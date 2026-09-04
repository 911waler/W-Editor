import type { Page } from '@playwright/test'

import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

async function authority(page: Page) {
  const snapshot = await page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read())
  if (snapshot === undefined) throw new Error('The E2E authority inspection seam is unavailable.')
  return snapshot
}

async function seedVisual(page: Page, markdown: string): Promise<void> {
  await openReadyApp(page)
  await page.locator('[data-toolbar-menu="language"] .toolbar-menu__trigger').click()
  await page.locator('[data-command-id="language.en"]').click()
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill(markdown)
  await expect.poll(() => authority(page)).toMatchObject({ markdown, synchronizationStatus: 'synchronized' })
  await page.locator('[data-command-id="mode.visual"]').click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'visual')
}

async function selectCharacter(page: Page, paragraphIndex: number, characterIndex: number): Promise<void> {
  const paragraph = page.locator('.ProseMirror > p').nth(paragraphIndex)
  await paragraph.click()
  await page.keyboard.press('Home')
  for (let index = 0; index < characterIndex; index += 1) await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Shift+ArrowRight')
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('啊')
}

async function selectVisualTextRange(
  page: Page,
  paragraphIndex: number,
  from: number,
  to: number,
  expected: string,
): Promise<void> {
  const paragraph = page.locator('.ProseMirror > p').nth(paragraphIndex)
  await paragraph.evaluate((element, rangeOffsets) => {
    const editor = element.closest<HTMLElement>('.ProseMirror')
    const selection = window.getSelection()
    if (editor === null || selection === null) throw new Error('Expected a focused visual editor selection.')
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let cursor = 0
    let start: Readonly<{ node: Node; offset: number }> | null = null
    let end: Readonly<{ node: Node; offset: number }> | null = null
    while (walker.nextNode()) {
      const node = walker.currentNode
      const length = node.textContent?.length ?? 0
      if (start === null && rangeOffsets.from >= cursor && rangeOffsets.from <= cursor + length) {
        start = { node, offset: rangeOffsets.from - cursor }
      }
      if (rangeOffsets.to >= cursor && rangeOffsets.to <= cursor + length) {
        end = { node, offset: rangeOffsets.to - cursor }
        break
      }
      cursor += length
    }
    if (start === null || end === null) throw new Error('Requested visual text range is outside the paragraph.')
    editor.focus()
    const range = document.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  }, { from, to })
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(expected)
}

async function applyFontSize(page: Page, value: string): Promise<void> {
  await page.locator('[data-command-id="text.size"]').click()
  const picker = page.locator('[data-picker-command="text.size"]')
  await picker.getByRole('listbox', { name: 'Font size' }).selectOption(value)
  await picker.locator('.primary-action').click()
}

async function applyTextColor(page: Page, value: string): Promise<void> {
  await page.locator('[data-toolbar-menu="color"] .toolbar-menu__trigger').click()
  const picker = page.locator('[data-picker-command="text.color"]')
  await picker.getByRole('option', { name: value }).click()
}

async function applyBackgroundColor(page: Page, value: string): Promise<void> {
  await page.locator('[data-toolbar-menu="color"] .toolbar-menu__trigger').click()
  const picker = page.locator('.rich-text-picker')
  await picker.getByRole('tab', { name: 'Background' }).click()
  await expect(picker).toHaveAttribute('data-picker-command', 'text.background')
  await picker.getByRole('option', { name: value }).click()
}

async function ensureVisualMode(page: Page): Promise<void> {
  if (await page.getByTestId('editor-surface').getAttribute('data-mode') !== 'visual') {
    await page.locator('[data-command-id="mode.visual"]').click()
  }
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'visual')
}

