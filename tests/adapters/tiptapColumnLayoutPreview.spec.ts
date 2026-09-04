import { afterEach, describe, expect, it } from 'vitest'

import { TiptapVisualAdapter } from '../../src/adapters'
import { columnLayoutStarterSource, projectOrdinaryMarkdown, type ColumnLayoutCommandId } from '../../src/codecs'
import { DocumentSession } from '../../src/core'

const adapters: TiptapVisualAdapter[] = []

afterEach(() => {
  while (adapters.length > 0) adapters.pop()?.destroy()
  document.body.replaceChildren()
})

describe('typed column-layout preview', () => {
  it.each<ColumnLayoutCommandId>(['layout.two-column', 'layout.multi-column'])(
    'renders %s as a selectable preview with its declared edit route',
    (commandId) => {
      const host = document.createElement('div')
      document.body.append(host)
      const session = new DocumentSession({ documentId: commandId, markdown: columnLayoutStarterSource(commandId) })
      const adapter = new TiptapVisualAdapter({ host, project: projectOrdinaryMarkdown, session })
      adapters.push(adapter)
      const preview = host.querySelector<HTMLElement>('[data-semantic-kind="column-layout"]')
      expect(preview).not.toBeNull()
      expect(preview?.getAttribute('aria-label')).toBe(commandId === 'layout.two-column' ? 'Two-column layout' : 'Multi-column layout')
      expect(preview?.querySelectorAll('.semantic-preview__column')).toHaveLength(commandId === 'layout.two-column' ? 2 : 3)
      expect(preview?.querySelector('.semantic-preview__column')?.getAttribute('role')).toBe('region')
      expect(adapter.projection().map.entries[0]?.safePatchUnit.strategy).toEqual({
        editorId: 'column-layout-editor',
        kind: 'semantic-editor',
      })
    },
  )
})
