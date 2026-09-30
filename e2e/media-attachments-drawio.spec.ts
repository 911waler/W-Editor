import type { FrameLocator, Page } from '@playwright/test'

import { attachmentSource, drawioSource, mediaSource, type AttachmentKind, type MediaKind } from '../src/codecs'
import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

type AssetCase = Readonly<{
  readonly fixture: string
  kind: AttachmentKind | MediaKind
  mediaType: string
  semanticKind: 'attachment' | 'media'
}>

const ASSET_CASES: readonly AssetCase[] = Object.freeze([
  Object.freeze({ fixture: 'sample-image.png', kind: 'image', mediaType: 'image/*', semanticKind: 'media' }),
  Object.freeze({ fixture: 'sample-audio.wav', kind: 'audio', mediaType: 'audio/*', semanticKind: 'media' }),
  Object.freeze({ fixture: 'sample-video.mp4', kind: 'video', mediaType: 'video/*', semanticKind: 'media' }),
  Object.freeze({ fixture: 'sample.pdf', kind: 'pdf', mediaType: 'application/pdf', semanticKind: 'attachment' }),
  Object.freeze({ fixture: 'sample.docx', kind: 'word', mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', semanticKind: 'attachment' }),
  Object.freeze({ fixture: 'sample.pdf', kind: 'file', mediaType: 'application/octet-stream', semanticKind: 'attachment' }),
])

async function authorityMarkdown(page: Page): Promise<string | undefined> {
  return page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().markdown)
}

async function expectAuthorityMarkdown(page: Page, markdown: string): Promise<void> {
  await expect.poll(() => authorityMarkdown(page)).toBe(markdown)
  await expect.poll(() => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().synchronizationStatus)).toBe('synchronized')
}

async function setSourceMarkdown(page: Page, markdown: string): Promise<void> {
  if (await page.getByTestId('editor-surface').getAttribute('data-mode') !== 'source') {
    await page.locator('[data-command-id="mode.source"]').click()
    await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'source')
  }
  await page.locator('#markdown-source-editor').fill(markdown)
  await expectAuthorityMarkdown(page, markdown)
}

async function openInsertCommand(page: Page, commandId: string): Promise<void> {
  await page.locator('[data-toolbar-menu="insert"] .toolbar-menu__trigger').click()
  await page.locator(`[data-command-id="${commandId}"]`).click()
}

async function expectSafeCherryDom(page: Page): Promise<void> {
  await expect(page.locator('.preview-rendered-content script, .preview-rendered-content [onclick], .preview-rendered-content [onerror]'))
    .toHaveCount(0)
}

function assetSource(asset: AssetCase, name: string, url: string): string {
  return asset.semanticKind === 'media'
    ? mediaSource(asset.kind as MediaKind, name, url)
    : attachmentSource({
        kind: asset.kind as AttachmentKind,
        mediaType: asset.mediaType,
        name,
        size: 0,
        url,
      })
}

