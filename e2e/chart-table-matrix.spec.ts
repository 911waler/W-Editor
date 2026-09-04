import type { Page } from '@playwright/test'

import {
  CHART_TABLE_DESCRIPTORS,
  chartTableSource,
  chartTableStarterSource,
  parseChartTableAt,
} from '../src/codecs'
import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

async function authorityMarkdown(page: Page): Promise<string | undefined> {
  return page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().markdown)
}

async function expectAuthorityMarkdown(page: Page, markdown: string): Promise<void> {
  await expect.poll(() => authorityMarkdown(page)).toBe(markdown)
  await expect.poll(() => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().synchronizationStatus)).toBe('synchronized')
}

async function setSourceMarkdown(page: Page, markdown: string): Promise<void> {
  await page.locator('[data-command-id="mode.source"]').click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'source')
  await page.locator('.cm-content[contenteditable="true"]').fill(markdown)
  await expectAuthorityMarkdown(page, markdown)
}

async function selectEnglish(page: Page): Promise<void> {
  await page.locator('[data-toolbar-menu="language"] .toolbar-menu__trigger').click()
  await page.locator('[data-command-id="language.en"]').click()
}

for (const descriptor of CHART_TABLE_DESCRIPTORS) {
  test(`${descriptor.commandId} inserts exact Markdown, edits atomically, and renders its chart preview`, async ({ page }) => {
    const starter = chartTableStarterSource(descriptor.commandId)
    const parsed = parseChartTableAt(starter, 0)
    if (parsed === null) throw new Error(`Invalid test starter for ${descriptor.commandId}.`)

    const updatedTitle = `${descriptor.chartType} chart updated`
    const updatedCell = `${descriptor.chartType}-cell-updated`
    const updatedRows = parsed.rows.map((row, rowIndex) => (
      row.map((cell, cellIndex) => rowIndex === 0 && cellIndex === 1 ? updatedCell : cell)
    ))
    const updated = chartTableSource({
      chartType: parsed.chartType,
      columns: parsed.columns,
      options: parsed.options,
      rows: updatedRows,
      title: updatedTitle,
    })
    const insertedDocument = `Anchor\n\n${starter}`
    const updatedDocument = `Anchor\n\n${updated}`

    await openReadyApp(page)
    await selectEnglish(page)
    await setSourceMarkdown(page, 'Anchor')
    await page.locator('[data-command-id="mode.visual"]').click()

    await page.locator('[data-toolbar-menu="chart"] .toolbar-menu__trigger').click()
    await page.locator(`[data-command-id="${descriptor.commandId}"]`).click()
    await expectAuthorityMarkdown(page, insertedDocument)

    const node = page.locator(
      `[data-semantic-kind="chart-table"][data-chart-type="${descriptor.chartType}"]`,
    )
    await expect(node).toHaveCount(1)
    await expect(node).toHaveAttribute('data-preview-state', 'ready')
    await expect(node.locator('.semantic-preview__title')).toHaveText(parsed.title)
    await expect(node.locator('.semantic-preview__chart-rendered .cherry-echarts-wrapper')).toHaveAttribute('data-chart-type', descriptor.chartType)
    await expect(node.locator('.semantic-preview__chart-rendered svg')).toHaveCount(1)
    await expect(node.locator('.semantic-preview__chart-data')).toContainText(parsed.rows[0]?.[1] ?? '')

    const editChart = node.getByRole('button', { name: new RegExp(`Edit chart: ${descriptor.labels.en}`, 'u') })
    await node.hover()
    await expect(editChart).toBeVisible()
    await node.dblclick({ position: { x: 24, y: 24 } })
    const dialog = page.locator('[data-editor-command="chart-table.editor"]')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Chart type')).toHaveValue(descriptor.chartType)
    await expect(dialog.getByLabel('Title')).toHaveValue(parsed.title)
    await expect(dialog.locator('[data-chart-draft-preview] svg')).toHaveCount(1)
    await dialog.getByLabel('Title').fill('cancelled title')
    await dialog.locator('#chart-cell-0-1').fill('cancelled cell')
    await expect(dialog.locator('[data-chart-draft-preview] .cherry-echarts-wrapper'))
      .toHaveAttribute('data-chart-options', /cancelled title/u)
    await expectAuthorityMarkdown(page, insertedDocument)
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
    await expectAuthorityMarkdown(page, insertedDocument)

    await node.hover()
    await editChart.click()
    await dialog.getByLabel('Title').fill(updatedTitle)
    await dialog.locator('#chart-cell-0-1').fill(updatedCell)
    await expect(dialog.locator('[data-chart-draft-preview] .cherry-echarts-wrapper'))
      .toHaveAttribute('data-table-data', new RegExp(updatedCell, 'u'))
    await expectAuthorityMarkdown(page, insertedDocument)
    await dialog.getByRole('button', { name: 'Apply' }).click()
    await expect(dialog).toHaveCount(0)
    await expectAuthorityMarkdown(page, updatedDocument)
    await expect(node.locator('.semantic-preview__title')).toHaveText(updatedTitle)
    await expect(node.locator('.semantic-preview__chart-data')).toContainText(updatedCell)
    await expect(node.locator('.semantic-preview__chart-rendered .cherry-echarts-wrapper'))
      .toHaveAttribute('data-chart-options', new RegExp(updatedTitle, 'u'))
    await expect(node.locator('.semantic-preview__chart-rendered svg')).toHaveCount(1)

    await page.locator('[data-command-id="history.undo"]').click()
    await expectAuthorityMarkdown(page, insertedDocument)
    await page.locator('[data-command-id="history.redo"]').click()
    await expectAuthorityMarkdown(page, updatedDocument)

    await page.locator('[data-command-id="mode.preview"]').click()
    const finalPreview = page.locator('.preview-rendered-content .cherry-table-figure')
    const chart = finalPreview.locator(`.cherry-echarts-wrapper[data-chart-type="${descriptor.chartType}"]`)
    await expect(finalPreview).toHaveCount(1)
    await expect(chart).toHaveCount(1)
    await expect(chart.locator('svg')).toHaveCount(1)
    await expect(chart).toHaveAttribute('data-chart-options', new RegExp(updatedTitle))
    await expect(chart).toHaveAttribute('data-table-data', new RegExp(updatedCell))
    await expect(page.locator('.preview-rendered-content script, .preview-rendered-content [onclick], .preview-rendered-content [onerror]'))
      .toHaveCount(0)
    await expectAuthorityMarkdown(page, updatedDocument)
    await expect.poll(() => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().autosaveStatus)).toBe('saved')

    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
    await expectAuthorityMarkdown(page, updatedDocument)
    await page.locator('[data-command-id="mode.visual"]').click()
    await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'visual')
    await expect(node).toHaveCount(1)
    await expect(node.locator('.semantic-preview__title')).toHaveText(updatedTitle)
    await expect(node.locator('.semantic-preview__chart-data')).toContainText(updatedCell)
    await expect(node.locator('.semantic-preview__chart-rendered .cherry-echarts-wrapper'))
      .toHaveAttribute('data-chart-options', new RegExp(updatedTitle, 'u'))
    await expect(node.locator('.semantic-preview__chart-rendered svg')).toHaveCount(1)
  })
}
