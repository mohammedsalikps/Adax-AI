import { type AiDraftItem, type Encounter, type EncounterAi, type Transcript } from '@adaxai/contracts'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, FileAudio, ListChecks, Mic, Pencil, ShieldAlert, Sparkles, Square, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { type AiResponse, aiKey, newIdempotencyKey, useAiMutation } from '../../lib/ai.ts'
import { api, ApiError, errorMessage } from '../../lib/api.ts'
import { fmtDateTime } from '../../lib/format.ts'
import type { NoteInserter } from '../../lib/insert.ts'
import { ActivityView } from '../ai/ActivityView.tsx'
import { FactsView } from '../ai/FactsView.tsx'
import { InsertButton, SECTION_LABEL } from '../ai/InsertButton.tsx'
import { LiveRecorder } from '../ai/LiveRecorder.tsx'
import { RecommendationsView } from '../ai/RecommendationsView.tsx'
import { Button } from '../ui/Button.tsx'
import { Alert, Badge, Spinner } from '../ui/Feedback.tsx'
import { TextAreaField } from '../ui/Form.tsx'
import { Card } from '../ui/Layout.tsx'
import { useToast } from '../ui/Toast.tsx'

const MAX_RECORDING_S = 15 * 60

/** Browser recording with MediaRecorder. Audio is uploaded only when the doctor stops the recording. */
function Recorder({ onRecorded, disabled }: { onRecorded: (blob: Blob) => void; disabled: boolean }) {
  const [state, setState] = useState<'idle' | 'recording' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [seconds, setSeconds] = useState(0)
  const rec = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const supported = typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'

  const stop = () => {
    if (timer.current) clearInterval(timer.current)
    rec.current?.stop()
  }
  useEffect(() => () => stop(), [])
  useEffect(() => {
    if (seconds >= MAX_RECORDING_S) stop()
  }, [seconds])

  const start = async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : ''
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunks.current = []
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data)
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        setState('idle')
        const blob = new Blob(chunks.current, { type: (r.mimeType || 'audio/webm').split(';')[0] })
        if (blob.size) onRecorded(blob)
      }
      rec.current = r
      r.start(1000)
      setSeconds(0)
      timer.current = setInterval(() => setSeconds((s) => s + 1), 1000)
      setState('recording')
    } catch {
      setState('error')
      setError('Microphone not available or permission denied.')
    }
  }

  if (!supported) return <p className="text-sm text-ink-muted">This browser cannot record audio. Upload a recording or type the transcript.</p>
  return (
    <div className="space-y-2">
      {state === 'recording' ? (
        <div className="flex flex-wrap items-center gap-3">
          <span role="status" className="inline-flex items-center gap-2 text-sm font-medium text-down">
            <span className="size-2.5 animate-pulse rounded-full bg-down" aria-hidden="true" />
            Recording {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
          </span>
          <Button variant="danger" size="sm" icon={<Square aria-hidden="true" className="size-4" />} onClick={stop}>
            Stop and save
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="secondary" icon={<Mic aria-hidden="true" className="size-4" />} onClick={() => void start()} disabled={disabled}>
          Start recording
        </Button>
      )}
      {error && <p className="text-sm text-down">{error}</p>}
      <p className="text-xs text-ink-muted">Maximum {MAX_RECORDING_S / 60} minutes. Audio is stored with the consultation.</p>
    </div>
  )
}

function TranscriptView({ t, highlight }: { t: Transcript; highlight: Set<string> }) {
  return (
    <ol className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-line bg-canvas p-3 text-sm" aria-label="Transcript segments">
      {t.segments.map((s) => (
        <li key={s.id} className={highlight.has(s.id) ? 'rounded bg-ai-soft px-1' : 'px-1'} title={typeof s.chunkIndex === 'number' ? `Recorded part ${s.chunkIndex + 1}` : undefined}>
          <span className="font-mono text-xs text-ink-muted">{s.id}</span> {s.speaker && <strong>{s.speaker}: </strong>}
          {s.text}
        </li>
      ))}
    </ol>
  )
}

