import { readFile } from 'node:fs/promises'

import type { Download, Locator, Page } from '@playwright/test'

import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

interface AuthorityState {
  readonly autosaveStatus: string
  readonly markdown: string
  readonly revision: number
  readonly synchronizationStatus: string
}

const ORIGINAL = 'Before\n\n```javascript\nconst first = 1\nconst second = 2\n```\n\nAfter'
const SELECTED_EDITED = 'Before\n\n```javascript\nconst answer = 1\nconst second = 2\n```\n\nAfter'
const DIRECT_CODE = 'const answer = 1\nconst second = 2\nconst fence = "```"'
const DIRECT_EDITED = `Before\n\n\`\`\`\`typescript\n${DIRECT_CODE}\n\`\`\`\`\n\nAfter`

async function authority(page: Page): Promise<AuthorityState> {
  const snapshot = await page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read())
  if (snapshot === undefined) throw new Error('The E2E authority inspection seam is unavailable.')
  return snapshot
}

async function expectAuthority(page: Page, markdown: string, revision?: number): Promise<void> {
  await expect.poll(() => authority(page)).toMatchObject({
    markdown,
    ...(revision === undefined ? {} : { revision }),
    synchronizationStatus: 'synchronized',
  })
}

async function primeDocument(page: Page, markdown = ORIGINAL): Promise<void> {
  await openReadyApp(page)
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('.cm-content[contenteditable="true"]').fill(markdown)
  await expectAuthority(page, markdown)
  await expect.poll(() => authority(page).then(({ autosaveStatus }) => autosaveStatus)).toBe('saved')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  await expectAuthority(page, markdown)
}

async function openVisual(page: Page): Promise<Locator> {
  await page.locator('[data-command-id="mode.visual"]').click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'visual')
  const block = page.locator('[data-w-editor-node="code-block"]')
  await expect(block).toHaveCount(1)
  return block
}

async function selectCodeText(code: Locator, text: string): Promise<void> {
  const selected = await code.evaluate((element, needle) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let offset = 0
    let startNode: Text | null = null
    let startOffset = 0
    let endNode: Text | null = null
    let endOffset = 0
    let combined = ''
    const nodes: Text[] = []
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      nodes.push(node)
      combined += node.data
    }
    const start = combined.indexOf(needle)
    if (start < 0) return null
    const end = start + needle.length
    for (const node of nodes) {
      const nextOffset = offset + node.data.length
      if (startNode === null && start >= offset && start <= nextOffset) {
        startNode = node
        startOffset = start - offset
      }
      if (endNode === null && end >= offset && end <= nextOffset) {
        endNode = node
        endOffset = end - offset
      }
      offset = nextOffset
    }
    if (startNode === null || endNode === null) return null
    ;(element.closest('.ProseMirror') as HTMLElement | null)?.focus()
    const range = document.createRange()
    range.setStart(startNode, startOffset)
    range.setEnd(endNode, endOffset)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    return selection?.toString() ?? null
  }, text)
  expect(selected).toBe(text)
}

