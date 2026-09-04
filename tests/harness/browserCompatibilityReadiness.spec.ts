import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const guidance = readFileSync('docs/browser-compatibility-readiness.md', 'utf8')

describe('future real-site browser compatibility trigger', () => {
  it('keeps compatibility guidance discoverable and activation-scoped', () => {
    expect(guidance).toMatch(/real-site integration/u)
    expect(guidance).toContain('browser, engine, operating-system, and device analytics')
  })

  it('requires an explicit audience-based engine, mobile, and accessibility decision', () => {
    for (const environment of ['Firefox', 'WebKit/Safari', 'iOS', 'Android', 'Accessibility environments']) {
      expect(guidance).toContain(environment)
    }
    expect(guidance).toContain('blocking')
    expect(guidance).toContain('non-blocking smoke')
    expect(guidance).toContain('deferred with evidence')
    expect(guidance).toContain('not applicable')
    expect(guidance).toContain('Do not claim real-site integration readiness')
  })
})
