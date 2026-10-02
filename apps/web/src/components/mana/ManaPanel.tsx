import { MANA_INTENTS, MANA_SOURCE_STATUS, MANA_SUGGESTIONS, type ManaAnswer, type ManaSource, type ManaStatement, NOTE_SECTIONS, type NoteFields } from '@adaxai/contracts'
import { BookOpenCheck, CheckCheck, FileText, LoaderCircle, MessageCircleQuestion, NotebookPen, RotateCcw, Send, Sparkles } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
import { Link } from 'react-router'
import { errorMessage } from '../../lib/api.ts'
import { usePortalBase } from '../../lib/clinical.ts'
import { fmtDate, fmtDateTime } from '../../lib/format.ts'
import type { NoteInserter } from '../../lib/insert.ts'
import { manaKey, useAiStatus, useAskMana, useManaAction, useManaAnswers } from '../../lib/mana.ts'
import { provenanceLabel } from '../ai/Evidence.tsx'
import { SECTION_LABEL } from '../ai/InsertButton.tsx'
import { Button } from '../ui/Button.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { Alert, Badge } from '../ui/Feedback.tsx'
import { CheckboxField, SelectField, TextAreaField, TextField } from '../ui/Form.tsx'
import { Card } from '../ui/Layout.tsx'
import { useToast } from '../ui/Toast.tsx'

const KIND_BADGE: Partial<Record<ManaStatement['kind'], { tone: 'neutral' | 'down' | 'warn'; label: string }>> = {
  absent: { tone: 'neutral', label: 'Not in record' },
  conflict: { tone: 'down', label: 'Conflict' },
  outdated: { tone: 'warn', label: 'Possibly outdated' },
}

const fmtSourceDate = (d: string | null) => (d ? (d.length === 10 ? fmtDate(d) : fmtDateTime(d)) : 'undated')

/** The record items a statement is based on, expandable, each linking to its consultation. */
function SourceRefs({ refs, sources }: { refs: string[]; sources: ManaSource[] }) {
  const base = usePortalBase()
  if (!refs.length) return null
  const items = refs.map((r) => sources.find((s) => s.ref === r)).filter((s): s is ManaSource => !!s)
  return (
    <details className="mt-0.5 text-xs">
      <summary className="cursor-pointer text-ink-muted">Sources: {refs.join(', ')}</summary>
      <ul className="mt-1 space-y-1">
        {items.map((s) => (
          <li key={s.ref} className="rounded bg-canvas px-2 py-1">
            <span className="font-mono text-ink-muted">{s.ref}</span> <span className="font-medium">{s.field}</span> · {fmtSourceDate(s.date)} <Badge tone={s.status === 'draft' ? 'warn' : s.status === 'amended' ? 'warn' : 'notice'}>{MANA_SOURCE_STATUS[s.status]}</Badge>{' '}
            <Badge>{provenanceLabel(s.provenance)}</Badge>
            <span className="mt-0.5 block">“{s.excerpt}”</span>
            {s.encounterId && (
              <Link to={`${base}/encounters/${s.encounterId}`} className="font-medium text-brand-strong underline underline-offset-2">
                Open consultation
              </Link>
            )}
          </li>
        ))}
      </ul>
    </details>
  )
}

function Statement({ s, sources }: { s: ManaStatement; sources: ManaSource[] }) {
  const badge = KIND_BADGE[s.kind]
  return (
    <li className={`text-sm ${s.unsupported ? 'text-ink-muted' : ''}`}>
      {badge && (
        <span className="mr-1">
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </span>
      )}
      {s.unsupported && (
        <span className="mr-1">
          <Badge tone="warn">Not supported by the record</Badge>
        </span>
      )}
      {s.text}
      <SourceRefs refs={s.refs} sources={sources} />
    </li>
  )
}

