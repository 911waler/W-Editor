import type { Page } from '@playwright/test'

import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

const markdown = 'Keep\n\nAlpha\n\nBravo\n\nTail'
const joinedMarkdown = 'Keep\n\nAlphaBravo\n\nTail'

async function openOrdinaryVisualDocument(page: Page): Promise<void> {
  await openReadyApp(page)
  await page.locator('[data-toolbar-menu="language"] .toolbar-menu__trigger').click()
  await page.locator('[data-command-id="language.en"]').click()
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill(markdown)
  await page.locator('[data-command-id="mode.visual"]').click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'visual')
  await expect(page.locator('.ProseMirror .ordinary-block')).toHaveCount(4)
}

async function setCaret(page: Page, blockIndex: number, offset: number): Promise<void> {
  await page.locator('.ProseMirror').evaluate((editor, caret) => {
    const block = editor.querySelectorAll<HTMLElement>('.ordinary-block')[caret.blockIndex]
    if (block === undefined) throw new Error('Expected an ordinary block at the requested caret position.')
    const text = block.firstChild
    if (text === null || text.nodeType !== Node.TEXT_NODE) {
      throw new Error('Expected an ordinary text block at the requested caret position.')
    }
    const range = document.createRange()
    range.setStart(text, caret.offset)
    range.collapse(true)
    const selection = window.getSelection()
    if (selection === null) throw new Error('Browser selection is unavailable.')
    selection.removeAllRanges()
    selection.addRange(range)
    editor.dispatchEvent(new Event('focus'))
    ;(editor as HTMLElement).focus()
  }, { blockIndex, offset })
}

async function caret(page: Page): Promise<{ readonly blockText: string; readonly offset: number }> {
  return page.locator('.ProseMirror').evaluate((editor) => {
    const selection = window.getSelection()
    const anchor = selection?.anchorNode
    const block = anchor?.parentElement?.closest<HTMLElement>('.ordinary-block')
    if (selection === null || anchor === null || block == null || !editor.contains(block)) {
      throw new Error('Expected a caret in an ordinary block.')
    }
    return { blockText: block.textContent ?? '', offset: selection.anchorOffset }
  })
}

async function selectAcrossBlocks(page: Page): Promise<string> {
  return page.locator('.ProseMirror').evaluate((editor) => {
    const blocks = editor.querySelectorAll<HTMLElement>('.ordinary-block')
    const start = blocks[1]?.firstChild
    const end = blocks[2]?.firstChild
    if (start === undefined || start === null || end === undefined || end === null) {
      throw new Error('Expected adjacent ordinary blocks for selection.')
    }
    const range = document.createRange()
    range.setStart(start, 2)
    range.setEnd(end, 3)
    const selection = window.getSelection()
    if (selection === null) throw new Error('Browser selection is unavailable.')
    selection.removeAllRanges()
    selection.addRange(range)
    return selection.toString()
  })
}

async function waitForSynchronization(page: Page): Promise<void> {
  await page.waitForTimeout(300)
  await expect(page.locator('.status-region')).toContainText('synchronized')
}

async function expectExactSource(page: Page, expected: string): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().markdown)).toBe(expected)
  await expect.poll(() => page.locator('#markdown-source-editor').locator('.cm-line').evaluateAll(
    (lines) => lines.map((line) => line.textContent ?? '').join('\n'),
  )).toBe(expected)
}

test('real visual surface supports arrows, cross-block selection, Backspace join, exact source, and one undo', async ({ page }) => {
  await openOrdinaryVisualDocument(page)

  await setCaret(page, 1, 5)
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => caret(page)).toEqual({ blockText: 'Bravo', offset: 0 })
  await page.keyboard.press('ArrowLeft')
  await expect.poll(() => caret(page)).toEqual({ blockText: 'Alpha', offset: 5 })
  expect(await selectAcrossBlocks(page)).toBe('pha\n\nBra')

  await setCaret(page, 2, 0)
  await page.keyboard.press('Backspace')
  await expect(page.locator('.ProseMirror .ordinary-block')).toHaveCount(3)
  await expect(page.locator('.ProseMirror .ordinary-block').nth(1)).toHaveText('AlphaBravo')
  await expect.poll(() => caret(page)).toEqual({ blockText: 'AlphaBravo', offset: 5 })
  await waitForSynchronization(page)

  await page.keyboard.press('Control+z')
  await expect(page.locator('.ProseMirror .ordinary-block')).toHaveCount(4)
  await expect(page.locator('.ProseMirror .ordinary-block').nth(1)).toHaveText('Alpha')
  await expect(page.locator('.ProseMirror .ordinary-block').nth(2)).toHaveText('Bravo')
  await waitForSynchronization(page)

  await setCaret(page, 2, 0)
  await page.keyboard.press('Backspace')
  await waitForSynchronization(page)
  await page.locator('[data-command-id="mode.source"]').click()
  await expectExactSource(page, joinedMarkdown)
})

test('real visual surface performs the symmetric Delete join without changing surrounding source', async ({ page }) => {
  await openOrdinaryVisualDocument(page)

  await setCaret(page, 1, 5)
  await page.keyboard.press('Delete')
  await expect(page.locator('.ProseMirror .ordinary-block')).toHaveCount(3)
  await expect(page.locator('.ProseMirror .ordinary-block').nth(1)).toHaveText('AlphaBravo')
  await expect.poll(() => caret(page)).toEqual({ blockText: 'AlphaBravo', offset: 5 })
  await waitForSynchronization(page)

  await page.keyboard.press('Control+z')
  await expect(page.locator('.ProseMirror .ordinary-block')).toHaveCount(4)
  await waitForSynchronization(page)

  await setCaret(page, 1, 5)
  await page.keyboard.press('Delete')
  await waitForSynchronization(page)
  await page.locator('[data-command-id="mode.source"]').click()
  await expectExactSource(page, joinedMarkdown)
})
