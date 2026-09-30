import { readFile } from 'node:fs/promises'

import type { Download, Page } from '@playwright/test'

import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

async function authorityMarkdown(page: Page): Promise<string | undefined> {
  return page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().markdown)
}

async function setSource(page: Page, markdown: string): Promise<void> {
  const source = page.locator('#markdown-source-editor')
  if (!await source.isVisible()) {
    await page.locator('[data-command-id="mode.source"]').click()
    await expect(source).toBeVisible()
  }
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'source')
  await source.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.insertText(markdown)
  await expect.poll(() => authorityMarkdown(page), { timeout: 30_000 }).toBe(markdown)
}

async function invokeToolbarCommand(page: Page, commandId: string): Promise<void> {
  const menuId = commandId.startsWith('export.')
    ? 'export'
    : commandId.startsWith('language.') ? 'language' : null
  if (menuId !== null) await page.locator(`[data-toolbar-menu="${menuId}"] .toolbar-menu__trigger`).click()
  await page.locator(`[data-command-id="${commandId}"]`).click()
}

async function downloadedBytes(download: Download): Promise<Buffer> {
  const path = await download.path()
  if (path === null) throw new Error(`Download ${download.suggestedFilename()} has no local path.`)
  return readFile(path)
}

async function invokeDownload(page: Page, commandId: string): Promise<Download> {
  const pending = page.waitForEvent('download')
  await invokeToolbarCommand(page, commandId)
  return pending
}

test('real utility controls execute search, shortcuts, modes, fullscreen, languages, and flushed statistics', async ({ page }) => {
  await openReadyApp(page)
  await invokeToolbarCommand(page, 'language.en')
  await setSource(page, 'Alpha beta Alpha')

  await page.locator('[data-command-id="search.replace"]').click()
  const search = page.getByRole('search', { name: 'Search this article' })
  await search.getByLabel('Search text').fill('Alpha')
  await search.getByRole('button', { name: 'Show replacement controls' }).click()
  await search.getByLabel('Replacement text').fill('Omega')
  await expect(search.getByTestId('search-status')).toContainText('1 of 2')
  await search.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(search.getByTestId('search-status')).toContainText('2 of 2')
  await search.getByRole('button', { name: 'Replace all', exact: true }).click()
  await expect.poll(() => authorityMarkdown(page)).toBe('Omega beta Omega')
  await search.locator('.search-dock__close').click()

  const revisionBeforeSettings = await page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().revision)
  await invokeToolbarCommand(page, 'settings.shortcuts')
  const shortcuts = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await shortcuts.locator('[data-shortcut-command="text.bold"] .shortcut-recorder').click()
  await page.keyboard.press('Control+Alt+k')
  await expect(shortcuts.locator('[data-shortcut-command="text.bold"] kbd')).toHaveText(['Ctrl', 'Alt', 'K'])
  await shortcuts.getByRole('button', { name: 'Apply shortcuts', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().revision)).toBe(revisionBeforeSettings)
  await setSource(page, 'Alpha')
  await page.locator('#markdown-source-editor').click()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Control+Alt+k')
  await expect.poll(() => authorityMarkdown(page)).toBe('**Alpha**')

  await page.locator('[data-command-id="mode.visual"]').click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'visual')
  await page.getByTestId('toolbar-preview-toggle').click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'preview')
  await page.getByTestId('toolbar-preview-toggle').click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'visual')
  await page.locator('[data-command-id="mode.source"]').click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'source')

  await invokeToolbarCommand(page, 'application.fullscreen')
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains('workspace-shell') ?? false)).toBe(true)
  await invokeToolbarCommand(page, 'application.fullscreen')
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true)

  await invokeToolbarCommand(page, 'language.zh')
  await expect(page.locator('[data-command-id="search.replace"]')).toContainText('搜索')
  await invokeToolbarCommand(page, 'language.ru')
  await expect(page.locator('[data-command-id="search.replace"]')).toContainText('Поиск')
  await invokeToolbarCommand(page, 'language.en')
  await expect(page.locator('[data-command-id="search.replace"]')).toContainText('Search')

  await setSource(page, 'Hello world\n\nПривет мир')
  const statisticsRevision = await page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().revision)
  await invokeToolbarCommand(page, 'document.word-count')
  const statistics = page.getByTestId('word-count-dialog')
  await expect(statistics.locator('[data-statistic="revision"]')).toHaveText(String(statisticsRevision))
  await expect(statistics.locator('[data-statistic="words"]')).toHaveText('4')
  await expect(statistics.locator('[data-statistic="paragraphs"]')).toHaveText('2')
  await statistics.getByRole('button', { name: 'Close', exact: true }).click()
})

