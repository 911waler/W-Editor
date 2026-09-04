import type { Page } from '@playwright/test'

import {
  chartTableStarterSource,
  columnLayoutSource,
  disclosureSource,
  panelSource,
} from '../src/codecs'
import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

async function authorityMarkdown(page: Page): Promise<string | undefined> {
  return page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().markdown)
}

async function expectMarkdown(page: Page, markdown: string): Promise<void> {
  await expect.poll(() => authorityMarkdown(page)).toBe(markdown)
  await expect.poll(() => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().synchronizationStatus))
    .toBe('synchronized')
}

async function selectEnglishSource(page: Page): Promise<void> {
  await page.locator('[data-toolbar-menu="language"] .toolbar-menu__trigger').click()
  await page.locator('[data-command-id="language.en"]').click()
  await page.locator('[data-command-id="mode.source"]').click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'source')
}

async function selectAllSource(page: Page, markdown: string): Promise<void> {
  const source = page.locator('#markdown-source-editor')
  await source.fill(markdown)
  await expectMarkdown(page, markdown)
  await source.click()
  await page.keyboard.press('Control+a')
}

test('Task 21.7 Ruby/pinyin picker is anchored, validates in place, preserves selection, and returns focus', async ({ page }) => {
  await openReadyApp(page)
  await selectEnglishSource(page)
  await selectAllSource(page, 'Alpha')
  await page.locator('[data-toolbar-menu="text-style"] .toolbar-menu__trigger').click()
  const trigger = page.locator('[data-command-id="text.ruby"]')
  await trigger.click()

  const picker = page.locator('[data-picker-command="text.ruby"]')
  await expect(picker).toBeVisible()
  await expect(picker).toHaveClass(/rich-text-picker/)
  await expect(picker).toHaveCSS('position', 'fixed')
  await expect(picker.getByLabel('Base text')).toHaveValue('Alpha')
  const annotation = picker.getByLabel('Ruby annotation / pinyin')
  await expect(annotation).toBeFocused()

  await annotation.fill('bad|annotation')
  await picker.getByRole('button', { name: 'Apply' }).click()
  await expect(picker.getByRole('alert')).toContainText('cannot contain')
  await expect(picker).toBeVisible()
  await expectMarkdown(page, 'Alpha')

  await annotation.fill('han4')
  await picker.getByRole('button', { name: 'Apply' }).click()
  await expect(picker).toHaveCount(0)
  await expectMarkdown(page, '{ Alpha | han4 }')
  await expect(page.locator('#markdown-source-editor')).toBeFocused()

  await page.locator('[data-command-id="mode.preview"]').click()
  const ruby = page.locator('.preview-rendered-content .ruby-mark[data-ruby-annotation="han4"]')
  await expect(ruby).toContainText('Alpha')
  expect(await ruby.evaluate((element) => getComputedStyle(element, '::before').content)).toContain('han4')
})

test('Task 21.7 size and color pickers expose anchored keyboard/list and named-swatch routes at narrow width', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 820 })
  await openReadyApp(page)
  await selectEnglishSource(page)
  await selectAllSource(page, 'Alpha')

  await page.locator('[data-command-id="text.size"]').click()
  const sizePicker = page.locator('[data-picker-command="text.size"]')
  await expect(sizePicker).toHaveClass(/rich-text-picker/)
  const sizes = sizePicker.getByRole('listbox', { name: 'Font size' })
  await expect(sizes.getByRole('option')).toHaveCount(6)
  await sizes.selectOption('24')
  await sizePicker.getByRole('button', { name: 'Apply' }).click()
  await expectMarkdown(page, '!24 Alpha!')

  await page.locator('#markdown-source-editor').click()
  await page.keyboard.press('Control+a')
  await page.locator('[data-toolbar-menu="color"] .toolbar-menu__trigger').click()
  const colorPicker = page.locator('[data-picker-command="text.color"]')
  await colorPicker.locator('#rich-picker-value').evaluate((element) => {
    if (!(element instanceof HTMLInputElement)) throw new TypeError('Expected the current color input.')
    element.value = '#c2410c'
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await expectMarkdown(page, '!!#c2410c !24 Alpha!!!')

  await page.locator('#markdown-source-editor').click()
  await page.keyboard.press('Control+a')
  await page.locator('[data-toolbar-menu="color"] .toolbar-menu__trigger').click()
  const textPicker = page.locator('[data-picker-command="text.color"]')
  await textPicker.getByRole('tab').nth(1).click()
  const backgroundPicker = page.locator('[data-picker-command="text.background"]')
  const bounds = await backgroundPicker.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(8)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(412)
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-toolbar-menu="color"] .toolbar-menu__trigger')).toBeFocused()
})

