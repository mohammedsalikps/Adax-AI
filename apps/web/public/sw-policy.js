// Caching policy for the ADAXAI service worker, kept separate so it can be
// unit-tested (apps/web/test/sw-policy.test.mjs).
//
// Rule: only the application shell and versioned static files are cached.
// Anything under /api/ (patient records, files, AI output) is NEVER cached,
// and the API itself answers with Cache-Control: no-store.
self.ADAXAI_SHELL = ['/', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png']

/**
 * @param {string} href absolute request URL
 * @param {string} method HTTP method
 * @param {string} mode request mode ("navigate" for page loads)
 * @param {string} origin the app's origin
 * @returns {'bypass' | 'network-only' | 'shell-fallback' | 'cache-first'}
 */
self.adaxaiCachePolicy = function (href, method, mode, origin) {
  const url = new URL(href)
  if (method !== 'GET' || url.origin !== origin) return 'bypass'
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return 'network-only'
  // Page loads: always from the network; the cached shell only when offline.
  if (mode === 'navigate') return 'shell-fallback'
  // Content-hashed build output never changes under the same name.
  if (url.pathname.startsWith('/assets/') || self.ADAXAI_SHELL.includes(url.pathname)) return 'cache-first'
  return 'bypass'
}
