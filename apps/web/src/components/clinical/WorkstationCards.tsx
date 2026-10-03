import { PenLine } from 'lucide-react'
import { Badge } from '../ui/Feedback.tsx'
import { Card } from '../ui/Layout.tsx'

/**
 * Handwriting is not built: it needs somewhere to keep the strokes, a place for
 * them in the signed record and a retention rule. This card says so instead of
 * offering a pad that would lose what is written on it.
 */
export function WritingPadCard() {
  return (
    <div data-testid="writing-pad">
      <Card title="Digital writing pad" actions={<Badge>Not available yet</Badge>}>
        <div className="flex items-start gap-3 text-sm text-ink-muted">
          <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-canvas">
            <PenLine className="size-4" />
          </span>
          <p>Handwritten notes are planned; they need storage for the strokes and a place in the signed record. Type in the consultation note for now.</p>
        </div>
      </Card>
    </div>
  )
}
