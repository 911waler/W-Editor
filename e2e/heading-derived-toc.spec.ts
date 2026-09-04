import type { Page } from '@playwright/test'

import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

interface AuthorityState {
  readonly autosaveStatus: string
  readonly markdown: string
  readonly revision: number
  readonly synchronizationStatus: string
}

const UNICODE_ANCHOR = '%E7%AB%A0%E8%8A%82-%E4%B8%80'
const POPULATED = '# Alpha\n\n## 章节 一\n\n# Alpha\n\n### Custom {#chosen}\n\n[[toc]]'
const RENAMED = '# Renamed\n\n## 章节 一\n\n# Alpha\n\n### Custom {#chosen}\n\n[[toc]]'
const ADDED = '# Renamed\n\n## Added\n\n## 章节 一\n\n# Alpha\n\n### Custom {#chosen}\n\n[[toc]]'
const REORDERED = '### Custom {#chosen}\n\n# Added\n\n## 章节 一\n\n# Renamed\n\n[[toc]]'
const TOC_STYLE_MARKDOWN = '# Alpha\n\n## Beta\n\n### Gamma\n\n[[toc]]'

async function authority(page: Page): Promise<AuthorityState> {
  const snapshot = await page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read())
  if (snapshot === undefined) throw new Error('The E2E authority inspection seam is unavailable.')
  return snapshot
}

async function expectAuthority(page: Page, markdown: string): Promise<void> {
  await expect.poll(() => authority(page)).toMatchObject({ markdown, synchronizationStatus: 'synchronized' })
}

async function switchMode(page: Page, mode: 'source' | 'visual'): Promise<void> {
  await page.locator(`[data-command-id="mode.${mode}"]`).click()
}

function sourceControl(page: Page) {
  // The e2e build exposes CodeMirror's stable contenteditable source surface;
  // the test-mode build uses #markdown-source instead.
  return page.locator('#markdown-source, #markdown-source-editor').first()
}

async function setSource(page: Page, markdown: string): Promise<void> {
  await switchMode(page, 'source')
  await sourceControl(page).fill(markdown)
  await expectAuthority(page, markdown)
}

async function codeMirrorSource(page: Page): Promise<string> {
  return sourceControl(page).locator('.cm-line')
    .evaluateAll((lines) => lines.map((line) => line.textContent ?? '').join('\n'))
}

async function insertTocThroughMenu(page: Page): Promise<void> {
  await page.locator('[data-toolbar-menu="insert"] .toolbar-menu__trigger').click()
  await page.locator('[data-command-id="insert.toc"]').click()
}

async function expectOneTocNodeAndMarker(page: Page): Promise<void> {
  await expect(page.locator('[data-w-editor-node="toc"]')).toHaveCount(1)
  await expect.poll(() => authority(page).then(({ markdown }) =>
    markdown.match(/^\[\[toc\]\]$/gmu)?.length ?? 0)).toBe(1)
}

test('Task 1 keeps one TOC across repeated Visual and Source commands', async ({ page }) => {
  await openReadyApp(page)
  await setSource(page, '# Alpha')
  await switchMode(page, 'visual')

  await insertTocThroughMenu(page)
  await expectOneTocNodeAndMarker(page)
  await expect(page.locator('.status-region__command')).toHaveText('已插入目录。')

  await insertTocThroughMenu(page)
  await expectOneTocNodeAndMarker(page)
  await expect(page.locator('.status-region__command')).toHaveText('目录已存在。')
  await expect(page.locator('[data-w-editor-node="toc"]')).toHaveClass(/ProseMirror-selectednode/)

  await switchMode(page, 'source')
  await insertTocThroughMenu(page)
  await expectAuthority(page, '# Alpha\n\n[[toc]]')
  await expect(page.locator('.status-region__command')).toHaveText('目录已存在。')
  await switchMode(page, 'visual')
  await expectOneTocNodeAndMarker(page)
  await expect(page.locator('[data-w-editor-node="toc"]')).toHaveClass(/ProseMirror-selectednode/)
})

test('Task 1 Tiptap-style TOC presentation is borderless and hierarchical', async ({ page }) => {
  await openReadyApp(page)
  await setSource(page, TOC_STYLE_MARKDOWN)
  await switchMode(page, 'visual')

  const toc = page.locator('[data-w-editor-node="toc"]')
  await expect(toc).toHaveCount(1)
  const styles = await toc.evaluate((node) => {
    const title = node.querySelector<HTMLElement>('.toc-node__title')
    const levelOne = node.querySelector<HTMLElement>('[data-toc-level="1"]')
    const levelTwo = node.querySelector<HTMLElement>('[data-toc-level="2"]')
    const levelThree = node.querySelector<HTMLElement>('[data-toc-level="3"]')
    const link = node.querySelector<HTMLElement>('.toc-node__link')
    if (title === null || levelOne === null || levelTwo === null || levelThree === null || link === null) {
      throw new Error('The TOC style fixture is missing a title, heading level, or link.')
    }
    return {
      backgroundColor: getComputedStyle(node).backgroundColor,
      borderTopWidth: getComputedStyle(node).borderTopWidth,
      borderRightWidth: getComputedStyle(node).borderRightWidth,
      borderBottomWidth: getComputedStyle(node).borderBottomWidth,
      borderLeftWidth: getComputedStyle(node).borderLeftWidth,
      titleTextTransform: getComputedStyle(title).textTransform,
      linkTextDecorationLine: getComputedStyle(link).textDecorationLine,
      levelOnePadding: Number.parseFloat(getComputedStyle(levelOne).paddingInlineStart),
      levelTwoPadding: Number.parseFloat(getComputedStyle(levelTwo).paddingInlineStart),
      levelThreePadding: Number.parseFloat(getComputedStyle(levelThree).paddingInlineStart),
    }
  })

  expect(styles.backgroundColor).toBe('rgba(0, 0, 0, 0)')
  expect(styles.borderTopWidth).toBe('0px')
  expect(styles.borderRightWidth).toBe('0px')
  expect(styles.borderBottomWidth).toBe('0px')
  expect(styles.borderLeftWidth).toBe('0px')
  expect(styles.titleTextTransform).toBe('none')
  expect(styles.linkTextDecorationLine).toBe('underline')
  expect(styles.levelTwoPadding).toBeGreaterThan(styles.levelOnePadding)
  expect(styles.levelThreePadding).toBeGreaterThan(styles.levelTwoPadding)
})