test('every export command produces its real browser outcome from the same pending revision', async ({ page }) => {
  test.setTimeout(60_000)
  await openReadyApp(page)
  await invokeToolbarCommand(page, 'language.en')
  const markdown = '# Export revision\n\nCafé 👋\n\n<script>globalThis.pwned = true</script>\n'
  await setSource(page, markdown)
  const revision = await page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().revision)

  const markdownDownload = await invokeDownload(page, 'export.markdown')
  expect(markdownDownload.suggestedFilename()).toBe('welcome.md')
  expect((await downloadedBytes(markdownDownload)).toString('utf8')).toBe(markdown)

  const htmlDownload = await invokeDownload(page, 'export.html')
  expect(htmlDownload.suggestedFilename()).toBe('welcome.html')
  const html = (await downloadedBytes(htmlDownload)).toString('utf8')
  expect(html).toContain('<!doctype html>')
  expect(html).toContain(`data-revision="${revision ?? -1}"`)
  expect(html).toContain('Café 👋')
  expect(html).not.toMatch(/<script/iu)
  expect(html).toContain('&lt;script&gt;globalThis.pwned = true&lt;/script&gt;')

  await expect(page.locator('[data-command-id="export.word"]')).toHaveCount(0)

  const pdfDownload = await invokeDownload(page, 'export.pdf')
  expect(pdfDownload.suggestedFilename()).toBe('welcome.pdf')
  const pdf = await downloadedBytes(pdfDownload)
  expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-')
  expect(pdf.toString('latin1').trimEnd().endsWith('%%EOF')).toBe(true)
  await expect(page.getByRole('status')).toContainText(`PDF revision ${revision ?? -1} downloaded.`)

  const screenshotDownload = await invokeDownload(page, 'export.screenshot')
  expect(screenshotDownload.suggestedFilename()).toBe('welcome.png')
  const screenshot = await downloadedBytes(screenshotDownload)
  expect([...screenshot.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  await expect(page.getByRole('status')).toContainText(`Long screenshot revision ${revision ?? -1} downloaded.`)
  await expect.poll(() => authorityMarkdown(page)).toBe(markdown)
  await expect(page.locator('.status-region')).toContainText('Manual checkpoint dirty')
})

test('remote images without CORS do not block rendered exports, while real capture failures stay visible', async ({ page }) => {
  test.setTimeout(60_000)
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window)
    window.fetch = (input, init) => String(input).startsWith('https://cdn.example.test/')
      ? Promise.reject(new TypeError('Failed to fetch'))
      : nativeFetch(input, init)
  })
  await page.route('https://cdn.example.test/**', (route) => route.fulfill({
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
    contentType: 'image/png',
    status: 200,
  }))
  await openReadyApp(page)
  await invokeToolbarCommand(page, 'language.en')
  const remote = '![remote](https://cdn.example.test/no-cors.png)'
  await setSource(page, remote)
  const revision = await page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().revision)

  const pdfDownload = page.waitForEvent('download', { timeout: 3_000 })
  await invokeToolbarCommand(page, 'export.pdf')
  const pdf = await downloadedBytes(await pdfDownload)
  expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-')
  expect(pdf.toString('latin1').trimEnd().endsWith('%%EOF')).toBe(true)
  await expect(page.getByRole('status')).toContainText(`PDF revision ${revision ?? -1} downloaded`)
  await expect(page.getByRole('status')).toContainText('remote images omitted: 1')
  await expect(page.getByTestId('export-error')).toHaveCount(0)
  await expect.poll(() => authorityMarkdown(page)).toBe(remote)

  const screenshotDownload = page.waitForEvent('download', { timeout: 3_000 })
  await invokeToolbarCommand(page, 'export.screenshot')
  const screenshot = await downloadedBytes(await screenshotDownload)
  expect([...screenshot.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  await expect(page.getByRole('status')).toContainText(`Long screenshot revision ${revision ?? -1} downloaded`)
  await expect(page.getByRole('status')).toContainText('remote images omitted: 1')
  await expect(page.getByTestId('export-error')).toHaveCount(0)
  await expect.poll(() => authorityMarkdown(page)).toBe(remote)

  const oversized = Array.from({ length: 1_600 }, (_, index) => `Paragraph ${index + 1}`).join('\n\n')
  await setSource(page, oversized)
  await invokeToolbarCommand(page, 'export.screenshot')
  await expect(page.getByTestId('export-error')).toContainText('exceeds the browser-safe screenshot limit')
  await expect.poll(() => authorityMarkdown(page)).toBe(oversized)
})


test('PDF and PNG capture real inline images with formulas and references without fetching editor separator images', async ({ page }) => {
  test.setTimeout(60_000)
  await openReadyApp(page)
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  const markdown = `# Mixed export\n\nInline ![real export image](${image}) with $E=mc^2$ and [1](#wref-book~https%3A%2F%2Fexample.org%2Fpaper).`
  await setSource(page, markdown)
  await page.locator('[data-command-id="mode.visual"]').click()
  await expect(page.locator('.ProseMirror img[alt="real export image"]').first()).toBeVisible()
  await expect(page.locator('.ProseMirror .katex').first()).toBeVisible()
  const pdf = await downloadedBytes(await invokeDownload(page, 'export.pdf'))
  expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-')
  const png = await downloadedBytes(await invokeDownload(page, 'export.screenshot'))
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  await expect.poll(() => authorityMarkdown(page)).toBe(markdown)
  await expect(page.locator('.w-editor-export-instance')).toHaveCount(0)
})
