import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import type { Download, Page } from '@playwright/test'

import { openReadyApp, useEnglishUi } from './fixtures/app'
import { expect, test } from './fixtures/test'

const WORKSPACE_KEY = 'w-editor:v1:workspace'
const WELCOME_KEY = 'w-editor:v1:document:welcome'
const PRODUCT_KEY = 'w-editor:v1:document:product-notes'
const CATALOG = ['welcome', 'product-notes', 'formatting-gallery'] as const
const INITIAL_WELCOME = readFileSync(new URL('../apps/playground/src/content/articles/welcome.md', import.meta.url), 'utf8')

function workspaceEnvelope(activeDocumentId: string) {
  return {
    activeDocumentId,
    articlePanel: { collapsed: false, width: 252 },
    catalogDocumentIds: CATALOG,
    schemaVersion: 1,
  }
}

function documentEnvelope(documentId: string, markdown: string, revision: number) {
  return {
    autosave: { markdown, revision, savedAt: '2026-08-22T06:00:00.000Z' },
    documentId,
    manualCheckpoint: null,
    preDestructiveReplace: null,
    preModeSwitch: null,
    schemaVersion: 1,
    status: { lastPersistenceFailure: null },
  }
}

async function seedStorage(page: Page, entries: Readonly<Record<string, string>>): Promise<void> {
  await page.addInitScript((seed) => {
    for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value)
  }, entries)
}

async function authority(page: Page) {
  return page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read())
}

async function downloadedBytes(download: Download): Promise<Buffer> {
  const path = await download.path()
  if (path === null) throw new Error(`Download ${download.suggestedFilename()} has no local path.`)
  return readFile(path)
}

test('valid startup recovery restores the last active document before the app is ready', async ({ page }) => {
  const markdown = '# Recovered product notes\n\nExact autosaved draft.'
  await seedStorage(page, {
    [PRODUCT_KEY]: JSON.stringify(documentEnvelope('product-notes', markdown, 7)),
    [WORKSPACE_KEY]: JSON.stringify(workspaceEnvelope('product-notes')),
  })

  await openReadyApp(page)

  await expect.poll(async () => authority(page)).toMatchObject({
    autosaveStatus: 'saved',
    documentId: 'product-notes',
    markdown,
    revision: 7,
  })
  await expect(page.locator('.article-card--active')).toContainText('Product notes')
  await page.locator('[data-command-id="mode.source"]').click()
  await expect.poll(() => page.locator('#markdown-source-editor').locator('.cm-line')
    .evaluateAll((lines) => lines.map((line) => line.textContent ?? '').join('\n'))).toBe(markdown)
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  await expect.poll(async () => (await authority(page))?.markdown).toBe(markdown)
})

for (const recovery of [
  {
    expectedFilename: 'w-editor-recovery-document-welcome.json',
    key: WELCOME_KEY,
    label: 'corrupt document',
    raw: '{not-json',
    seed: { [WELCOME_KEY]: '{not-json', [WORKSPACE_KEY]: JSON.stringify(workspaceEnvelope('welcome')) },
  },
  {
    expectedFilename: 'w-editor-recovery-workspace.json',
    key: WORKSPACE_KEY,
    label: 'unknown workspace version',
    raw: JSON.stringify({ schemaVersion: 99, future: 'exact raw value' }),
    seed: { [WORKSPACE_KEY]: JSON.stringify({ schemaVersion: 99, future: 'exact raw value' }) },
  },
] as const) {
  test(`${recovery.label} requires exact raw export before explicit clear and reset`, async ({ page }) => {
    await seedStorage(page, recovery.seed)
    await openReadyApp(page)

    const panel = page.getByTestId('startup-recovery')
    await expect(panel).toBeVisible()
    await expect(page.locator('#markdown-source-editor')).toHaveCount(0)
    const recoveryActions = panel.locator(':scope > .startup-recovery__actions')
    const exportRaw = recoveryActions.locator('button').nth(0)
    const reset = recoveryActions.locator('button').nth(1)
    await expect(reset).toBeDisabled()

    const pendingDownload = page.waitForEvent('download')
    await exportRaw.click()
    const download = await pendingDownload
    expect(download.suggestedFilename()).toBe(recovery.expectedFilename)
    expect((await downloadedBytes(download)).toString('utf8')).toBe(recovery.raw)
    await expect(page.getByTestId('raw-recovery-exported')).toBeVisible()
    await expect(reset).toBeEnabled()
    expect(await page.evaluate((key) => localStorage.getItem(key), recovery.key)).toBe(recovery.raw)

    await reset.click()
    const confirmation = page.getByTestId('startup-recovery-confirmation')
    await expect(confirmation).toBeVisible()
    await confirmation.locator('button').first().click()
    await expect(confirmation).toHaveCount(0)
    expect(await page.evaluate((key) => localStorage.getItem(key), recovery.key)).toBe(recovery.raw)

    await reset.click()
    await page.getByTestId('startup-recovery-confirmation').locator('button').last().click()
    await expect(panel).toHaveCount(0)
    await page.locator('[data-command-id="mode.source"]').click()
    await expect(page.locator('#markdown-source-editor')).toBeVisible()
    await expect.poll(async () => (await authority(page))?.markdown).toBe(INITIAL_WELCOME)
    const resetEnvelope = await page.evaluate((key) => localStorage.getItem(key), recovery.key)
    expect(JSON.parse(resetEnvelope ?? 'null')).toMatchObject({ schemaVersion: 1 })
  })
}

