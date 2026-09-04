import { afterEach, beforeEach, vi } from 'vitest'

export const FIXED_TEST_TIME = new Date('2026-01-15T12:00:00.000Z')

let uuidSequence = 0

export const JSDOM_BROWSER_SUBSTITUTES = Object.freeze({
  canvas2d: 'unavailable; pixel behavior belongs to browser gates',
  rangeGeometry: 'zero rect; caret and scroll geometry belongs to browser gates',
  windowScroll: 'observable no-op; layout behavior belongs to browser gates',
})

if (typeof Range.prototype.getClientRects !== 'function') {
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => [new DOMRect(0, 0, 0, 0)] as unknown as DOMRectList,
  })
}
if (typeof Range.prototype.getBoundingClientRect !== 'function') {
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(0, 0, 0, 0),
  })
}

class DeterministicResizeObserver implements ResizeObserver {
  disconnect(): void {}

  observe(): void {}

  unobserve(): void {}
}

vi.stubGlobal('ResizeObserver', DeterministicResizeObserver)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_TEST_TIME)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
  vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  window.localStorage.clear()
  uuidSequence = 0
  vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => {
    uuidSequence += 1
    const suffix = uuidSequence.toString(16).padStart(12, '0')
    return `00000000-0000-4000-8000-${suffix}`
  })
})

afterEach(() => {
  vi.useRealTimers()
})
