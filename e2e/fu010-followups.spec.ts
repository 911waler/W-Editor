import type { Page } from '@playwright/test'

import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

async function authority(page: Page) {
  return page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read() ?? null)
}

async function openVisualDocument(page: Page, markdown: string): Promise<void> {
  await openReadyApp(page)
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('.cm-content[contenteditable="true"]').fill(markdown)
  await expect.poll(() => authority(page)).toMatchObject({ markdown })
  await page.locator('[data-command-id="mode.visual"]').click()
  await expect(page.locator('.ProseMirror')).toBeVisible()
}

test('FU-010 keeps the six-dot block controls clear of text and removes the redundant Final Preview heading', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openVisualDocument(page, 'A paragraph whose first glyph must remain clear of the block controls.')

  const paragraph = page.locator('.ProseMirror > p').first()
  await paragraph.hover()
  const geometry = await Promise.all([
    page.locator('.visual-surface').boundingBox(),
    paragraph.boundingBox(),
    page.locator('.visual-block-add').boundingBox(),
    page.locator('.visual-block-handle').boundingBox(),
  ])
  const [paperBox, paragraphBox, addBox, handleBox] = geometry
  expect(paperBox).not.toBeNull()
  expect(paragraphBox).not.toBeNull()
  expect(addBox).not.toBeNull()
  expect(handleBox).not.toBeNull()
  expect(addBox!.x).toBeGreaterThanOrEqual(paperBox!.x)
  expect(handleBox!.x).toBeGreaterThanOrEqual(paperBox!.x)
  expect(handleBox!.x + handleBox!.width).toBeLessThanOrEqual(paperBox!.x + paperBox!.width)
  expect(addBox!.x + addBox!.width).toBeLessThanOrEqual(paragraphBox!.x - 4)
  expect(handleBox!.x + handleBox!.width).toBeLessThanOrEqual(paragraphBox!.x - 4)
  expect(handleBox!.y).toBeGreaterThanOrEqual(addBox!.y + addBox!.height + 2)

  await page.setViewportSize({ width: 390, height: 760 })
  await paragraph.hover()
  const [narrowPaperBox, narrowParagraphBox, narrowAddBox] = await Promise.all([
    page.locator('.visual-surface').boundingBox(),
    paragraph.boundingBox(),
    page.locator('.visual-block-add').boundingBox(),
  ])
  const narrowHandleBox = await page.locator('.visual-block-handle').boundingBox()
  expect(narrowPaperBox).not.toBeNull()
  expect(narrowParagraphBox).not.toBeNull()
  expect(narrowAddBox).not.toBeNull()
  expect(narrowHandleBox).not.toBeNull()
  expect(narrowAddBox!.x).toBeGreaterThanOrEqual(narrowPaperBox!.x)
  expect(narrowHandleBox!.x).toBeGreaterThan(narrowAddBox!.x)
  expect(narrowHandleBox!.x + narrowHandleBox!.width).toBeLessThanOrEqual(narrowPaperBox!.x + narrowPaperBox!.width)
  expect(narrowAddBox!.y + narrowAddBox!.height).toBeLessThanOrEqual(narrowParagraphBox!.y)
  expect(narrowHandleBox!.y + narrowHandleBox!.height).toBeLessThanOrEqual(narrowParagraphBox!.y)

  await page.locator('[data-command-id="mode.preview"]').click()
  await expect(page.locator('.preview-surface')).toBeVisible()
  await expect(page.locator('.preview-label')).toHaveCount(0)
  await expect(page.locator('.preview-surface')).not.toContainText('最终 Cherry 预览')
})

test('FU-010 line spacing sits left of Word count, changes all text surfaces, persists, and does not mutate Markdown', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const markdown = 'First line spacing sample.\n\nSecond paragraph.'
  await openVisualDocument(page, markdown)
  const before = await authority(page)

  const lineSpacing = page.locator('[data-toolbar-slot="line-spacing"]')
  const wordCount = page.locator('[data-command-id="document.word-count"]')
  await expect(lineSpacing).toBeVisible()
  expect(await lineSpacing.evaluate((node, word) => Boolean(node.compareDocumentPosition(word) & Node.DOCUMENT_POSITION_FOLLOWING), await wordCount.elementHandle())).toBe(true)
  await lineSpacing.getByRole('button').click()
  const menu = page.getByTestId('line-spacing-menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitemradio')).toHaveCount(4)
  await menu.getByRole('menuitemradio').first().focus()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await expect(lineSpacing.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
  await expect(lineSpacing.getByRole('button')).toHaveAttribute('aria-label', /行间距|Line spacing/u)
  await expect.poll(() => authority(page)).toMatchObject(before ?? {})
  await expect.poll(() => page.locator('.ProseMirror > p').first().evaluate((element) => {
    const style = getComputedStyle(element)
    return Number.parseFloat(style.lineHeight) / Number.parseFloat(style.fontSize)
  })).toBe(2)

  await page.locator('[data-command-id="mode.preview"]').click()
  await expect.poll(() => page.locator('.preview-rendered-content p').first().evaluate((element) => {
    const style = getComputedStyle(element)
    return Number.parseFloat(style.lineHeight) / Number.parseFloat(style.fontSize)
  })).toBe(2)

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  await expect(page.locator('[data-toolbar-slot="line-spacing"] [data-line-spacing-trigger]')).toHaveAttribute('data-line-spacing-value', '2')
})
