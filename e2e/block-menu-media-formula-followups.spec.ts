import { resolve } from 'node:path'

import type { Locator, Page } from '@playwright/test'

import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

async function setSourceMarkdown(page: Page, markdown: string): Promise<void> {
  const surface = page.getByTestId('editor-surface')
  if (await surface.getAttribute('data-mode') !== 'source') {
    await page.locator('.workspace-controls [data-command-id="mode.source"]').click()
  }
  await expect(surface).toHaveAttribute('data-mode', 'source')
  await page.locator('.cm-content[contenteditable="true"]').fill(markdown)
}

async function openVisualMarkdown(page: Page, markdown: string): Promise<Locator> {
  await openReadyApp(page)
  await setSourceMarkdown(page, markdown)
  await page.locator('.workspace-controls [data-command-id="mode.visual"]').click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'visual')
  return page.locator('.ProseMirror')
}

async function openBlockMenu(page: Page, block: Locator): Promise<Locator> {
  await block.hover()
  await page.locator('.visual-block-handle').click()
  const menu = page.locator('.visual-block-menu').filter({ has: page.locator('[data-block-action="duplicate"]') })
  await expect(menu).toBeVisible()
  return menu
}

test('block Color submenu exposes recent, text, and background palettes and applies both kinds', async ({ page }) => {
  const editor = await openVisualMarkdown(page, 'Alpha')
  const paragraph = editor.locator(':scope > p', { hasText: 'Alpha' })
  let menu = await openBlockMenu(page, paragraph)
  await menu.locator('[data-block-action="color"]').click()

  const colorMenu = page.locator('.visual-block-color-menu')
  await expect(colorMenu).toBeVisible()
  await expect(colorMenu.locator('[data-block-color-section="recent"] [data-block-color-option]')).toHaveCount(2)
  await expect(colorMenu.locator('[data-block-color-section="text"] [data-block-color-option]')).toHaveCount(10)
  await expect(colorMenu.locator('[data-block-color-section="background"] [data-block-color-option]')).toHaveCount(10)
  await expect(colorMenu).toContainText('默认文字')
  await expect(colorMenu).toContainText('红色文字')
  await expect(colorMenu).toContainText('默认背景')
  await expect(colorMenu).toContainText('红色背景')

  await colorMenu.locator('[data-block-color-option="text-blue"]').click()
  await expect(paragraph.locator('span[style*="color"]')).toHaveCSS('color', 'rgb(51, 126, 169)')

  menu = await openBlockMenu(page, paragraph)
  await menu.locator('[data-block-action="color"]').click()
  await page.locator('.visual-block-color-menu [data-block-color-option="background-yellow"]').click()
  await expect(paragraph.locator('mark')).toHaveCSS('background-color', 'rgb(251, 243, 219)')
})

test('local image upload creates one persistent loadable image instead of a fixture fallback URL', async ({ page }) => {
  await openReadyApp(page)
  await setSourceMarkdown(page, '')
  await page.locator('[data-toolbar-menu="insert"] .toolbar-menu__trigger').click()
  await page.locator('[data-command-id="insert.image"]').click()

  const dialog = page.locator('.dialog-panel')
  await dialog.locator('input[type="file"][accept="image/*"]').setInputFiles(
    resolve('e2e/fixtures/files/sample-image.png'),
  )
  await dialog.locator('.dialog-panel__actions .primary-action').click()
  await page.locator('.workspace-controls [data-command-id="mode.visual"]').click()

  const images = page.locator('.ProseMirror img')
  await expect(images).toHaveCount(1)
  await expect(page.locator('[data-media-fallback="image"]')).toBeHidden()
  await expect.poll(() => images.first().evaluate((image) => ({
    complete: (image as HTMLImageElement).complete,
    naturalWidth: (image as HTMLImageElement).naturalWidth,
  }))).toEqual({ complete: true, naturalWidth: 1 })
  await expect(images.first()).toHaveAttribute('src', /^data:image\/png;base64,/u)

  await page.reload()
  await page.locator('html[data-w-editor-ready="true"]').waitFor()
  await page.locator('.workspace-controls [data-command-id="mode.visual"]').click()
  await expect(page.locator('.ProseMirror img')).toHaveCount(1)
  await expect(page.locator('[data-media-fallback="image"]')).toBeHidden()
  await page.locator('.workspace-controls [data-command-id="mode.preview"]').click()
  await expect(page.locator('.preview-rendered-content img')).toHaveAttribute('src', /^data:image\/png;base64,/u)
})

test('formula picker provides a live safe KaTeX preview that follows source edits', async ({ page }) => {
  await openReadyApp(page)
  await page.locator('[data-command-alias="insert.formula"]').click()
  const picker = page.locator('[data-picker-command="insert.formula"]')
  const preview = picker.locator('[data-formula-live-preview]')
  await expect(preview.locator('.katex')).toHaveCount(1)

  await picker.locator('#formula-source').fill(String.raw`\frac{x+1}{y}`)
  await expect(preview.locator('.katex .mfrac')).toHaveCount(1)
  await expect(preview).toContainText('x')
  await expect(preview).toContainText('y')

  await picker.locator('#formula-source').fill(String.raw`\sqrt{a^2+b^2}`)
  await expect(preview.locator('.katex .sqrt')).toHaveCount(1)
})

test('plus button opens an above-or-below menu and inserts the chosen paragraph', async ({ page }) => {
  const editor = await openVisualMarkdown(page, 'Alpha')
  const paragraph = editor.locator(':scope > p', { hasText: 'Alpha' })
  await paragraph.hover()
  const add = page.locator('.visual-block-add')
  await add.click()

  let menu = page.locator('.visual-block-menu--insert')
  await expect(menu).toBeVisible()
  await menu.locator('[data-block-insert="above"]').click()
  await page.keyboard.type('Before')
  await expect(editor.locator(':scope > p')).toHaveCount(2)
  await expect(editor.locator(':scope > p').nth(0)).toHaveText('Before')
  await expect(editor.locator(':scope > p').nth(1)).toHaveText('Alpha')

  await paragraph.hover()
  await add.click()
  menu = page.locator('.visual-block-menu--insert')
  await menu.locator('[data-block-insert="below"]').click()
  await page.keyboard.type('After')
  await expect(editor.locator(':scope > p')).toHaveCount(3)
  await expect(editor.locator(':scope > p').nth(0)).toHaveText('Before')
  await expect(editor.locator(':scope > p').nth(1)).toHaveText('Alpha')
  await expect(editor.locator(':scope > p').nth(2)).toHaveText('After')

  await page.locator('.workspace-controls [data-command-id="mode.source"]').click()
  await expect.poll(() => page.locator('.cm-line').allTextContents()).toEqual(['Before', '', 'Alpha', '', 'After'])
})
