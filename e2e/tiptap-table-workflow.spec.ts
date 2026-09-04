import type { Locator, Page } from '@playwright/test'

import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

interface AuthorityState {
  readonly autosaveStatus: string
  readonly markdown: string
  readonly revision: number
  readonly synchronizationStatus: string
}

const TABLE = '| Name | Role | Score |\n| :--- | :--- | :---: |\n| Cara | QA | 7 |\n| Ada | Engineer | 9 |\n| Bob | Design | 8 |'
const DUPLICATED_ROW = '| Name | Role | Score |\n| :--- | :--- | :---: |\n| Cara | QA | 7 |\n| Ada | Engineer | 9 |\n| Ada | Engineer | 9 |\n| Bob | Design | 8 |'
const MOVED_ROW_UP = '| Name | Role | Score |\n| :--- | :--- | :---: |\n| Ada | Engineer | 9 |\n| Cara | QA | 7 |\n| Bob | Design | 8 |'
const WITH_EMPTY_ROW = '| Name | Role | Score |\n| :--- | :--- | :---: |\n| Cara | QA | 7 |\n| Ada | Engineer | 9 |\n|  |  |  |\n| Bob | Design | 8 |'
const DUPLICATED_COLUMN = '| Name | Role | Role | Score |\n| :--- | :--- | :--- | :---: |\n| Cara | QA | QA | 7 |\n| Ada | Engineer | Engineer | 9 |\n| Bob | Design | Design | 8 |'
const MOVED_COLUMN_LEFT = '| Role | Name | Score |\n| :--- | :--- | :---: |\n| QA | Cara | 7 |\n| Engineer | Ada | 9 |\n| Design | Bob | 8 |'
const WITH_EMPTY_COLUMN = '| Name | Role |  | Score |\n| :--- | :--- | :--- | :---: |\n| Cara | QA |  | 7 |\n| Ada | Engineer |  | 9 |\n| Bob | Design |  | 8 |'
const ALIGNED = '| Name | Role | Score |\n| :--- | ---: | :---: |\n| Cara | QA | 7 |\n| Ada | Engineer | 9 |\n| Bob | Design | 8 |'
const SORTED = '| Name | Role | Score |\n| :--- | ---: | :---: |\n| Ada | Engineer | 9 |\n| Bob | Design | 8 |\n| Cara | QA | 7 |'
const EDITED = '| Name | Role | Score |\n| :--- | ---: | :---: |\n| Ada | Engineer | 10 |\n| Bob | Design | 8 |\n| Cara | QA | 7 |'

async function authority(page: Page): Promise<AuthorityState> {
  const snapshot = await page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read())
  if (snapshot === undefined) throw new Error('The E2E authority inspection seam is unavailable.')
  return snapshot
}

async function expectAuthority(page: Page, markdown: string, revision?: number): Promise<void> {
  await expect.poll(() => authority(page)).toMatchObject({
    markdown,
    ...(revision === undefined ? {} : { revision }),
    synchronizationStatus: 'synchronized',
  })
}

async function openVisualTable(page: Page): Promise<Readonly<{ before: AuthorityState; table: Locator }>> {
  await openReadyApp(page)
  const languageMenu = page.locator('[data-toolbar-menu="language"]')
  await languageMenu.locator(':scope > button').click()
  await languageMenu.locator('[data-command-id="language.en"]').click()
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill(TABLE)
  await expectAuthority(page, TABLE)
  const before = await authority(page)
  await page.locator('[data-command-id="mode.visual"]').click()
  const table = page.locator('[data-w-editor-node="ordinary-table"]')
  await expect(table).toHaveCount(1)
  return Object.freeze({ before, table })
}

function cell(table: Locator, row: number, column: number): Locator {
  return table.locator('tbody tr').nth(row).locator('th, td').nth(column)
}

async function runMenuAction(
  table: Locator,
  kind: 'column' | 'row',
  row: number,
  column: number,
  name: string,
): Promise<void> {
  await cell(table, row, column).click()
  await table.locator(`[data-table-handle="${kind}"]`).click()
  await table.getByRole('menu', { name: new RegExp(`^${kind === 'row' ? 'Row' : 'Column'} \\d+ actions$`, 'u') })
    .getByRole('menuitem', { name, exact: true })
    .click()
}

