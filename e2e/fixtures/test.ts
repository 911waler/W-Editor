import { test as base, expect } from '@playwright/test'

import { monitorBrowserDiagnostics } from './diagnostics'

export const test = base.extend<{ browserDiagnostics: void }>({
  browserDiagnostics: [
    async ({ context, baseURL }, use, testInfo) => {
      await monitorBrowserDiagnostics(context, baseURL ?? 'http://127.0.0.1:4173', testInfo, use)
    },
    { auto: true },
  ],
})

export { expect }
