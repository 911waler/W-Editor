export const LINE_SPACING_STORAGE_KEY = 'w-editor:line-spacing'

export const LINE_SPACING_IDS = Object.freeze([
  'single',
  'compact',
  'standard',
  'double',
] as const)

export type LineSpacingId = (typeof LINE_SPACING_IDS)[number]

export interface LineSpacingOption {
  readonly id: LineSpacingId
  readonly value: number
}

export const LINE_SPACING_OPTIONS: readonly LineSpacingOption[] = Object.freeze([
  Object.freeze({ id: 'single', value: 1.25 }),
  Object.freeze({ id: 'compact', value: 1.5 }),
  Object.freeze({ id: 'standard', value: 1.75 }),
  Object.freeze({ id: 'double', value: 2 }),
])

export function isLineSpacingId(value: unknown): value is LineSpacingId {
  return typeof value === 'string' && LINE_SPACING_IDS.includes(value as LineSpacingId)
}

export function lineSpacingOption(id: LineSpacingId): LineSpacingOption {
  return LINE_SPACING_OPTIONS.find((option) => option.id === id) ?? LINE_SPACING_OPTIONS[2]!
}

export function readLineSpacing(storage: Storage = window.localStorage): LineSpacingId {
  try {
    const stored = storage.getItem(LINE_SPACING_STORAGE_KEY)
    return isLineSpacingId(stored) ? stored : 'standard'
  } catch {
    return 'standard'
  }
}

export function writeLineSpacing(id: LineSpacingId, storage: Storage = window.localStorage): boolean {
  try {
    storage.setItem(LINE_SPACING_STORAGE_KEY, id)
    return true
  } catch {
    return false
  }
}
