import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@/App'
import { closeTopOverlay } from '@/hooks/useOverlay'
import '@/styles/index.css'

declare global {
  interface Window {
    /**
     * Read by the Android activity when the hardware back button is pressed,
     * so that back dismisses an open dialog instead of leaving the app.
     * Unused in the browser, where there is no hardware back button.
     */
    adaxCloseTopOverlay?: () => boolean
  }
}

window.adaxCloseTopOverlay = closeTopOverlay

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
