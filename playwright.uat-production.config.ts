import { defineConfig, devices } from '@playwright/test'

const baseURL = 'http://127.0.0.1:4175'

export default defineConfig({
  expect: { timeout: 10_000 },
  forbidOnly: true,
  fullyParallel: false,
  outputDir: './test-results/uat-dtr-round-1-production',
  projects: [{
    name: 'chromium',
    use: { ...devices['Desktop Chrome'], browserName: 'chromium' },
  }],
  reporter: [['list']],
  retries: 0,
  testDir: './e2e',
  testMatch: ['uat-dtr-drawio-production.spec.ts'],
  timeout: 90_000,
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
    storageState: { cookies: [], origins: [] },
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'corepack pnpm run build && corepack pnpm exec vite preview --host 127.0.0.1 --port 4175 --strictPort',
    reuseExistingServer: false,
    stderr: 'pipe',
    stdout: 'pipe',
    timeout: 120_000,
    url: baseURL,
  },
  workers: 1,
})
