import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'

import type { Page } from '@playwright/test'

import { openReadyApp, useEnglishUi } from './fixtures/app'
import { expect, test } from './fixtures/test'

const WORKSPACE_KEY = 'w-editor:v1:workspace'
const WELCOME_KEY = 'w-editor:v1:document:welcome'
const CATALOG = ['welcome', 'product-notes', 'formatting-gallery'] as const
const INITIAL_WELCOME = readFileSync(new URL('../apps/playground/src/content/articles/welcome.md', import.meta.url), 'utf8')
  .replace(/\r\n/gu, '\n')

interface StoredCheckpoint {
  readonly markdown: string
  readonly revision: number
  readonly savedAt: string
}

function workspaceEnvelope() {
  return {
    activeDocumentId: 'welcome',
    articlePanel: { collapsed: false, width: 252 },
    catalogDocumentIds: CATALOG,
    schemaVersion: 1,
  }
}

function documentEnvelope(
  markdown: string,
  revision: number,
  checkpoints: Readonly<{
    preDestructiveReplace?: StoredCheckpoint | null
    preModeSwitch?: StoredCheckpoint | null
  }> = {},
) {
  return {
    autosave: { markdown, revision, savedAt: '2026-08-22T06:00:00.000Z' },
    documentId: 'welcome',
    manualCheckpoint: null,
    preDestructiveReplace: checkpoints.preDestructiveReplace ?? null,
    preModeSwitch: checkpoints.preModeSwitch ?? null,
    schemaVersion: 1,
    status: { lastPersistenceFailure: null },
  }
}

async function seedWelcome(page: Page, envelope: ReturnType<typeof documentEnvelope>): Promise<void> {
  await page.addInitScript(([workspaceKey, documentKey, workspace, documentValue]) => {
    localStorage.setItem(workspaceKey, JSON.stringify(workspace))
    localStorage.setItem(documentKey, JSON.stringify(documentValue))
  }, [WORKSPACE_KEY, WELCOME_KEY, workspaceEnvelope(), envelope] as const)
}

async function authority(page: Page) {
  return page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read())
}

async function storedWelcome(page: Page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null') as ReturnType<typeof documentEnvelope>, WELCOME_KEY)
}

async function confirmLifecycle(page: Page, kind: string): Promise<void> {
  const dialog = page.getByTestId('document-lifecycle-confirmation')
  await expect(dialog).toHaveAttribute('data-confirmation-kind', kind)
  await dialog.getByTestId('document-lifecycle-confirm').click()
  await expect(dialog).toHaveCount(0)
}

test('Markdown import cancellation, unreadable input, and confirmation preserve the documented boundaries', async ({ page }) => {
  const before = '# Before import\n\nKeep this exact source.'
  const imported = '# Imported Markdown\n\nExact UTF-8 input.\n'
  await openReadyApp(page)
  await useEnglishUi(page)
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill(before)
  await expect(page.locator('.status-region')).toContainText('Autosave saved', { timeout: 5_000 })
  const beforeAuthority = await authority(page)
  const beforeEnvelope = await storedWelcome(page)

  const input = page.getByTestId('import-markdown-input')
  await input.setInputFiles({ buffer: Buffer.from('# Cancelled candidate'), mimeType: 'text/markdown', name: 'cancelled.md' })
  const cancellation = page.getByTestId('document-lifecycle-confirmation')
  await expect(cancellation).toHaveAttribute('data-confirmation-kind', 'import')
  await cancellation.getByTestId('document-lifecycle-cancel').click()
  await expect(cancellation).toHaveCount(0)
  expect(await authority(page)).toEqual(beforeAuthority)
  expect(await storedWelcome(page)).toMatchObject({
    autosave: { markdown: before },
    preDestructiveReplace: null,
    preModeSwitch: beforeEnvelope.preModeSwitch,
  })
  const envelopeBeforeUnreadable = await storedWelcome(page)

  await input.setInputFiles({ buffer: Buffer.from([0xff, 0xfe, 0x00]), mimeType: 'text/markdown', name: 'unreadable.md' })
  await expect(page.getByTestId('document-lifecycle-error')).toContainText('not readable UTF-8 Markdown')
  await expect(page.getByTestId('document-lifecycle-confirmation')).toHaveCount(0)
  expect(await authority(page)).toEqual(beforeAuthority)
  expect(await storedWelcome(page)).toEqual(envelopeBeforeUnreadable)

  await page.locator('[data-command-id="history.undo"]').click()
  await expect.poll(async () => (await authority(page))?.markdown).toBe(INITIAL_WELCOME)
  await page.locator('[data-command-id="history.redo"]').click()
  await expect.poll(async () => (await authority(page))?.markdown).toBe(before)
  const preConfirmedAuthority = await authority(page)
  const preConfirmedEnvelope = await storedWelcome(page)

  await input.setInputFiles({ buffer: Buffer.from(imported), mimeType: 'text/markdown', name: 'imported.md' })
  await confirmLifecycle(page, 'import')
  await expect.poll(async () => authority(page)).toMatchObject({
    markdown: imported,
    revision: (preConfirmedAuthority?.revision ?? 0) + 1,
  })
  await expect(page.locator('.status-region')).toContainText('Autosave saved')
  expect(await storedWelcome(page)).toMatchObject({
    autosave: { markdown: imported, revision: (preConfirmedAuthority?.revision ?? 0) + 1 },
    preDestructiveReplace: { markdown: before, revision: preConfirmedAuthority?.revision },
    preModeSwitch: preConfirmedEnvelope.preModeSwitch,
  })
})

