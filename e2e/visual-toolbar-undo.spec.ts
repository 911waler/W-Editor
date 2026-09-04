import type { Page } from '@playwright/test'

import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

const original = 'Keep\n\nAlpha\n\nBravo\n\nTail'
const joined = 'Keep\n\nAlphaBravo\n\nTail'

async function readAuthority(page: Page) {
  return page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read())
}

test('toolbar Undo restores every block after a synchronized visual Backspace join', async ({
  page,
}) => {
  await openReadyApp(page)
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill(original)
  await expect.poll(async () => (await readAuthority(page))?.markdown).toBe(original)

  await page.locator('[data-command-id="mode.visual"]').click()
  const editor = page.locator('.ProseMirror')
  await expect(editor.locator('.ordinary-block')).toHaveCount(4)
  await editor.evaluate((root) => {
    const text = root.querySelectorAll('.ordinary-block')[2]?.firstChild
    if (!(text instanceof Text)) throw new Error('Expected the third ordinary text block.')

    const range = document.createRange()
    range.setStart(text, 0)
    range.collapse(true)
    const selection = getSelection()
    if (selection === null) throw new Error('Selection unavailable.')

    selection.removeAllRanges()
    selection.addRange(range)
    ;(root as HTMLElement).focus()
  })
  await page.keyboard.press('Backspace')
  await expect(editor.locator('.ordinary-block')).toHaveCount(3)
  await expect.poll(async () => (await readAuthority(page))?.markdown).toBe(joined)

  await page.locator('[data-command-id="history.undo"]').click()

  await expect(editor.locator('.ordinary-block')).toHaveCount(4)
  await expect.poll(async () => (await readAuthority(page))?.markdown).toBe(original)
})
