import type { Page } from '@playwright/test'

import { openReadyApp, useEnglishUi } from './fixtures/app'
import { expect, test } from './fixtures/test'

async function authority(page: Page) {
  const snapshot = await page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read())
  if (snapshot === undefined) throw new Error('The E2E authority inspection seam is unavailable.')
  return snapshot
}

async function seedVisual(page: Page, markdown: string): Promise<void> {
  await openReadyApp(page)
  await useEnglishUi(page)
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill(markdown)
  await expect.poll(() => authority(page)).toMatchObject({ markdown, synchronizationStatus: 'synchronized' })
  await page.locator('[data-command-id="mode.visual"]').click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'visual')
}

async function insertTable(page: Page, columns = 2, rows = 1): Promise<void> {
  await page.locator('[data-toolbar-menu="insert"] .toolbar-menu__trigger').click()
  await page.locator('[data-command-id="insert.table"]').click()
  await page.getByRole('gridcell', {
    name: `${columns} ${columns === 1 ? 'column' : 'columns'} by ${rows} ${rows === 1 ? 'data row' : 'data rows'}`,
  }).click()
}

test('an empty Visual caret accepts a Cherry preset as the typing color for subsequent text', async ({ page }) => {
  await seedVisual(page, 'Alpha')
  const paragraph = page.locator('.ProseMirror > p', { hasText: 'Alpha' })
  await paragraph.click()
  await page.keyboard.press('End')

  await page.locator('[data-toolbar-menu="color"] .toolbar-menu__trigger').click()
  const picker = page.locator('[data-picker-command="text.color"]')
  await expect(page.locator('[data-toolbar-menu="color"] [role="menu"]')).toBeHidden()
  await expect(picker).toBeVisible()
  await expect(picker.locator('.rich-color-picker__preset')).toHaveCount(50)
  await picker.getByRole('option', { name: '#0066cc' }).click()
  await page.keyboard.type('Next')

  await expect.poll(() => authority(page)).toMatchObject({
    markdown: 'Alpha!!#0066cc Next!!',
    synchronizationStatus: 'synchronized',
  })
  await expect(page.locator('.ProseMirror span[style*="color"]', { hasText: 'Next' })).toHaveCSS('color', 'rgb(0, 102, 204)')
})

test('Enter immediately after a semantic panel persists the following paragraph', async ({ page }) => {
  const panel = '::: info Information\nPanel body\n:::'
  await seedVisual(page, panel)
  await page.locator('[data-w-editor-node="semantic-block"]').click()
  await page.keyboard.press('Enter')
  await page.keyboard.type('After')

  await expect.poll(() => authority(page)).toMatchObject({
    markdown: `${panel}\n\nAfter`,
    synchronizationStatus: 'synchronized',
  })
  await expect(page.locator('.ProseMirror > p', { hasText: 'After' })).toBeVisible()
})

test('a table replaces an empty Visual line and content-line insertion preserves the viewport', async ({ page }) => {
  await seedVisual(page, 'Alpha')
  const paragraph = page.locator('.ProseMirror > p', { hasText: 'Alpha' })
  await paragraph.click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await insertTable(page)
  await expect.poll(() => authority(page)).toMatchObject({
    markdown: 'Alpha\n\n| Header | Header |\n| ------ | ------ |\n| Sample | Sample |',
    synchronizationStatus: 'synchronized',
  })
  await expect(page.locator('.ProseMirror > p')).toHaveCount(1)
  await expect(page.locator('.ProseMirror table')).toHaveCount(1)

  const longMarkdown = Array.from({ length: 70 }, (_, index) => `Line ${index + 1}`).join('\n\n')
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill(longMarkdown)
  await expect.poll(() => authority(page)).toMatchObject({ markdown: longMarkdown, synchronizationStatus: 'synchronized' })
  await page.locator('[data-command-id="mode.visual"]').click()
  const target = page.locator('.ProseMirror > p', { hasText: /^Line 50$/ })
  await target.scrollIntoViewIfNeeded()
  await target.click()
  const before = await page.locator('.editor-surface').evaluate((surface) => surface.scrollTop)
  await insertTable(page)
  await expect.poll(() => authority(page).then((state) => state.synchronizationStatus)).toBe('synchronized')
  await expect(page.locator('.ProseMirror table')).toHaveCount(1)
  await expect.poll(() => page.locator('.editor-surface').evaluate((surface) => surface.scrollTop))
    .toBeCloseTo(before, 0)
})

