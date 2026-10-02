import { defineConfig, devices } from '@playwright/test'
import { E2E_DB } from './e2e/db-names.ts'

// The suite runs its own API, thermal service and web app on separate ports,
// against the dedicated e2e database (reset and seeded in global-setup), so it
// can run while `npm run dev` is up and never touches development data.
// Importing db-names stops the run here, before any server starts, if the
// database names are ambiguous (e.g. the e2e name equals the development one).
const PORTS = { api: 4100, thermal: 8101, web: 5273, mockAnthropic: 4199 }
const WEB = `http://127.0.0.1:${PORTS.web}`

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Whole multi-role workflows are long: in a fully passing run on the dev
  // machine (2 Oct 2026) doctor-workflow took 27.7 s (desktop) and 26.6 s
  // (mobile), and the longest test of a later passing run took 32.4 s, beyond
  // Playwright's 30 s default; runs under CPU load timed out at the final steps. Each assertion keeps its own 5 s limit, so a hang
  // still fails quickly.
  timeout: 60_000,
  reporter: [['list']],
  use: { baseURL: WEB, trace: 'retain-on-failure' },
  projects: [
    {
      name: 'desktop-chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Chromium's synthetic microphone, so browser recording can be tested.
        permissions: ['microphone'],
        launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
      },
    },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      // TEST-ONLY mock of the Anthropic Messages API (e2e/mock-anthropic.mjs).
      command: 'node e2e/mock-anthropic.mjs',
      url: `http://127.0.0.1:${PORTS.mockAnthropic}/health`,
      env: { MOCK_ANTHROPIC_PORT: String(PORTS.mockAnthropic) },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'npm run start --workspace @adaxai/api',
      url: `http://127.0.0.1:${PORTS.api}/api/health`,
      env: {
        DB_NAME: E2E_DB,
        // Uploaded files of the end-to-end run stay out of the development store.
        STORAGE_DIR: 'storage-e2e',
        API_PORT: String(PORTS.api),
        THERMAL_URL: `http://127.0.0.1:${PORTS.thermal}`,
        // Points the real Anthropic SDK at the local mock; the key is a placeholder, not a credential.
        ANTHROPIC_API_KEY: 'e2e-placeholder-not-a-key',
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${PORTS.mockAnthropic}`,
        AI_STT_API_KEY: '',
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'node scripts/thermal.mjs dev',
      url: `http://127.0.0.1:${PORTS.thermal}/health`,
      env: { THERMAL_PORT: String(PORTS.thermal) },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'npm run dev --workspace @adaxai/web',
      url: WEB,
      env: { WEB_PORT: String(PORTS.web), API_PORT: String(PORTS.api) },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
