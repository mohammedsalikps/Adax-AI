import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Capacitor wraps the existing Vite production build in a native Android
 * shell. Nothing about the web application changes: the same routes,
 * localStorage persistence, demo data and safety labels ship as-is.
 *
 * `webDir` points at Vite's build output, so `npm run build` followed by
 * `npx cap sync android` is what refreshes the native web assets.
 *
 * No `server.url` is set on purpose — the app runs entirely from the
 * bundled assets, with no dev server and no network access.
 */
const config: CapacitorConfig = {
  appId: 'com.adax.ai',
  appName: 'Adax AI',
  webDir: 'dist',

  // Matches the application's canvas token, so there is no white or black
  // flash before the first paint.
  backgroundColor: '#f5f7f9',

  android: {
    backgroundColor: '#f5f7f9',
    // The WebView is the app itself — no browser chrome, no address bar.
    allowMixedContent: false,
    captureInput: true,
  },
}

export default config