for (const asset of ASSET_CASES) {
  test(`insert.${asset.kind} cancels, applies, edits, previews, reloads, and undoes through visible UI`, async ({ page }) => {
    const commandId = `insert.${asset.kind}`
    const initialName = `Initial ${asset.kind}`
    const updatedName = `Updated ${asset.kind}`
    const initialUrl = `http://127.0.0.1:4173/${asset.fixture}?state=initial`
    const updatedUrl = `http://127.0.0.1:4173/${asset.fixture}?state=updated`
    const initial = assetSource(asset, initialName, initialUrl)
    const updated = assetSource(asset, updatedName, updatedUrl)
    await openReadyApp(page)
    await setSourceMarkdown(page, '')

    await openInsertCommand(page, commandId)
    let dialog = page.locator(`[data-editor-command="${commandId}"]`)
    await expect(dialog).toBeVisible()
    await dialog.locator('.dialog-panel__actions button').first().click()
    await expect(dialog).toHaveCount(0)
    await expectAuthorityMarkdown(page, '')

    await openInsertCommand(page, commandId)
    dialog = page.locator(`[data-editor-command="${commandId}"]`)
    await dialog.locator(`#media-name-${asset.kind}`).fill(initialName)
    await dialog.locator(`#media-url-${asset.kind}`).fill(initialUrl)
    await dialog.locator('.dialog-panel__actions .primary-action').click()
    await expect(dialog).toHaveCount(0)
    await expectAuthorityMarkdown(page, initial)

    await page.locator('[data-command-id="mode.visual"]').click()
    const node = page.locator(`[data-semantic-kind="${asset.semanticKind}"]`)
    await expect(node).toHaveCount(1)
    if (asset.kind === 'image') await node.locator('img[src]').click()
    await node.locator(`[data-semantic-edit="${asset.semanticKind === 'media' ? 'media-editor' : 'attachment-editor'}"]`).click()
    dialog = page.locator(`[data-editor-command="${commandId}"]`)
    await expect(dialog.locator(`#media-name-${asset.kind}`)).toHaveValue(initialName)
    await expect(dialog.locator(`#media-url-${asset.kind}`)).toHaveValue(initialUrl)
    await dialog.locator(`#media-name-${asset.kind}`).fill(updatedName)
    await dialog.locator(`#media-url-${asset.kind}`).fill(updatedUrl)
    await dialog.locator('.dialog-panel__actions .primary-action').click()
    await expectAuthorityMarkdown(page, updated)

    await page.locator('[data-command-id="history.undo"]').click()
    await expectAuthorityMarkdown(page, initial)
    await page.locator('[data-command-id="history.redo"]').click()
    await expectAuthorityMarkdown(page, updated)

    await page.locator('[data-command-id="mode.preview"]').click()
    const preview = asset.semanticKind === 'media'
      ? page.locator(`.preview-rendered-content ${asset.kind === 'image' ? 'img[src]' : asset.kind}`)
      : page.locator('.preview-rendered-content a')
    await expect(preview).toHaveAttribute(asset.semanticKind === 'media' ? 'src' : 'href', updatedUrl)
    if (asset.semanticKind === 'attachment') await expect(preview).toContainText(updatedName)
    await expectSafeCherryDom(page)
    await expect.poll(() => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().autosaveStatus)).toBe('saved')

    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
    await expectAuthorityMarkdown(page, updated)
    await page.locator('[data-command-id="mode.preview"]').click()
    await expect(preview).toHaveAttribute(asset.semanticKind === 'media' ? 'src' : 'href', updatedUrl)
    await expectSafeCherryDom(page)
  })
}

function nestedDrawio(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="drawio-bridge-frame"]').frameLocator('#drawio-editor')
}

async function openReadyDrawio(page: Page): Promise<FrameLocator> {
  await openInsertCommand(page, 'insert.drawio')
  const editor = nestedDrawio(page)
  await expect(editor.getByTestId('fake-drawio-status')).toHaveText('Ready')
  return editor
}

