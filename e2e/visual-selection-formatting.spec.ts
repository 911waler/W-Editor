import type { Locator, Page } from '@playwright/test'

import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

const initialMarkdown = 'Alpha Bravo'
const italicMarkdown = 'Alpha *Bravo*'

async function readAuthority(page: Page) {
  return page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read() ?? null)
}

async function expectAuthority(page: Page, markdown: string, revision: number): Promise<void> {
  await expect.poll(async () => (await readAuthority(page))?.markdown).toBe(markdown)
  await expect.poll(async () => (await readAuthority(page))?.revision).toBe(revision)
  await expect.poll(async () => (await readAuthority(page))?.synchronizationStatus).toBe('synchronized')
}

async function openVisualDocument(page: Page): Promise<Readonly<{ block: Locator; revision: number }>> {
  await openReadyApp(page)
  await page.locator('[data-toolbar-menu="language"] .toolbar-menu__trigger').click()
  await page.locator('[data-command-id="language.en"]').click()
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill(initialMarkdown)
  await expect.poll(async () => (await readAuthority(page))?.markdown).toBe(initialMarkdown)
  const revision = (await readAuthority(page))?.revision
  if (revision === undefined) throw new Error('The E2E authority inspection seam is unavailable.')

  await page.locator('[data-command-id="mode.visual"]').click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'visual')
  const block = page.locator('.ProseMirror .ordinary-block').filter({ hasText: initialMarkdown })
  await expect(block).toHaveCount(1)
  await expect(block).toHaveText(initialMarkdown)
  return Object.freeze({ block, revision })
}

async function expectItalicApplied(
  page: Page,
  block: Locator,
  revision: number,
): Promise<void> {
  await expect.poll(() => block.evaluate((element) => element.innerHTML))
    .toBe('Alpha <em>Bravo</em>')
  await expect(page.locator('.ProseMirror em')).toHaveCSS('font-style', 'italic')
  await expect(page.locator('.ProseMirror em')).toHaveCSS('font-synthesis', 'style')
  await expectAuthority(page, italicMarkdown, revision + 1)
  await expect(page.locator('.ProseMirror')).toBeFocused()
  await expect(page.locator('.status-region__command'))
    .toHaveText('Italic applied.')
}

async function expectSingleUndo(
  page: Page,
  block: Locator,
  revision: number,
): Promise<void> {
  await page.keyboard.press('Control+z')
  await expect.poll(() => block.evaluate((element) => element.innerHTML)).toBe(initialMarkdown)
  await expectAuthority(page, initialMarkdown, revision + 2)
  await expect(page.locator('.ProseMirror em')).toHaveCount(0)
  await expect(page.locator('.ProseMirror')).toBeFocused()
}

test('UA-003 pointer word selection plus toolbar Italic preserves selection, authority, focus, feedback, and one-step undo', async ({ page }) => {
  const { block, revision } = await openVisualDocument(page)
  const drag = await block.evaluate((element) => {
    const text = element.firstChild
    if (text === null || text.nodeType !== Node.TEXT_NODE) {
      throw new Error('Expected one direct text node for the pointer-selection fixture.')
    }
    const word = document.createRange()
    word.setStart(text, 6)
    word.setEnd(text, 11)
    const wordRect = word.getBoundingClientRect()
    const caretX = (offset: number): number => {
      const caret = document.createRange()
      caret.setStart(text, offset)
      caret.collapse(true)
      return caret.getBoundingClientRect().left
    }
    return {
      end: { x: caretX(11) - 0.25, y: wordRect.top + wordRect.height / 2 },
      start: { x: caretX(6) + 0.25, y: wordRect.top + wordRect.height / 2 },
    }
  })

  await page.mouse.move(drag.start.x, drag.start.y)
  await page.mouse.down()
  await page.mouse.move(drag.end.x, drag.end.y, { steps: 8 })
  await page.mouse.up()
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('Bravo')
  await page.locator('[data-command-id="text.italic"]').click()

  await expectItalicApplied(page, block, revision)
  await expectSingleUndo(page, block, revision)
})