test('Task 21.7 Panel, Columns, Tabs, Accordion, and chart-table use their frozen component hierarchies and presentation-only state', async ({ page }) => {
  const markdown = [
    panelSource({ body: 'Panel body', title: 'Information', variant: 'info' }),
    columnLayoutSource({ columns: ['Left body', 'Right body'], kind: 'two-column', title: 'Columns' }),
    disclosureSource('tabs', [
      { body: 'First body', label: 'First tab' },
      { body: 'Second body', label: 'Second tab' },
    ]),
    disclosureSource('accordion', [{ body: 'Accordion body', label: 'Details' }]),
    chartTableStarterSource('chart.line'),
  ].join('\n\n')

  await openReadyApp(page)
  await selectEnglishSource(page)
  await page.locator('#markdown-source-editor').fill(markdown)
  await expectMarkdown(page, markdown)
  await page.locator('[data-command-id="mode.visual"]').click()

  const panel = page.locator('.ProseMirror .semantic-preview--panel.semantic-preview--info')
  await expect(panel).toHaveAttribute('role', 'note')
  await expect(panel.locator('.semantic-preview__panel-icon')).toHaveAttribute('aria-hidden', 'true')
  await expect(panel.locator('.semantic-preview__panel-header')).toContainText('Information')
  await expect(panel.locator('.semantic-preview__body')).toContainText('Panel body')
  await expect(panel.locator('.semantic-preview__panel-header')).toHaveCSS('background-color', 'rgb(11, 92, 173)')

  const columns = page.locator('.ProseMirror .semantic-preview--two-column')
  await expect(columns).toHaveAttribute('aria-label', 'Two-column layout')
  await expect(columns.getByRole('region')).toHaveCount(2)
  await expect(columns.getByRole('region').nth(1)).toHaveAttribute('aria-label', 'Column 2 of 2')

  const tabs = page.locator('.ProseMirror .semantic-preview--tabs')
  const firstTab = tabs.getByRole('tab', { name: 'First tab' })
  const secondTab = tabs.getByRole('tab', { name: 'Second tab' })
  await expect(firstTab).toHaveAttribute('aria-selected', 'true')
  await secondTab.click()
  await expect(secondTab).toHaveAttribute('aria-selected', 'true')
  await expect(tabs.getByRole('tabpanel')).toContainText('Second body')
  await page.keyboard.press('ArrowLeft')
  await expect(firstTab).toBeFocused()
  await expect(firstTab).toHaveAttribute('aria-selected', 'true')

  const accordion = page.locator('.ProseMirror .semantic-preview--accordion')
  const disclosure = accordion.getByRole('button', { name: 'Details' })
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true')
  await disclosure.click()
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
  await expect(accordion.getByRole('region')).toBeHidden()
  await expectMarkdown(page, markdown)

  const chart = page.locator('.ProseMirror .semantic-preview--chart-table')
  await expect(chart.locator('.semantic-preview__chart-rendered .cherry-echarts-wrapper')).toHaveCount(1)
  await expect(chart.locator('.semantic-preview__chart-rendered svg')).toHaveCount(1)
  await expect(chart.locator('.semantic-preview__chart-data')).toHaveAttribute('aria-label', 'Line Table data')
  await expect(chart.locator('.semantic-preview__chart-data')).toHaveClass(/visually-hidden/u)
  await expect(chart.locator('th[scope="row"]')).toHaveCount(3)

  await page.setViewportSize({ width: 420, height: 820 })
  await expect.poll(async () => columns.locator('.semantic-preview__columns').evaluate((element) => (
    getComputedStyle(element).gridTemplateColumns.split(' ').length
  ))).toBe(1)
  const chartBox = await chart.boundingBox()
  expect(chartBox).not.toBeNull()
  expect(chartBox!.width).toBeLessThanOrEqual(340)
  await expectMarkdown(page, markdown)
})
