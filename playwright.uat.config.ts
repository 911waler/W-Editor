import { defineConfig, devices } from '@playwright/test'

const baseURL = 'http://127.0.0.1:4174'

export default defineConfig({
  expect: { timeout: 5_000 },
  forbidOnly: true,
  fullyParallel: false,
  outputDir: './test-results/uat-dtr-round-1',
  projects: [{
    name: 'chromium',
    use: { ...devices['Desktop Chrome'], browserName: 'chromium' },
  }],
  reporter: [['list']],
  retries: 0,
  testDir: './e2e',
  testIgnore: ['uat-dtr-drawio-production.spec.ts'],
  timeout: 30_000,
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
    storageState: { cookies: [], origins: [] },
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'corepack pnpm run build:e2e && corepack pnpm exec vite preview --host 127.0.0.1 --port 4174 --strictPort',
    reuseExistingServer: false,
    stderr: 'pipe',
    stdout: 'pipe',
    timeout: 120_000,
    url: baseURL,
  },
  workers: 1,
})
