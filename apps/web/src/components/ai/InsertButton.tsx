import { type InsertionSubject, NOTE_SECTIONS, type NoteFields } from '@adaxai/contracts'
import { Check, Plus } from 'lucide-react'
import { useState } from 'react'
import { errorMessage } from '../../lib/api.ts'
import type { NoteInserter } from '../../lib/insert.ts'
import { Button } from '../ui/Button.tsx'
import { Badge } from '../ui/Feedback.tsx'
import { useToast } from '../ui/Toast.tsx'

export const SECTION_LABEL = Object.fromEntries(NOTE_SECTIONS.map((s) => [s.key, s.label])) as Record<keyof NoteFields, string>

/** "Add to <section>": inserts reviewed AI text into the note through the server, once. */
export function InsertButton({ inserter, section, text, subject }: { inserter: NoteInserter; section: keyof NoteFields; text: string; subject: { type: InsertionSubject; id: string } }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  if (inserter.inserted(subject.type, subject.id)) {
    return (
      <span className="mt-2 inline-block">
        <Badge tone="ai" icon={<Check aria-hidden="true" className="size-3" />}>
          In the note ({SECTION_LABEL[section]})
        </Badge>
      </span>
    )
  }
  return (
    <Button
      size="sm"
      variant="secondary"
      className="mt-2"
      loading={busy}
      icon={<Plus aria-hidden="true" className="size-4" />}
      onClick={async () => {
        setBusy(true)
        try {
          await inserter.insert(section, text, subject)
          toast('success', `Added to ${SECTION_LABEL[section]}. Review it in the note.`)
        } catch (e) {
          toast('error', errorMessage(e))
        } finally {
          setBusy(false)
        }
      }}
    >
      Add to {SECTION_LABEL[section]}
    </Button>
  )
}