test('draw.io rejects hostile messages and supports cancel, apply, edit, preview, reload, and one-step undo', async ({ page }) => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'
  const initialGraph = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="initial" value="Initial" vertex="1" parent="1"/></root></mxGraphModel>'
  const updatedGraph = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="updated" value="Updated" vertex="1" parent="1"/></root></mxGraphModel>'
  const initialXml = `<mxfile host="W-Editor"><diagram id="page-1" name="Page-1">${initialGraph}</diagram></mxfile>`
  const updatedXml = `<mxfile host="W-Editor"><diagram id="page-1" name="Page-1">${updatedGraph}</diagram></mxfile>`
  const initial = drawioSource('draw.io diagram', png, initialXml)
  const updated = drawioSource('draw.io diagram', png, updatedXml)
  await openReadyApp(page)
  await setSourceMarkdown(page, '')

  await openReadyDrawio(page)
  await page.locator('[data-editor-command="insert.drawio"] .drawio-dialog__actions button').first().click()
  await expect(page.locator('[data-editor-command="insert.drawio"]')).toHaveCount(0)
  await expectAuthorityMarkdown(page, '')

  let editor = await openReadyDrawio(page)
  await editor.locator('body').evaluate(() => {
    window.top?.postMessage({
      png: 'data:image/png;base64,AAAA',
      requestId: 'nested-hostile-source',
      type: 'w-editor:drawio:save',
      xml: '<mxfile><diagram id="hostile"/></mxfile>',
    }, location.origin)
  })
  await page.frameLocator('[data-testid="drawio-bridge-frame"]').locator('body').evaluate(() => {
    parent.postMessage({
      png: 'data:image/png;base64,AAAA',
      requestId: 'wrong-request-id',
      type: 'w-editor:drawio:save',
      xml: '<mxfile><diagram id="hostile"/></mxfile>',
    }, location.origin)
  })
  await expect(page.locator('[data-editor-command="insert.drawio"]')).toBeVisible()
  await expectAuthorityMarkdown(page, '')

  await editor.getByLabel('Fake draw.io XML').fill(initialXml)
  await page.getByTestId('drawio-apply').click()
  await expect(page.locator('[data-editor-command="insert.drawio"]')).toHaveCount(0)
  await expectAuthorityMarkdown(page, initial)

  await page.locator('[data-command-id="mode.visual"]').click()
  const node = page.locator('[data-semantic-kind="drawio"]')
  await expect(node.locator('img')).toHaveAttribute('src', png)
  await node.locator('[data-semantic-edit="drawio-editor"]').click()
  editor = nestedDrawio(page)
  await expect(editor.getByTestId('fake-drawio-status')).toHaveText('Ready')
  await expect(editor.getByLabel('Fake draw.io XML')).toHaveValue(initialXml)
  await editor.getByLabel('Fake draw.io XML').fill(updatedXml)
  await page.getByTestId('drawio-apply').click()
  await expectAuthorityMarkdown(page, updated)

  await page.locator('[data-command-id="history.undo"]').click()
  await expectAuthorityMarkdown(page, initial)
  await page.locator('[data-command-id="history.redo"]').click()
  await expectAuthorityMarkdown(page, updated)

  await page.locator('[data-command-id="mode.preview"]').click()
  const preview = page.locator('.preview-rendered-content [data-semantic-kind="drawio"] img')
  await expect(preview).toHaveAttribute('src', png)
  await expectSafeCherryDom(page)
  await expect.poll(() => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().autosaveStatus)).toBe('saved')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  await expectAuthorityMarkdown(page, updated)
  await page.locator('[data-command-id="mode.visual"]').click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'visual')
  await expect(node).toHaveCount(1)
  await expect(node.locator('img')).toHaveAttribute('src', png)
})

test('draw.io resource failure is actionable and does not change the Markdown authority', async ({ page }) => {
  await openReadyApp(page)
  await setSourceMarkdown(page, 'before')
  await expect(page.getByTestId('drawio-bridge-frame')).toHaveCount(0)
  await page.route('**/drawio-bridge.html**', async (route) => route.fulfill({
    body: '<!doctype html><title>bridge resource unavailable</title>',
    contentType: 'text/html',
    status: 200,
  }))

  await openInsertCommand(page, 'insert.drawio')
  await expect(page.getByTestId('drawio-resource-error')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('drawio-resource-error')).toContainText(/resources|资源|Ресурсы/u)
  await expectAuthorityMarkdown(page, 'before')

  await page.locator('[data-editor-command="insert.drawio"] .drawio-dialog__actions button').first().click()
  await expect(page.locator('[data-editor-command="insert.drawio"]')).toHaveCount(0)
  await expectAuthorityMarkdown(page, 'before')
  await page.unroute('**/drawio-bridge.html**')
})

test('an existing draw.io PNG remains visible without initializing the editor runtime', async ({ page }) => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'
  const source = drawioSource('Existing diagram', png, '<mxfile><diagram id="existing"/></mxfile>')
  await openReadyApp(page)
  await setSourceMarkdown(page, source)
  await page.locator('[data-command-id="mode.preview"]').click()

  await expect(page.locator('.preview-rendered-content [data-semantic-kind="drawio"] img')).toHaveAttribute('src', png)
  await expect(page.getByTestId('drawio-bridge-frame')).toHaveCount(0)
  await expectAuthorityMarkdown(page, source)
})
