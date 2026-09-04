import { readFile } from 'node:fs/promises'

import type { Download, Page } from '@playwright/test'

import { mediaSource, mermaidSource } from '../src/codecs'
import { openReadyApp, useEnglishUi } from './fixtures/app'
import { expect, test } from './fixtures/test'

const WELCOME_KEY = 'w-editor:v1:document:welcome'

async function authority(page: Page) {
  return page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read())
}

async function expectAuthorityMarkdown(page: Page, markdown: string): Promise<void> {
  await expect.poll(async () => (await authority(page))?.markdown).toBe(markdown)
}

async function setSourceMarkdown(page: Page, markdown: string): Promise<void> {
  await useEnglishUi(page)
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill(markdown)
  await expectAuthorityMarkdown(page, markdown)
}

async function downloadedText(download: Download): Promise<string> {
  const path = await download.path()
  if (path === null) throw new Error(`Download ${download.suggestedFilename()} has no local path.`)
  return readFile(path, 'utf8')
}

async function expectVisualModeWithoutGlobalFailure(page: Page): Promise<void> {
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'visual')
  await expect(page.locator('.workspace-error')).toHaveCount(0)
  await expect(page.locator('.status-region')).toContainText('Visual mode')
  await expect(page.locator('.status-region')).not.toContainText('failed')
}

async function editVisualTail(page: Page, original: string, suffix: string): Promise<void> {
  const tail = page.locator('.ProseMirror p').filter({ hasText: original }).last()
  await tail.click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(suffix)
}

for (const failure of [
  {
    code: 'CODEC_THROW',
    message: 'Injected codec failure at the declared fixture marker.',
    modeFailure: 'visual-codec',
    source: '# Preserved codec source\n\n[[fixture:codec-throw]]',
  },
  {
    code: 'INVALID_TIPTAP_SCHEMA',
    message: 'Visual projection does not satisfy the active Tiptap schema.',
    modeFailure: 'visual-schema',
    source: '# Preserved invalid-schema source\n\nExact authority.',
  },
  {
    code: 'DECLARED_RESOURCE_LIMIT_EXCEEDED',
    message: 'Injected visual projection resource limit exceeded.',
    modeFailure: 'visual-resource',
    source: '# Preserved resource source\n\n[[fixture:resource-limit]]',
  },
] as const) {
  test(`${failure.code} during the real visual preflight preserves source mode and exact authority`, async ({ page }) => {
    await page.goto(`/?modeFailure=${failure.modeFailure}`)
    await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
    await setSourceMarkdown(page, failure.source)
    const before = await authority(page)
    const checkpointBefore = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null') as {
      preModeSwitch: unknown
    }, WELCOME_KEY)

    await page.locator('[data-command-id="mode.visual"]').click()

    await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'source')
    await expect(page.locator('#markdown-source-editor')).toBeVisible()
    expect(await authority(page)).toMatchObject({
      actionCount: before?.actionCount,
      documentId: before?.documentId,
      markdown: before?.markdown,
      mode: before?.mode,
      revision: before?.revision,
      autosaveStatus: 'saved',
      synchronizationStatus: 'failed',
    })
    const alert = page.locator('.workspace-error')
    await expect(alert).toContainText(failure.code)
    await expect(alert).toContainText(failure.message)
    await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible()
    await expect(alert.getByRole('button', { name: 'Open source' })).toBeVisible()
    await expect(alert.getByRole('button', { name: 'Export raw Markdown' })).toBeVisible()
    await expect(page.locator('[data-command-id="mode.visual"]')).toBeFocused()
    const checkpointAfter = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null') as {
      preModeSwitch: unknown
    }, WELCOME_KEY)
    expect(checkpointAfter.preModeSwitch).toEqual(checkpointBefore.preModeSwitch)

    if (failure.code === 'CODEC_THROW') {
      const pendingDownload = page.waitForEvent('download')
      await alert.getByRole('button', { name: 'Export raw Markdown' }).click()
      expect(await downloadedText(await pendingDownload)).toBe(failure.source)
    }
  })
}

test('unknown Markdown degrades to one raw node while the rest of visual mode stays editable', async ({ page }) => {
  const raw = '::: unknown-widget\nexact raw bytes  \n:::'
  const source = `${raw}\n\nEditable raw sibling`
  await openReadyApp(page)
  await setSourceMarkdown(page, source)
  await page.locator('[data-command-id="mode.visual"]').click()

  await expectVisualModeWithoutGlobalFailure(page)
  const rawNode = page.locator('[data-w-editor-node="raw-block"]')
  await expect(rawNode).toHaveCount(1)
  expect(await rawNode.locator('.raw-node__source').textContent()).toBe(raw)
  await editVisualTail(page, 'Editable raw sibling', ' remains editable')
  await expectAuthorityMarkdown(page, `${raw}\n\nEditable raw sibling remains editable`)
  await expect(rawNode).toHaveCount(1)
})

test('Retry performs a fresh Source-to-Visual schema hydrate after a recoverable first rejection', async ({ page }) => {
  const source = '# Retry schema hydrate\n\nExact authority remains available.'
  await page.goto('/?modeFailure=visual-schema-once')
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  await setSourceMarkdown(page, source)
  const before = await authority(page)

  await page.locator('[data-command-id="mode.visual"]').click()

  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'source')
  await expect(page.locator('.workspace-error')).toContainText('INVALID_TIPTAP_SCHEMA')
  expect(await authority(page)).toMatchObject({
    markdown: source,
    mode: 'source',
    revision: before?.revision,
    synchronizationStatus: 'failed',
  })

  await page.locator('.workspace-error').getByRole('button', { name: 'Retry' }).click()

  await expectVisualModeWithoutGlobalFailure(page)
  await expect(page.locator('.ProseMirror h1')).toContainText('Retry schema hydrate')
  expect(await authority(page)).toMatchObject({
    markdown: source,
    mode: 'visual',
    revision: before?.revision,
    synchronizationStatus: 'synchronized',
  })
})

