import { afterEach, describe, expect, it } from 'vitest'

import { TiptapVisualAdapter } from '../../src/adapters'
import { projectOrdinaryMarkdown } from '../../src/codecs'
import { DocumentSession } from '../../src/core'

const TABLE = '| Name | Score |\n| :--- | :---: |\n| Ada | 99 |'
const adapters: TiptapVisualAdapter[] = []

afterEach(() => {
  while (adapters.length > 0) adapters.pop()?.destroy()
  document.body.replaceChildren()
})

function mountTable() {
  const host = document.createElement('div')
  document.body.append(host)
  const session = new DocumentSession({ documentId: 'ordinary-table', markdown: TABLE })
  const adapter = new TiptapVisualAdapter({ host, project: projectOrdinaryMarkdown, session })
  adapters.push(adapter)
  return { adapter, host, session }
}

function button(host: HTMLElement, action: string): HTMLButtonElement {
  const replacements: Readonly<Record<string, string>> = Object.freeze({
    'add-column': 'add-column-after',
    'add-row': 'add-row-after',
    'align-center': 'align-column-center',
    'align-left': 'align-column-left',
    'align-right': 'align-column-right',
  })
  const currentAction = replacements[action] ?? action
  const kind = currentAction.includes('row') ? 'row' : 'column'
  host.querySelector<HTMLButtonElement>(`[data-table-handle="${kind}"]`)?.click()
  const control = host.querySelector<HTMLButtonElement>(`[data-table-action="${currentAction}"]`)
  if (control === null) throw new Error(`Missing table action ${action}.`)
  return control
}

describe('ordinary table direct controls', () => {
  it('keeps cell content in the main editor and directly edits it', () => {
    const { adapter, host, session } = mountTable()
    expect(host.querySelector('[data-w-editor-node="ordinary-table"] table')).not.toBeNull()
    expect(host.querySelector('[data-w-editor-node="ordinary-table"] [contenteditable="true"]')).toBeNull()
    expect(host.querySelector('.column-resize-handle')).toBeNull()
    adapter.setSelection({ anchor: 30, head: 30 })
    adapter.insertText('Perfect ')
    expect(adapter.documentJSON().content?.[0]?.content?.[1]?.content?.[1]?.content?.[0]?.content?.[0]?.text).toBe('Perfect 99')
    expect(session.snapshot().revision).toBe(0)
  })

  it('adds and deletes the selected body row through contextual controls', () => {
    const { adapter, host } = mountTable()
    adapter.setSelection({ anchor: 19, head: 19 })
    button(host, 'add-row').click()
    expect(adapter.documentJSON().content?.[0]?.content).toHaveLength(3)
    button(host, 'delete-row').click()
    expect(adapter.documentJSON().content?.[0]?.content).toHaveLength(2)
  })

  it('adds and deletes the selected column through contextual controls', () => {
    const { adapter, host } = mountTable()
    adapter.setSelection({ anchor: 19, head: 19 })
    button(host, 'add-column').click()
    expect(adapter.documentJSON().content?.[0]?.content?.map((row) => row.content?.length)).toEqual([3, 3])
    button(host, 'delete-column').click()
    expect(adapter.documentJSON().content?.[0]?.content?.map((row) => row.content?.length)).toEqual([2, 2])
  })

  it.each([
    ['align-left', 'left'],
    ['align-center', 'center'],
    ['align-right', 'right'],
  ] as const)('applies %s to the complete selected column', (action, alignment) => {
    const { adapter, host } = mountTable()
    adapter.setSelection({ anchor: 30, head: 30 })
    button(host, action).click()
    expect(adapter.documentJSON().content?.[0]?.content?.map((row) => row.content?.[1]?.attrs?.['align'])).toEqual([
      alignment,
      alignment,
    ])
  })

  it('does not expose merge or resize controls', () => {
    const { host } = mountTable()
    expect(host.querySelector('[data-table-action*="merge"]')).toBeNull()
    expect(host.querySelector('[data-table-action*="resize"]')).toBeNull()
    expect(host.querySelectorAll('[data-table-action]')).toHaveLength(17)
    expect(host.querySelector('[data-table-advanced-action]')).toBeNull()
  })
})