test('an empty line between a success panel and code stays deleted through history and synchronization', async ({ page }) => {
  const panel = '::: success Success\nDescribe the successful outcome.\n:::'
  const code = "```javascript\nconsole.log('Hello from W-Editor')\n```"
  const table = '| Plain | Explicit |\n| --- | :------ |\n| A | B |'
  const original = [panel, '', code, table].join('\n\n')
  const edited = [panel, code, table].join('\n\n')
  await seedVisual(page, original)

  const editor = page.locator('.ProseMirror')
  const emptyParagraph = () => editor.locator(':scope > p').filter({ hasText: /^$/ }).first()
  const scrollSurface = page.locator('.editor-surface')
  for (const key of ['Delete', 'Backspace']) {
    await expect(emptyParagraph()).toBeVisible()
    await emptyParagraph().evaluate((paragraph) => {
      const visual = paragraph.closest<HTMLElement>('.ProseMirror')
      const selection = window.getSelection()
      if (visual === null || selection === null) throw new Error('Expected the empty Visual paragraph.')
      visual.focus()
      const range = document.createRange()
      range.selectNodeContents(paragraph)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })
    const beforeScrollTop = await scrollSurface.evaluate((surface) => surface.scrollTop)

    await page.keyboard.press(key)
    await expect.poll(() => authority(page)).toMatchObject({
      markdown: edited,
      synchronizationStatus: 'synchronized',
    })
    await page.waitForTimeout(500)
    await expect.poll(() => authority(page)).toMatchObject({ markdown: edited })
    await expect(emptyParagraph()).toHaveCount(0)
    await expect(editor.locator('[data-w-editor-node="semantic-block"]')).toHaveCount(1)
    await expect(editor.locator('[data-w-editor-node="code-block"]')).toHaveCount(1)
    await expect(editor.locator('[data-w-editor-node="ordinary-table"]')).toHaveCount(1)
    await expect.poll(async () => Math.abs(
      await scrollSurface.evaluate((surface) => surface.scrollTop) - beforeScrollTop,
    )).toBeLessThan(100)

    await page.keyboard.press('Control+z')
    await expect.poll(() => authority(page)).toMatchObject({ markdown: original })
    await expect(emptyParagraph()).toHaveCount(1)

    await page.keyboard.press('Control+Shift+z')
    await expect.poll(() => authority(page)).toMatchObject({ markdown: edited })
    await expect(emptyParagraph()).toHaveCount(0)

    await page.keyboard.press('Control+z')
    await expect.poll(() => authority(page)).toMatchObject({ markdown: original })
  }
})

test('selecting exactly two of three empty lines deletes and restores exactly that range', async ({ page }) => {
  const panel = '::: success Success\nDescribe the successful outcome.\n:::'
  const javascript = "```javascript\nconsole.log('Hello from W-Editor')\n```"
  const python = "```python\nprint('Second code block')\n```"
  const table = '| Plain | Explicit |\n| --- | :------ |\n| A | B |'
  const original = [panel, '', '', '', javascript, python, table].join('\n\n')
  const edited = [panel, '', javascript, python, table].join('\n\n')
  await seedVisual(page, original)

  const visual = page.locator('.ProseMirror')
  const empties = visual.locator(':scope > p').filter({ hasText: /^$/ })
  await expect(empties).toHaveCount(3)
  const first = await empties.nth(0).boundingBox()
  const third = await empties.nth(2).boundingBox()
  if (first === null || third === null) throw new Error('Expected clickable empty paragraph boxes.')
  const x = first.x + Math.min(160, first.width / 2)
  const beforeScrollTop = await page.locator('.editor-surface').evaluate((surface) => surface.scrollTop)
  await page.mouse.move(x, first.y + first.height / 2)
  await page.mouse.down()
  await page.mouse.move(x, third.y + third.height / 2, { steps: 12 })
  await page.mouse.up()

  await expect.poll(() => page.evaluate(() => {
    const editor = document.querySelector('.ProseMirror')
    const paragraphs = editor === null ? [] : Array.from(editor.querySelectorAll(':scope > p'))
    const selection = window.getSelection()
    const anchor = selection?.anchorNode instanceof Element ? selection.anchorNode : selection?.anchorNode?.parentElement
    const focus = selection?.focusNode instanceof Element ? selection.focusNode : selection?.focusNode?.parentElement
    return {
      anchorIndex: paragraphs.findIndex((paragraph) => paragraph === anchor?.closest('p')),
      collapsed: selection?.isCollapsed ?? null,
      focusIndex: paragraphs.findIndex((paragraph) => paragraph === focus?.closest('p')),
    }
  })).toEqual({ anchorIndex: 0, collapsed: false, focusIndex: 2 })

  await page.keyboard.press('Delete')
  await expect.poll(() => authority(page)).toMatchObject({
    markdown: edited,
    synchronizationStatus: 'synchronized',
  })
  await page.waitForTimeout(500)
  await expect.poll(() => authority(page)).toMatchObject({ markdown: edited })
  await expect(empties).toHaveCount(1)
  await expect(visual.locator('[data-w-editor-node="semantic-block"]')).toHaveCount(1)
  await expect(visual.locator('[data-w-editor-node="code-block"]')).toHaveCount(2)
  await expect(visual.locator('[data-w-editor-node="ordinary-table"]')).toHaveCount(1)
  await expect.poll(async () => Math.abs(
    await page.locator('.editor-surface').evaluate((surface) => surface.scrollTop) - beforeScrollTop,
  )).toBeLessThan(100)

  await page.keyboard.press('Control+z')
  await expect.poll(() => authority(page)).toMatchObject({ markdown: original })
  await expect(empties).toHaveCount(3)

  await page.keyboard.press('Control+Shift+z')
  await expect.poll(() => authority(page)).toMatchObject({ markdown: edited })
  await expect(empties).toHaveCount(1)
})
