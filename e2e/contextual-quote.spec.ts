import type { Page } from '@playwright/test'

import { createToolbarCommandDescriptors } from '../src/services'
import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

async function authorityMarkdown(page: Page): Promise<string | undefined> {
  return page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().markdown)
}

async function expectMarkdown(page: Page, markdown: string): Promise<void> {
  await expect.poll(() => authorityMarkdown(page)).toBe(markdown)
  await expect.poll(() => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().synchronizationStatus)).toBe('synchronized')
}

async function setMarkdown(page: Page, markdown: string): Promise<void> {
  if (await page.getByTestId('editor-surface').getAttribute('data-mode') !== 'source') {
    await page.locator('.workspace-controls [data-command-id="mode.source"]').click()
    await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'source')
  }
  await page.locator('.cm-content[contenteditable="true"]').fill(markdown)
  await expectMarkdown(page, markdown)
}

async function switchMode(page: Page, mode: 'preview' | 'source' | 'visual'): Promise<void> {
  await page.locator(`.workspace-controls [data-command-id="mode.${mode}"]`).click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', mode)
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ height: 1000, width: 1440 })
  await openReadyApp(page)
})

test('Task 21.6 Visual six-dot Turn into Quote is contextual, editable, undoable, final, and persistent', async ({ page }) => {
  expect(createToolbarCommandDescriptors()).toHaveLength(80)
  await expect(page.locator('[data-command-id="block.quote"]')).toHaveCount(1)
  await setMarkdown(page, 'Alpha')
  await switchMode(page, 'visual')

  const paragraph = page.locator('.ProseMirror > p').filter({ hasText: 'Alpha' })
  await paragraph.hover()
  const handle = page.locator('.visual-block-handle')
  await expect(handle).toBeVisible()
  await expect(handle.locator('.visual-block-handle__dot')).toHaveCount(6)
  await handle.click()

  const blockMenu = page.locator('.visual-block-menu').filter({ has: page.locator('[data-block-action="duplicate"]') })
  await expect(blockMenu).toBeVisible()
  await blockMenu.locator('[data-block-action="turn-into"]').click()
  const turnIntoMenu = page.locator('.visual-block-menu').filter({ has: page.locator('[data-turn-into="quote"]') })
  await turnIntoMenu.locator('[data-turn-into="quote"]').click()

  const quote = page.locator('.ProseMirror > blockquote')
  await expect(quote).toContainText('Alpha')
  await expect(page.locator('.ProseMirror')).toBeFocused()
  await expectMarkdown(page, '> Alpha')

  await page.locator('[data-command-id="history.undo"]').click()
  await expectMarkdown(page, 'Alpha')
  await expect(page.locator('.ProseMirror > blockquote')).toHaveCount(0)
  await page.locator('[data-command-id="history.redo"]').click()
  await expectMarkdown(page, '> Alpha')

  await quote.locator('p').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' edited')
  await expectMarkdown(page, '> Alpha edited')
  await switchMode(page, 'preview')
  await expect(page.locator('.preview-rendered-content blockquote')).toContainText('Alpha edited')
  await expect.poll(() => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().autosaveStatus)).toBe('saved')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  await expectMarkdown(page, '> Alpha edited')
})

test('Task 21.6 Visual keyboard-equivalent menu converts a whole block alongside the toolbar command', async ({ page }) => {
  await setMarkdown(page, 'Keyboard block')
  await switchMode(page, 'visual')
  await page.locator('.ProseMirror > p').click()
  await page.keyboard.press('Alt+Shift+Enter')

  const turnInto = page.locator('[data-block-action="turn-into"]')
  await expect(turnInto).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('[data-turn-into="quote"]')).toBeFocused()
  await page.keyboard.press('Enter')

  await expect(page.locator('.ProseMirror > blockquote')).toContainText('Keyboard block')
  await expectMarkdown(page, '> Keyboard block')
})

test('Task 21.6 Visual native > input rule creates a directly editable blockquote', async ({ page }) => {
  await setMarkdown(page, '')
  await switchMode(page, 'visual')
  await page.locator('.ProseMirror > p').click()
  await page.keyboard.type('> ')
  await page.keyboard.type('Input-rule quote')

  const quote = page.locator('.ProseMirror > blockquote')
  await expect(quote).toContainText('Input-rule quote')
  expect(await quote.locator('p').evaluate((element) => (element as HTMLElement).isContentEditable)).toBe(true)
  await expectMarkdown(page, '> Input-rule quote')
})

test('Task 21.6 Source Cherry-referenced selection bubble and direct Markdown preserve Quote semantics', async ({ page }) => {
  await setMarkdown(page, 'Source selection')
  const source = page.locator('.cm-content[contenteditable="true"]')
  await source.click()
  await page.keyboard.press('Control+A')

  const quoteAction = page.locator('.source-selection-bubble button')
  await expect(quoteAction).toBeVisible()
  await page.keyboard.press('Alt+Shift+q')
  await expect(quoteAction).toBeFocused()
  await page.keyboard.press('Enter')
  await expectMarkdown(page, '> Source selection')

  await page.locator('[data-command-id="history.undo"]').click()
  await expectMarkdown(page, 'Source selection')
  await page.locator('[data-command-id="history.redo"]').click()
  await expectMarkdown(page, '> Source selection')
  await switchMode(page, 'preview')
  await expect(page.locator('.preview-rendered-content blockquote')).toContainText('Source selection')

  await switchMode(page, 'source')
  await setMarkdown(page, '> Direct Markdown quote')
  await switchMode(page, 'visual')
  await expect(page.locator('.ProseMirror > blockquote')).toContainText('Direct Markdown quote')
  await switchMode(page, 'preview')
  await expect(page.locator('.preview-rendered-content blockquote')).toContainText('Direct Markdown quote')
})
