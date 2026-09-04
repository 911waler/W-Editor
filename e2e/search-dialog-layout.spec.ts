import type { Locator, Page } from '@playwright/test'

import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

async function setLongSource(page: Page): Promise<string> {
  await page.locator('[data-command-id="mode.source"]').click()
  const markdown = Array.from({ length: 120 }, (_, index) => (
    index === 18 || index === 89 ? `target NEEDLE ${index}` : `line ${String(index + 1).padStart(3, '0')}`
  )).join('\n')
  await page.locator('.cm-content[contenteditable="true"]').fill(markdown)
  await expect.poll(() => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().markdown)).toBe(markdown)
  return markdown
}

async function openSearch(page: Page): Promise<Locator> {
  await page.locator('[data-command-id="search.replace"]').click()
  const search = page.locator('.search-dock')
  await expect(search).toBeVisible()
  return search
}

async function selectionOffset(page: Page, selector: string): Promise<Readonly<{ anchor: number; collapsed: boolean }>> {
  return page.locator(selector).evaluate((root) => {
    const selection = window.getSelection()
    if (selection === null || selection.anchorNode === null || !root.contains(selection.anchorNode)) {
      throw new Error('Expected the browser selection inside the active editor.')
    }
    const range = document.createRange()
    range.selectNodeContents(root)
    range.setEnd(selection.anchorNode, selection.anchorOffset)
    return Object.freeze({ anchor: range.toString().length, collapsed: selection.isCollapsed })
  })
}

test('search is editor-adjacent, focuses its query, highlights all matches, and centers navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openReadyApp(page)
  await setLongSource(page)
  await page.locator('.editor-surface').evaluate((element) => { element.scrollTop = 0 })
  const editor = page.locator('.cm-content[contenteditable="true"]')
  await editor.focus()
  const search = await openSearch(page)

  await expect(search.getByLabel('搜索文本')).toBeFocused()
  await expect(page.locator('.dialog-backdrop')).toHaveCount(0)
  const [searchBox, editorBox] = await Promise.all([search.boundingBox(), page.locator('.editor-surface').boundingBox()])
  expect(searchBox).not.toBeNull()
  expect(editorBox).not.toBeNull()
  expect(searchBox!.y + searchBox!.height).toBeLessThanOrEqual(editorBox!.y)

  await search.getByLabel('搜索文本').fill('NEEDLE')
  await expect(search.getByTestId('search-status')).toHaveText('第 1 项，共 2 项')
  expect(await page.locator('.cm-searching').count()).toBeGreaterThanOrEqual(1)
  const active = page.locator('.cm-selectionBackground')
  const firstActive = await active.boundingBox()
  expect(firstActive).not.toBeNull()
  expect(firstActive!.y).toBeGreaterThan(editorBox!.y + 80)
  expect(firstActive!.y).toBeLessThan(editorBox!.y + editorBox!.height - 80)

  const firstScroll = await page.locator('.editor-surface').evaluate((element) => element.scrollTop)
  await search.getByRole('button', { name: '下一个' }).click()
  await expect(search.getByTestId('search-status')).toHaveText('第 2 项，共 2 项')
  const secondScroll = await page.locator('.editor-surface').evaluate((element) => element.scrollTop)
  expect(secondScroll).toBeGreaterThan(firstScroll)

  await editor.click()
  await expect(editor).toBeFocused()
  await expect(search).toBeVisible()
  await search.getByRole('button', { name: '关闭' }).click()
  await expect(search).toHaveCount(0)
  await expect(page.locator('.cm-searching')).toHaveCount(0)
  await expect(editor).toBeFocused()
})