function Generation({ a }: { a: ManaAnswer }) {
  const retry = useManaAction(a.patientId, 'retry')
  const g = a.generation
  if (g.status === 'succeeded') {
    return (
      <div className="mt-3 rounded-md border border-ai/30 bg-ai-soft p-3" data-testid="mana-ai-summary">
        <Badge tone="ai" wrap icon={<Sparkles aria-hidden="true" className="size-3 shrink-0" />}>
          AI-generated summary · check against the sources
        </Badge>
        <ul className="mt-2 space-y-1.5">
          {g.statements.map((s, i) => (
            <Statement key={i} s={s} sources={a.sources} />
          ))}
        </ul>
        {g.notFound.length > 0 && (
          <p className="mt-2 text-sm">
            <span className="font-medium">Not found in the record:</span> {g.notFound.join('; ')}
          </p>
        )}
        <p className="mt-2 text-xs text-ink-muted">
          {g.provider} · {g.model} · prompt {g.promptVersion}
        </p>
      </div>
    )
  }
  if (g.status === 'pending') {
    return (
      <p role="status" className="mt-3 flex items-center gap-2 text-xs text-ink-muted">
        <LoaderCircle aria-hidden="true" className="size-3 animate-spin" /> AI summary in progress…
      </p>
    )
  }
  if (g.status === 'failed') {
    return (
      <Alert tone="warning" title="AI summary failed" className="mt-3">
        {g.reason}
        {g.retryable && (
          <Button size="sm" variant="secondary" className="mt-2" loading={retry.isPending} icon={<RotateCcw aria-hidden="true" className="size-4" />} onClick={() => retry.mutate(a.id)}>
            Retry AI summary
          </Button>
        )}
        {retry.isError && <span className="mt-1 block">{errorMessage(retry.error)}</span>}
      </Alert>
    )
  }
  return (
    <p className="mt-3 text-xs text-ink-muted">
      <span className="font-medium">{g.status === 'consent_required' ? 'No AI summary: consent needed.' : g.status === 'not_requested' ? 'No AI summary requested.' : 'AI summary unavailable.'}</span> {g.reason}
    </p>
  )
}

function InsertDialog({ a, inserter, onClose }: { a: ManaAnswer; inserter: NoteInserter; onClose: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const lines = (statements: ManaStatement[]) => statements.filter((s) => !s.unsupported).map((s) => `- ${s.text}`).join('\n')
  const recordText = a.record.sections.map((sec) => `${sec.title}:\n${lines(sec.statements)}`).join('\n')
  const aiText = a.generation.status === 'succeeded' ? lines(a.generation.statements) : null
  const [source, setSource] = useState<'record' | 'ai'>('record')
  const [section, setSection] = useState<keyof NoteFields>('history')
  const [text, setText] = useState(recordText)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Dialog
      open
      onClose={onClose}
      title="Insert into the note"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={!text.trim()}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await inserter.insert(section, text.trim(), { type: 'mana_answer', id: a.id })
                void qc.invalidateQueries({ queryKey: manaKey(a.patientId) })
                toast('success', `Added to ${SECTION_LABEL[section]}. Review it in the note.`)
                onClose()
              } catch (e) {
                setError(errorMessage(e))
              } finally {
                setBusy(false)
              }
            }}
          >
            Insert into {SECTION_LABEL[section]}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-ink-muted">Edit the text before inserting. The note will record that it came from this Mana answer.</p>
        {aiText && (
          <SelectField
            label="Start from"
            value={source}
            onChange={(e) => {
              const v = e.target.value as 'record' | 'ai'
              setSource(v)
              setText(v === 'ai' ? aiText : recordText)
            }}
          >
            <option value="record">Answer from the record</option>
            <option value="ai">AI-generated summary</option>
          </SelectField>
        )}
        <SelectField label="Note section" value={section} onChange={(e) => setSection(e.target.value as keyof NoteFields)}>
          {NOTE_SECTIONS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </SelectField>
        <TextAreaField label="Text to insert" rows={8} value={text} onChange={(e) => setText(e.target.value)} />
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Dialog>
  )
}

function AnswerCard({ a, inserter }: { a: ManaAnswer; inserter?: NoteInserter | undefined }) {
  const headingId = useId()
  const review = useManaAction(a.patientId, 'review')
  const [inserting, setInserting] = useState(false)
  return (
    <article aria-labelledby={headingId} className="animate-rise-in rounded-lg border border-line p-3" data-testid="mana-answer">
      <h3 id={headingId} className="text-sm font-semibold">
        <MessageCircleQuestion aria-hidden="true" className="mr-1 inline size-4 text-brand" />
        {a.question}
      </h3>
      <p className="text-xs text-ink-muted">
        {MANA_INTENTS[a.intent]} · {fmtDateTime(a.createdAt)}
        {a.askedByName && ` · ${a.askedByName}`}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge tone="notice" icon={<FileText aria-hidden="true" className="size-3" />}>
          From the record
        </Badge>
        <span className="text-xs text-ink-muted">explicit rules {a.record.rulesVersion}</span>
      </div>
      {a.record.sections.map((sec) => (
        <section key={sec.title} className="mt-2" aria-label={sec.title}>
          <h4 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">{sec.title}</h4>
          <ul className="mt-1 space-y-1.5">
            {sec.statements.map((s, i) => (
              <Statement key={i} s={s} sources={a.sources} />
            ))}
          </ul>
        </section>
      ))}
      <Generation a={a} />
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-2">
        {a.review.reviewedAt ? (
          <Badge tone="ok" wrap icon={<CheckCheck aria-hidden="true" className="size-3 shrink-0" />}>
            Reviewed by {a.review.reviewedByName} · {fmtDateTime(a.review.reviewedAt)}
          </Badge>
        ) : (
          <Button size="sm" variant="ghost" loading={review.isPending} icon={<BookOpenCheck aria-hidden="true" className="size-4" />} onClick={() => review.mutate(a.id)}>
            Mark reviewed
          </Button>
        )}
        {inserter && (
          <Button size="sm" variant="secondary" icon={<NotebookPen aria-hidden="true" className="size-4" />} onClick={() => setInserting(true)}>
            Insert into note…
          </Button>
        )}
        {a.insertions > 0 && <Badge tone="ai">In the note ×{a.insertions}</Badge>}
      </div>
      {inserting && inserter && <InsertDialog a={a} inserter={inserter} onClose={() => setInserting(false)} />}
    </article>
  )
}

