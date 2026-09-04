import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { Page } from '@playwright/test'

import { openReadyApp, useEnglishUi } from './fixtures/app'
import { expect, test } from './fixtures/test'

const FIXTURE_PATH = resolve('e2e/fixtures/documents/representative-long.md')
const WELCOME_KEY = 'w-editor:v1:document:welcome'

async function authority(page: Page) {
  return page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read())
}

test('representative long document supports typing, lifecycle flush, mode switch, manual save, and reload', async ({ page }) => {
  test.setTimeout(120_000)
  const source = await readFile(FIXTURE_PATH, 'utf8')
  const suffix = 'Blocking long-document smoke edit.'
  const expected = `${source}${suffix}`

  await openReadyApp(page)
  await useEnglishUi(page)
  await page.getByTestId('import-markdown-input').setInputFiles(FIXTURE_PATH)
  const confirmation = page.getByTestId('document-lifecycle-confirmation')
  await expect(confirmation).toHaveAttribute('data-confirmation-kind', 'import')
  await confirmation.getByTestId('document-lifecycle-confirm').click()
  await expect.poll(async () => (await authority(page))?.markdown, { timeout: 30_000 }).toBe(source)

  await page.locator('[data-command-id="mode.source"]').click()
  const editor = page.locator('#markdown-source-editor')
  await editor.focus()
  await editor.press('Control+End')
  await page.keyboard.insertText(suffix)
  await expect.poll(async () => (await authority(page))?.markdown, { timeout: 30_000 }).toBe(expected)

  await page.locator('[data-command-id="mode.visual"]').click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'visual', { timeout: 60_000 })
  await expect(page.locator('.ProseMirror')).toContainText('Blocking long-document smoke edit.', { timeout: 30_000 })
  await expect(page.locator('.status-region')).toContainText('Autosave saved', { timeout: 30_000 })

  await page.locator('[data-command-id="document.manual-save"]').click()
  await expect(page.locator('.status-region')).toContainText('Manual checkpoint clean', { timeout: 30_000 })
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null') as {
    autosave?: { markdown?: string }
    manualCheckpoint?: { markdown?: string }
  }, WELCOME_KEY)
  expect(stored).toMatchObject({
    autosave: { markdown: expected },
    manualCheckpoint: { markdown: expected },
  })

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true', { timeout: 30_000 })
  await page.locator('[data-command-id="mode.source"]').click()
  await expect.poll(async () => authority(page), { timeout: 30_000 }).toMatchObject({
    autosaveStatus: 'saved',
    markdown: expected,
    mode: 'source',
  })
  const reloadedEditor = page.locator('#markdown-source-editor')
  await reloadedEditor.focus()
  await reloadedEditor.press('Control+End')
  await expect(reloadedEditor).toContainText('Blocking long-document smoke edit.')
})
