import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  CherryRenderAdapter,
  TiptapTransactionPatchPlanner,
  TiptapVisualAdapter,
  serializeOrdinaryTiptapPatch,
} from '../../src/adapters'
import { projectOrdinaryMarkdown } from '../../src/codecs'
import { DocumentSession, type PatchPlan } from '../../src/core'

const TABLE = '| Name | Score |\n| :--- | :---: |\n| Ada | 99 |'
const adapters: TiptapVisualAdapter[] = []
const rangePrototype = Range.prototype
const originalRangeGetClientRects = Object.getOwnPropertyDescriptor(rangePrototype, 'getClientRects')
let installedRangeGetClientRects = false

beforeAll(() => {
  if (typeof rangePrototype.getClientRects === 'function') return
  Object.defineProperty(rangePrototype, 'getClientRects', {
    configurable: true,
    value(this: Range): DOMRectList {
      const rect = new DOMRect(0, 0, 1, 1)
      const rects = Object.assign([rect], {
        item: (index: number): DOMRect | null => index === 0 ? rect : null,
      })
      return rects as unknown as DOMRectList
    },
  })
  installedRangeGetClientRects = true
})

afterAll(() => {
  if (!installedRangeGetClientRects) return
  if (originalRangeGetClientRects === undefined) {
    Reflect.deleteProperty(rangePrototype, 'getClientRects')
    return
  }
  Object.defineProperty(rangePrototype, 'getClientRects', originalRangeGetClientRects)
})

afterEach(() => {
  while (adapters.length > 0) adapters.pop()?.destroy()
  document.body.replaceChildren()
})

function mount(markdown: string) {
  const host = document.createElement('div')
  document.body.append(host)
  const session = new DocumentSession({ documentId: 'table-sync', markdown })
  const plans: PatchPlan[] = []
  let sequence = 0
  const adapter = new TiptapVisualAdapter({
    host,
    onTransaction: ({ patchPlan }) => {
      if (patchPlan !== null) plans.push(patchPlan)
    },
    patchPlanner: new TiptapTransactionPatchPlanner({
      createTransactionId: () => `table-sync:${++sequence}`,
      serialize: serializeOrdinaryTiptapPatch,
    }),
    project: projectOrdinaryMarkdown,
    session,
  })
  adapters.push(adapter)
  const commitLatest = (): void => {
    const plan = plans.at(-1)
    if (plan === undefined) throw new Error('Expected a table patch plan.')
    session.commitPatchPlan(plan)
    adapter.acknowledgeSynchronization({ map: projectOrdinaryMarkdown(session.snapshot()).map, snapshot: session.snapshot() })
  }
  return { adapter, commitLatest, host, plans, session }
}

function selectText(adapter: TiptapVisualAdapter, text: string): void {
  const document = adapter.schema().nodeFromJSON(adapter.documentJSON())
  let position: number | null = null
  document.descendants((node, nodePosition) => {
    if (!node.isText || node.text !== text || position !== null) return true
    position = nodePosition
    return false
  })
  if (position === null) throw new Error(`Text ${text} was not found.`)
  adapter.setSelection({ anchor: position, head: position })
}

function click(host: HTMLElement, action: string): void {
  const replacements: Readonly<Record<string, string>> = Object.freeze({
    'add-column': 'add-column-after',
    'add-row': 'add-row-after',
    'align-right': 'align-column-right',
  })
  const currentAction = replacements[action] ?? action
  const kind = currentAction.includes('row') ? 'row' : 'column'
  host.querySelector<HTMLButtonElement>(`[data-table-handle="${kind}"]`)?.click()
  const control = host.querySelector<HTMLButtonElement>(`[data-table-action="${currentAction}"]`)
  if (control === null) throw new Error(`Missing table action ${action}.`)
  control.click()
}

