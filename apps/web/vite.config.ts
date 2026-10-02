import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')

export default defineConfig(({ mode }) => {
  // Server-side only: ports come from the repo-root .env. Nothing here is
  // exposed to the browser bundle (no VITE_ prefix).
  const env = loadEnv(mode, REPO_ROOT, '')
  const webPort = Number(env.WEB_PORT || 5173)
  const apiTarget = `http://${env.API_HOST || '127.0.0.1'}:${env.API_PORT || 4000}`

  return {
    plugins: [react(), tailwindcss()],
    envDir: REPO_ROOT,
    envPrefix: 'VITE_',
    server: {
      host: '127.0.0.1',
      port: webPort,
      strictPort: true,
      proxy: { '/api': { target: apiTarget, changeOrigin: false } },
    },
    preview: {
      host: '127.0.0.1',
      port: webPort,
      strictPort: true,
      proxy: { '/api': { target: apiTarget, changeOrigin: false } },
    },
  }
})
