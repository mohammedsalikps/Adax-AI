// Unit test (node --test) of the extra window events that re-check who is signed in: which events, what they refetch, and that cleanup works.
import assert from 'node:assert/strict'
import test from 'node:test'
import { QueryClient } from '@tanstack/react-query'
import { watchSessionOnFocus } from '../src/lib/focus.ts'
import { ME_KEY } from '../src/lib/session.ts'

test('window focus and a restored page re-check the session and nothing else; a normal page load does not; cleanup stops it', () => {
  const real = (globalThis as { window?: unknown }).window
  const fake = new EventTarget()
  ;(globalThis as { window?: unknown }).window = fake
  try {
    const qc = new QueryClient()
    const refetched: unknown[] = []
    qc.refetchQueries = ((filters: unknown, options: unknown) => {
      refetched.push([filters, options])
      return Promise.resolve()
    }) as typeof qc.refetchQueries
    const stop = watchSessionOnFocus(qc)

    fake.dispatchEvent(new Event('focus'))
    assert.deepEqual(refetched, [[{ queryKey: ME_KEY }, { cancelRefetch: false }]], 'only the session is re-checked, and a check already running is not restarted')

    // pageshow also fires on every ordinary load: only a page restored from the back/forward cache counts.
    refetched.length = 0
    fake.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }))
    assert.equal(refetched.length, 0)
    fake.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }))
    assert.equal(refetched.length, 1)

    refetched.length = 0
    stop()
    fake.dispatchEvent(new Event('focus'))
    fake.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }))
    assert.equal(refetched.length, 0, 'after cleanup nothing listens')
  } finally {
    ;(globalThis as { window?: unknown }).window = real
  }
})

test('without a window (server-side or a test) it does nothing and returns a cleanup', () => {
  const real = (globalThis as { window?: unknown }).window
  delete (globalThis as { window?: unknown }).window
  try {
    const stop = watchSessionOnFocus(new QueryClient())
    assert.equal(typeof stop, 'function')
    stop()
  } finally {
    if (real !== undefined) (globalThis as { window?: unknown }).window = real
  }
})
