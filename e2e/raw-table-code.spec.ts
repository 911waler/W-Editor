import type { Locator, Page } from '@playwright/test'

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

async function expectSafeCherryDom(page: Page): Promise<void> {
  await expect(page.locator('.preview-rendered-content script, .preview-rendered-content [onclick], .preview-rendered-content [onerror]'))
    .toHaveCount(0)
}

test('raw nodes edit exact source, retain unknown replacements, and promote recognized replacements', async ({ page }) => {
  const original = '::: mystery\nbody\n:::'
  const stillUnknown = '::: another-unknown\nbody  \n:::'
  const recognized = '::: info Information\nAdd supporting information here.\n:::'
  await openReadyApp(page)
  await useEnglishUi(page)
  await setSourceMarkdown(page, original)
  await page.locator('[data-command-id="mode.visual"]').click()

  const raw = page.locator('[data-w-editor-node="raw-block"]')
  await expect(raw).toHaveCount(1)
  expect(await raw.locator('.raw-node__source').textContent()).toBe(original)
  await raw.getByRole('button', { name: 'Edit unknown block source' }).click()
  const dialog = page.locator('[data-editor-command="raw.source"]')
  const rawEditor = dialog.locator('.cm-content[contenteditable="true"]')
  await expect(dialog).toBeVisible()
  expect(await codeMirrorSource(rawEditor)).toBe(original)
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
  await expectAuthorityMarkdown(page, original)

  await raw.getByRole('button', { name: 'Edit unknown block source' }).click()
  await replaceCodeMirrorSource(page, dialog.locator('.cm-content[contenteditable="true"]'), stillUnknown)
  await dialog.getByRole('button', { name: 'Apply' }).click()
  await expect(dialog).toHaveCount(0)
  await expectAuthorityMarkdown(page, stillUnknown)
  expect(await raw.locator('.raw-node__source').textContent()).toBe(stillUnknown)

  await raw.getByRole('button', { name: 'Edit unknown block source' }).click()
  await replaceCodeMirrorSource(page, dialog.locator('.cm-content[contenteditable="true"]'), recognized)
  await dialog.getByRole('button', { name: 'Apply' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(raw).toHaveCount(0)
  await expect(page.locator('[data-semantic-kind="panel"]')).toContainText('Information')
  await expectAuthorityMarkdown(page, recognized)

  await page.locator('[data-command-id="history.undo"]').click()
  await expectAuthorityMarkdown(page, stillUnknown)
  await expect(raw).toHaveCount(1)
  await page.locator('[data-command-id="history.redo"]').click()
  await expectAuthorityMarkdown(page, recognized)
  await expect(page.locator('[data-semantic-kind="panel"]')).toHaveCount(1)

  await page.locator('[data-command-id="mode.preview"]').click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'preview')
  await expect(page.locator('.preview-rendered-content [data-semantic-kind="panel"][data-semantic-variant="info"]')).toContainText('Information')
  await expectSafeCherryDom(page)
  await expect.poll(() => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().autosaveStatus)).toBe('saved')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  await expectAuthorityMarkdown(page, recognized)
  await page.locator('[data-command-id="mode.visual"]').click()
  await expect(page.locator('[data-semantic-kind="panel"]')).toContainText('Information')
})

