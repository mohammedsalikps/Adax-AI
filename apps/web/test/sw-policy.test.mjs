// Unit test of the service-worker caching policy (node --test).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

const self = {}
vm.runInNewContext(fs.readFileSync(path.join(import.meta.dirname, '..', 'public', 'sw-policy.js'), 'utf8'), { self, URL })
const ORIGIN = 'https://adaxai.example'
const policy = (p, method = 'GET', mode = 'cors', origin = ORIGIN) => self.adaxaiCachePolicy(`${origin}${p}`, method, mode, ORIGIN)

test('API responses are never cached, whatever the path or mode', () => {
  for (const p of ['/api/portal/records', '/api/portal/records/1', '/api/files/abc', '/api/encounters/x/ai', '/api', '/api/auth/me?x=1']) {
    assert.equal(policy(p), 'network-only', p)
    assert.equal(policy(p, 'GET', 'navigate'), 'network-only', p)
  }
})

test('page loads go to the network, with the shell only as an offline fallback', () => {
  assert.equal(policy('/patient/records/1', 'GET', 'navigate'), 'shell-fallback')
})

test('only the shell and hashed build files are cached', () => {
  assert.equal(policy('/assets/index-abc123.js'), 'cache-first')
  assert.equal(policy('/manifest.webmanifest'), 'cache-first')
  assert.equal(policy('/icons/icon-192.png'), 'cache-first')
  assert.equal(policy('/src/main.tsx'), 'bypass')
  assert.equal(policy('/some/other.json'), 'bypass')
})

test('non-GET and cross-origin requests are left alone', () => {
  assert.equal(policy('/api/auth/login', 'POST'), 'bypass')
  assert.equal(policy('/assets/x.js', 'GET', 'cors', 'https://cdn.example'), 'bypass')
})

test('the shell list contains no API or patient routes', () => {
  assert.ok(self.ADAXAI_SHELL.every((p) => !p.startsWith('/api') && !p.startsWith('/patient')))
})