test('a persistent acknowledgement hydrate failure keeps raw export and Source recovery available', async ({ page }) => {
  const source = 'Visual acknowledgement authority'
  await page.goto('/?modeFailure=visual-ack-schema')
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  await setSourceMarkdown(page, source)
  await page.locator('[data-command-id="mode.visual"]').click()
  await expectVisualModeWithoutGlobalFailure(page)

  const paragraph = page.locator('.ProseMirror p').filter({ hasText: source }).last()
  await paragraph.click()
  await page.keyboard.press('End')
  await page.keyboard.insertText('!')

  await expect(page.locator('.workspace-error')).toContainText('INVALID_TIPTAP_SCHEMA')
  await expectAuthorityMarkdown(page, `${source}!`)
  expect(await authority(page)).toMatchObject({
    mode: 'visual',
    synchronizationStatus: 'failed',
  })

  const pendingDownload = page.waitForEvent('download')
  await page.locator('.workspace-error').getByRole('button', { name: 'Export raw Markdown' }).click()
  expect(await downloadedText(await pendingDownload)).toBe(`${source}!`)
  await expect(page.locator('.workspace-error')).toContainText('INVALID_TIPTAP_SCHEMA')

  await page.locator('.workspace-error').getByRole('button', { name: 'Open source' }).click()

  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'source')
  await expect(page.locator('#markdown-source-editor')).toContainText(`${source}!`)
  await expect(page.locator('.workspace-error')).toHaveCount(0)
  expect(await authority(page)).toMatchObject({
    markdown: `${source}!`,
    mode: 'source',
    synchronizationStatus: 'synchronized',
  })
})

test('Retry re-accepts a committed Visual revision without committing the transaction twice', async ({ page }) => {
  const source = 'Retry visual acknowledgement'
  await page.goto('/?modeFailure=visual-ack-schema-once')
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  await setSourceMarkdown(page, source)
  await page.locator('[data-command-id="mode.visual"]').click()
  await expectVisualModeWithoutGlobalFailure(page)
  const before = await authority(page)

  const paragraph = page.locator('.ProseMirror p').filter({ hasText: source }).last()
  await paragraph.click()
  await page.keyboard.press('End')
  await page.keyboard.insertText('!')

  await expect(page.locator('.workspace-error')).toContainText('INVALID_TIPTAP_SCHEMA')
  await expectAuthorityMarkdown(page, `${source}!`)
  const rejected = await authority(page)
  expect(rejected?.revision).toBe((before?.revision ?? 0) + 1)
  expect(rejected?.synchronizationStatus).toBe('failed')

  await page.locator('.workspace-error').getByRole('button', { name: 'Retry' }).click()

  await expectVisualModeWithoutGlobalFailure(page)
  await expect(page.locator('.ProseMirror p')).toContainText(`${source}!`)
  const accepted = await authority(page)
  expect(accepted?.revision).toBe(rejected?.revision)
  expect(accepted?.markdown).toBe(`${source}!`)
  expect(accepted?.synchronizationStatus).toBe('synchronized')
})

test('invalid Mermaid remains a local semantic-node error while sibling content stays editable', async ({ page }) => {
  const mermaid = mermaidSource('not valid\n  preserved exactly')
  const source = `${mermaid}\n\nEditable Mermaid sibling`
  await openReadyApp(page)
  await setSourceMarkdown(page, source)
  await page.locator('[data-command-id="mode.visual"]').click()

  await expectVisualModeWithoutGlobalFailure(page)
  const node = page.locator('[data-semantic-kind="mermaid"]')
  await expect(node).toHaveAttribute('data-preview-state', 'error', { timeout: 10_000 })
  await expect(node.getByRole('alert')).toContainText('Mermaid preview failed:')
  await editVisualTail(page, 'Editable Mermaid sibling', ' remains editable')
  await expectAuthorityMarkdown(page, `${mermaid}\n\nEditable Mermaid sibling remains editable`)
  await expect(node).toHaveAttribute('data-preview-state', 'error')
})

test('media decode failure exposes its typed local fallback while sibling content stays editable', async ({ page }) => {
  const url = 'http://127.0.0.1:4173/fixtures/invalid-image.png'
  const media = mediaSource('image', 'Unavailable local image', url)
  const source = `${media}\n\nEditable media sibling`
  await page.route('**/fixtures/invalid-image.png', async (route) => {
    await route.fulfill({ body: 'not an image', contentType: 'image/png', status: 200 })
  })
  await openReadyApp(page)
  await setSourceMarkdown(page, source)
  await page.locator('[data-command-id="mode.visual"]').click()

  await expectVisualModeWithoutGlobalFailure(page)
  const node = page.locator('[data-semantic-kind="media"]')
  await expect(node).toHaveAttribute('data-preview-state', 'error')
  const fallback = node.locator('[data-media-fallback="image"]')
  await expect(fallback).toBeVisible()
  await expect(fallback).toContainText('Image preview unavailable')
  await expect(fallback).toContainText(url)
  await editVisualTail(page, 'Editable media sibling', ' remains editable')
  await expectAuthorityMarkdown(page, `${media}\n\nEditable media sibling remains editable`)
  await expect(node).toHaveAttribute('data-preview-state', 'error')
})