function SuggestionCard({ item, transcript, encounterId, inserter, onFocusSources }: { item: AiDraftItem; transcript?: Transcript; encounterId: string; inserter: NoteInserter; onFocusSources: (ids: string[]) => void }) {
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(item.text)
  const [confirmUnsupported, setConfirmUnsupported] = useState(false)
  const decide = useAiMutation<{ decision: 'accepted' | 'edited' | 'rejected'; text?: string }>(encounterId, (body) =>
    api(`/ai-draft-items/${item.id}/decision`, { method: 'POST', body: { ...body, confirmUnsupported } }),
  )
  const act = (decision: 'accepted' | 'edited' | 'rejected') =>
    decide.mutate(decision === 'edited' ? { decision, text } : { decision }, {
      onSuccess: (r) => {
        if (decision !== 'rejected' && r.item?.finalText) {
          // Accepting a note suggestion inserts it (recorded on the server with a reference to this suggestion).
          inserter.insert(item.section, r.item.finalText, { type: 'draft_item', id: item.id }).then(
            () => toast('success', `Added to ${SECTION_LABEL[item.section]}. Review it in the note.`),
            (e: unknown) => toast('error', `Accepted, but not added to the note: ${errorMessage(e)}`),
          )
        }
        setEditing(false)
      },
    })
  const sources = (transcript?.segments ?? []).filter((s) => item.sourceSegmentIds.includes(s.id))
  const decided = item.decision !== 'pending' && item.decision !== 'deferred'
  return (
    <li className={`rounded-lg border p-3 ${decided ? 'border-line bg-surface opacity-80' : 'border-ai/30 bg-ai-soft'}`}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Badge tone="ai" icon={<Sparkles aria-hidden="true" className="size-3" />}>
          AI draft
        </Badge>
        <span className="text-sm font-medium">{SECTION_LABEL[item.section]}</span>
        {item.decision === 'accepted' && <Badge tone="ok">Accepted</Badge>}
        {item.decision === 'edited' && <Badge tone="ok">Edited and accepted</Badge>}
        {item.decision === 'rejected' && <Badge>Rejected</Badge>}
      </div>
      {editing ? (
        <TextAreaField label="Edit before adding" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      ) : (
        <p className={`text-sm ${item.decision === 'rejected' ? 'line-through' : ''}`}>{item.finalText ?? item.text}</p>
      )}
      {item.unsupported ? (
        <Alert tone="warning" className="mt-2">
          Not linked to any part of the transcript. It may be inaccurate.
          {!decided && (
            <label className="mt-1 flex items-center gap-2 font-medium">
              <input type="checkbox" className="size-4 accent-brand" checked={confirmUnsupported} onChange={(e) => setConfirmUnsupported(e.target.checked)} />I have checked this against the consultation
            </label>
          )}
        </Alert>
      ) : (
        <details className="mt-2 text-xs" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && onFocusSources(item.sourceSegmentIds)}>
          <summary className="cursor-pointer text-ink-muted">Source: {item.sourceSegmentIds.join(', ')}</summary>
          <ul className="mt-1 space-y-1">
            {sources.map((s) => (
              <li key={s.id} className="rounded bg-surface px-2 py-1">
                <span className="font-mono text-ink-muted">{s.id}</span> {s.speaker && <strong>{s.speaker}: </strong>}“{s.text}”
              </li>
            ))}
          </ul>
        </details>
      )}
      {decide.isError && <p className="mt-2 text-sm text-down">{errorMessage(decide.error)}</p>}
      {!decided && (
        <div className="mt-2 flex flex-wrap gap-2">
          {editing ? (
            <>
              <Button size="sm" icon={<Check aria-hidden="true" className="size-4" />} loading={decide.isPending} disabled={!text.trim() || (item.unsupported && !confirmUnsupported)} onClick={() => act('edited')}>
                Add edited text
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" icon={<Check aria-hidden="true" className="size-4" />} loading={decide.isPending} disabled={item.unsupported && !confirmUnsupported} onClick={() => act('accepted')}>
                Accept
              </Button>
              <Button size="sm" variant="secondary" icon={<Pencil aria-hidden="true" className="size-4" />} onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button size="sm" variant="ghost" icon={<X aria-hidden="true" className="size-4" />} loading={decide.isPending} onClick={() => act('rejected')}>
                Reject
              </Button>
            </>
          )}
        </div>
      )}
      {/* Accepting inserts automatically; if that failed (or after a reload), the doctor can insert it here. */}
      {(item.decision === 'accepted' || item.decision === 'edited') && <InsertButton inserter={inserter} section={item.section} text={item.finalText ?? item.text} subject={{ type: 'draft_item', id: item.id }} />}
    </li>
  )
}

