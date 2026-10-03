import type { ReactNode } from 'react'
import { Alert } from './Feedback.tsx'
import { Button } from './Button.tsx'
import { Dialog } from './Dialog.tsx'
import { TextField } from './Form.tsx'

export interface ConfirmReason {
  label: string
  value: string
  onChange: (v: string) => void
  /** A field problem reported by the server or by validation. */
  error?: string | undefined
  hint?: ReactNode
  required?: boolean
}

/**
 * Asks before something that cannot be undone, or that other people rely on
 * (cancelling, closing, discarding). It says what will happen, offers a plain
 * "keep it" way out first, asks for a reason when the record needs one, and
 * shows a failure inside the dialog (a toast behind a modal is neither seen
 * nor announced). It cannot be dismissed while the request is in flight, so a
 * result is never lost.
 */
export function ConfirmationDialog({
  title,
  onClose,
  onConfirm,
  confirmLabel,
  keepLabel = 'Keep it',
  tone = 'danger',
  loading,
  error,
  reason,
  children,
}: {
  title: ReactNode
  onClose: () => void
  onConfirm: () => void
  confirmLabel: string
  keepLabel?: string
  tone?: 'danger' | 'primary'
  loading?: boolean
  /** A failure that has no field of its own (a taken slot, a stale screen). */
  error?: ReactNode
  reason?: ConfirmReason
  children?: ReactNode
}) {
  const close = () => {
    if (!loading) onClose()
  }
  return (
    <Dialog
      open
      onClose={close}
      dismissible={!loading}
      title={title}
      footer={
        <>
          <Button variant="secondary" disabled={loading} onClick={close}>
            {keepLabel}
          </Button>
          <Button type="submit" form="confirm-form" variant={tone} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form
        id="confirm-form"
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          onConfirm()
        }}
      >
        {error && <Alert tone="error">{error}</Alert>}
        {children && <div className="space-y-2 text-sm">{children}</div>}
        {reason && <TextField label={reason.label} required={reason.required ?? false} value={reason.value} onChange={(e) => reason.onChange(e.target.value)} error={reason.error} hint={reason.hint} />}
      </form>
    </Dialog>
  )
}
