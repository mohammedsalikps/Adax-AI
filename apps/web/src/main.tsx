import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root element missing from index.html')

// App-shell service worker (installable app). It never caches /api/ responses.
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Without a service worker the app still works online.
    })
  })
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