test('ordinary tables direct-edit cells, mutate structure, align columns, persist, and render in read-only Preview', async ({ page }) => {
  const originalTable = '| Name | Score |\n| :--- | :---: |\n| Ada | 99 |'
  const editedTable = '| Name | Score |\n| :--- | :---: |\n| Ada | Perfect 99 |'
  const alignedTable = '| Name | Score |\n| :--- | ---: |\n| Ada | Perfect 99 |'
  const withRow = `${alignedTable}\n|  |  |`
  await openReadyApp(page)
  await useEnglishUi(page)
  await setSourceMarkdown(page, originalTable)
  await page.locator('[data-command-id="mode.visual"]').click()

  const table = page.locator('[data-w-editor-node="ordinary-table"]')
  await expect(table.locator('tbody tr')).toHaveCount(2)
  const score = table.locator('tbody tr').nth(1).locator('td').nth(1)
  await score.click()
  await page.keyboard.press('Home')
  await page.keyboard.type('Perfect ')
  await expectAuthorityMarkdown(page, editedTable)

  await score.click()
  await table.locator('[data-table-handle="column"]').click()
  await table.getByRole('menu', { name: /^Column \d+ actions$/u })
    .getByRole('menuitem', { name: 'Align column right', exact: true })
    .click()
  await expectAuthorityMarkdown(page, alignedTable)
  await score.click()
  await table.locator('[data-table-handle="row"]').click()
  await table.getByRole('menu', { name: /^Row \d+ actions$/u })
    .getByRole('menuitem', { name: 'Add row after', exact: true })
    .click()
  await expect(table.locator('tbody tr')).toHaveCount(3)
  await expectAuthorityMarkdown(page, withRow)

  await page.locator('[data-command-id="history.undo"]').click()
  await expectAuthorityMarkdown(page, alignedTable)
  await expect(table.locator('tbody tr')).toHaveCount(2)
  await page.locator('[data-command-id="history.redo"]').click()
  await expectAuthorityMarkdown(page, withRow)

  await page.locator('[data-command-id="mode.preview"]').click()
  const previewTable = page.locator('.preview-rendered-content table')
  await expect(previewTable).toHaveCount(1)
  await expect(previewTable).toContainText('Perfect 99')
  await expect(previewTable.locator('tbody tr').nth(1).locator('td').nth(1)).toHaveCSS('text-align', 'right')
  await expectSafeCherryDom(page)
  await expect.poll(() => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().autosaveStatus)).toBe('saved')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  await expectAuthorityMarkdown(page, withRow)
  await page.locator('[data-command-id="mode.source"]').click()
  await expect(page.locator('#markdown-source-editor')).toBeVisible()
})

test('code blocks stay directly editable, copy through the clipboard, use optional advanced editing, undo once, persist, and preview', async ({ context, page }) => {
  const original = '```javascript\nconst answer = 42\n```'
  const code = 'const fence = ````\nconsole.log(fence)'
  const modified = `\`\`\`\`\`typescript\n${code}\n\`\`\`\`\``
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openReadyApp(page)
  await useEnglishUi(page)
  await setSourceMarkdown(page, original)
  await page.locator('[data-command-id="mode.visual"]').click()

  const codeNode = page.locator('[data-w-editor-node="code-block"]')
  await expect(codeNode).toHaveCount(1)
  await expect(codeNode.locator('code')).toHaveText('const answer = 42')
  await expect(codeNode.locator('.cm-editor')).toHaveCount(0)
  await codeNode.getByRole('button', { name: 'Copy code' }).click()
  await expect(page.locator('.status-region__command')).toHaveText('Code copied.')
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('const answer = 42')

  await codeNode.getByRole('button', { name: 'Advanced code editor' }).click()
  const dialog = page.locator('[data-editor-command="insert.code-block"]')
  await expect(dialog.locator('.cm-editor')).toHaveCount(1)
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
  await expectAuthorityMarkdown(page, original)

  await codeNode.getByRole('button', { name: 'Advanced code editor' }).click()
  await dialog.getByLabel('Language').selectOption('typescript')
  await replaceCodeMirrorSource(page, dialog.locator('.cm-content[contenteditable="true"]'), code)
  await dialog.getByRole('button', { name: 'Apply' }).click()
  await expect(dialog).toHaveCount(0)
  await expectAuthorityMarkdown(page, modified)
  await expect(codeNode.getByRole('combobox', { name: 'Change language' })).toHaveValue('typescript')
  await expect(codeNode.locator('code')).toHaveClass(/language-typescript/u)
  await expect(codeNode.locator('code')).toHaveText(code)

  await page.locator('[data-command-id="history.undo"]').click()
  await expectAuthorityMarkdown(page, original)
  await page.locator('[data-command-id="history.redo"]').click()
  await expectAuthorityMarkdown(page, modified)

  await page.locator('[data-command-id="mode.preview"]').click()
  await expect(page.locator('.preview-rendered-content code.language-typescript')).toContainText('console')
  await expectSafeCherryDom(page)
  await expect.poll(() => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().autosaveStatus)).toBe('saved')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  await expectAuthorityMarkdown(page, modified)
  await page.locator('[data-command-id="mode.source"]').click()
  await expect(page.locator('#markdown-source-editor')).toBeVisible()
})
