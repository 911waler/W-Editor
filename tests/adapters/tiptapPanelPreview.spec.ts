import { afterEach, describe, expect, it } from 'vitest'

import { TiptapVisualAdapter } from '../../src/adapters'
import { PANEL_VARIANTS } from '../../src/codecs'
import { DocumentSession } from '../../src/core'
import { projectOrdinaryMarkdown } from '../../src/codecs/ordinaryBlocks'

const adapters: TiptapVisualAdapter[] = []

afterEach(() => {
  while (adapters.length > 0) adapters.pop()?.destroy()
})

describe('typed Tiptap panel previews', () => {
  it.each(PANEL_VARIANTS)('renders the %s panel title and body without a nested editor', (variant) => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({
      documentId: variant,
      markdown: `::: ${variant} Panel title\nPanel body\n:::`,
    })
    const adapter = new TiptapVisualAdapter({ host, project: projectOrdinaryMarkdown, session })
    adapters.push(adapter)
    expect(host.querySelector(`[data-semantic-variant="${variant}"]`)).not.toBeNull()
    expect(host.querySelector('.semantic-preview__title')?.textContent).toBe('Panel title')
    expect(host.querySelector('.semantic-preview__body')?.textContent).toBe('Panel body')
    expect(host.querySelector('.semantic-preview__panel-header .semantic-preview__panel-icon')?.getAttribute('aria-hidden')).toBe('true')
    expect(host.querySelector('[contenteditable="true"] [contenteditable="true"]')).toBeNull()
    host.remove()
  })
})
