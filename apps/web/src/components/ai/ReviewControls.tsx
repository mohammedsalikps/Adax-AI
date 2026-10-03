import { Check, Clock, Pencil, X } from 'lucide-react'
import { useState } from 'react'
import { errorMessage } from '../../lib/api.ts'
import { type AiResponse, STATUS_LABEL, useReview } from '../../lib/ai.ts'
import { Button } from '../ui/Button.tsx'
import { Badge } from '../ui/Feedback.tsx'
import { TextAreaField } from '../ui/Form.tsx'

export function StatusBadge({ status }: { status: string }) {
  const tone = status === 'accepted' || status === 'edited' ? 'ok' : status === 'deferred' ? 'warn' : status === 'pending' ? 'ai' : 'neutral'
  return <Badge tone={tone}>{STATUS_LABEL[status] ?? status}</Badge>
}

/**
 * Accept / edit / reject / defer for one AI output. When `confirm` is set
 * (flagged or unsupported output) accepting needs an explicit checkbox; the
 * server enforces the same rule.
 */
export function ReviewControls({
  encounterId,
  type,
  id,
  text,
  status,
  confirm,
  editLabel = 'Edit before accepting',
  labels,
  onDecided,
}: {
  encounterId: string
  type: 'fact' | 'recommendation' | 'draft_item' | 'image_analysis'
  id: string
  text: string
  status: string
  confirm: string | null
  editLabel?: string
  /** Words for the buttons (the important points say "Confirm" where other AI output says "Accept"). */
  labels?: Partial<Record<'accept' | 'edit' | 'reject' | 'defer' | 'saveEdited', string>>
  onDecided?: (r: AiResponse) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)
  const [confirmed, setConfirmed] = useState(false)
  const review = useReview(encounterId, type, id)
  const L = { accept: 'Accept', edit: 'Edit', reject: 'Reject', defer: 'Defer', saveEdited: 'Save edited text', ...labels }
  if (status !== 'pending' && status !== 'deferred') return null
  const blocked = !!confirm && !confirmed
  const act = (action: 'accepted' | 'edited' | 'rejected' | 'deferred') =>
    review.mutate(action === 'edited' ? { action, text: draft, confirmFlags: confirmed } : { action, confirmFlags: confirmed }, {
      onSuccess: (r) => {
        setEditing(false)
        onDecided?.(r)
      },
    })
  return (
    <div className="mt-2 space-y-2">
      {confirm && (
        <label className="flex items-start gap-2 text-sm font-medium">
          <input type="checkbox" className="mt-0.5 size-4 accent-brand" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>I have checked this against the conversation and the record</span>
        </label>
      )}
      {editing && <TextAreaField label={editLabel} rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} />}
      {review.isError && <p className="text-sm text-down">{errorMessage(review.error)}</p>}
      <div className="flex flex-wrap gap-2">
        {editing ? (
          <>
            <Button size="sm" icon={<Check aria-hidden="true" className="size-4" />} loading={review.isPending} disabled={!draft.trim() || blocked} onClick={() => act('edited')}>
              {L.saveEdited}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" icon={<Check aria-hidden="true" className="size-4" />} loading={review.isPending && review.variables?.action === 'accepted'} disabled={blocked} onClick={() => act('accepted')}>
              {L.accept}
            </Button>
            <Button size="sm" variant="secondary" icon={<Pencil aria-hidden="true" className="size-4" />} onClick={() => setEditing(true)}>
              {L.edit}
            </Button>
            <Button size="sm" variant="ghost" icon={<X aria-hidden="true" className="size-4" />} loading={review.isPending && review.variables?.action === 'rejected'} onClick={() => act('rejected')}>
              {L.reject}
            </Button>
            {status === 'pending' && (
              <Button size="sm" variant="ghost" icon={<Clock aria-hidden="true" className="size-4" />} loading={review.isPending && review.variables?.action === 'deferred'} onClick={() => act('deferred')}>
                {L.defer}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
