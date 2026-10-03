import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')

/**
 * Vite logs every failed proxy request as `http proxy error: <url>` plus a
 * stack, and the url carries the query string (a patient search term, for one).
 * That line is dropped, for the dev server and for `vite preview`; the proxy
 * handler below logs only the error code.
 */
const quietProxyErrors = (): Plugin => ({
  name: 'adaxai-quiet-proxy-errors',
  // The resolved config's logger is the one both servers use. (A configurePreviewServer hook would switch off Vite's own check for a missing dist folder.)
  configResolved(config) {
    const error = config.logger.error.bind(config.logger)
    config.logger.error = (msg, options) => {
      if (typeof msg === 'string' && msg.includes('http proxy error')) return
      error(msg, options)
    }
  },
})

export default defineConfig(({ mode }) => {
  // Server-side only: ports come from the repo-root .env. Nothing here is
  // exposed to the browser bundle (no VITE_ prefix).
  const env = loadEnv(mode, REPO_ROOT, '')
  const webPort = Number(env.WEB_PORT || 5173)
  const apiTarget = `http://${env.API_HOST || '127.0.0.1'}:${env.API_PORT || 4000}`
  // When the API is not running the proxy used to answer with an empty 502, which the app could only report as "Request failed (502)".
  // It now answers 503 with a body that says what is wrong (development and preview only; production has no Vite proxy).
  const proxy: Record<string, ProxyOptions> = {
    '/api': {
      target: apiTarget,
      changeOrigin: false,
      configure: (p) => {
        p.on('error', (err, _req, res) => {
          const code = (err as NodeJS.ErrnoException).code ?? 'error'
          // Only the error code is logged (never the request: it may hold a sign-in body or a search term).
          console.error(`[proxy] /api request failed (${code})${code === 'ECONNREFUSED' ? `: is the API running on ${apiTarget}?` : ''}`)
          if (code === 'ECONNREFUSED' && 'writeHead' in res && !res.headersSent) {
            res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' })
            res.end(JSON.stringify({ error: 'api_unavailable', message: 'The API is not running. Start it with `npm run dev` (or `npm run dev:api`) and try again.' }))
          }
        })
      },
    },
  }
  // The app is never meant to be framed (sign-in pages and consent confirmations are clickjacking targets).
  const headers = { 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'" }

  return {
    plugins: [react(), tailwindcss(), quietProxyErrors()],
    envDir: REPO_ROOT,
    envPrefix: 'VITE_',
    server: {
      host: '127.0.0.1',
      port: webPort,
      strictPort: true,
      headers,
      proxy,
    },
    preview: {
      host: '127.0.0.1',
      port: webPort,
      strictPort: true,
      headers,
      proxy,
    },
  }
})