test('adjacent font-size and color runs remain rendered after authority reload', async ({ page }) => {
  const expected = '!32 啊!!24 啊!啊啊\n\n!!#0066cc 啊!!!!#e6730d 啊!!啊啊'
  await seedVisual(page, '啊啊啊啊\n\n啊啊啊啊')

  await selectCharacter(page, 0, 0)
  await applyFontSize(page, '32')
  await selectCharacter(page, 0, 1)
  await applyFontSize(page, '24')
  await selectCharacter(page, 1, 0)
  await applyTextColor(page, '#0066cc')
  await selectCharacter(page, 1, 1)
  await applyTextColor(page, '#e6730d')

  await expect.poll(() => authority(page)).toMatchObject({ markdown: expected, synchronizationStatus: 'synchronized' })
  await expect.poll(() => authority(page)).toMatchObject({ autosaveStatus: 'saved' })
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  await ensureVisualMode(page)

  const paragraphs = page.locator('.ProseMirror > p')
  await expect(paragraphs).toHaveCount(2)
  await expect(paragraphs.nth(0)).toHaveText('啊啊啊啊')
  await expect(paragraphs.nth(1)).toHaveText('啊啊啊啊')
  await expect(paragraphs.nth(0)).not.toContainText('!32')
  await expect(paragraphs.nth(1)).not.toContainText('!!#')
  expect(await paragraphs.nth(0).locator('span').evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).fontSize)))
    .toEqual(expect.arrayContaining(['32px', '24px']))
  expect(await paragraphs.nth(1).locator('span').evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).color)))
    .toEqual(expect.arrayContaining(['rgb(0, 102, 204)', 'rgb(230, 115, 13)']))
})

test('legacy adjacent compound rich marks stay lossless in Visual and delimiter-free in Final', async ({ page }) => {
  const legacy = '!!#e6730d 甲!!!!#0066cc !!!#00ff00 乙!!!!!'
  await seedVisual(page, legacy)

  const visual = page.locator('.ProseMirror > p').first()
  await expect(visual).toHaveText('甲乙')
  await expect(visual).not.toContainText('!!#')
  await expect(visual.locator('[style*="color: rgb(230, 115, 13)"]')).toHaveText('甲')
  await expect(visual.locator('[style*="color: rgb(0, 102, 204)"]')).toHaveText('乙')
  await expect(visual.locator('mark[style*="background-color: rgb(0, 255, 0)"]')).toHaveText('乙')
  await expect.poll(() => authority(page)).toMatchObject({ markdown: legacy, synchronizationStatus: 'synchronized' })

  await page.locator('[data-command-id="mode.preview"]').click()
  const final = page.locator('.preview-rendered-content')
  await expect(final).toHaveText('甲乙')
  await expect(final).not.toContainText('!!#')
  await expect(final.locator('[style*="color: rgb(230, 115, 13)"]')).toHaveText('甲')
  await expect(final.locator('[style*="color: rgb(0, 102, 204)"]')).toHaveText('乙')
  await expect(final.locator('mark[style*="background-color: rgb(0, 255, 0)"]')).toHaveText('乙')
  await expect.poll(() => authority(page)).toMatchObject({ markdown: legacy })
})

test('the actual Welcome rich-format chain matches between Visual and Final', async ({ page }) => {
  const welcome = '**啊**++啊++*啊*~~啊~~~啊~啊^啊^{ 啊 | a }啊啊啊!!#0066cc 啊!!!!#e60000 啊!!!!#e6730d 啊!!!!!#0080e6 啊!!!!!!#00cc00 啊!!!啊啊啊$E = mc^2$啊啊啊'
  await seedVisual(page, welcome)

  const visual = page.locator('.ProseMirror > p').first()
  await expect(visual).not.toContainText('!!#')
  await expect(visual.locator('.ruby-mark[data-ruby-annotation="a"]')).toHaveText('啊')
  await expect(visual.locator('[style*="color: rgb(0, 102, 204)"]')).toHaveText('啊')
  await expect(visual.locator('[style*="color: rgb(230, 0, 0)"]')).toHaveText('啊')
  await expect(visual.locator('[style*="color: rgb(230, 115, 13)"]')).toHaveText('啊')
  await expect(visual.locator('mark[style*="background-color: rgb(0, 128, 230)"]')).toHaveText('啊')
  await expect(visual.locator('mark[style*="background-color: rgb(0, 204, 0)"]')).toHaveText('啊')
  await expect.poll(() => authority(page)).toMatchObject({ markdown: welcome, synchronizationStatus: 'synchronized' })

  await page.locator('[data-command-id="mode.preview"]').click()
  const final = page.locator('.preview-rendered-content')
  await expect(final).not.toContainText('!!#')
  await expect(final).not.toContainText('!#e6730d')
  await expect(final).not.toContainText('{ 啊 | a }')
  expect(await final.innerHTML()).not.toContain('w-editor-rich-boundary')
  const ruby = final.locator('.ruby-mark[data-ruby-annotation="a"]')
  await expect(ruby).toHaveText('啊')
  expect(await ruby.evaluate((element) => getComputedStyle(element, '::before').content)).toContain('a')
  await expect(final.locator('[style*="color: rgb(0, 102, 204)"]')).toHaveText('啊')
  await expect(final.locator('[style*="color: rgb(230, 0, 0)"]')).toHaveText('啊')
  await expect(final.locator('[style*="color: rgb(230, 115, 13)"]')).toHaveText('啊')
  await expect(final.locator('mark[style*="background-color: rgb(0, 128, 230)"]')).toHaveText('啊')
  await expect(final.locator('mark[style*="background-color: rgb(0, 204, 0)"]')).toHaveText('啊')
  await expect.poll(() => authority(page)).toMatchObject({ markdown: welcome })
})

