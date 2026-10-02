# ADR 0002: AI text enters a note only through a server-recorded insertion

- **Status:** accepted
- **Date:** 2 Oct 2026

## Context

"Add to note" used to append text in the browser. After saving, AI-derived text could not be told apart from typed text. If autosave failed after the doctor accepted an item, the item showed "accepted" while the text was lost. A reload could also insert the same text twice. Directive invariant 1 requires two things: AI content enters a note only by explicit doctor action, *and* the note keeps its AI artifact reference.

## Decision

`POST /api/encounters/:id/insertions` is the only way the UI puts AI or rule output into a note.

- **Who and when:** the authoring doctor, before signing, at the editor's encounter version (compare-and-set). On a stale version it returns 409.
- **What may be inserted:**
  - A note suggestion, fact, recommendation or photo description must already be accepted or edited, and **the inserted text must be exactly the reviewed text**: 409 `text_mismatch` otherwise. The AI reference can never be attached to other text.
  - A Mana answer may be inserted directly, because the insertion is itself the explicit action. The doctor may edit its text in the insert dialog; such insertions are labelled "text chosen and edited by the doctor".
  - The artifact must belong to this consultation, or to this patient for Mana answers and photos.
  - The resulting section must stay within its length limit: 400 otherwise, so autosave keeps working.
- **Recorded together:** the server appends the text and records a `note_insertions` row with:
  - section;
  - text;
  - subject type and id;
  - a "produced by" label (provider, model, prompt or rules version);
  - who inserted it, and when.
  It also writes an `ai_review_actions` "inserted" row and the audit event `encounter.ai_insert`, all in the same transaction.
- **No duplicates:** the same text from the same artifact goes into a section once (unique index, 409 `already_inserted`).
- **Signing:** the signed snapshot lists every insertion, with `retained` (whether the text is still present unchanged). The UI shows the provenance under the section, in the sign dialog and on the signed record.
- **Append-only:** `note_insertions` is append-only (trigger).

## Consequences

- AI-assisted passages are traceable in the signed record, and the doctor sees them before signing.
- The editor saves pending edits first, and stays read-only for the duration of an insertion, so no keystrokes are lost.
- If the doctor later edits or deletes inserted text, the insertion record stays and shows `retained: false`.