async function placeCodeCaretAtEnd(code: Locator): Promise<void> {
  await code.evaluate((element) => {
    ;(element.closest('.ProseMirror') as HTMLElement | null)?.focus()
    const range = document.createRange()
    range.selectNodeContents(element)
    range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
}

async function codeMirrorSource(editor: Locator): Promise<string> {
  return editor.locator('.cm-line').evaluateAll((lines) => lines.map((line) => line.textContent ?? '').join('\n'))
}

async function replaceCodeMirrorSource(editor: Locator, source: string): Promise<void> {
  await editor.click()
  await editor.press('Control+A')
  await editor.pressSequentially(source)
  await expect.poll(() => codeMirrorSource(editor)).toBe(source)
}

async function downloadMarkdown(page: Page): Promise<Download> {
  const pending = page.waitForEvent('download')
  await page.locator('[data-toolbar-menu="export"] .toolbar-menu__trigger').click()
  await page.locator('[data-command-id="export.markdown"]').click()
  return pending
}

test('Task 22.3 Visual code supports direct selection, typing, line breaks, language, highlighting, copy, native undo, safe fences, Source, Final, and reload', async ({ context, page }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await primeDocument(page)
  const block = await openVisual(page)
  const code = block.locator('pre > code')
  await expect(code).toHaveText('const first = 1\nconst second = 2')
  expect(await code.evaluate((element) => (element as HTMLElement).isContentEditable)).toBe(true)

  await selectCodeText(code, 'first')
  await page.keyboard.insertText('answer')
  await expectAuthority(page, SELECTED_EDITED)
  await page.keyboard.press('Control+z')
  await expectAuthority(page, ORIGINAL)
  await page.keyboard.press('Control+Shift+z')
  await expectAuthority(page, SELECTED_EDITED)

  await placeCodeCaretAtEnd(code)
  await page.keyboard.press('Enter')
  await page.keyboard.insertText('const fence = "```"')
  await block.getByRole('combobox', { name: /Change language|更改语言|Изменить язык/u }).selectOption('typescript')
  await expectAuthority(page, DIRECT_EDITED)
  await expect(code).toHaveClass(/language-typescript/u)
  await expect(code).toHaveAttribute('data-highlighted', 'true')
  await expect(code.locator('span')).not.toHaveCount(0)

  const beforeCopy = await authority(page)
  await block.getByRole('button', { name: /Copy code|复制代码|Копировать код/u }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText().then((value) => value.replace(/\r\n/gu, '\n')))).toBe(DIRECT_CODE)
  await expectAuthority(page, beforeCopy.markdown, beforeCopy.revision)

  await page.locator('[data-command-id="mode.source"]').click()
  await expect.poll(() => codeMirrorSource(page.locator('.cm-editor'))).toBe(DIRECT_EDITED)
  await page.locator('[data-command-id="mode.preview"]').click()
  await expect(page.locator('.preview-rendered-content code.language-typescript')).toContainText('const fence')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  await expectAuthority(page, DIRECT_EDITED)
})

test('Task 22.3 selected Visual code exposes contextual actions and keeps CodeMirror optional with atomic Cancel and Apply', async ({ page }) => {
  await primeDocument(page)
  const block = await openVisual(page)
  await block.locator('pre > code').click()
  const actions = block.getByRole('toolbar', { name: /Code block actions|代码块操作|Действия блока кода/u })
  await expect(actions).toBeVisible()
  await expect(actions.getByRole('button', { name: /Copy code|复制代码|Копировать код/u })).toBeVisible()
  const advanced = actions.getByRole('button', { name: /Advanced code editor|高级代码编辑器|Расширенный редактор кода/u })
  await expect(advanced).toBeVisible()

  const beforeCancel = await authority(page)
  await advanced.click()
  const dialog = page.locator('[data-editor-command="insert.code-block"]')
  const codeSource = dialog.getByLabel(/Code source|源码|Исходный код/u)
  await expect(codeSource).toBeFocused()
  await replaceCodeMirrorSource(codeSource, 'cancelled draft')
  await dialog.getByRole('button', { exact: true, name: /Cancel|取消|Отмена/u }).click()
  await expect(dialog).toHaveCount(0)
  await expectAuthority(page, beforeCancel.markdown, beforeCancel.revision)
  await expect(page.locator('.ProseMirror')).toBeFocused()

  await advanced.click()
  const advancedCode = 'const value = "```"\nconsole.log(value)'
  const indentedAdvancedCode = advancedCode.split('\n').map((line) => `  ${line}`).join('\n')
  const expected = `Before\n\n\`\`\`\`typescript\n${indentedAdvancedCode}\n\`\`\`\`\n\nAfter`
  await dialog.getByLabel(/Language|语言|Язык/u).selectOption('typescript')
  const advancedSource = dialog.getByLabel(/Code source|源码|Исходный код/u)
  await replaceCodeMirrorSource(advancedSource, advancedCode)
  await advancedSource.press('Control+A')
  await advancedSource.press('Tab')
  await expect.poll(() => codeMirrorSource(advancedSource)).toBe(indentedAdvancedCode)
  await advancedSource.press('Shift+Tab')
  await expect.poll(() => codeMirrorSource(advancedSource)).toBe(advancedCode)
  await advancedSource.press('Tab')
  await expect.poll(() => codeMirrorSource(advancedSource)).toBe(indentedAdvancedCode)
  await dialog.getByRole('button', { exact: true, name: /Apply|应用|Применить/u }).click()
  await expect(dialog).toHaveCount(0)
  await expectAuthority(page, expected, beforeCancel.revision + 1)
  await page.locator('[data-command-id="history.undo"]').click()
  await expectAuthority(page, ORIGINAL)
})

test('short Visual code keeps only Copy and Edit actions and creates zero content effect', async ({ page }) => {
  await primeDocument(page)
  const before = await authority(page)
  const block = await openVisual(page)
  const envelopeBefore = await page.evaluate(() => localStorage.getItem('w-editor:v1:document:welcome'))
  const undoWasEnabled = await page.locator('[data-command-id="history.undo"]').isEnabled()
  await expect(block.locator('[data-code-action="fold"]')).toBeHidden()
  await expect(block.locator('[data-code-action="expand"]')).toBeHidden()
  await expect(block.locator('pre')).toBeVisible()
  await expectAuthority(page, before.markdown, before.revision)
  await expect(page.locator('[data-command-id="history.undo"]')).toBeEnabled({ enabled: undoWasEnabled })
  await expect.poll(() => page.evaluate(() => localStorage.getItem('w-editor:v1:document:welcome'))).toBe(envelopeBefore)

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  const reloaded = await openVisual(page)
  await expect(reloaded.locator('[data-code-action="fold"]')).toBeHidden()
  await expect(reloaded.locator('[data-code-action="expand"]')).toBeHidden()
  await expect(reloaded.locator('pre')).toBeVisible()
  await expectAuthority(page, before.markdown, before.revision)
})

test('short read-only Preview code keeps copy, hides edit/fold actions, and leaves Markdown export exact', async ({ page }) => {
  await primeDocument(page)
  const before = await authority(page)
  await page.locator('[data-command-id="mode.preview"]').click()
  const envelopeBefore = await page.evaluate(() => localStorage.getItem('w-editor:v1:document:welcome'))
  const undoWasEnabled = await page.locator('[data-command-id="history.undo"]').isEnabled()
  const block = page.locator('.preview-rendered-content [data-w-editor-node="code-block"]')
  await expect(block).toHaveCount(1)
  await expect(block.locator('[data-semantic-copy="code-block"]')).toBeVisible()
  await expect(block.locator('[data-semantic-edit="code-block-editor"]')).toBeHidden()
  await expect(block.locator('[data-code-action="fold"]')).toBeHidden()
  await expect(block.locator('[data-code-action="expand"]')).toBeHidden()
  await expect(block.locator('pre')).toBeVisible()
  const download = await downloadMarkdown(page)
  const path = await download.path()
  if (path === null) throw new Error('The Markdown download has no local path.')
  expect((await readFile(path)).toString('utf8')).toBe(ORIGINAL)
  await expectAuthority(page, before.markdown, before.revision)
  await expect(page.locator('[data-command-id="history.undo"]')).toBeEnabled({ enabled: undoWasEnabled })
  await expect.poll(() => page.evaluate(() => localStorage.getItem('w-editor:v1:document:welcome'))).toBe(envelopeBefore)

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  await page.locator('[data-command-id="mode.preview"]').click()
  const reloaded = page.locator('.preview-rendered-content [data-w-editor-node="code-block"]')
  await expect(reloaded.locator('[data-code-action="fold"]')).toBeHidden()
  await expect(reloaded.locator('[data-code-action="expand"]')).toBeHidden()
  await expect(reloaded.locator('pre')).toBeVisible()
  await expectAuthority(page, before.markdown, before.revision)
})