test('empty and transient-match searches restore the opening Source and Visual caret', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openReadyApp(page)
  const markdown = await setLongSource(page)

  const source = page.locator('.cm-content[contenteditable="true"]')
  await source.focus()
  await page.keyboard.press('Control+End')
  let search = await openSearch(page)
  await expect(search.getByLabel('搜索文本')).toBeFocused()
  await search.getByLabel('搜索文本').press('Escape')
  await expect(search).toHaveCount(0)
  await page.keyboard.insertText('§')
  await expect.poll(() => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().markdown)).toBe(`${markdown}§`)
  await source.fill(markdown)
  await expect.poll(() => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().markdown)).toBe(markdown)
  await source.focus()
  await page.keyboard.press('Control+End')

  search = await openSearch(page)
  await search.getByLabel('搜索文本').pressSequentially('NEEDLEX')
  await expect(search.getByTestId('search-status')).toHaveText('没有匹配项。')
  await search.getByRole('button', { name: '关闭' }).click()
  await expect(search).toHaveCount(0)
  await page.keyboard.insertText('§')
  await expect.poll(() => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().markdown)).toBe(`${markdown}§`)
  await source.fill(markdown)
  await expect.poll(() => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().markdown)).toBe(markdown)

  await page.locator('[data-command-id="mode.visual"]').click()
  const visual = page.locator('.ProseMirror')
  await visual.locator('p').last().click()
  await page.keyboard.press('End')
  const visualOpening = await selectionOffset(page, '.ProseMirror')

  search = await openSearch(page)
  await expect(search.getByLabel('搜索文本')).toBeFocused()
  await search.getByLabel('搜索文本').pressSequentially('NEEDLEX')
  await expect(search.getByTestId('search-status')).toHaveText('没有匹配项。')
  await search.getByRole('button', { name: '关闭' }).click()
  await expect(search).toHaveCount(0)
  expect(await selectionOffset(page, '.ProseMirror')).toEqual(visualOpening)

})

test('visual sheet uses compact margins, full-width ordinary paragraphs, and localized non-authoritative edit boundaries', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openReadyApp(page)
  await page.locator('[data-command-id="mode.source"]').click()
  const markdown = '一段用于测量正文宽度的普通文本。\n\n第二段保持同一 Markdown 权威。'
  await page.locator('.cm-content[contenteditable="true"]').fill(markdown)
  await expect.poll(() => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().markdown)).toBe(markdown)
  const revision = await page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().revision)
  await page.locator('[data-command-id="mode.visual"]').click()

  const geometry = await page.locator('.visual-surface').evaluate((sheet) => {
    const editorSurface = sheet.closest('.editor-surface') as HTMLElement
    const editor = sheet.querySelector<HTMLElement>('.ProseMirror')!
    const paragraph = editor.querySelector<HTMLElement>(':scope > p')!
    const sheetStyle = getComputedStyle(sheet)
    const outerStyle = getComputedStyle(editorSurface)
    return Object.freeze({
      endContent: getComputedStyle(editor, '::after').content,
      innerPadding: Number.parseFloat(sheetStyle.paddingInlineStart),
      outerPadding: Number.parseFloat(outerStyle.paddingInlineStart),
      paragraphWidth: paragraph.getBoundingClientRect().width,
      startContent: getComputedStyle(editor, '::before').content,
      textWidth: editor.getBoundingClientRect().width,
      width: sheet.getBoundingClientRect().width,
    })
  })
  expect(geometry.outerPadding).toBeLessThanOrEqual(32)
  expect(geometry.innerPadding).toBeLessThanOrEqual(48)
  expect(geometry.width).toBeGreaterThanOrEqual(940)
  expect(geometry.textWidth - geometry.paragraphWidth).toBeLessThanOrEqual(1)
  expect(geometry.startContent).toContain('可编辑区开始')
  expect(geometry.endContent).toContain('可编辑区结束')
  await expect.poll(() => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read())).toMatchObject({ markdown, revision })

  await page.setViewportSize({ width: 390, height: 760 })
  const narrow = await page.locator('.visual-surface').evaluate((sheet) => Object.freeze({
    right: sheet.getBoundingClientRect().right,
    viewport: window.innerWidth,
    width: sheet.getBoundingClientRect().width,
    x: sheet.getBoundingClientRect().x,
  }))
  expect(narrow.x).toBeGreaterThanOrEqual(0)
  expect(narrow.right).toBeLessThanOrEqual(narrow.viewport)
  expect(narrow.width).toBeGreaterThan(300)
})

test('search reflows without clipping at a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 })
  await openReadyApp(page)
  await setLongSource(page)
  const search = await openSearch(page)

  const [searchBox, workspaceBox] = await Promise.all([search.boundingBox(), page.locator('.editor-workspace').boundingBox()])
  expect(searchBox).not.toBeNull()
  expect(workspaceBox).not.toBeNull()
  expect(searchBox!.x).toBeGreaterThanOrEqual(workspaceBox!.x)
  expect(searchBox!.x + searchBox!.width).toBeLessThanOrEqual(workspaceBox!.x + workspaceBox!.width + 1)
  await search.getByLabel('展开替换控件').click()
  await expect(search.getByLabel('替换文本')).toBeVisible()
  await expect(search.getByRole('button', { name: '全部替换' })).toBeVisible()
  await expect(page.locator('.editor-surface')).toBeVisible()
})