test('Visual writes compound text/background colors in the canonical order and survives reload', async ({ page }) => {
  const canonical = '!!#e6730d 甲!!!!!#00ff00 !!#0066cc 乙!!!!!'
  await seedVisual(page, '甲乙')

  await selectVisualTextRange(page, 0, 0, 1, '甲')
  await applyTextColor(page, '#e6730d')
  await selectVisualTextRange(page, 0, 1, 2, '乙')
  await applyTextColor(page, '#0066cc')
  await selectVisualTextRange(page, 0, 1, 2, '乙')
  await applyBackgroundColor(page, '#00ff00')

  await expect.poll(() => authority(page)).toMatchObject({ markdown: canonical, synchronizationStatus: 'synchronized' })
  await page.locator('[data-command-id="mode.preview"]').click()
  const final = page.locator('.preview-rendered-content')
  await expect(final).toHaveText('甲乙')
  await expect(final).not.toContainText('!!#')
  await expect(final.locator('[style*="color: rgb(230, 115, 13)"]')).toHaveText('甲')
  await expect(final.locator('[style*="color: rgb(0, 102, 204)"]')).toHaveText('乙')
  await expect(final.locator('mark[style*="background-color: rgb(0, 255, 0)"]')).toHaveText('乙')

  await expect.poll(() => authority(page)).toMatchObject({ autosaveStatus: 'saved' })
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  await ensureVisualMode(page)
  const reloaded = page.locator('.ProseMirror > p').first()
  await expect(reloaded).toHaveText('甲乙')
  await expect(reloaded).not.toContainText('!!#')
  await expect(reloaded.locator('[style*="color: rgb(0, 102, 204)"]')).toHaveText('乙')
  await expect(reloaded.locator('mark[style*="background-color: rgb(0, 255, 0)"]')).toHaveText('乙')
  await expect.poll(() => authority(page)).toMatchObject({ markdown: canonical })
})

test('deleting the final character preserves the emptied middle paragraph after synchronization', async ({ page }) => {
  await seedVisual(page, '甲\n\n乙\n\n丙')
  const paragraphs = page.locator('.ProseMirror > p')
  await paragraphs.nth(1).evaluate((paragraph) => {
    const editor = paragraph.closest<HTMLElement>('.ProseMirror')
    const selection = window.getSelection()
    if (editor === null || selection === null) throw new Error('Expected a focused visual editor selection.')
    editor.focus()
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
  })
  await page.keyboard.press('Backspace')

  await expect.poll(() => authority(page)).toMatchObject({
    markdown: '甲\n\n\n\n丙',
    synchronizationStatus: 'synchronized',
  })
  await expect(paragraphs).toHaveCount(3)
  await expect(paragraphs.nth(0)).toHaveText('甲')
  await expect(paragraphs.nth(1)).toBeEmpty()
  await expect(paragraphs.nth(2)).toHaveText('丙')
})

test('Enter after the first paragraph following a panel keeps one stable empty line without duplicating later rows', async ({ page }) => {
  const panel = '::: info Information\nPanel body\n:::'
  const lines = ['1', '2', '3', '4', '5', '6']
  await seedVisual(page, [panel, ...lines].join('\n\n'))
  const paragraphs = page.locator('.ProseMirror > p')
  await paragraphs.nth(0).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')

  const expectedMarkdown = [panel, '1', '', '2', '3', '4', '5', '6'].join('\n\n')
  await expect.poll(() => authority(page)).toMatchObject({
    markdown: expectedMarkdown,
    synchronizationStatus: 'synchronized',
  })
  await expect.poll(() => paragraphs.allTextContents()).toEqual(['1', '', '2', '3', '4', '5', '6'])
  await page.waitForTimeout(500)
  await expect(paragraphs).toHaveText(['1', '', '2', '3', '4', '5', '6'])
  const projectionIds = await paragraphs.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-projection-id')))
  expect(new Set(projectionIds).size).toBe(projectionIds.length)
})
