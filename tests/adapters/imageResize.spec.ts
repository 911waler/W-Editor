import { describe, expect, it } from 'vitest'
import { resizedImageDimensions, type ResizeHandle } from '../../packages/editor-vue/src/adapters/imageResize'

describe('image resize geometry', () => {
  it.each(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as ResizeHandle[])('resizes %s independently', handle => {
    expect(resizedImageDimensions({ width: 200, height: 100, dx: 40, dy: 20, handle, lockAspectRatio: false })).toEqual({
      width: handle.includes('w') ? 160 : handle.includes('e') ? 240 : 200,
      height: handle.includes('n') ? 80 : handle.includes('s') ? 120 : 100,
    })
  })
  it.each(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as ResizeHandle[])('locks %s to the original ratio', handle => {
    const result = resizedImageDimensions({ width: 200, height: 100, dx: handle.includes('w') ? -40 : 40, dy: handle.includes('n') ? -20 : 20, handle, lockAspectRatio: true })
    expect(result).toEqual({ width: 240, height: 120 })
  })
  it('clamps reverse drags and maximum size while retaining ratio', () => {
    expect(resizedImageDimensions({ width: 200, height: 100, dx: -900, dy: 0, handle: 'e', lockAspectRatio: true })).toEqual({ width: 32, height: 16 })
    expect(resizedImageDimensions({ width: 200, height: 100, dx: 9000, dy: 0, handle: 'e', lockAspectRatio: true })).toEqual({ width: 4096, height: 2048 })
    expect(resizedImageDimensions({ width: 200, height: 100, dx: -900, dy: 9000, handle: 'se', lockAspectRatio: false })).toEqual({ width: 16, height: 4096 })
  })
})