type Tab = 'draft' | 'facts' | 'recommendations' | 'activity'

/**
 * Consultation assistant: consent, transcript (recorded, live, uploaded or
 * typed), then drafting, fact extraction and recommendations, each reviewed
 * item by item. Nothing reaches the note without the doctor's Accept/Edit,
 * and signing stays a separate action.
 */
export function AiAssistantPanel({ encounter, inserter }: { encounter: Encounter; inserter: NoteInserter }) {
  const toast = useToast()
  const qc = useQueryClient()
  const id = encounter.id
  const tabsId = useId()
  const q = useQuery({ queryKey: aiKey(id), queryFn: () => api<EncounterAi>(`/encounters/${id}/ai`) })
  const [text, setText] = useState('')
  const [tab, setTab] = useState<Tab>('draft')
  const [highlight, setHighlight] = useState<Set<string>>(new Set())
  const consent = useAiMutation<{ method: 'verbal' | 'written' }>(id, (body) => api(`/encounters/${id}/ai-consent`, { method: 'POST', body }))
  const saveTranscript = useAiMutation<{ text: string }>(id, (body) => api(`/encounters/${id}/transcripts`, { method: 'POST', body: { ...body, source: 'pasted' } }))
  const uploadAudio = useAiMutation<{ blob: Blob; name: string; source: 'browser_recording' | 'audio_upload' }>(id, ({ blob, name, source }) => {
    const fd = new FormData()
    fd.append('source', source)
    fd.append('file', blob, name)
    return api(`/encounters/${id}/audio`, { method: 'POST', body: fd })
  })
  const draft = useAiMutation<string>(id, (transcriptId) => api(`/transcripts/${transcriptId}/drafts`, { method: 'POST', body: { idempotencyKey: newIdempotencyKey() } }))
  const extract = useAiMutation<string>(id, (transcriptId) => api(`/transcripts/${transcriptId}/extract`, { method: 'POST', body: { idempotencyKey: newIdempotencyKey() } }))
  const recommend = useAiMutation<boolean>(id, (includeLlm) => api(`/encounters/${id}/recommendations`, { method: 'POST', body: { includeLlm, idempotencyKey: newIdempotencyKey() } }))
  const onLiveUpdate = (r: AiResponse) => {
    if (r.consent) qc.setQueryData(aiKey(id), r)
    if (r.notice) toast('error', r.notice)
  }
  // A failed job is listed under Activity (with Retry); refresh so it appears.
  const refreshOnError = { onError: () => void qc.invalidateQueries({ queryKey: aiKey(id) }) }

  if (q.isPending)
    return (
      <Card title="AI consultation assistant">
        <Spinner />
      </Card>
    )
  if (q.isError)
    return (
      <Card title="AI consultation assistant">
        <Alert tone="error">{errorMessage(q.error)}</Alert>
      </Card>
    )
  const ai = q.data
  const latest = ai.transcripts.at(-1)
  const latestDraft = ai.drafts[0]
  const draftTranscript = ai.transcripts.find((t) => t.id === latestDraft?.transcriptId)
  const pending = latestDraft?.items.filter((i) => i.decision === 'pending').length ?? 0
  const live = latest?.status === 'live'
  const llm = ai.status.llm.available
  const tabs: [Tab, string, number][] = [
    ['draft', 'Note suggestions', pending],
    ['facts', 'Facts', ai.facts.filter((f) => f.status === 'pending' || f.status === 'deferred').length],
    ['recommendations', 'Recommendations', ai.recommendations.filter((r) => r.status === 'pending' || r.status === 'deferred').length],
    ['activity', 'Activity', ai.jobs.filter((j) => j.status === 'failed').length],
  ]
  const focus = (ids: string[]) => setHighlight(new Set(ids))

  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          <Sparkles aria-hidden="true" className="size-4 text-ai" />
          AI consultation assistant
        </span>
      }
    >
      <div className="@container space-y-4">
        <p className="text-xs text-ink-muted">Everything here is a draft for you to review. Nothing is added to the note until you accept or edit it, and signing is always your separate action. The assistant is not clinically validated.</p>
        <ul className="flex flex-wrap gap-2 text-xs">
          <li>
            <Badge tone={llm ? 'ok' : 'neutral'}>AI drafting: {llm ? `available (${ai.status.llm.model})` : 'unavailable'}</Badge>
          </li>
          <li>
            <Badge tone={ai.status.stt.available ? 'ok' : 'neutral'}>Speech-to-text: {ai.status.stt.available ? `available (${ai.status.stt.model})` : 'unavailable'}</Badge>
          </li>
          <li>
            <Badge tone="notice">Safety rules: always on</Badge>
          </li>
        </ul>

        {!ai.consent.granted ? (
          <div className="rounded-lg border border-line p-3 text-sm">
            <p className="font-medium">Patient consent needed</p>
            <p className="mt-1 text-ink-muted">
              Ask the patient whether the consultation may be recorded and processed, with relevant parts of their record (without name or contact details), by external speech-to-text and AI services to draft notes and suggest points for you to review. They can say no;
              care is not affected.
            </p>
            {consent.isError && (
              <Alert tone="error" className="mt-2">
                {errorMessage(consent.error)}
              </Alert>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" loading={consent.isPending} onClick={() => consent.mutate({ method: 'verbal' }, { onSuccess: () => toast('success', 'Consent recorded for this consultation') })}>
                Patient agrees (verbal)
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-xs text-ok">
              Consent recorded {ai.consent.scope === 'encounter' ? 'for this consultation' : '(ongoing)'} · {fmtDateTime(ai.consent.recordedAt)}
            </p>
            {!ai.consent.current && (
              <Alert tone="info" title="Consent wording has changed">
                The patient agreed to an earlier wording that did not cover using their record for recommendations. Drafting and extraction still work. To use record-aware AI recommendations, read the current wording and record consent again.
                <span className="mt-2 block">
                  <Button size="sm" variant="secondary" loading={consent.isPending} onClick={() => consent.mutate({ method: 'verbal' })}>
                    Patient agrees to current wording (verbal)
                  </Button>
                </span>
              </Alert>
            )}
            <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
              <div className="space-y-3">
                <p className="text-sm font-medium">Record or upload audio</p>
                {ai.status.stt.available && ai.status.features.liveTranscription && <LiveRecorder encounterId={id} chunkSeconds={ai.status.liveChunkSeconds} onUpdate={onLiveUpdate} disabled={uploadAudio.isPending} />}
                <Recorder disabled={uploadAudio.isPending} onRecorded={(blob) => uploadAudio.mutate({ blob, name: `recording.${blob.type.includes('ogg') ? 'ogg' : 'webm'}`, source: 'browser_recording' })} />
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-brand-strong underline underline-offset-2">
                  <FileAudio aria-hidden="true" className="size-4" />
                  Upload an audio file
                  <input
                    type="file"
                    accept="audio/*"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) uploadAudio.mutate({ blob: f, name: f.name, source: 'audio_upload' })
                      e.target.value = ''
                    }}
                  />
                </label>
                {uploadAudio.isPending && <Spinner label="Uploading audio…" />}
                {uploadAudio.isError && <Alert tone="error">{errorMessage(uploadAudio.error)}</Alert>}
                {ai.audio.length > 0 && (
                  <ul className="space-y-2" aria-label="Saved recordings">
                    {ai.audio.map((a) => (
                      <li key={a.fileId} className="text-xs text-ink-muted">
                        <audio controls preload="none" src={`/api/files/${a.fileId}`} className="w-full" aria-label={`Recording from ${fmtDateTime(a.createdAt)}`} />
                        {fmtDateTime(a.createdAt)} · {(a.sizeBytes / 1024).toFixed(0)} KB · {a.transcriptId ? 'transcribed' : 'not transcribed'}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="space-y-2">
                <TextAreaField label="Or type / paste the transcript" hint="One line per utterance. Start lines with “Doctor:” or “Patient:” to label speakers." rows={6} value={text} onChange={(e) => setText(e.target.value)} />
                {saveTranscript.isError && <Alert tone="error">{errorMessage(saveTranscript.error)}</Alert>}
                <Button size="sm" variant="secondary" disabled={!text.trim()} loading={saveTranscript.isPending} onClick={() => saveTranscript.mutate({ text }, { onSuccess: () => setText('') })}>
                  Save transcript
                </Button>
              </div>
            </div>

            {latest && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    Transcript · {latest.segments.length} segments · {latest.source.replace('_', ' ')} · {fmtDateTime(latest.createdAt)} {live && <Badge tone="warn">Live, still recording</Badge>}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      icon={<Sparkles aria-hidden="true" className="size-4" />}
                      disabled={!llm || live || !latest.segments.length}
                      loading={draft.isPending}
                      onClick={() => draft.mutate(latest.id, { onSuccess: () => (setTab('draft'), toast('success', 'Draft ready for review')), ...refreshOnError })}
                    >
                      {latestDraft?.transcriptId === latest.id ? 'Draft again' : 'Generate draft'}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<ListChecks aria-hidden="true" className="size-4" />}
                      disabled={!llm || live || !latest.segments.length || !ai.status.features.extraction}
                      loading={extract.isPending}
                      onClick={() => extract.mutate(latest.id, { onSuccess: () => (setTab('facts'), toast('success', 'Facts ready for review')), ...refreshOnError })}
                    >
                      Extract facts
                    </Button>
                  </div>
                </div>
                {!llm && <Alert tone="info">{ai.status.llm.reason} Write the note yourself; the transcript is saved for reference.</Alert>}
                {draft.isError && (
                  <Alert tone="error" title="Drafting failed">
                    {errorMessage(draft.error)}
                    {draft.error instanceof ApiError && draft.error.status === 502 ? ' See Activity to retry.' : ''}
                  </Alert>
                )}
                {extract.isError && (
                  <Alert tone="error" title="Extraction failed">
                    {errorMessage(extract.error)}
                  </Alert>
                )}
                <TranscriptView t={latest} highlight={highlight} />
              </div>
            )}
          </>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <p className="text-sm text-ink-muted">
            Safety rules check the prescription against recorded allergies, vital signs, missing information and red-flag phrases.{ai.consent.granted && llm ? ' AI suggestions also use the record and transcript.' : ''}
          </p>
          <Button size="sm" variant="secondary" icon={<ShieldAlert aria-hidden="true" className="size-4" />} loading={recommend.isPending} onClick={() => recommend.mutate(ai.consent.granted && llm, { onSuccess: () => setTab('recommendations'), ...refreshOnError })}>
            Get recommendations
          </Button>
        </div>
        {recommend.isError && <Alert tone="error">{errorMessage(recommend.error)}</Alert>}

        <div role="tablist" aria-label="Assistant output" className="flex flex-wrap gap-1 border-b border-line">
          {tabs.map(([key, label, n]) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`${tabsId}-${key}`}
              aria-selected={tab === key}
              aria-controls={`${tabsId}-panel`}
              tabIndex={tab === key ? 0 : -1}
              onClick={() => setTab(key)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
                const i = tabs.findIndex(([k]) => k === tab)
                const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]![0]
                setTab(next)
                document.getElementById(`${tabsId}-${next}`)?.focus()
              }}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === key ? 'border-brand text-brand-strong' : 'border-transparent text-ink-muted hover:text-ink'}`}
            >
              {label}
              {n > 0 && <span className="ml-1 rounded-full bg-ai-soft px-1.5 text-xs text-ai">{n}</span>}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${tab}`}>
          {tab === 'draft' &&
            (latestDraft ? (
              <section aria-label="Suggestions to review" className="space-y-2">
                <p className="text-sm font-medium">
                  Suggestions to review {pending > 0 && <Badge tone="ai">{pending} pending</Badge>}{' '}
                  <span className="text-xs font-normal text-ink-muted">
                    · {latestDraft.run.model} · prompt {latestDraft.run.promptVersion} · {fmtDateTime(latestDraft.createdAt)}
                  </span>
                </p>
                {latestDraft.items.length === 0 && <p className="text-sm text-ink-muted">The assistant found nothing to suggest from this transcript.</p>}
                <ul className="space-y-2">
                  {latestDraft.items
                    .filter((i) => i.decision !== 'superseded')
                    .map((i) => (
                      <SuggestionCard key={i.id} item={i} transcript={draftTranscript} encounterId={id} inserter={inserter} onFocusSources={focus} />
                    ))}
                </ul>
              </section>
            ) : (
              <p className="text-sm text-ink-muted">No note draft yet. Use “Generate draft” on a transcript.</p>
            ))}
          {tab === 'facts' && <FactsView facts={ai.facts} encounterId={id} inserter={inserter} onFocus={focus} />}
          {tab === 'recommendations' && <RecommendationsView recommendations={ai.recommendations} jobs={ai.jobs} encounterId={id} inserter={inserter} onFocus={focus} />}
          {tab === 'activity' && <ActivityView ai={ai} encounterId={id} />}
        </div>
      </div>
    </Card>
  )
}