test('UA-003 immediately formed keyboard selection plus Ctrl+I uses the current visual selection', async ({ page }) => {
  const { block, revision } = await openVisualDocument(page)
  const editor = page.locator('.ProseMirror')
  await editor.evaluate((element) => {
    element.setAttribute('data-shortcut-target-observed', 'false')
    const observeShortcut = (event: Event): void => {
      const keyEvent = event as KeyboardEvent
      if (!(keyEvent.ctrlKey || keyEvent.metaKey) || keyEvent.key.toLocaleLowerCase() !== 'i') return
      element.setAttribute('data-shortcut-target-observed', 'true')
      element.removeEventListener('keydown', observeShortcut)
    }
    element.addEventListener('keydown', observeShortcut)
  })
  await block.click({ position: { x: 4, y: 8 } })
  await page.keyboard.press('Control+Home')
  for (let index = 0; index < 6; index += 1) await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Shift+End')
  await page.keyboard.press('Control+i')

  await expect(editor).toHaveAttribute('data-shortcut-target-observed', 'true')
  await expectItalicApplied(page, block, revision)
  await expectSingleUndo(page, block, revision)
})

test('UA-003 an unapplied visual formatting command reports no change instead of false success', async ({ page }) => {
  const { revision } = await openVisualDocument(page)
  await page.locator('.ProseMirror').click()
  await page.keyboard.press('Control+Home')
  await page.keyboard.press('Control+i')

  await expectAuthority(page, initialMarkdown, revision)
  await expect(page.locator('.ProseMirror em')).toHaveCount(0)
  await expect(page.locator('.ProseMirror')).toBeFocused()
  await expect(page.locator('.status-region__command'))
    .toHaveText('Italic made no change.')
})

test('a real Source selection applies visibly synthesized Italic to Chinese text in Final', async ({ page }) => {
  const chineseMarkdown = '普通 中文斜体'
  const chineseItalicMarkdown = '普通 *中文斜体*'
  await openReadyApp(page)
  await page.locator('[data-toolbar-menu="language"] .toolbar-menu__trigger').click()
  await page.locator('[data-command-id="language.en"]').click()
  await page.locator('[data-command-id="mode.source"]').click()
  const source = page.locator('#markdown-source-editor')
  await source.fill(chineseMarkdown)
  await expect.poll(async () => (await readAuthority(page))?.markdown).toBe(chineseMarkdown)
  const revision = (await readAuthority(page))?.revision
  if (revision === undefined) throw new Error('The E2E authority inspection seam is unavailable.')

  await source.press('Control+Home')
  for (let index = 0; index < 3; index += 1) await source.press('ArrowRight')
  await source.press('Shift+End')
  await page.locator('[data-command-id="text.italic"]').click()

  await expectAuthority(page, chineseItalicMarkdown, revision + 1)
  await expect(page.locator('.status-region__command'))
    .toHaveText('Italic applied.')
  await page.locator('[data-command-id="mode.preview"]').click()
  const renderedItalic = page.locator('.preview-rendered-content em')
  await expect(renderedItalic).toHaveText('中文斜体')
  await expect(renderedItalic).toHaveCSS('font-style', 'italic')
  await expect(renderedItalic).toHaveCSS('font-synthesis', 'style')
})

test('the formatting toolbar follows the live caret across imported bold, strike, underline, italic, and plain text', async ({ page }) => {
  const markdown = '**Bold** ~~Strike~~ ++Underline++ *Italic* Plain'
  await openReadyApp(page)
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill(markdown)
  await expect.poll(async () => (await readAuthority(page))?.markdown).toBe(markdown)
  await page.locator('[data-command-id="mode.visual"]').click()

  const cases = [
    { commandId: 'text.bold', selector: 'strong' },
    { commandId: 'text.strike', selector: 's' },
    { commandId: 'text.underline', selector: 'u' },
    { commandId: 'text.italic', selector: 'em' },
  ] as const
  for (const current of cases) {
    await page.locator(`.ProseMirror ${current.selector}`).click({ position: { x: 8, y: 8 } })
    await expect(page.locator(`[data-command-id="${current.commandId}"]`))
      .toHaveAttribute(current.commandId === 'text.bold' || current.commandId === 'text.italic' ? 'aria-pressed' : 'aria-checked', 'true')
  }

  await page.locator('.ProseMirror p').click({ position: { x: 300, y: 8 } })
  for (const current of cases) {
    await expect(page.locator(`[data-command-id="${current.commandId}"]`))
      .toHaveAttribute(current.commandId === 'text.bold' || current.commandId === 'text.italic' ? 'aria-pressed' : 'aria-checked', 'false')
  }
})
