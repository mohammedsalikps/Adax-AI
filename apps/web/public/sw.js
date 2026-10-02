// ADAXAI service worker: app-shell caching only. Patient data is never cached
// (see sw-policy.js). Bump CACHE when the shell list or policy changes.
importScripts('/sw-policy.js')

const CACHE = 'adaxai-shell-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(self.ADAXAI_SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const policy = self.adaxaiCachePolicy(req.url, req.method, req.mode, self.location.origin)
  if (policy === 'bypass') return
  if (policy === 'network-only') {
    // Explicitly network: never read from or written to a cache.
    event.respondWith(fetch(req, { cache: 'no-store' }))
    return
  }
  if (policy === 'shell-fallback') {
    event.respondWith(fetch(req).catch(() => caches.match('/', { cacheName: CACHE })))
    return
  }
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req)
      if (hit) return hit
      const res = await fetch(req)
      if (res.ok && res.type === 'basic') cache.put(req, res.clone())
      return res
    }),
  )
})
