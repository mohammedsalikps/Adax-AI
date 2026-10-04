/**
 * Record text on its way into a model's prompt. Everything a record says is DATA: it must not be able to pass for another source, for the
 * prompt's own structure, or for the model's chat markers. One line, control characters gone, brackets turned into parentheses (so a source
 * cannot forge another source's id), and the chat template's markers written apart so that they are only text. Shared by every feature that
 * shows record text to the local model (the consultation draft, Mana).
 */

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/g

export function neutralise(s: string): string {
  // The model's chat template marks its turns with strings such as <|im_start|>, and the runtime reads them as markers even inside a message (probed
  // against the real server: the token count of a message that carries them is that of markers, not of text). Text that carries one could close the
  // record's turn and open another. They are written apart, so that they are only text.
  // Characters that only format text (zero-width spaces and joiners, soft hyphens, direction marks, the invisible "tag" characters that can carry a hidden
  // message) are taken out first: a person does not see them, and a model would read them, so a rule that looks for words would be fooled by them.
  return s
    .replace(/\p{Cf}/gu, '')
    .replace(CONTROL, ' ')
    .replace(/[\r\n]+/g, ' ')
    .replace(/<\|/g, '< |')
    .replace(/\|>/g, '| >')
    .replace(/<(\/?(?:think|tool_call|tools|tool_response|function)\b)/gi, '< $1')
    .replace(/[[\]]/g, (c) => (c === '[' ? '(' : ')'))
    .replace(/\s+/g, ' ')
    .trim()
}
