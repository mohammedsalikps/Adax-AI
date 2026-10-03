// Unit test (node --test) of the small pure helpers of live capture: how a time on the recording is shown, how a language code is named,
// and the store that points the transcript at the lines an important point came from.
import assert from 'node:assert/strict'
import test from 'node:test'
import { fmtOffset, languageName } from '../src/lib/transcriptTime.ts'
import { focusedLines, focusLines } from '../src/lib/focusLines.ts'

test('a time on the recording is shown as mm:ss, and as h:mm:ss from an hour; no time shows nothing', () => {
  assert.equal(fmtOffset(0), '00:00')
  assert.equal(fmtOffset(999), '00:00')
  assert.equal(fmtOffset(1000), '00:01')
  assert.equal(fmtOffset(61_500), '01:01')
  assert.equal(fmtOffset(59 * 60_000 + 59_999), '59:59')
  assert.equal(fmtOffset(3_600_000), '1:00:00')
  assert.equal(fmtOffset(3_600_000 + 125_000), '1:02:05')
  assert.equal(fmtOffset(-5000), '00:00')
  assert.equal(fmtOffset(null), '')
  assert.equal(fmtOffset(undefined), '')
})

test('a language code is named in English; an unknown or missing one is never invented', () => {
  assert.equal(languageName('en'), 'English')
  assert.equal(languageName('hi'), 'Hindi')
  assert.equal(languageName(null), '')
  assert.equal(languageName(undefined), '')
  // Not a language code: shown as it came, not translated into something plausible.
  assert.equal(languageName('not a code!'), 'not a code!')
})

test('pointing at transcript lines replaces what was pointed at before, and may point at none', () => {
  focusLines(['S1', 'S2'])
  assert.deepEqual([...focusedLines()].sort(), ['S1', 'S2'])
  focusLines(['S9'])
  assert.deepEqual([...focusedLines()], ['S9'])
  focusLines([])
  assert.equal(focusedLines().size, 0)
})