test('later destructive replacement overwrites only its own checkpoint boundary', async ({ page }) => {
  const protectedMode = '# Mode boundary\n\nMust remain independent.'
  const firstReplacement = '# First destructive replacement'
  await openReadyApp(page)
  await useEnglishUi(page)
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill(protectedMode)
  await expect(page.locator('.status-region')).toContainText('Autosave saved', { timeout: 5_000 })
  const protectedRevision = (await authority(page))?.revision

  await page.locator('[data-command-id="mode.visual"]').click()
  await expect.poll(async () => (await authority(page))?.mode).toBe('visual')
  await page.getByTestId('import-markdown-input').setInputFiles({
    buffer: Buffer.from(firstReplacement),
    mimeType: 'text/markdown',
    name: 'first.md',
  })
  await confirmLifecycle(page, 'import')
  await expect.poll(async () => (await authority(page))?.markdown).toBe(firstReplacement)
  const firstEnvelope = await storedWelcome(page)
  expect(firstEnvelope.preModeSwitch).toMatchObject({ markdown: protectedMode, revision: protectedRevision })
  expect(firstEnvelope.preDestructiveReplace).toMatchObject({ markdown: protectedMode, revision: protectedRevision })

  await page.getByTestId('import-markdown-input').setInputFiles({
    buffer: Buffer.from('# Second destructive replacement'),
    mimeType: 'text/markdown',
    name: 'second.md',
  })
  await confirmLifecycle(page, 'import')
  await expect(page.locator('.status-region')).toContainText('Autosave saved')
  const secondEnvelope = await storedWelcome(page)
  expect(secondEnvelope.preModeSwitch).toEqual(firstEnvelope.preModeSwitch)
  expect(secondEnvelope.preDestructiveReplace).toMatchObject({
    markdown: firstReplacement,
    revision: firstEnvelope.autosave.revision,
  })
})

test('daily Library surface does not expose destructive or checkpoint controls', async ({ page }) => {
  const current = '# Current source content'
  const checkpoint = '# Protected mode checkpoint'
  await seedWelcome(page, documentEnvelope(current, 10, {
    preModeSwitch: { markdown: checkpoint, revision: 6, savedAt: '2026-08-22T05:00:00.000Z' },
  }))
  await openReadyApp(page)
  await useEnglishUi(page)

  const library = page.locator('.article-panel')
  await expect(library.getByTestId('clear-document')).toHaveCount(0)
  await expect(library.getByTestId('reset-document')).toHaveCount(0)
  await expect(library.getByTestId('restore-pre-mode-switch')).toHaveCount(0)
  await expect(library.getByTestId('restore-pre-destructive-replace')).toHaveCount(0)
  expect((await storedWelcome(page)).preModeSwitch).toMatchObject({ markdown: checkpoint, revision: 6 })
  expect((await authority(page))?.markdown).toBe(current)
})

test('checkpoint data remains durable without daily Library restore buttons', async ({ page }) => {
  const current = '# Current visual content\n\nUndo must recover this.'
  const checkpoint = '# Protected replacement checkpoint\n\nRestore through Tiptap.'
  await seedWelcome(page, documentEnvelope(current, 10, {
    preDestructiveReplace: { markdown: checkpoint, revision: 5, savedAt: '2026-08-22T04:00:00.000Z' },
  }))
  await openReadyApp(page)
  await useEnglishUi(page)
  const library = page.locator('.article-panel')
  await expect(library.getByTestId('clear-document')).toHaveCount(0)
  await expect(library.getByTestId('reset-document')).toHaveCount(0)
  await expect(library.getByTestId('restore-pre-mode-switch')).toHaveCount(0)
  await expect(library.getByTestId('restore-pre-destructive-replace')).toHaveCount(0)
  expect((await storedWelcome(page)).preDestructiveReplace).toMatchObject({ markdown: checkpoint, revision: 5 })
  expect((await authority(page))?.markdown).toBe(current)
})
