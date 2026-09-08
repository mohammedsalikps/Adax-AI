import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, Printer, Share2, X } from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import { Button, useToast } from '@/components/ui'
import { useOverlay } from '@/hooks/useOverlay'
import { buildPrescriptionText } from './prescriptionText'
import { PrescriptionPreview, type PrescriptionPreviewProps } from './PrescriptionPreview'

export interface PrescriptionPreviewModalProps extends PrescriptionPreviewProps {
  open: boolean
  onClose: () => void
}

/**
 * Full-screen review of the prescription document.
 *
 * Portalled to <body> as [data-print-root] so print.css can hide the rest
 * of the application. Printing and sharing never change the consultation:
 * neither action saves, signs or completes anything.
 */
export function PrescriptionPreviewModal({
  open,
  onClose,
  ...preview
}: PrescriptionPreviewModalProps) {
  const { showToast } = useToast()
  const containerRef = useOverlay(open, onClose)
  const [copied, setCopied] = useState(false)
  const [showTextFallback, setShowTextFallback] = useState(false)
  const fallbackRef = useRef<HTMLTextAreaElement>(null)

  if (!open) return null

  const text = buildPrescriptionText(preview)

  function handlePrint() {
    // Android's WebView does not implement window.print(): the call is a
    // silent no-op. Say so rather than letting the button appear broken.
    if (Capacitor.isNativePlatform()) {
      showToast({
        title: 'Printing is not available in the app',
        description: 'Use “Copy text” or “Share” to send the prescription instead.',
        status: 'warning',
      })
      return
    }
    // Called only from this click — never automatically.
    window.print()
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2500)
      showToast({ title: 'Prescription text copied', status: 'success' })
      return
    } catch {
      // The Clipboard API is unavailable in some contexts (no focus, no
      // permission, insecure origin). Fall back to a selectable field.
    }

    setShowTextFallback(true)
    // Wait for the field to mount, then select it so one keystroke copies.
    window.setTimeout(() => {
      const field = fallbackRef.current
      if (!field) return
      field.focus()
      field.select()
      showToast({
        title: 'Copy the text below',
        description: 'Clipboard access was blocked, so the text is selected for you.',
        status: 'warning',
      })
    }, 0)
  }

  async function share() {
    if (!navigator.share) {
      showToast({
        // The Android WebView has no Web Share API, so say "app" there rather
        // than "browser", which would be wrong inside the installed app.
        title: Capacitor.isNativePlatform()
          ? 'Sharing is not available in the app'
          : 'Sharing is not available in this browser',
        description: 'Use “Copy prescription text” instead.',
        status: 'warning',
      })
      return
    }

    try {
      await navigator.share({
        title: `Draft prescription — ${preview.patient.fullName}`,
        text,
      })
      // Only reported once the browser resolves the share.
      showToast({ title: 'Prescription shared', status: 'success' })
    } catch (cause) {
      // A cancelled share rejects with AbortError; that is not a failure.
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      showToast({
        title: 'Sharing failed',
        description: cause instanceof Error ? cause.message : 'The share was not completed.',
        status: 'error',
      })
    }
  }

  return createPortal(
    <div data-print-root className="fixed inset-0 z-50 overflow-y-auto bg-ink/40 p-4">
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Prescription preview"
        className="mx-auto w-full max-w-4xl"
      >
        <div className="print-chrome sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-panel border border-line bg-surface px-3 py-2.5">
          <h2 className="mr-auto text-sm font-semibold tracking-tight text-ink">
            Prescription preview
          </h2>
          <Button size="sm" variant="secondary" icon={Printer} onClick={handlePrint}>
            Print
          </Button>
          <Button size="sm" variant="secondary" icon={Share2} onClick={() => void share()}>
            Share
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={copied ? Check : Copy}
            onClick={() => void copyText()}
          >
            {copied ? 'Copied' : 'Copy text'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            icon={X}
            aria-label="Close prescription preview"
            onClick={onClose}
          />
        </div>

        <div className="rounded-panel border border-line bg-surface shadow-[0_2px_10px_rgba(15,23,42,0.08)]">
          <PrescriptionPreview {...preview} />
        </div>

        {showTextFallback && (
          <div className="print-chrome mt-3 rounded-panel border border-line bg-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="prescription-plain-text"
                className="text-[11px] font-semibold tracking-wide text-ink-soft uppercase"
              >
                Prescription text
              </label>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowTextFallback(false)}
              >
                Hide
              </Button>
            </div>
            <textarea
              id="prescription-plain-text"
              ref={fallbackRef}
              readOnly
              rows={10}
              value={text}
              className="mt-2 w-full resize-y rounded-control border border-line bg-surface-alt px-3 py-2 font-mono text-[11px] text-ink"
            />
            <p className="mt-1 text-[11px] text-ink-muted">
              Press Ctrl+C (Cmd+C on Mac) to copy the selected text.
            </p>
          </div>
        )}

        <p className="print-chrome mt-3 text-center text-[11px] text-ink-muted">
          Printing or sharing does not save or complete the consultation.
        </p>
      </div>
    </div>,
    document.body,
  )
}
