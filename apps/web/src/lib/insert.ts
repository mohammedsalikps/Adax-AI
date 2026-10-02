import type { InsertionSubject, NoteFields } from '@adaxai/contracts'

/**
 * How AI output reaches a consultation note: an explicit doctor action that
 * the server records with a reference to the AI artifact (never a silent
 * client-side append).
 */
export interface NoteInserter {
  insert: (section: keyof NoteFields, text: string, subject: { type: InsertionSubject; id: string }) => Promise<void>
  /** Whether text from this artifact is already in the note. */
  inserted: (type: InsertionSubject, id: string) => boolean
}
