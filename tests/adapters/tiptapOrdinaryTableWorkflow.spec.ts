import { afterEach, describe, expect, it } from 'vitest'

import { TiptapTransactionPatchPlanner, TiptapVisualAdapter, serializeOrdinaryTiptapPatch } from '../../src/adapters'
import { projectOrdinaryMarkdown } from '../../src/codecs'
import { DocumentSession, type PatchPlan } from '../../src/core'

const TABLE = '| Name | Role | Score |\n| :--- | :--- | :---: |\n| Cara | QA | 7 |\n| Ada | Engineer | 9 |\n| Bob | Design | 8 |'
const adapters: TiptapVisualAdapter[] = []

afterEach(() => {
  while (adapters.length > 0) adapters.pop()?.destroy()
  document.body.replaceChildren()
})

function mountTable() {
  const host = document.createElement('div')
  document.body.append(host)
  const session = new DocumentSession({ documentId: 'table-workflow', markdown: TABLE })
  const plans: PatchPlan[] = []
  const adapter = new TiptapVisualAdapter({
    host,
    onTransaction: ({ patchPlan }) => {
      if (patchPlan !== null) plans.push(patchPlan)
    },
    patchPlanner: new TiptapTransactionPatchPlanner({
      createTransactionId: () => 'table-workflow:1',
      serialize: serializeOrdinaryTiptapPatch,
    }),
    project: projectOrdinaryMarkdown,
    session,
  })
  adapters.push(adapter)
  return { adapter, host, plans }
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

function openMenu(host: HTMLElement, kind: 'column' | 'row'): HTMLElement {
  const handle = host.querySelector<HTMLButtonElement>(`[data-table-handle="${kind}"]`)
  if (handle === null) throw new Error(`Missing ${kind} handle.`)
  handle.click()
  const menu = host.querySelector<HTMLElement>(`[data-table-menu="${kind}"]`)
  if (menu === null) throw new Error(`Missing ${kind} menu.`)
  return menu
}

function runAction(host: HTMLElement, kind: 'column' | 'row', action: string): void {
  const menu = openMenu(host, kind)
  const control = menu.querySelector<HTMLButtonElement>(`[data-table-action="${action}"]`)
  if (control === null) throw new Error(`Missing table action ${action}.`)
  control.click()
}

function expectReplacement(plans: readonly PatchPlan[], replacement: string): void {
  expect(plans).toHaveLength(1)
  expect(plans[0]?.patches).toEqual([{
    codecId: 'ordinary-table',
    expected: TABLE,
    from: 0,
    replacement,
    to: TABLE.length,
  }])
}

function tableMenuStructure(menu: HTMLElement): readonly string[] {
  return [...menu.children].map((child) => {
    if (child.getAttribute('role') === 'separator') return 'separator'
    const name = child.getAttribute('data-table-menu-group')
    const actions = [...child.querySelectorAll<HTMLElement>('[data-table-action]')]
      .map((control) => control.dataset['tableAction'])
    return `group:${name}:${actions.join(',')}`
  })
}

describe('Tiptap-reference ordinary table workflow', () => {
  it('shows a cell-selection overlay plus accessible row and column handles and menus', () => {
    const { adapter, host } = mountTable()
    selectText(adapter, 'Ada')

    expect(host.querySelector('table[aria-label="Editable Markdown table"]')).not.toBeNull()
    expect(host.querySelector('[data-table-selection-overlay]')?.getAttribute('aria-hidden')).toBe('true')
    const rowHandle = host.querySelector<HTMLButtonElement>('[data-table-handle="row"]')
    const columnHandle = host.querySelector<HTMLButtonElement>('[data-table-handle="column"]')
    expect(rowHandle?.getAttribute('aria-label')).toBe('Row 3 actions')
    expect(columnHandle?.getAttribute('aria-label')).toBe('Column 1 actions')

    rowHandle?.click()
    expect(host.querySelector('[data-table-menu="row"]')?.getAttribute('role')).toBe('menu')
    expect(host.querySelector('[data-table-menu="row"]')?.getAttribute('aria-label')).toBe('Row 3 actions')
  })

  it('organizes row and column commands into Tiptap-style semantic groups with dividers and icons', () => {
    const { adapter, host } = mountTable()
    selectText(adapter, 'Ada')
    const rowMenu = openMenu(host, 'row')
    const columnMenu = openMenu(host, 'column')

    expect(tableMenuStructure(rowMenu)).toEqual([
      'group:move:move-row-up,move-row-down',
      'separator',
      'group:insert:add-row-before,add-row-after',
      'separator',
      'group:finish:duplicate-row,delete-row',
    ])
    expect(tableMenuStructure(columnMenu)).toEqual([
      'group:move:move-column-left,move-column-right',
      'separator',
      'group:insert:add-column-before,add-column-after',
      'separator',
      'group:sort:sort-column-ascending,sort-column-descending',
      'separator',
      'group:alignment:align-column-left,align-column-center,align-column-right',
      'separator',
      'group:finish:duplicate-column,delete-column',
    ])
    expect(rowMenu.querySelectorAll('[data-table-action-icon]')).toHaveLength(6)
    expect(columnMenu.querySelectorAll('[data-table-action-icon]')).toHaveLength(11)
    expect(rowMenu.querySelector('[data-table-action="delete-row"]')?.getAttribute('data-danger')).toBe('true')
    expect(columnMenu.querySelector('[data-table-action="delete-column"]')?.getAttribute('data-danger')).toBe('true')
  })

  it.each([
    ['add-row-before', '| Name | Role | Score |\n| :--- | :--- | :---: |\n| Cara | QA | 7 |\n|  |  |  |\n| Ada | Engineer | 9 |\n| Bob | Design | 8 |'],
    ['add-row-after', '| Name | Role | Score |\n| :--- | :--- | :---: |\n| Cara | QA | 7 |\n| Ada | Engineer | 9 |\n|  |  |  |\n| Bob | Design | 8 |'],
    ['duplicate-row', '| Name | Role | Score |\n| :--- | :--- | :---: |\n| Cara | QA | 7 |\n| Ada | Engineer | 9 |\n| Ada | Engineer | 9 |\n| Bob | Design | 8 |'],
    ['move-row-up', '| Name | Role | Score |\n| :--- | :--- | :---: |\n| Ada | Engineer | 9 |\n| Cara | QA | 7 |\n| Bob | Design | 8 |'],
    ['move-row-down', '| Name | Role | Score |\n| :--- | :--- | :---: |\n| Cara | QA | 7 |\n| Bob | Design | 8 |\n| Ada | Engineer | 9 |'],
    ['delete-row', '| Name | Role | Score |\n| :--- | :--- | :---: |\n| Cara | QA | 7 |\n| Bob | Design | 8 |'],
  ] as const)('%s writes the actual row structure into one exact pipe-Markdown patch', (action, replacement) => {
    const { adapter, host, plans } = mountTable()
    selectText(adapter, 'Ada')
    runAction(host, 'row', action)
    expectReplacement(plans, replacement)
  })

  it.each([
    ['add-column-before', '| Name |  | Role | Score |\n| :--- | :--- | :--- | :---: |\n| Cara |  | QA | 7 |\n| Ada |  | Engineer | 9 |\n| Bob |  | Design | 8 |'],
    ['add-column-after', '| Name | Role |  | Score |\n| :--- | :--- | :--- | :---: |\n| Cara | QA |  | 7 |\n| Ada | Engineer |  | 9 |\n| Bob | Design |  | 8 |'],
    ['duplicate-column', '| Name | Role | Role | Score |\n| :--- | :--- | :--- | :---: |\n| Cara | QA | QA | 7 |\n| Ada | Engineer | Engineer | 9 |\n| Bob | Design | Design | 8 |'],
    ['move-column-left', '| Role | Name | Score |\n| :--- | :--- | :---: |\n| QA | Cara | 7 |\n| Engineer | Ada | 9 |\n| Design | Bob | 8 |'],
    ['move-column-right', '| Name | Score | Role |\n| :--- | :---: | :--- |\n| Cara | 7 | QA |\n| Ada | 9 | Engineer |\n| Bob | 8 | Design |'],
    ['delete-column', '| Name | Score |\n| :--- | :---: |\n| Cara | 7 |\n| Ada | 9 |\n| Bob | 8 |'],
  ] as const)('%s writes the actual column structure into one exact pipe-Markdown patch', (action, replacement) => {
    const { adapter, host, plans } = mountTable()
    selectText(adapter, 'Engineer')
    runAction(host, 'column', action)
    expectReplacement(plans, replacement)
  })

  it.each([
    ['sort-column-ascending', '| Name | Role | Score |\n| :--- | :--- | :---: |\n| Ada | Engineer | 9 |\n| Bob | Design | 8 |\n| Cara | QA | 7 |'],
    ['sort-column-descending', '| Name | Role | Score |\n| :--- | :--- | :---: |\n| Cara | QA | 7 |\n| Bob | Design | 8 |\n| Ada | Engineer | 9 |'],
    ['align-column-right', '| Name | Role | Score |\n| :--- | ---: | :---: |\n| Cara | QA | 7 |\n| Ada | Engineer | 9 |\n| Bob | Design | 8 |'],
  ] as const)('%s serializes content or alignment without persistent table UI state', (action, replacement) => {
    const { adapter, host, plans } = mountTable()
    selectText(adapter, action.startsWith('sort-') ? 'Ada' : 'Engineer')
    runAction(host, 'column', action)
    expectReplacement(plans, replacement)
    expect(JSON.stringify(adapter.documentJSON())).not.toMatch(/sortDirection|sortColumn|columnWidth|backgroundColor|verticalAlign/u)
  })

  it('keeps unsupported advanced table actions absent and out of content state', () => {
    const { adapter, host, plans } = mountTable()
    selectText(adapter, 'Engineer')
    openMenu(host, 'column')
    expect(host.querySelector('[data-table-advanced-action]')).toBeNull()
    expect(host.textContent).not.toContain('Merge cells unavailable')
    expect(host.textContent).not.toContain('Persistent sort unavailable')
    expect(plans).toHaveLength(0)
    expect(JSON.stringify(adapter.documentJSON())).not.toMatch(/sortDirection|sortColumn|columnWidth|backgroundColor|verticalAlign/u)
  })
})
