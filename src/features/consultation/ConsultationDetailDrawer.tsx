import { useState } from 'react'
import { Badge, Divider, Drawer, Tabs } from '@/components/ui'
import { ClinicalDataRow } from '@/components/clinical'
import { formatDate, formatDateTime } from '@/lib/format'
import {
  AI_DRAFT_DISCLAIMER,
  NOT_MENTIONED,
  type Consultation,
} from '@/types/consultation'
import { TranscriptMeta, TranscriptViewer } from './TranscriptViewer'

export interface ConsultationDetailDrawerProps {
  consultation: Consultation | null
  onClose: () => void
}

type DetailTab = 'details' | 'transcript' | 'draft'

/**
 * Read-only view of a saved consultation. Opening it never regenerates,
 * modifies or re-saves anything.
 */
export function ConsultationDetailDrawer({
  consultation,
  onClose,
}: ConsultationDetailDrawerProps) {
  // Remounting per consultation resets the tab without an effect.
  return (
    <DetailBody
      key={consultation?.id ?? 'none'}
      consultation={consultation}
      onClose={onClose}
    />
  )
}

function DetailBody({ consultation, onClose }: ConsultationDetailDrawerProps) {
  const [tab, setTab] = useState<DetailTab>('details')

  const transcript = consultation?.transcript ?? []
  const draft = consultation?.aiDraft ?? null

  const tabs = [
    { value: 'details', label: 'Details' },
    ...(transcript.length > 0
      ? [{ value: 'transcript', label: 'Transcript', count: transcript.length }]
      : []),
    ...(draft ? [{ value: 'draft', label: 'AI draft' }] : []),
  ]

  return (
    <Drawer
      open={consultation !== null}
      onClose={onClose}
      title={consultation?.chiefComplaint || 'Consultation'}
      description={
        consultation
          ? `${formatDateTime(consultation.createdAt)} · ${consultation.doctorName}`
          : undefined
      }
      size="lg"
    >
      {consultation && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={consultation.status === 'completed' ? 'normal' : 'caution'}>
              {consultation.status === 'completed' ? 'Completed' : 'Draft'}
            </Badge>
            <span className="tnum text-[11px] text-ink-muted">
              Saved {formatDateTime(consultation.createdAt)}
            </span>
            <span aria-hidden className="text-ink-muted">
              ·
            </span>
            <span className="tnum text-[11px] text-ink-muted">
              Last updated {formatDateTime(consultation.updatedAt)}
            </span>
          </div>

          {tabs.length > 1 && (
            <Tabs
              ariaLabel="Consultation record sections"
              items={tabs}
              value={tab}
              onValueChange={(value) => setTab(value as DetailTab)}
            />
          )}

          {tab === 'details' && (
            <div className="space-y-5">
              <Section title="Chief complaint" body={consultation.chiefComplaint} />
              <Section
                title="History of present illness"
                body={consultation.historyOfPresentIllness}
              />
              <Section title="Examination" body={consultation.examination} />

              <div>
                <SectionTitle>Diagnosis</SectionTitle>
                {consultation.diagnoses.length === 0 ? (
                  <Empty />
                ) : (
                  <ul className="mt-1.5 space-y-1.5">
                    {consultation.diagnoses.map((diagnosis) => (
                      <li key={diagnosis.id} className="text-[13px]">
                        <span className="font-semibold text-ink">{diagnosis.name}</span>
                        {diagnosis.notes && (
                          <span className="text-ink-muted"> — {diagnosis.notes}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <SectionTitle>Prescription</SectionTitle>
                {consultation.prescription.length === 0 ? (
                  <Empty text="Nothing prescribed at this visit." />
                ) : (
                  <div className="mt-2 space-y-2">
                    {consultation.prescription.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-control border border-line bg-surface-alt p-2.5"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <p className="text-[13px] font-semibold text-ink">
                            {item.medication}
                            {item.strength ? ` ${item.strength}` : ''}
                          </p>
                          <Badge variant="accent">Doctor-entered</Badge>
                        </div>
                        {item.genericName && (
                          <p className="text-[11px] text-ink-muted">{item.genericName}</p>
                        )}
                        <p className="tnum text-[11px] text-ink-soft">
                          {item.dose} · {item.frequency} · {item.route} · {item.duration}
                          {item.quantity ? ` · Qty ${item.quantity}` : ''}
                          {item.instructions ? ` · ${item.instructions}` : ''}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Section title="Clinical notes" body={consultation.clinicalNotes} />

              <Divider />

              <div className="space-y-0.5">
                <ClinicalDataRow
                  label="Follow-up"
                  value={consultation.followUp.required ? 'Required' : 'Not required'}
                  emphasis
                />
                {consultation.followUp.required && consultation.followUp.date && (
                  <ClinicalDataRow
                    label="Follow-up date"
                    value={formatDate(consultation.followUp.date)}
                    numeric
                  />
                )}
                {consultation.followUp.instructions && (
                  <ClinicalDataRow
                    label="Follow-up instructions"
                    value={consultation.followUp.instructions}
                    layout="stacked"
                  />
                )}
                <ClinicalDataRow label="Recorded by" value={consultation.doctorName} />
                <ClinicalDataRow
                  label="Status"
                  value={consultation.status === 'completed' ? 'Completed' : 'Draft'}
                />
              </div>
            </div>
          )}

          {tab === 'transcript' && (
            <div className="space-y-3">
              <TranscriptMeta lines={transcript} />
              <p className="text-[11px] text-ink-muted">
                Saved transcript, shown read-only. Continue the consultation to edit it.
              </p>
              <TranscriptViewer lines={transcript} />
            </div>
          )}

          {tab === 'draft' && draft && (
            <div className="space-y-4">
              <div className="rounded-control border border-ai/30 bg-ai-soft px-3 py-2.5">
                <p className="text-[13px] font-semibold text-ai">{AI_DRAFT_DISCLAIMER}</p>
                <p className="mt-0.5 text-xs text-ink-soft">
                  Generated {formatDateTime(draft.generatedAt)} from{' '}
                  {draft.sourceLineCount} transcript lines. Shown as a record of what was
                  drafted — the consultation fields above are what was actually saved.
                </p>
              </div>

              <DraftSectionView title="Chief complaint" text={draft.chiefComplaint.text} />
              <DraftSectionView
                title="History of present illness"
                text={draft.historyOfPresentIllness.text}
              />
              <DraftSectionView title="Examination" text={draft.examination.text} />
              <DraftSectionView title="Clinical notes" text={draft.clinicalNotes.text} />
              <DraftSectionView
                title="Follow-up instructions"
                text={draft.followUpInstructions.text}
              />

              <div>
                <SectionTitle>Possible diagnoses mentioned</SectionTitle>
                {draft.diagnoses.length === 0 ? (
                  <p className="mt-1 text-xs text-ink-muted italic">{NOT_MENTIONED}</p>
                ) : (
                  <ul className="mt-1.5 space-y-1.5">
                    {draft.diagnoses.map((diagnosis) => (
                      <li key={diagnosis.id} className="text-[13px]">
                        <span className="font-semibold text-ink">{diagnosis.name}</span>
                        <span className="block text-[11px] text-ink-muted">
                          Heard in the consultation: “{diagnosis.evidence}”
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Drawer>
  )
}

function SectionTitle({ children }: { children: string }) {
  return (
    <h3 className="text-[11px] font-semibold tracking-wider text-ink-muted uppercase">
      {children}
    </h3>
  )
}

function Empty({ text = 'Not recorded.' }: { text?: string }) {
  return <p className="mt-1 text-xs text-ink-muted">{text}</p>
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      {body.trim() ? (
        <p className="mt-1 text-[13px] whitespace-pre-wrap text-ink-soft">{body}</p>
      ) : (
        <Empty />
      )}
    </div>
  )
}

function DraftSectionView({ title, text }: { title: string; text: string }) {
  const unavailable = text === NOT_MENTIONED
  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      <p
        className={
          unavailable
            ? 'mt-1 text-xs text-ink-muted italic'
            : 'mt-1 text-[13px] whitespace-pre-wrap text-ink-soft'
        }
      >
        {text}
      </p>
    </div>
  )
}