describe('ordinary table synchronization', () => {
  it('replaces an empty visual line instead of leaving a transient paragraph before the table', () => {
    const { adapter, plans } = mount('')
    adapter.setSelection({ anchor: 1, head: 1 })

    expect(adapter.insertTable(2, 1)).toMatchObject({ changed: true })
    expect(adapter.documentJSON().content?.map(({ type }) => type)).toEqual(['table'])
    expect(plans).toHaveLength(1)
    expect(plans[0]?.patches[0]?.replacement).toBe('| Header | Header |\n| ------ | ------ |\n| Sample | Sample |')
  })

  it('patches only the table unit, reloads direct cell edits, renders in Cherry, and undoes once', () => {
    const prefix = 'Before exact.\r\n\r\n'
    const suffix = '\r\n\r\nAfter exact.\n'
    const { adapter, commitLatest, plans, session } = mount(`${prefix}${TABLE}${suffix}`)
    selectText(adapter, '99')
    adapter.insertText('Perfect ')

    const edited = '| Name | Score |\n| :--- | :---: |\n| Ada | Perfect 99 |'
    expect(plans).toHaveLength(1)
    expect(plans[0]?.patches).toEqual([{
      codecId: 'ordinary-table',
      expected: TABLE,
      from: prefix.length,
      replacement: edited,
      to: prefix.length + TABLE.length,
    }])
    commitLatest()
    expect(session.snapshot().markdown).toBe(`${prefix}${edited}${suffix}`)

    const reloadHost = document.createElement('div')
    document.body.append(reloadHost)
    const reloaded = new TiptapVisualAdapter({ host: reloadHost, project: projectOrdinaryMarkdown, session })
    adapters.push(reloaded)
    expect(reloaded.text()).toContain('Perfect 99')
    const html = new CherryRenderAdapter().render(session.snapshot()).html
    expect(html).toContain('<table')
    expect(html).toContain('Perfect 99')

    expect(adapter.undo()).toBe(true)
    expect(plans).toHaveLength(2)
    expect(plans[1]?.patches[0]?.replacement).toBe(TABLE)
    commitLatest()
    expect(session.snapshot().markdown).toBe(`${prefix}${TABLE}${suffix}`)
  })

  it('distinguishes unspecified from explicit-left alignment and restores the exact delimiter through undo and redo', () => {
    const original = '| Name | Role | Score |\n| --- | :--- | ---: |\n| Ada | Engineer | 99 |'
    const edited = '| Name | Role | Score |\n| --- | :--- | ---: |\n| Ada | Engineer | Perfect 99 |'
    const { adapter, commitLatest, plans, session } = mount(original)
    selectText(adapter, '99')
    adapter.insertText('Perfect ')

    expect(plans).toHaveLength(1)
    expect(plans[0]?.patches[0]?.replacement).toBe(edited)
    commitLatest()
    expect(session.snapshot().markdown).toBe(edited)

    expect(adapter.undo()).toBe(true)
    expect(plans).toHaveLength(2)
    expect(plans[1]?.patches[0]?.replacement).toBe(original)
    commitLatest()
    expect(session.snapshot().markdown).toBe(original)

    expect(adapter.redo()).toBe(true)
    expect(plans).toHaveLength(3)
    expect(plans[2]?.patches[0]?.replacement).toBe(edited)
    commitLatest()
    expect(session.snapshot().markdown).toBe(edited)
  })

  it('moves exact unspecified and explicit-left delimiter syntax with its column and undoes byte-for-byte', () => {
    const original = '| Plain | Explicit |\n| --- | :------ |\n| A | B |'
    const moved = '| Explicit | Plain |\n| :------ | --- |\n| B | A |'
    const { adapter, commitLatest, host, plans, session } = mount(original)
    selectText(adapter, 'B')
    click(host, 'move-column-left')

    expect(plans).toHaveLength(1)
    expect(plans[0]?.patches[0]?.replacement).toBe(moved)
    commitLatest()
    expect(session.snapshot().markdown).toBe(moved)

    expect(adapter.undo()).toBe(true)
    expect(plans).toHaveLength(2)
    expect(plans[1]?.patches[0]?.replacement).toBe(original)
    commitLatest()
    expect(session.snapshot().markdown).toBe(original)
  })

  it('turns unspecified alignment into explicit left and undo restores the original marker', () => {
    const original = '| Plain | Score |\n| --- | ---: |\n| A | 9 |'
    const explicitLeft = '| Plain | Score |\n| :--- | ---: |\n| A | 9 |'
    const { adapter, commitLatest, host, plans, session } = mount(original)
    selectText(adapter, 'A')
    click(host, 'align-column-left')

    expect(plans).toHaveLength(1)
    expect(plans[0]?.patches[0]?.replacement).toBe(explicitLeft)
    commitLatest()
    expect(session.snapshot().markdown).toBe(explicitLeft)

    expect(adapter.undo()).toBe(true)
    expect(plans).toHaveLength(2)
    expect(plans[1]?.patches[0]?.replacement).toBe(original)
    commitLatest()
    expect(session.snapshot().markdown).toBe(original)

    expect(adapter.redo()).toBe(true)
    expect(plans).toHaveLength(3)
    expect(plans[2]?.patches[0]?.replacement).toBe(explicitLeft)
    commitLatest()
    expect(session.snapshot().markdown).toBe(explicitLeft)
  })

  it('serializes complete-column alignment markers and Cherry preview alignment', () => {
    const { adapter, commitLatest, host, plans, session } = mount(TABLE)
    selectText(adapter, '99')
    click(host, 'align-right')
    const aligned = '| Name | Score |\n| :--- | ---: |\n| Ada | 99 |'
    expect(plans).toHaveLength(1)
    expect(plans[0]?.patches[0]?.replacement).toBe(aligned)
    commitLatest()
    const html = new CherryRenderAdapter().render(session.snapshot()).html
    expect(html).toContain('align="right"')
  })

  it('synchronizes each row/column control as one valid table transaction', () => {
    const { adapter, commitLatest, host, plans, session } = mount(TABLE)
    selectText(adapter, 'Ada')
    click(host, 'add-row')
    expect(plans).toHaveLength(1)
    expect(plans[0]?.patches[0]?.replacement).toBe('| Name | Score |\n| :--- | :---: |\n| Ada | 99 |\n|  |  |')
    commitLatest()

    click(host, 'add-column')
    expect(plans).toHaveLength(2)
    expect(plans[1]?.patches[0]?.replacement).toContain('| Name |  | Score |')
    commitLatest()

    click(host, 'delete-column')
    expect(plans).toHaveLength(3)
    commitLatest()
    expect(session.snapshot().markdown).toBe('| Name | Score |\n| :--- | :---: |\n| Ada | 99 |\n|  |  |')
  })

  it('inserts a visual table and removes it with one undo step', () => {
    const { adapter, commitLatest, plans, session } = mount('Alpha')
    adapter.setSelection({ anchor: 3, head: 3 })
    expect(adapter.insertTable(2, 1)).toMatchObject({ changed: true })
    expect(plans).toHaveLength(1)
    expect(plans[0]?.patches[0]?.replacement).toContain('| Header | Header |\n| ------ | ------ |\n| Sample | Sample |')
    commitLatest()
    expect(session.snapshot().markdown).toContain('| ------ | ------ |')

    expect(adapter.undo()).toBe(true)
    expect(plans).toHaveLength(2)
    expect(plans[1]?.patches[0]?.replacement).toBe('Alpha')
    commitLatest()
    expect(session.snapshot().markdown).toBe('Alpha')
  })

  it('inserts a visual table between ordinary blocks as one checked patch', () => {
    const markdown = 'Line 49\n\nLine 50\n\nLine 51'
    const table = '| Header | Header |\n| ------ | ------ |\n| Sample | Sample |'
    const { adapter, host, plans, session } = mount(markdown)
    try {
      selectText(adapter, 'Line 50')

      expect(adapter.insertTable(2, 1)).toMatchObject({ changed: true })
      expect(plans).toHaveLength(1)
      expect(plans[0]?.patches).toEqual([{
        codecId: 'ordinary-insert',
        expected: 'Line 50\n\nLine 51',
        from: markdown.indexOf('Line 50'),
        replacement: `Line 50\n\n${table}\n\nLine 51`,
        to: markdown.length,
      }])
      expect(session.previewPatchPlan(plans[0]!)).toBe(`Line 49\n\nLine 50\n\n${table}\n\nLine 51`)
    } finally {
      adapter.destroy()
      host.remove()
    }
  })
})
