import type { Locator, Page } from '@playwright/test'

import {
  MERMAID_DESCRIPTORS,
  mermaidSource,
  mermaidStarterSource,
  parseMermaidAt,
} from '../src/codecs'
import { openReadyApp, useEnglishUi } from './fixtures/app'
import { expect, test } from './fixtures/test'

async function authorityMarkdown(page: Page): Promise<string | undefined> {
  return page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().markdown)
}

async function expectAuthorityMarkdown(page: Page, markdown: string): Promise<void> {
  await expect.poll(() => authorityMarkdown(page)).toBe(markdown)
  await expect.poll(() => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().synchronizationStatus)).toBe('synchronized')
}

async function setSourceMarkdown(page: Page, markdown: string): Promise<void> {
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill(markdown)
  await expectAuthorityMarkdown(page, markdown)
}

async function codeMirrorSource(editor: Locator): Promise<string> {
  return editor.locator('.cm-line').evaluateAll((lines) => lines.map((line) => line.textContent ?? '').join('\n'))
}

async function replaceCodeMirrorSource(page: Page, editor: Locator, source: string): Promise<void> {
  await editor.click()
  await page.keyboard.press('Control+A')
  const lines = source.split('\n')
  for (const [index, line] of lines.entries()) {
    await page.keyboard.insertText(line)
    if (index < lines.length - 1) await page.keyboard.press('Enter')
  }
  await expect.poll(() => codeMirrorSource(editor)).toBe(source)
}

async function insertCodeMirrorSecondLine(page: Page, editor: Locator, line: string, expected: string): Promise<void> {
  await editor.click()
  await page.keyboard.press('Control+Home')
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.insertText(line)
  await expect.poll(() => codeMirrorSource(editor)).toBe(expected)
}

for (const descriptor of MERMAID_DESCRIPTORS) {
  test(`${descriptor.commandId} inserts, edits, navigates, persists, and reaches final preview`, async ({ page }) => {
    const starter = mermaidStarterSource(descriptor.commandId)
    const parsed = parseMermaidAt(starter, 0)
    if (parsed === null) throw new Error(`Invalid test starter for ${descriptor.commandId}.`)
    const [firstLine, ...remainingLines] = parsed.code.split('\n')
    const updatedCode = [firstLine, `%% exact update for ${descriptor.diagramType}`, ...remainingLines].join('\n')
    const updated = mermaidSource(updatedCode)
    const insertedDocument = `Anchor\n\n${starter}`
    const updatedDocument = `Anchor\n\n${updated}`
    await openReadyApp(page)
    await useEnglishUi(page)
    await setSourceMarkdown(page, 'Anchor')
    await page.locator('[data-command-id="mode.visual"]').click()

    await page.locator('[data-toolbar-menu="mermaid"] .toolbar-menu__trigger').click()
    await page.locator(`[data-command-id="${descriptor.commandId}"]`).click()
    await expectAuthorityMarkdown(page, insertedDocument)
    const node = page.locator(`[data-semantic-kind="mermaid"][data-mermaid-type="${descriptor.diagramType}"]`)
    await expect(node).toHaveCount(1)
    await expect(node).toHaveAttribute('data-preview-state', 'ready', { timeout: 10_000 })
    await expect(node.locator('.semantic-preview__mermaid-rendered svg')).toHaveCount(1)

    await node.click({ position: { x: 8, y: 8 } })
    await page.keyboard.press('ArrowLeft')
    await expect(node).toHaveAttribute('data-selected', 'false')
    await node.getByRole('button', { name: /Edit .*Mermaid/ }).click()
    const dialog = page.locator('[data-editor-command="mermaid.source"]')
    const editor = dialog.locator('.cm-content[contenteditable="true"]')
    await expect(dialog).toBeVisible()
    expect(await codeMirrorSource(editor)).toBe(parsed.code)
    await insertCodeMirrorSecondLine(page, editor, `%% exact update for ${descriptor.diagramType}`, updatedCode)
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
    await expectAuthorityMarkdown(page, insertedDocument)

    await node.getByRole('button', { name: /Edit .*Mermaid/ }).click()
    await insertCodeMirrorSecondLine(page, dialog.locator('.cm-content[contenteditable="true"]'), `%% exact update for ${descriptor.diagramType}`, updatedCode)
    await dialog.getByRole('button', { name: 'Apply' }).click()
    await expect(dialog).toHaveCount(0)
    await expectAuthorityMarkdown(page, updatedDocument)
    await expect(node).toHaveAttribute('data-preview-state', 'ready', { timeout: 10_000 })
    await expect(node.locator('.semantic-preview__mermaid-rendered svg')).toHaveCount(1)

    await page.locator('[data-command-id="history.undo"]').click()
    await expectAuthorityMarkdown(page, insertedDocument)
    await page.locator('[data-command-id="history.redo"]').click()
    await expectAuthorityMarkdown(page, updatedDocument)

    await page.locator('[data-command-id="mode.preview"]').click()
    const finalPreview = page.locator(`.preview-rendered-content [data-semantic-kind="mermaid"][data-mermaid-type="${descriptor.diagramType}"]`)
    await expect(finalPreview).toHaveCount(1)
    await expect(finalPreview).toHaveAttribute('data-preview-state', 'ready')
    await expect(finalPreview.locator('.semantic-preview__mermaid-rendered svg')).toBeVisible()
    await expect(page.locator('.preview-rendered-content script, .preview-rendered-content [onclick], .preview-rendered-content [onerror]'))
      .toHaveCount(0)
    await expect.poll(() => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().autosaveStatus)).toBe('saved')

    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
    await expectAuthorityMarkdown(page, updatedDocument)
    await page.locator('[data-command-id="mode.visual"]').click()
    await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'visual')
    await expect(node).toHaveCount(1)
    await expect(node).toHaveAttribute('data-preview-state', 'ready', { timeout: 10_000 })
    await expect(node.locator('.semantic-preview__mermaid-rendered svg')).toHaveCount(1)
  })
}

