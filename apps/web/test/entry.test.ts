// Unit tests (node --test) of the pure logic behind the front door: what a failed sign-in says, where a post-sign-in redirect may go,
// and how the API client describes a gateway answering for a missing API. No browser, no server.
import assert from 'node:assert/strict'
import test from 'node:test'
import { APPLICATION_ROLES, applicationOf, Role } from '@adaxai/contracts'
import { ApiError, api, isServiceUnavailable } from '../src/lib/api.ts'
import { APPLICATION_ENTRIES, applicationForRoles, safeNext } from '../src/lib/applications.ts'
import { clearSessionExit, markPortalWithdrawn, markSessionEnded, markSignedOut, recentSessionExit } from '../src/lib/sessionEnd.ts'
import { describeSignInError, signOutProblem } from '../src/lib/signInErrors.ts'

test('every failure has plain words, a service problem offers a retry, and none shows a status code', () => {
  const cases: [ApiError, string, boolean][] = [
    [new ApiError(401, 'invalid_credentials', 'Invalid username or password'), 'invalid_credentials', false],
    [new ApiError(423, 'account_locked', 'Too many failed sign-in attempts. Try again in 15 minutes or ask an administrator.'), 'locked', false],
    [new ApiError(429, 'rate_limited', 'Too many attempts. Try again in 36 seconds.'), 'rate_limited', false],
    [new ApiError(403, 'wrong_application', 'This account cannot sign in to the Admin App. Go back.'), 'wrong_application', false],
    [new ApiError(403, 'forbidden', 'x'), 'forbidden', false],
    [new ApiError(502, 'service_unavailable', 'x'), 'unavailable', true],
    [new ApiError(503, 'api_unavailable', 'The API is not running. Start it with `npm run dev`.'), 'unavailable', true],
    [new ApiError(504, 'service_unavailable', 'x'), 'unavailable', true],
    [new ApiError(0, 'network_error', 'x'), 'network', true],
    [new ApiError(500, 'internal_error', 'Something went wrong'), 'server', true],
  ]
  for (const [error, problem, retry] of cases) {
    const v = describeSignInError(error, 'doctor')
    assert.equal(v.problem, problem, `${error.status} ${error.code}`)
    assert.equal(v.retry, retry, `${problem} retry`)
    assert.doesNotMatch(`${v.title} ${v.message}`, /\b(50[0-9]|Request failed|internal_error|api_unavailable|npm run)\b/, problem)
  }
  assert.equal(describeSignInError(new Error('boom'), 'doctor').problem, 'unexpected')
})

test('a wrong password, an unknown user and a switched-off account get one and the same answer', () => {
  // The API returns an identical 401 for all three (on purpose); the page must not add anything that tells them apart.
  const a = describeSignInError(new ApiError(401, 'invalid_credentials', 'Invalid username or password'), 'admin')
  const b = describeSignInError(new ApiError(401, 'invalid_credentials', 'something else the server might say'), 'admin')
  assert.deepEqual(a, b)
  // The patient door names its field as the MRN.
  assert.match(describeSignInError(new ApiError(401, 'invalid_credentials', 'x'), 'patient').message, /Invalid MRN or password/)
})

test('a redirect after sign-in goes only to a page of the signed-in role’s own application', () => {
  assert.equal(safeNext('/doctor/appointments?scope=today', 'doctor'), '/doctor/appointments?scope=today')
  assert.equal(safeNext('/doctor', 'doctor'), '/doctor')
  assert.equal(safeNext('/nurse/patients/123', 'nurse'), '/nurse/patients/123')
  assert.equal(safeNext('/print/encounters/abc', 'doctor'), '/print/encounters/abc')
  assert.equal(safeNext('/change-password', 'patient'), '/change-password')
  const refused = [
    null,
    '',
    'doctor',
    '/admin/users', // another role's page
    '/patient', // another role's page
    '/doctorx', // a prefix trick
    '/doctor/../admin',
    '/doctor/./x',
    '//evil.example/x',
    '/\\evil.example',
    'https://evil.example',
    'javascript:alert(1)',
    '/doctor\t',
    '/doctor\nHost: x',
    '/doctor\u0000',
    '/login/doctor', // a sign-in page is not a destination
    '/doctor/%2e%2e/admin', // encoded dot segments
    '/doctor/%2E%2E/admin',
    '/doctor%2f..%2fadmin', // an encoded slash
    '/doctor%5c..%5cadmin', // an encoded backslash
  ]
  for (const next of refused) assert.equal(safeNext(next, 'doctor'), null, String(next))
  // Odd shapes that are not refused are still only ever a path on this site under the role's own pages (a router would decode them once, no further).
  for (const next of ['/doctor/%252e%252e/admin', '/doctor/..;/admin', '/doctor?x=//evil.example', '/doctor#//evil.example']) {
    const kept = safeNext(next, 'doctor')
    assert.ok(kept === null || (kept.startsWith('/doctor') && !kept.startsWith('//')), next)
  }
  assert.equal(safeNext('/%2Fevil.example', 'doctor'), null)
  // Printable records are the clinical roles' only: nobody else is sent there after signing in.
  for (const role of ['patient', 'admin'] as const) assert.equal(safeNext('/print/encounters/abc', role), null, role)
  assert.equal(safeNext('/print/encounters/abc', 'nurse'), '/print/encounters/abc')
  // A role never lands in a page of the administrator's application.
  assert.equal(safeNext('/admin/users', 'nurse'), null)
  assert.equal(safeNext('/doctor/appointments', 'admin'), null)
})