test('Task 23.2 table selection, grouped menus, keyboard focus, screen-reader names, and absent advanced actions follow the Tiptap workflow', async ({ page }) => {
  const { before, table } = await openVisualTable(page)
  await expect(table.getByRole('table', { name: 'Editable Markdown table' })).toHaveCount(1)

  await cell(table, 2, 0).click()
  await expect(table.locator('[data-table-selection-overlay]')).toBeVisible()
  const rowHandle = table.getByRole('button', { name: 'Row 3 actions' })
  let columnHandle = table.getByRole('button', { name: 'Column 1 actions' })
  await expect(rowHandle).toBeVisible()
  await expect(columnHandle).toBeVisible()

  await rowHandle.focus()
  await rowHandle.press('Enter')
  const rowMenu = table.getByRole('menu', { name: 'Row 3 actions' })
  await expect(rowMenu).toBeVisible()
  await expect(rowMenu.getByRole('menuitem')).toHaveCount(6)
  await expect(rowMenu.locator(':scope > [role="group"]')).toHaveCount(3)
  await expect(rowMenu.locator(':scope > [role="separator"]')).toHaveCount(2)
  await expect(rowMenu.getByRole('menuitem', { name: 'Move row up' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(rowMenu.getByRole('menuitem', { name: 'Duplicate row' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expectAuthority(page, DUPLICATED_ROW, before.revision + 1)
  await expect(page.locator('.ProseMirror')).toBeFocused()

  await page.locator('[data-command-id="history.undo"]').click()
  await expectAuthority(page, TABLE, before.revision + 2)

  await cell(table, 2, 1).click()
  columnHandle = table.getByRole('button', { name: 'Column 2 actions' })
  await columnHandle.focus()
  await columnHandle.press(' ')
  const columnMenu = table.getByRole('menu', { name: 'Column 2 actions' })
  await expect(columnMenu).toBeVisible()
  await expect(columnMenu.getByRole('menuitem', { name: 'Move column left' })).toBeFocused()
  await page.keyboard.press('End')
  await expect(columnMenu.getByRole('menuitem', { name: 'Delete column' })).toBeFocused()
  await page.keyboard.press('Home')
  await page.keyboard.press('Escape')
  await expect(columnMenu).toBeHidden()
  await expect(columnHandle).toBeFocused()

  await columnHandle.press('Enter')
  await columnMenu.getByRole('menuitem', { name: 'Align column right' }).focus()
  await page.keyboard.press('Enter')
  await expectAuthority(page, ALIGNED, before.revision + 3)
  await expect(page.locator('.ProseMirror')).toBeFocused()

  await cell(table, 2, 1).click()
  await table.getByRole('button', { name: 'Column 2 actions' }).click()
  const reopened = table.getByRole('menu', { name: 'Column 2 actions' })
  await expect(reopened.locator(':scope > [role="group"]')).toHaveCount(5)
  await expect(reopened.locator(':scope > [role="separator"]')).toHaveCount(4)
  await expect(reopened.locator('[data-table-action-icon]')).toHaveCount(11)
  await expect(reopened.locator('[data-table-advanced-action]')).toHaveCount(0)
  await expect(reopened).not.toContainText('Merge cells unavailable')
  await expect(reopened).not.toContainText('Persistent sort unavailable')
  expect(await reopened.evaluate((menu) => menu.scrollHeight <= menu.clientHeight)).toBe(true)
  await expectAuthority(page, ALIGNED, before.revision + 3)
})

test('Task 23.2 pointer workflow writes every row/column operation and one-time sort into exact Markdown, then survives Final, undo, and reload', async ({ page }) => {
  test.setTimeout(60_000)
  const { before, table } = await openVisualTable(page)

  await runMenuAction(table, 'row', 2, 0, 'Duplicate row')
  await expectAuthority(page, DUPLICATED_ROW, before.revision + 1)
  await page.locator('[data-command-id="history.undo"]').click()
  await expectAuthority(page, TABLE, before.revision + 2)

  await runMenuAction(table, 'row', 2, 0, 'Move row up')
  await expectAuthority(page, MOVED_ROW_UP, before.revision + 3)
  await runMenuAction(table, 'row', 1, 0, 'Move row down')
  await expectAuthority(page, TABLE, before.revision + 4)
  await runMenuAction(table, 'row', 2, 0, 'Add row after')
  await expectAuthority(page, WITH_EMPTY_ROW, before.revision + 5)
  await runMenuAction(table, 'row', 3, 0, 'Delete row')
  await expectAuthority(page, TABLE, before.revision + 6)

  await runMenuAction(table, 'column', 2, 1, 'Duplicate column')
  await expectAuthority(page, DUPLICATED_COLUMN, before.revision + 7)
  await page.locator('[data-command-id="history.undo"]').click()
  await expectAuthority(page, TABLE, before.revision + 8)
  await runMenuAction(table, 'column', 2, 1, 'Move column left')
  await expectAuthority(page, MOVED_COLUMN_LEFT, before.revision + 9)
  await runMenuAction(table, 'column', 2, 0, 'Move column right')
  await expectAuthority(page, TABLE, before.revision + 10)
  await runMenuAction(table, 'column', 2, 1, 'Add column after')
  await expectAuthority(page, WITH_EMPTY_COLUMN, before.revision + 11)
  await runMenuAction(table, 'column', 2, 2, 'Delete column')
  await expectAuthority(page, TABLE, before.revision + 12)

  await runMenuAction(table, 'column', 2, 1, 'Align column right')
  await expectAuthority(page, ALIGNED, before.revision + 13)
  await runMenuAction(table, 'column', 2, 0, 'Sort ascending')
  await expectAuthority(page, SORTED, before.revision + 14)

  const score = cell(table, 1, 2)
  await score.click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  await page.keyboard.type('10')
  await expectAuthority(page, EDITED, before.revision + 15)
  await page.locator('[data-command-id="history.undo"]').click()
  await expectAuthority(page, SORTED, before.revision + 16)
  await page.locator('[data-command-id="history.redo"]').click()
  await expectAuthority(page, EDITED, before.revision + 17)

  expect(JSON.stringify(await page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read()))).not.toMatch(/sortDirection|sortColumn|columnWidth|backgroundColor|verticalAlign/u)
  await page.locator('[data-command-id="mode.preview"]').click()
  const finalTable = page.locator('.preview-rendered-content table')
  await expect(finalTable).toContainText('Ada')
  await expect(finalTable).toContainText('10')
  expect(await finalTable.locator('th, td').evaluateAll((cells) => (
    cells.some((cell) => getComputedStyle(cell).textAlign === 'right')
  ))).toBe(true)
  await expect.poll(() => authority(page)).toMatchObject({ autosaveStatus: 'saved', markdown: EDITED })

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  await expectAuthority(page, EDITED)
  await page.locator('[data-command-id="mode.visual"]').click()
  await expect(page.locator('[data-w-editor-node="ordinary-table"] tbody tr')).toHaveCount(4)
  await expect(page.locator('[data-w-editor-node="ordinary-table"]')).toContainText('10')
})
