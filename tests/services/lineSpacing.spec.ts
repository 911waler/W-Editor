import { describe, expect, it } from 'vitest'

import {
  LINE_SPACING_IDS,
  LINE_SPACING_OPTIONS,
  LINE_SPACING_STORAGE_KEY,
  isLineSpacingId,
  lineSpacingOption,
  readLineSpacing,
  writeLineSpacing,
} from '../../src/services/lineSpacing'

describe('line spacing preference', () => {
  it('exposes four stable appearance values with the existing 1.75 rhythm as default', () => {
    expect(LINE_SPACING_IDS).toEqual(['single', 'compact', 'standard', 'double'])
    expect(LINE_SPACING_OPTIONS.map((option) => option.value)).toEqual([1.25, 1.5, 1.75, 2])
    expect(lineSpacingOption('standard').value).toBe(1.75)
    expect(isLineSpacingId('standard')).toBe(true)
    expect(isLineSpacingId('unsupported')).toBe(false)
  })

  it('persists valid values and falls back from missing, invalid, or unavailable storage', () => {
    const storage = window.localStorage
    expect(readLineSpacing(storage)).toBe('standard')
    expect(writeLineSpacing('double', storage)).toBe(true)
    expect(storage.getItem(LINE_SPACING_STORAGE_KEY)).toBe('double')
    expect(readLineSpacing(storage)).toBe('double')

    storage.setItem(LINE_SPACING_STORAGE_KEY, 'unsupported')
    expect(readLineSpacing(storage)).toBe('standard')

    const unavailable = {
      getItem: () => { throw new Error('storage unavailable') },
      setItem: () => { throw new Error('storage unavailable') },
    } as unknown as Storage
    expect(readLineSpacing(unavailable)).toBe('standard')
    expect(writeLineSpacing('compact', unavailable)).toBe(false)
  })
})
