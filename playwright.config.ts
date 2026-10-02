import { defineConfig, devices } from '@playwright/test'

// The suite runs its own API, thermal service and web app on separate ports,
// against the dedicated e2e database (reset and seeded in global-setup), so it
// can run while `npm run dev` is up and never touches development data.
const PORTS = { api: 4100, thermal: 8101, web: 5273, mockAnthropic: 4199 }
const WEB = `http://127.0.0.1:${PORTS.web}`
const E2E_DB = process.env.DB_E2E_NAME || 'adaxai_e2e'

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
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
