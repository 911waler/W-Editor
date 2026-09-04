import { describe, expect, it } from 'vitest'

import { isRequiredApplicationRequest } from '../../e2e/fixtures/diagnostics'

describe('Playwright browser diagnostic policy', () => {
  it.each(['document', 'script', 'stylesheet', 'fetch', 'xhr'])(
    'treats same-origin %s requests as required',
    (resourceType) => {
      expect(isRequiredApplicationRequest(resourceType, 'http://127.0.0.1:4173/assets/app.js')).toBe(true)
    },
  )

  it('does not turn optional assets or third-party requests into required failures', () => {
    expect(isRequiredApplicationRequest('image', 'http://127.0.0.1:4173/optional.png')).toBe(false)
    expect(isRequiredApplicationRequest('fetch', 'https://embed.example/resource')).toBe(false)
    expect(isRequiredApplicationRequest('script', 'not a url')).toBe(false)
  })
})