test('every role belongs to exactly the application the API admits it to', () => {
  for (const role of Role.options) {
    const app = applicationOf(role)
    assert.ok(APPLICATION_ROLES[app].includes(role), `${role} is routed to the ${app} door but the API does not admit it there`)
    assert.deepEqual(
      (Object.keys(APPLICATION_ROLES) as (keyof typeof APPLICATION_ROLES)[]).filter((a) => APPLICATION_ROLES[a].includes(role)),
      [app],
      `${role} must be admitted by one application only`,
    )
  }
})

test('protected pages send a signed-out visitor to the application they belong to', () => {
  assert.equal(applicationForRoles(['doctor']), 'doctor')
  assert.equal(applicationForRoles(['nurse']), 'doctor')
  assert.equal(applicationForRoles(['doctor', 'nurse']), 'doctor')
  assert.equal(applicationForRoles(['admin']), 'admin')
  assert.equal(applicationForRoles(['patient']), 'patient')
  assert.equal(applicationForRoles(['admin', 'patient']), null) // pages of no single application go to the selector
  assert.equal(applicationForRoles(undefined), null)
  for (const e of Object.values(APPLICATION_ENTRIES)) assert.equal(e.path, `/login/${e.id}`)
})

test('a gateway answering for a missing API is “service unavailable”, never “Request failed (502)”', async () => {
  const real = globalThis.fetch
  try {
    for (const [status, body, code] of [
      [502, '', 'service_unavailable'],
      [503, '', 'service_unavailable'],
      [504, 'Gateway Timeout', 'service_unavailable'],
      [503, JSON.stringify({ error: 'api_unavailable', message: 'The API is not running.' }), 'api_unavailable'],
    ] as const) {
      globalThis.fetch = (async () => new Response(body, { status, headers: body.startsWith('{') ? { 'content-type': 'application/json' } : {} })) as typeof fetch
      const err = await api('/auth/me').then(
        () => null,
        (e: unknown) => e,
      )
      assert.ok(err instanceof ApiError, `${status}`)
      assert.equal(err.code, code, `${status}`)
      assert.ok(isServiceUnavailable(err), `${status}`)
      assert.doesNotMatch(err.message, /Request failed/)
    }
    // A 500 with no body says the server had a problem, without the code.
    globalThis.fetch = (async () => new Response('', { status: 500 })) as typeof fetch
    const err = (await api('/x').catch((e: unknown) => e)) as ApiError
    assert.equal(err.status, 500)
    assert.doesNotMatch(err.message, /Request failed|500/)
    // A refused connection.
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch
    const net = (await api('/x').catch((e: unknown) => e)) as ApiError
    assert.deepEqual([net.status, net.code, isServiceUnavailable(net)], [0, 'network_error', true])
    // A real refusal is not "unavailable".
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'invalid_credentials', message: 'Invalid username or password' }), { status: 401, headers: { 'content-type': 'application/json' } })) as typeof fetch
    const bad = (await api('/auth/login', { method: 'POST', body: {} }).catch((e: unknown) => e)) as ApiError
    assert.equal(isServiceUnavailable(bad), false)
  } finally {
    globalThis.fetch = real
  }
})

test('how a session ended is remembered briefly, in memory, and only until someone signs in', () => {
  clearSessionExit()
  assert.equal(recentSessionExit(), null)
  markSessionEnded('admin')
  assert.deepEqual(recentSessionExit(), { kind: 'ended', application: 'admin' })
  assert.deepEqual(recentSessionExit(), { kind: 'ended', application: 'admin' }, 'reading does not consume it (a component may render twice)')
  markSignedOut()
  assert.deepEqual(recentSessionExit(), { kind: 'signed_out' })
  markPortalWithdrawn()
  assert.deepEqual(recentSessionExit(), { kind: 'portal_withdrawn' })
  clearSessionExit()
  assert.equal(recentSessionExit(), null)
  // It goes stale: a hint from long ago must not redirect a visitor who arrives later.
  const now = Date.now
  try {
    markSignedOut()
    Date.now = () => now() + 6_000
    assert.equal(recentSessionExit(), null)
  } finally {
    Date.now = now
    clearSessionExit()
  }
})

test('a failed sign-out says the person is still signed in', () => {
  assert.match(signOutProblem(new ApiError(0, 'network_error', 'x')), /still signed in/)
  assert.match(signOutProblem(new ApiError(503, 'api_unavailable', 'x')), /still signed in/)
  assert.match(signOutProblem(new Error('boom')), /still signed in/)
})