/**
 * Mana AI: questions about one patient. Answers are read from this patient's
 * record by explicit rules, with the source of every statement; an AI
 * summary is added only when a provider is configured and the patient has
 * consented, and it is always labelled as generated.
 */
export function ManaPanel({ patientId, encounterId, inserter }: { patientId: string; encounterId?: string | undefined; inserter?: NoteInserter | undefined }) {
  const status = useAiStatus()
  const answers = useManaAnswers(patientId)
  const ask = useAskMana(patientId)
  const [question, setQuestion] = useState('')
  const [withAi, setWithAi] = useState(true)
  const [showAll, setShowAll] = useState(false)
  // Screen readers hear a short notice when an answer arrives, not the whole answer list.
  const [announce, setAnnounce] = useState('')
  const announced = (a: ManaAnswer) => setAnnounce(`Mana answered: ${a.question}`)
  const qa = status.data?.qa
  // The server decides whether a summary can run (provider, consent) and says why not; the client only passes the doctor's choice.
  const generate = withAi
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (question.trim().length < 3) return
    ask.mutate({ question: question.trim(), generate, ...(encounterId && { encounterId }) }, { onSuccess: (a) => (setQuestion(''), announced(a)) })
  }
  const list = answers.data ?? []
  const shown = showAll ? list : list.slice(0, 2)
  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          <Sparkles aria-hidden="true" className="size-4 text-ai" />
          Mana AI
        </span>
      }
    >
      <p className="text-sm text-ink-muted">Ask about this patient’s record. Answers show what the record documents, with the source of each statement, and say what is missing.</p>
      {qa && (
        <p className="mt-1 text-xs text-ink-muted">
          {qa.available ? (
            <>
              AI summaries: {qa.provider} · {qa.model}. Sent only with the patient’s consent, without name or contact details.
            </>
          ) : (
            <>AI summaries unavailable: {qa.reason}</>
          )}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Suggested questions">
        {MANA_SUGGESTIONS.map((s) => (
          <button
            key={s.intent}
            type="button"
            disabled={ask.isPending}
            onClick={() => ask.mutate({ question: s.question, intent: s.intent, generate, ...(encounterId && { encounterId }) }, { onSuccess: announced })}
            className="min-h-9 rounded-full border border-brand/30 bg-brand-soft px-3 text-xs font-medium text-brand-strong transition-colors hover:bg-brand/10 disabled:opacity-60"
          >
            {s.label}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="mt-3 flex items-end gap-2">
        <TextField label="Ask Mana" className="min-w-0 flex-1" value={question} maxLength={500} placeholder="e.g. Any mention of chest pain?" onChange={(e) => setQuestion(e.target.value)} />
        <Button type="submit" loading={ask.isPending} disabled={question.trim().length < 3} icon={<Send aria-hidden="true" className="size-4" />}>
          Ask
        </Button>
      </form>
      {qa?.available && (
        <div className="mt-2">
          <CheckboxField label="Add an AI summary" hint="Sends the relevant record items for this question, without name or contact details, to the AI service." checked={withAi} onChange={(e) => setWithAi(e.target.checked)} />
        </div>
      )}
      {ask.isPending && (
        <p role="status" className="mt-3 flex items-center gap-2 text-sm text-ink-muted">
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> Mana is reading the record…
        </p>
      )}
      {ask.isError && (
        <Alert tone="error" className="mt-3">
          {errorMessage(ask.error)}
        </Alert>
      )}
      {answers.isError && (
        <Alert tone="error" className="mt-3">
          {errorMessage(answers.error)}
        </Alert>
      )}
      <p role="status" className="sr-only">
        {announce}
      </p>
      <div className="mt-4 space-y-3">
        {shown.map((a) => (
          <AnswerCard key={a.id} a={a} inserter={inserter} />
        ))}
      </div>
      {list.length > shown.length && (
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => setShowAll(true)}>
          Show earlier answers ({list.length - shown.length})
        </Button>
      )}
    </Card>
  )
}