test('invalid Mermaid rendering remains local while exact source stays editable and previewable', async ({ page }) => {
  const imported = mermaidSource('not valid\n  imported exactly')
  const applied = mermaidSource('still not valid\n  applied exactly')
  await openReadyApp(page)
  await useEnglishUi(page)
  await setSourceMarkdown(page, imported)
  await page.locator('[data-command-id="mode.visual"]').click()

  const node = page.locator('[data-semantic-kind="mermaid"]')
  await expect(node).toHaveCount(1)
  await expect(node).toHaveAttribute('data-preview-state', 'error', { timeout: 10_000 })
  await expect(node.getByRole('alert')).toContainText('Mermaid preview failed:')
  await node.hover()
  await node.click()
  await node.locator('[data-semantic-edit]').click()
  const dialog = page.locator('[data-editor-command="mermaid.source"]')
  const editor = dialog.locator('.cm-content[contenteditable="true"]')
  expect(await codeMirrorSource(editor)).toBe('not valid\n  imported exactly')
  await replaceCodeMirrorSource(page, editor, 'still not valid\n  applied exactly')
  await dialog.getByRole('button', { name: 'Apply' }).click()
  await expectAuthorityMarkdown(page, applied)
  await expect(node).toHaveAttribute('data-preview-state', 'error', { timeout: 10_000 })
  await expect(node.getByRole('alert')).toContainText('Mermaid preview failed:')

  await page.locator('[data-command-id="mode.preview"]').click()
  const finalPreview = page.locator('.preview-rendered-content [data-semantic-kind="mermaid"]')
  await expect(finalPreview).toHaveAttribute('data-preview-state', 'error')
  await expect(finalPreview.getByRole('alert')).toContainText('Mermaid preview failed:')
  await expectAuthorityMarkdown(page, applied)
})
