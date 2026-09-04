import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

describe('repository lint boundary', () => {
  it('ignores generated bundles and third-party vendor trees globally', async () => {
    const eslint = new ESLint({ cwd: process.cwd() })
    for (const file of [
      '.tmp/production-fu007/assets/main.js',
      'packages/editor-web/dist/index.js',
      'apps/playground/dist/assets/main.js',
      'apps/desktop/src-tauri/target/debug/build/generated.js',
      'public/vendor/cherry-drawio/assets/mxgraph/mxClient.js',
    ]) {
      await expect(eslint.isPathIgnored(file), file).resolves.toBe(true)
    }
  }, 30_000)

  it('keeps authored source and validation scripts inside the lint boundary', async () => {
    const eslint = new ESLint({ cwd: process.cwd() })
    for (const file of [
      'packages/editor-web/src/publicContracts.ts',
      'packages/editor-vue/src/host.ts',
      'tests/web/hostContracts.spec.ts',
      'scripts/verify-code-ownership.mjs',
    ]) {
      await expect(eslint.isPathIgnored(file), file).resolves.toBe(false)
    }
  })
})
