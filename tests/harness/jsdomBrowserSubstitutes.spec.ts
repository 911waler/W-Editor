import { describe, expect, it, vi } from 'vitest'

import { JSDOM_BROWSER_SUBSTITUTES } from '../setup'

describe('explicit jsdom browser substitutes', () => {
  it('keeps Canvas pixels and window layout scrolling owned by real-browser gates', () => {
    const canvas = document.createElement('canvas')

    expect(canvas.getContext('2d')).toBeNull()
    expect(vi.isMockFunction(HTMLCanvasElement.prototype.getContext)).toBe(true)
    expect(vi.isMockFunction(window.scrollBy)).toBe(true)
    expect(vi.isMockFunction(window.scrollTo)).toBe(true)
    expect(JSDOM_BROWSER_SUBSTITUTES).toEqual({
      canvas2d: 'unavailable; pixel behavior belongs to browser gates',
      rangeGeometry: 'zero rect; caret and scroll geometry belongs to browser gates',
      windowScroll: 'observable no-op; layout behavior belongs to browser gates',
    })
  })
})
