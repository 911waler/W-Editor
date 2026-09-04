import type { Locator, Page } from '@playwright/test'

import { openReadyApp, useEnglishUi } from './fixtures/app'
import { expect, test } from './fixtures/test'

interface AuthorityState {
  readonly markdown: string
  readonly revision: number
  readonly synchronizationStatus: string
}

function cherryTableSource(columns: number, dataRows: number): string {
  const header = `|${' Header |'.repeat(columns)}`
  const delimiter = `|${' ------ |'.repeat(columns)}`
  const row = `|${' Sample |'.repeat(columns)}`
  return [header, delimiter, ...Array.from({ length: dataRows }, () => row)].join('\n')
}

async function authority(page: Page): Promise<AuthorityState> {
  const snapshot = await page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read())
  if (snapshot === undefined) throw new Error('The E2E authority inspection seam is unavailable.')
  return snapshot
}

async function expectAuthority(page: Page, markdown: string, revision: number): Promise<void> {
  await expect.poll(() => authority(page)).toMatchObject({
    markdown,
    revision,
    synchronizationStatus: 'synchronized',
  })
}

async function seedSource(page: Page): Promise<AuthorityState> {
  await useEnglishUi(page)
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill('Alpha')
  await expect.poll(() => authority(page)).toMatchObject({ markdown: 'Alpha', synchronizationStatus: 'synchronized' })
  return authority(page)
}

async function openTablePicker(page: Page): Promise<Readonly<{ grid: Locator; trigger: Locator }>> {
  const trigger = page.locator('[data-toolbar-menu="insert"] .toolbar-menu__trigger')
  await trigger.click()
  await page.locator('[data-command-id="insert.table"]').click()
  const grid = page.getByRole('grid', { name: 'Table size' })
  await expect(grid).toBeVisible()
  return Object.freeze({ grid, trigger })
}

async function undoOneTable(page: Page, expected: string, revision: number): Promise<void> {
  await page.locator('[data-command-id="history.undo"]').click()
  await expectAuthority(page, expected, revision)
}

test('Task 23.1 pointer picker inserts the 1-by-1 and 9-by-9 Cherry boundaries with exact rows, focus, revision, and one-step undo', async ({ page }) => {
  await openReadyApp(page)
  const before = await seedSource(page)

  let { grid } = await openTablePicker(page)
  await grid.getByRole('gridcell', { name: '1 column by 1 data row' }).click()
  const minimum = `Alpha\n\n${cherryTableSource(1, 1)}`
  await expectAuthority(page, minimum, before.revision + 1)
  await expect(page.locator('#markdown-source-editor')).toBeFocused()
  await undoOneTable(page, 'Alpha', before.revision + 2)

  ;({ grid } = await openTablePicker(page))
  await grid.getByRole('gridcell', { name: '9 columns by 9 data rows' }).click()
  const maximum = `Alpha\n\n${cherryTableSource(9, 9)}`
  await expectAuthority(page, maximum, before.revision + 3)
  await expect(page.locator('#markdown-source-editor')).toBeFocused()
  await undoOneTable(page, 'Alpha', before.revision + 4)
})

test('Task 23.1 keyboard picker clamps both boundaries and inserts the chosen Visual table as one undoable revision', async ({ page }) => {
  await openReadyApp(page)
  const before = await seedSource(page)
  await page.locator('[data-command-id="mode.visual"]').click()

  const trigger = page.locator('[data-toolbar-menu="insert"] .toolbar-menu__trigger')
  await trigger.focus()
  await trigger.press('Enter')
  const tableCommand = page.locator('[data-command-id="insert.table"]')
  await tableCommand.focus()
  await tableCommand.press('Enter')
  let grid = page.getByRole('grid', { name: 'Table size' })
  await expect(grid.getByRole('gridcell', { name: '1 column by 1 data row' })).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowUp')
  await expect(grid.getByRole('gridcell', { name: '1 column by 1 data row' })).toBeFocused()
  await page.keyboard.press('Enter')

  const minimum = `Alpha\n\n${cherryTableSource(1, 1)}`
  await expectAuthority(page, minimum, before.revision + 1)
  await expect(page.locator('.ProseMirror')).toBeFocused()
  await undoOneTable(page, 'Alpha', before.revision + 2)

  await trigger.focus()
  await trigger.press('Enter')
  await tableCommand.focus()
  await tableCommand.press('Enter')
  grid = page.getByRole('grid', { name: 'Table size' })
  for (let offset = 0; offset < 8; offset += 1) await page.keyboard.press('ArrowRight')
  for (let offset = 0; offset < 8; offset += 1) await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowDown')
  await expect(grid.getByRole('gridcell', { name: '9 columns by 9 data rows' })).toBeFocused()
  await page.keyboard.press('Enter')

  const maximum = `Alpha\n\n${cherryTableSource(9, 9)}`
  await expectAuthority(page, maximum, before.revision + 3)
  await expect(page.locator('.ProseMirror')).toBeFocused()
  await undoOneTable(page, 'Alpha', before.revision + 4)
})

test('Task 23.1 exposes a complete screen-reader grid and Escape cancellation creates no revision', async ({ page }) => {
  await openReadyApp(page)
  const before = await seedSource(page)
  const { grid, trigger } = await openTablePicker(page)

  await expect(grid).toHaveAttribute('aria-rowcount', '9')
  await expect(grid).toHaveAttribute('aria-colcount', '9')
  await expect(grid.getByRole('row')).toHaveCount(9)
  const cells = grid.getByRole('gridcell')
  await expect(cells).toHaveCount(81)
  await expect(cells.first()).toHaveAttribute('aria-rowindex', '1')
  await expect(cells.first()).toHaveAttribute('aria-colindex', '1')
  await expect(cells.first()).toHaveAttribute('aria-selected', 'true')
  await expect(cells.first()).toHaveAttribute('tabindex', '0')
  await expect(cells.last()).toHaveAttribute('aria-rowindex', '9')
  await expect(cells.last()).toHaveAttribute('aria-colindex', '9')
  await expect(cells.last()).toHaveAccessibleName('9 columns by 9 data rows')
  await expect(grid.getByRole('status')).toHaveText('1 column × 1 data row')

  await page.keyboard.press('Escape')
  await expect(grid).toBeHidden()
  await expect(trigger).toBeFocused()
  await expectAuthority(page, 'Alpha', before.revision)
})
