import { defineConfig, devices } from '@playwright/test'

// Starts (or reuses) the real API, thermal service and web app. PostgreSQL is
// started beforehand by `npm run test:e2e` (scripts/db.mjs start).
const WEB = 'http://127.0.0.1:5173'

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: WEB, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    { command: 'npm run dev:api', url: 'http://127.0.0.1:4000/api/health', reuseExistingServer: true, timeout: 60_000 },
    { command: 'npm run dev:thermal', url: 'http://127.0.0.1:8001/health', reuseExistingServer: true, timeout: 60_000 },
    { command: 'npm run dev:web', url: WEB, reuseExistingServer: true, timeout: 60_000 },
  ],
})
