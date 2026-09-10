import type { Locator, Page } from '@playwright/test'

import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

const WELCOME_KEY = 'w-editor:v1:document:welcome'

async function authority(page: Page) {
  return page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read())
}

async function setSource(page: Page, markdown: string): Promise<void> {
  await page.locator('[data-toolbar-menu="language"] .toolbar-menu__trigger').click()
  await page.locator('[data-command-id="language.en"]').click()
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill(markdown)
  await expect.poll(async () => (await authority(page))?.markdown).toBe(markdown)
}

async function beginComposition(editor: Locator, text: string): Promise<void> {
  await editor.focus()
  await editor.press('Control+End')
  await editor.dispatchEvent('compositionstart', { data: text })
  await editor.page().keyboard.insertText(text)
}

async function endComposition(editor: Locator, text: string): Promise<void> {
  await editor.dispatchEvent('compositionupdate', { data: text })
  await editor.dispatchEvent('compositionend', { data: text })
}

async function clickWithoutNativeCompositionCommit(button: Locator): Promise<void> {
  await button.evaluate((element) => { (element as HTMLButtonElement).click() })
}

test('visual composition keeps typing intermediate until preview waits and commits the completed text once', async ({ page }) => {
  await openReadyApp(page)
  await setSource(page, 'Alpha')
  await page.locator('[data-command-id="mode.visual"]').click()

  const editor = page.locator('.ProseMirror')
  const before = await authority(page)
  await beginComposition(editor, '中')
  await page.keyboard.insertText('文')
  await expect(editor).toContainText('Alpha中文')
  expect(await authority(page)).toMatchObject({ markdown: 'Alpha', revision: before?.revision })

  await clickWithoutNativeCompositionCommit(page.locator('[data-command-id="mode.preview"]'))
  await expect.poll(async () => (await authority(page))?.synchronizationStatus).toBe('waiting-composition')
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'visual')
  expect(await authority(page)).toMatchObject({ markdown: 'Alpha', revision: before?.revision })

  await endComposition(editor, '中文')
  await expect.poll(async () => authority(page)).toMatchObject({
    markdown: 'Alpha中文',
    mode: 'preview',
    revision: (before?.revision ?? 0) + 1,
    synchronizationStatus: 'synchronized',
  })
  await expect(page.locator('.preview-rendered-content')).toContainText('Alpha中文')
})

test('source composition blocks article switching and persists only the completed text before opening the next article', async ({ page }) => {
  await openReadyApp(page)
  await setSource(page, '# Welcome composition\n\nBefore')

  const editor = page.locator('#markdown-source-editor')
  const before = await authority(page)
  await beginComposition(editor, '中文')
  await expect(editor).toContainText('Before中文')
  expect(await authority(page)).toMatchObject({
    documentId: 'welcome',
    markdown: '# Welcome composition\n\nBefore',
    revision: before?.revision,
  })

  const product = page.locator('.article-card').filter({ hasText: 'Product notes' })
  await clickWithoutNativeCompositionCommit(product)
  await expect.poll(async () => (await authority(page))?.synchronizationStatus).toBe('waiting-composition')
  await expect(page.locator('.article-card--active')).toContainText('Welcome to W-Editor')

  await endComposition(editor, '中文')
  const decision = page.getByTestId('article-switch-decision')
  await expect(decision).toBeVisible()
  await expect(decision).toContainText('Unsaved changes')
  await decision.getByTestId('article-switch-save').click()
  await expect.poll(async () => (await authority(page))?.documentId).toBe('product-notes')
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null') as {
    autosave?: { markdown?: string; revision?: number }
  }, WELCOME_KEY)
  expect(stored.autosave).toMatchObject({
    markdown: '# Welcome composition\n\nBefore中文',
    revision: (before?.revision ?? 0) + 1,
  })
})

test('manual save waits for source composition and checkpoints the completed authoritative revision', async ({ page }) => {
  await openReadyApp(page)
  await setSource(page, '# Manual composition\n\nBefore')

  const editor = page.locator('#markdown-source-editor')
  const before = await authority(page)
  await beginComposition(editor, '中文')
  expect(await authority(page)).toMatchObject({
    markdown: '# Manual composition\n\nBefore',
    revision: before?.revision,
  })

  const save = page.locator('[data-command-id="document.manual-save"]')
  await clickWithoutNativeCompositionCommit(save)
  await expect.poll(async () => (await authority(page))?.synchronizationStatus).toBe('waiting-composition')
  await expect(save).toBeDisabled()

  await endComposition(editor, '中文')
  await expect.poll(async () => authority(page)).toMatchObject({
    markdown: '# Manual composition\n\nBefore中文',
    revision: (before?.revision ?? 0) + 1,
    synchronizationStatus: 'synchronized',
  })
  await expect(page.locator('.status-region')).toContainText('Manual checkpoint clean')
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null') as {
    manualCheckpoint?: { markdown?: string; revision?: number }
  }, WELCOME_KEY)
  expect(stored.manualCheckpoint).toMatchObject({
    markdown: '# Manual composition\n\nBefore中文',
    revision: (before?.revision ?? 0) + 1,
  })
})

test('pagehide force-persists the last completed source revision and excludes the active composition value', async ({ page }) => {
  await openReadyApp(page)
  const completed = '# Page hiding\n\nCompleted before composition'
  await page.locator('[data-command-id="mode.source"]').click()
  await setSource(page, completed)
  const completedAuthority = await authority(page)
  await expect.poll(async () => (await authority(page))?.autosaveStatus).toBe('pending')

  const editor = page.locator('#markdown-source-editor')
  await beginComposition(editor, '中间值')
  await expect(editor).toContainText('Completed before composition中间值')
  expect(await authority(page)).toMatchObject({
    markdown: completed,
    revision: completedAuthority?.revision,
  })

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
  await expect.poll(async () => page.evaluate((key) => {
    const stored = JSON.parse(localStorage.getItem(key) ?? 'null') as {
      autosave?: { markdown?: string; revision?: number }
    } | null
    return stored?.autosave
  }, WELCOME_KEY)).toEqual({
    markdown: completed,
    revision: completedAuthority?.revision,
    savedAt: expect.any(String),
  })
  await expect.poll(async () => (await authority(page))?.autosaveStatus).toBe('saved')

  await endComposition(editor, '中间值')
  await expect.poll(async () => (await authority(page))?.markdown).toBe(`${completed}中间值`)
})
