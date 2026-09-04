import { describe, expect, it } from 'vitest'

import {
  TIPTAP_VISUAL_HISTORY_CONFIG,
  createTiptapVisualExtensions,
} from '../../src/adapters/tiptapVisualSchema'

describe('Tiptap visual history contract', () => {
  it('wires the documented event depth and grouping delay into StarterKit', () => {
    const starterKit = createTiptapVisualExtensions().find((extension) => extension.name === 'starterKit')

    expect(TIPTAP_VISUAL_HISTORY_CONFIG).toEqual({ depth: 100, newGroupDelay: 500 })
    expect(starterKit?.options['undoRedo']).toEqual(TIPTAP_VISUAL_HISTORY_CONFIG)
  })
})