test('Task 22.7 TOC derives empty/populated items and live anchors, navigates, round-trips, reaches Cherry Final, and reloads', async ({ page }) => {
  await openReadyApp(page)
  await setSource(page, '[[toc]]')
  await switchMode(page, 'visual')

  let toc = page.locator('[data-w-editor-node="toc"]')
  await expect(toc).toHaveCount(1)
  await expect(toc.locator('[data-toc-empty]')).toBeVisible()
  await expect(toc.getByRole('link')).toHaveCount(0)

  await setSource(page, POPULATED)
  await switchMode(page, 'visual')
  toc = page.locator('[data-w-editor-node="toc"]')
  await expect(toc.getByRole('link')).toHaveCount(4)
  await expect(toc.getByRole('link').allTextContents()).resolves.toEqual(['Alpha', '章节 一', 'Alpha', 'Custom'])
  await expect(page.locator('.ProseMirror h1').nth(0)).toHaveAttribute('id', 'alpha')
  await expect(page.locator('.ProseMirror h2')).toHaveAttribute('id', UNICODE_ANCHOR)
  await expect(page.locator('.ProseMirror h1').nth(1)).toHaveAttribute('id', 'alpha-2')
  await expect(page.locator('.ProseMirror h3')).toHaveAttribute('id', 'chosen')
  await expect(page.locator('.ProseMirror h3')).toHaveText('Custom')

  const firstHeading = page.locator('.ProseMirror h1').first()
  await firstHeading.click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  await page.keyboard.type('Renamed')
  await expectAuthority(page, RENAMED)
  await expect(toc.getByRole('link').first()).toHaveText('Renamed')
  await expect(toc.getByRole('link').first()).toHaveAttribute('href', '#renamed')

  await firstHeading.click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Added')
  await page.locator('[data-toolbar-menu="heading"] .toolbar-menu__trigger').click()
  await page.locator('[data-command-id="block.h2"]').click()
  await expectAuthority(page, ADDED)
  await expect(toc.getByRole('link').allTextContents()).resolves.toEqual(['Renamed', 'Added', '章节 一', 'Alpha', 'Custom'])

  await setSource(page, RENAMED)
  await switchMode(page, 'visual')
  toc = page.locator('[data-w-editor-node="toc"]')
  await expect(toc.getByRole('link', { name: 'Added' })).toHaveCount(0)

  await setSource(page, REORDERED)
  await switchMode(page, 'visual')
  toc = page.locator('[data-w-editor-node="toc"]')
  await expect(toc.getByRole('link').allTextContents()).resolves.toEqual(['Custom', 'Added', '章节 一', 'Renamed'])
  await expect(toc.getByRole('link', { name: 'Alpha' })).toHaveCount(0)
  await toc.getByRole('link', { name: '章节 一' }).focus()
  await toc.getByRole('link', { name: '章节 一' }).press('Enter')
  await expect(page).toHaveURL(new RegExp(`#${UNICODE_ANCHOR}$`, 'u'))
  await expect(page.locator('.ProseMirror')).toBeFocused()
  await expect.poll(() => page.evaluate(() => {
    const anchor = window.getSelection()?.anchorNode
    const element = anchor instanceof Element ? anchor : anchor?.parentElement
    return element?.closest('h1, h2, h3, h4, h5')?.id ?? null
  })).toBe(UNICODE_ANCHOR)

  await setSource(page, REORDERED)
  await expect.poll(() => codeMirrorSource(page)).toBe(REORDERED)
  await page.locator('[data-command-id="mode.preview"]').click()
  const finalToc = page.locator('.preview-rendered-content .toc')
  await expect(finalToc.getByRole('link')).toHaveCount(4)
  await expect(finalToc.getByRole('link').allTextContents()).resolves.toEqual(['Custom', 'Added', '章节 一', 'Renamed'])
  await expect(finalToc.getByRole('link', { name: '章节 一' })).toHaveAttribute('href', `#${UNICODE_ANCHOR}`)
  await expect.poll(() => authority(page).then(({ autosaveStatus }) => autosaveStatus)).toBe('saved')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  await expectAuthority(page, REORDERED)
})
