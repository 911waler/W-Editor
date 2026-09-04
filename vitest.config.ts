import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

const projectRoot = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '#testing-capability-loader': resolve(projectRoot, 'src/testing/capabilityLoader.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.spec.ts', 'apps/desktop/tests/**/*.spec.ts'],
    setupFiles: ['./tests/setup.ts'],
    restoreMocks: true,
    clearMocks: true,
    mockReset: true,
    sequence: {
      concurrent: false,
    },
    fakeTimers: {
      now: new Date('2026-01-15T12:00:00.000Z'),
      shouldClearNativeTimers: true,
    },
    coverage: {
      reporter: ['text', 'json-summary', 'html'],
    },
  },
})
