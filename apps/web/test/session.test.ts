// Unit tests (node --test) of who-is-signed-in: the one cache entry, what is dropped when the person changes, and the ordering rules that stop
// an old answer overwriting a new session. A real QueryClient, with fetch stood in for the API. No browser, no server.
import assert from 'node:assert/strict'
import test from 'node:test'
import type { Me } from '@adaxai/contracts'
import { QueryClient } from '@tanstack/react-query'
import { checkSession, ME_KEY, replaceSession, updateMe } from '../src/lib/session.ts'
import { clearSessionExit, recentSessionExit } from '../src/lib/sessionEnd.ts'

const person = (id: string, role: Me['role'] = 'doctor'): Me => ({ id, username: id, fullName: `Person ${id}`, role, mustChangePassword: false }) as unknown as Me

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** A fetch whose answers the test releases one at a time. */
function gatedFetch() {
  const waiting: ((r: Response | Error) => void)[] = []
  globalThis.fetch = ((): Promise<Response> =>
    new Promise((resolve, reject) => {
      waiting.push((r) => (r instanceof Error ? reject(r) : resolve(r)))
    })) as typeof fetch
  return { release: (r: Response | Error, i = 0) => waiting[i]!(r), pending: () => waiting.length }
}

async function withFetch(run: () => Promise<void>) {
  const real = globalThis.fetch
  clearSessionExit()
  try {
    await run()
  } finally {
    globalThis.fetch = real
    clearSessionExit()
  }
}

const seeded = (me: Me | null) => {
  const qc = new QueryClient()
  qc.setQueryData(ME_KEY, me)
  qc.setQueryData(['patients', 'list'], [{ name: 'someone’s patient' }])
  return qc
}

test('a different person answering drops everything the last one had cached, before anything is rendered for them', async () => {
  await withFetch(async () => {
    const qc = seeded(person('p'))
    globalThis.fetch = (async () => json(200, person('q'))) as typeof fetch
    assert.equal((await checkSession(qc))?.id, 'q')
    assert.equal(qc.getQueryData(['patients', 'list']), undefined)
    assert.equal(recentSessionExit(), null, 'a person replaced is not "your session ended"')
  })
})

test('the same person answering changes nothing; nobody answering ends the session and says so', async () => {
  await withFetch(async () => {
    const qc = seeded(person('p', 'nurse'))
    globalThis.fetch = (async () => json(200, person('p', 'nurse'))) as typeof fetch
    assert.equal((await checkSession(qc))?.id, 'p')
    assert.ok(qc.getQueryData(['patients', 'list']), 'the same person keeps their cache')

    globalThis.fetch = (async () => json(401, { error: 'unauthorized', message: 'x' })) as typeof fetch
    assert.equal(await checkSession(qc), null)
    assert.equal(qc.getQueryData(['patients', 'list']), undefined)
    assert.deepEqual(recentSessionExit(), { kind: 'ended', application: 'doctor' })
  })
})

test('a service that cannot answer changes nothing: the person already shown stays shown', async () => {
  await withFetch(async () => {
    const qc = seeded(person('p'))
    for (const failure of [async () => new Response('', { status: 502 }), async () => json(500, { error: 'internal_error', message: 'x' }), async () => Promise.reject(new TypeError('fetch failed'))]) {
      globalThis.fetch = failure as typeof fetch
      await assert.rejects(checkSession(qc))
      assert.equal(qc.getQueryData<Me>(ME_KEY)?.id, 'p')
      assert.ok(qc.getQueryData(['patients', 'list']))
    }
    assert.equal(recentSessionExit(), null)
  })
})

test('an answer that is not a person (an empty 204, a web page from a proxy, a person without a role) is a failure, not "nobody is signed in"', async () => {
  await withFetch(async () => {
    const qc = seeded(person('p'))
    for (const answer of [() => new Response(null, { status: 204 }), () => new Response('<!doctype html><title>app</title>', { status: 200, headers: { 'content-type': 'text/html' } }), () => json(200, {}), () => json(200, { id: 'x', role: 'wizard' }), () => json(200, null)]) {
      globalThis.fetch = (async () => answer()) as typeof fetch
      await assert.rejects(checkSession(qc))
      assert.equal(qc.getQueryData<Me>(ME_KEY)?.id, 'p', 'the person shown is still shown')
      assert.ok(qc.getQueryData(['patients', 'list']))
    }
    assert.equal(recentSessionExit(), null)
  })
})

test('a check that was on its way when someone signed in does not overwrite them with the answer for the person before', async () => {
  await withFetch(async () => {
    const qc = seeded(null) // signed out; a check is made (the tab was looked at) ...
    const gate = gatedFetch()
    const check = checkSession(qc)
    // ... and before it is answered, someone signs in.
    replaceSession(qc, person('q'))
    gate.release(json(401, { error: 'unauthorized', message: 'x' }))
    assert.equal((await check)?.id, 'q', 'the answer for the person before is dropped; what was set since stands')
    assert.equal(recentSessionExit(), null, 'and nothing is reported as "ended"')
    // The same for an answer that failed.
    const second = checkSession(qc)
    replaceSession(qc, person('r'))
    gate.release(new TypeError('fetch failed'), 1)
    assert.equal((await second)?.id, 'r')
  })
})

test('a check that was on its way when someone signed out does not bring them back, or report an ending that was theirs', async () => {
  await withFetch(async () => {
    const qc = seeded(person('p'))
    const gate = gatedFetch()
    const check = checkSession(qc)
    replaceSession(qc, null) // they signed out
    gate.release(json(200, person('p'))) // the answer, made while they were still signed in
    assert.equal(await check, null)
    const late = checkSession(qc)
    gate.release(json(401, { error: 'unauthorized', message: 'x' }), 1)
    assert.equal(await late, null)
    assert.equal(recentSessionExit(), null)
  })
})

test('a new password updates the person in place and is not overwritten by a check that began before it', async () => {
  await withFetch(async () => {
    const mustChange = { ...person('p'), mustChangePassword: true } as Me
    const qc = seeded(mustChange)
    const gate = gatedFetch()
    const check = checkSession(qc)
    updateMe(qc, { ...mustChange, mustChangePassword: false } as Me)
    gate.release(json(200, mustChange))
    assert.equal((await check)?.mustChangePassword, false)
    assert.ok(qc.getQueryData(['patients', 'list']), 'the same person keeps their cache')
  })
})

test('replacing the session drops other queries and every mutation (a sign-in’s password among them), and keeps the one entry for who is signed in', async () => {
  const qc = seeded(person('p'))
  const mutation = qc.getMutationCache().build(qc, { mutationFn: async (v: { password: string }) => v })
  await mutation.execute({ password: 'not-a-real-password' })
  assert.equal(qc.getMutationCache().getAll().length, 1)
  replaceSession(qc, person('q'))
  assert.equal(qc.getMutationCache().getAll().length, 0)
  assert.equal(qc.getQueryData(['patients', 'list']), undefined)
  assert.equal(qc.getQueryData<Me>(ME_KEY)?.id, 'q')
})