test('article switching keeps both recovery drafts through explicit dirty decisions and preserves manual state per document', async ({ page }) => {
  await openReadyApp(page)
  await useEnglishUi(page)
  const welcome = '# Dirty welcome\n\nAutosaved but not manually checkpointed.'
  const product = '# Product draft\n\nSeparate local identity.'
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill(welcome)
  await expect(page.locator('.status-region')).toContainText('Autosave saved', { timeout: 5_000 })
  await expect(page.locator('.status-region')).toContainText('Manual checkpoint dirty')

  await page.locator('.article-card').filter({ hasText: 'Product notes' }).click()
  let decision = page.getByTestId('article-switch-decision')
  await expect(decision).toBeVisible()
  await decision.getByTestId('article-switch-draft').click()
  await expect.poll(async () => (await authority(page))?.documentId).toBe('product-notes')
  await expect(page.locator('[role="dialog"]')).toHaveCount(0)
  const welcomeCard = page.locator('.article-card').filter({ hasText: 'Welcome to W-Editor' })
  await expect(welcomeCard.locator('time')).not.toHaveText('--:--')
  await expect(welcomeCard).not.toContainText('checkpoint')
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill(product)
  await expect(page.locator('.status-region')).toContainText('Autosave saved', { timeout: 5_000 })

  await page.locator('.article-card').filter({ hasText: 'Welcome to W-Editor' }).click()
  decision = page.getByTestId('article-switch-decision')
  await expect(decision).toBeVisible()
  await decision.getByTestId('article-switch-draft').click()
  await expect.poll(async () => (await authority(page))?.markdown).toBe(welcome)
  await expect(page.locator('.status-region')).toContainText('Manual checkpoint dirty')
  await page.locator('[data-command-id="document.manual-save"]').click()
  await expect(page.locator('.status-region')).toContainText('Manual checkpoint clean')

  const stored = await page.evaluate(([welcomeKey, productKey]) => ({
    product: JSON.parse(localStorage.getItem(productKey) ?? 'null') as unknown,
    welcome: JSON.parse(localStorage.getItem(welcomeKey) ?? 'null') as unknown,
  }), [WELCOME_KEY, PRODUCT_KEY] as const)
  expect(stored.welcome).toMatchObject({ autosave: { markdown: welcome }, manualCheckpoint: { markdown: welcome } })
  expect(stored.product).toMatchObject({ autosave: { markdown: product }, manualCheckpoint: null })
})

test('autosave failure remains visible and recoverable while exact in-memory Markdown survives retry and reload', async ({ page }) => {
  const markdown = '# In-memory authority\n\nRetry this exact revision.'
  await page.goto('/?autosaveFailure=once')
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  await useEnglishUi(page)
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill(markdown)

  await expect(page.locator('.status-region')).toContainText('Autosave failed', { timeout: 5_000 })
  const failure = page.locator('.workspace-error')
  await expect(failure).toContainText('AUTOSAVE_FAILED')
  await expect(failure).toContainText('Injected automatic recovery persistence failure.')
  await expect.poll(async () => (await authority(page))?.markdown).toBe(markdown)
  await expect(page.locator('.status-region')).toContainText('Manual checkpoint dirty')

  await failure.getByRole('button', { name: 'Retry' }).click()
  await expect(page.locator('.status-region')).toContainText('Autosave saved')
  await expect(failure).toHaveCount(0)
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  await expect.poll(async () => (await authority(page))?.markdown).toBe(markdown)
})

test('same-document tabs expose no conflict claim and the last successful persistence write is the next startup value', async ({ context, page }) => {
  const first = '# First tab write'
  const second = '# Second tab write wins'
  await openReadyApp(page)
  await useEnglishUi(page)
  const other = await context.newPage()
  await openReadyApp(other)
  await useEnglishUi(other)

  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill(first)
  await expect(page.locator('.status-region')).toContainText('Autosave saved', { timeout: 5_000 })
  await other.locator('[data-command-id="mode.source"]').click()
  await other.locator('#markdown-source-editor').fill(second)
  await expect(other.locator('.status-region')).toContainText('Autosave saved', { timeout: 5_000 })
  const conflictClaim = /\b(?:conflict|merge|lock(?:ed|ing)?)\b/iu
  await expect(page.getByText(conflictClaim)).toHaveCount(0)
  await expect(other.getByText(conflictClaim)).toHaveCount(0)

  const reopened = await context.newPage()
  await openReadyApp(reopened)
  await expect.poll(async () => (await authority(reopened))?.markdown).toBe(second)
})
