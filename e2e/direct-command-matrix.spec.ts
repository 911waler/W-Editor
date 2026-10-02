import type { Locator, Page } from '@playwright/test'

import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

type ToolbarMenu = 'color' | 'heading' | 'insert' | 'list' | 'text-style'

interface CommandCase {
  readonly active: boolean
  readonly expected: string
  readonly id: string
  readonly initial: string
  readonly menu: ToolbarMenu | null
  readonly picker?: Readonly<{ kind: 'formula' | 'link' | 'rich'; value: string }>
  readonly preview: Readonly<{
    attribute?: Readonly<{ name: string; value: string }>
    extraSelector?: string
    selector: string
    text?: string
  }>
  readonly selection: Readonly<{ from: number; to: number }>
  readonly visualSelector: string
}

const simpleMarkSeeds = [
  ['text.bold', null, '**', 'strong', 'strong'],
  ['text.italic', null, '*', 'em', 'em'],
  ['text.strike', 'text-style', '~~', 's', 's, del'],
  ['text.underline', 'text-style', '++', 'u', 'u'],
  ['text.subscript', 'text-style', '~', 'sub', 'sub'],
  ['text.superscript', 'text-style', '^', 'sup', 'sup'],
] as const

const simpleMarks: readonly CommandCase[] = simpleMarkSeeds.map(([id, menu, marker, visualSelector, previewSelector]) => Object.freeze({
  active: true,
  expected: `${marker}Alpha${marker}`,
  id,
  initial: 'Alpha',
  menu: menu as ToolbarMenu | null,
  preview: Object.freeze({ selector: `.preview-rendered-content ${previewSelector}`, text: 'Alpha' }),
  selection: Object.freeze({ from: 0, to: 5 }),
  visualSelector: `.ProseMirror ${visualSelector}`,
}))

const richMarks: readonly CommandCase[] = [
  Object.freeze({
    active: true,
    expected: '{ Alpha | annotation }',
    id: 'text.ruby',
    initial: 'Alpha',
    menu: 'text-style',
    picker: Object.freeze({ kind: 'rich', value: 'annotation' }),
    preview: Object.freeze({ selector: '.preview-rendered-content .ruby-mark[data-ruby-annotation="annotation"]', text: 'Alpha' }),
    selection: Object.freeze({ from: 0, to: 5 }),
    visualSelector: '.ProseMirror .ruby-mark[data-ruby-annotation="annotation"]',
  }),
  Object.freeze({
    active: true,
    expected: '!24 Alpha!',
    id: 'text.size',
    initial: 'Alpha',
    menu: null,
    picker: Object.freeze({ kind: 'rich', value: '24' }),
    preview: Object.freeze({ selector: '.preview-rendered-content [style*="font-size: 24px"]', text: 'Alpha' }),
    selection: Object.freeze({ from: 0, to: 5 }),
    visualSelector: '.ProseMirror [style*="font-size: 24px"]',
  }),
  Object.freeze({
    active: true,
    expected: '!!#2563eb Alpha!!',
    id: 'text.color',
    initial: 'Alpha',
    menu: 'color',
    picker: Object.freeze({ kind: 'rich', value: '#2563eb' }),
    preview: Object.freeze({ selector: '.preview-rendered-content [style*="color: rgb(37, 99, 235)"]', text: 'Alpha' }),
    selection: Object.freeze({ from: 0, to: 5 }),
    visualSelector: '.ProseMirror [style*="color: rgb(37, 99, 235)"]',
  }),
  Object.freeze({
    active: true,
    expected: '!!!#bbf7d0 Alpha!!!',
    id: 'text.background',
    initial: 'Alpha',
    menu: 'color',
    picker: Object.freeze({ kind: 'rich', value: '#bbf7d0' }),
    preview: Object.freeze({ selector: '.preview-rendered-content [style*="background-color: rgb(187, 247, 208)"]', text: 'Alpha' }),
    selection: Object.freeze({ from: 0, to: 5 }),
    visualSelector: '.ProseMirror [style*="background-color: rgb(187, 247, 208)"]',
  }),
]

const headings: readonly CommandCase[] = [1, 2, 3, 4, 5].map((level) => Object.freeze({
  active: true,
  expected: `${'#'.repeat(level)} Alpha`,
  id: `block.h${level}`,
  initial: 'Alpha',
  menu: 'heading' as const,
  preview: Object.freeze({ selector: `.preview-rendered-content h${level}`, text: 'Alpha' }),
  selection: Object.freeze({ from: 0, to: 5 }),
  visualSelector: `.ProseMirror h${level}`,
}))

const lists: readonly CommandCase[] = [
  Object.freeze({ expected: '1. Alpha', id: 'list.ordered', previewSelector: 'ol li', visualSelector: 'ol li' }),
  Object.freeze({ expected: '- Alpha', id: 'list.unordered', previewSelector: 'ul li', visualSelector: 'ul li' }),
  Object.freeze({ expected: '- [ ] Alpha', id: 'list.task', previewSelector: 'ul li', visualSelector: 'ul[data-type="taskList"] li' }),
].map(({ expected, id, previewSelector, visualSelector }) => Object.freeze({
  active: true,
  expected,
  id,
  initial: 'Alpha',
  menu: 'list' as const,
  preview: Object.freeze({ selector: `.preview-rendered-content ${previewSelector}`, text: 'Alpha' }),
  selection: Object.freeze({ from: 0, to: 5 }),
  visualSelector: `.ProseMirror ${visualSelector}`,
}))

const simpleInserts: readonly CommandCase[] = [
  Object.freeze({
    active: true,
    expected: '[Alpha](https://example.test/page)',
    id: 'insert.link',
    initial: 'Alpha',
    menu: 'insert',
    picker: Object.freeze({ kind: 'link', value: 'https://example.test/page' }),
    preview: Object.freeze({ attribute: Object.freeze({ name: 'href', value: 'https://example.test/page' }), selector: '.preview-rendered-content a', text: 'Alpha' }),
    selection: Object.freeze({ from: 0, to: 5 }),
    visualSelector: '.ProseMirror a[href="https://example.test/page"]',
  }),
  Object.freeze({
    active: true,
    expected: '`Alpha`',
    id: 'insert.inline-code',
    initial: 'Alpha',
    menu: 'insert',
    preview: Object.freeze({ selector: '.preview-rendered-content code', text: 'Alpha' }),
    selection: Object.freeze({ from: 0, to: 5 }),
    visualSelector: '.ProseMirror code',
  }),
  Object.freeze({
    active: false,
    expected: 'Al  \npha',
    id: 'insert.hard-break',
    initial: 'Alpha',
    menu: 'insert',
    preview: Object.freeze({ selector: '.preview-rendered-content br' }),
    selection: Object.freeze({ from: 2, to: 2 }),
    visualSelector: '.ProseMirror br',
  }),
  Object.freeze({
    active: false,
    expected: 'Alpha\n\n---',
    id: 'insert.horizontal-rule',
    initial: 'Alpha',
    menu: 'insert',
    preview: Object.freeze({ selector: '.preview-rendered-content hr' }),
    selection: Object.freeze({ from: 5, to: 5 }),
    visualSelector: '.ProseMirror hr',
  }),
  Object.freeze({
    active: false,
    expected: '# Heading\n\nAlpha\n\n[[toc]]',
    id: 'insert.toc',
    initial: '# Heading\n\nAlpha',
    menu: 'insert',
    preview: Object.freeze({ selector: '.preview-rendered-content .toc a', text: 'Heading' }),
    selection: Object.freeze({ from: 16, to: 16 }),
    visualSelector: '.ProseMirror [data-w-editor-node="toc"]',
  }),
  Object.freeze({
    active: false,
    expected: 'Alpha\n\n$$\nx^2 + y^2\n$$',
    id: 'insert.formula',
    initial: 'Alpha',
    menu: 'insert',
    picker: Object.freeze({ kind: 'formula', value: 'x^2 + y^2' }),
    preview: Object.freeze({ selector: '.preview-rendered-content .formula-node--block' }),
    selection: Object.freeze({ from: 5, to: 5 }),
    visualSelector: '.ProseMirror [data-w-editor-node="formula"][data-formula-mode="block"]',
  }),
]

const COMMAND_CASES = Object.freeze([
  ...simpleMarks,
  ...richMarks,
  ...headings,
  ...lists,
  ...simpleInserts,
])

async function readAuthority(page: Page) {
  return page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read() ?? null)
}

async function expectAuthorityMarkdown(page: Page, markdown: string): Promise<void> {
  await expect.poll(async () => (await readAuthority(page))?.markdown).toBe(markdown)
  await expect.poll(async () => (await readAuthority(page))?.synchronizationStatus).toBe('synchronized')
}

async function setSourceMarkdown(page: Page, markdown: string): Promise<void> {
  await page.locator('[data-command-id="mode.source"]').click()
  const source = page.locator('#markdown-source-editor')
  await source.fill(markdown)
  await expectAuthorityMarkdown(page, markdown)
}

async function selectSourceRange(page: Page, selection: CommandCase['selection']): Promise<void> {
  const source = page.locator('#markdown-source-editor')
  await source.click()
  await page.keyboard.press('Control+Home')
  for (let index = 0; index < selection.from; index += 1) await page.keyboard.press('ArrowRight')
  for (let index = selection.from; index < selection.to; index += 1) await page.keyboard.press('Shift+ArrowRight')
}

async function selectVisualRange(page: Page, selection: CommandCase['selection']): Promise<void> {
  await page.locator('.ProseMirror').evaluate((editor, requested) => {
    const blocks = editor.querySelectorAll<HTMLElement>('.ordinary-block')
    const block = blocks.item(blocks.length - 1)
    const text = [...block.childNodes].find((node) => node.nodeType === Node.TEXT_NODE)
    if (text === undefined) throw new Error('Expected a direct text node in the last ordinary block.')
    const blockLength = text.textContent?.length ?? 0
    const initialOffset = requested.from === requested.to && requested.from > blockLength
      ? blockLength
      : requested.from
    const finalOffset = requested.from === requested.to && requested.to > blockLength
      ? blockLength
      : requested.to
    const range = document.createRange()
    range.setStart(text, initialOffset)
    range.setEnd(text, finalOffset)
    const browserSelection = window.getSelection()
    if (browserSelection === null) throw new Error('Browser selection is unavailable.')
    browserSelection.removeAllRanges()
    browserSelection.addRange(range)
    editor.dispatchEvent(new Event('focus'))
    ;(editor as HTMLElement).focus()
    document.dispatchEvent(new Event('selectionchange'))
  }, selection)
}

async function commandControl(page: Page, command: CommandCase): Promise<Locator> {
  if (command.menu !== null) {
    await page.locator(`[data-toolbar-menu="${command.menu}"] .toolbar-menu__trigger`).click()
  }
  return page.locator(`[data-command-id="${command.id}"]`)
}

async function invokeCommand(page: Page, command: CommandCase): Promise<void> {
  const control = await commandControl(page, command)
  await expect(control).toBeEnabled()
  if (command.menu !== 'color') {
    await control.click()
  } else if (command.id === 'text.background') {
    const picker = page.locator('[data-picker-command="text.color"]')
    await expect(picker).toBeVisible()
    await picker.getByRole('tab').nth(1).click()
  }
  if (command.picker === undefined) return
  const dialog = page.locator(`[data-picker-command="${command.id}"]`)
  await expect(dialog).toBeVisible()
  const input = command.picker.kind === 'rich'
    ? dialog.locator('#rich-picker-value')
    : command.picker.kind === 'link'
      ? dialog.locator('#link-url')
      : dialog.locator('#formula-source')
  if (await input.evaluate((element) => element instanceof HTMLSelectElement)) {
    await input.selectOption(command.picker.value)
  } else if (command.id === 'text.color' || command.id === 'text.background') {
    await input.evaluate((element, value) => {
      if (!(element instanceof HTMLInputElement)) throw new TypeError('Rich color control must be an input element.')
      element.value = String(value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }, command.picker.value)
    await expect(dialog).toHaveCount(0)
    return
  } else {
    await input.fill(command.picker.value)
  }
  await dialog.locator('.primary-action').click()
  await expect(dialog).toHaveCount(0)
}

async function expectToolbarState(page: Page, command: CommandCase): Promise<void> {
  const control = command.menu === 'color'
    ? page.locator(`[data-command-id="${command.id}"]`)
    : await commandControl(page, command)
  await expect(control).toBeEnabled()
  if (command.active) {
    await expect(control).toHaveAttribute(command.menu === null ? 'aria-pressed' : 'aria-checked', 'true')
  }
}

async function expectPreviewMeaning(page: Page, command: CommandCase): Promise<void> {
  const rendered = page.locator(command.preview.selector)
  await expect(rendered).toHaveCount(1)
  if (command.preview.text !== undefined) await expect(rendered).toContainText(command.preview.text)
  if (command.preview.attribute !== undefined) {
    await expect(rendered).toHaveAttribute(command.preview.attribute.name, command.preview.attribute.value)
  }
  if (command.id === 'text.ruby') {
    expect(await rendered.evaluate((element) => getComputedStyle(element, '::before').content)).toContain('annotation')
  }
  if (command.preview.extraSelector !== undefined) await expect(page.locator(command.preview.extraSelector)).toHaveCount(1)
  await expect(page.locator('.preview-rendered-content script, .preview-rendered-content [onerror], .preview-rendered-content [onclick]')).toHaveCount(0)
}

async function expectUndoRedo(page: Page, command: CommandCase): Promise<void> {
  await page.locator('[data-command-id="history.undo"]').click()
  await expectAuthorityMarkdown(page, command.initial)
  await page.locator('[data-command-id="history.redo"]').click()
  await expectAuthorityMarkdown(page, command.expected)
}

async function expectPreviewAndPersistence(page: Page, command: CommandCase, mode: 'source' | 'visual'): Promise<void> {
  await page.locator('[data-command-id="mode.preview"]').click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'preview')
  await expectPreviewMeaning(page, command)
  await expect.poll(async () => (await readAuthority(page))?.autosaveStatus).toBe('saved')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  await expectAuthorityMarkdown(page, command.expected)
  await page.locator(`[data-command-id="mode.${mode}"]`).click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', mode)
  if (mode === 'source') await expect(page.locator('#markdown-source-editor')).toBeVisible()
  else await expect(page.locator('.ProseMirror')).toBeVisible()
}

test.describe('11.7 source command matrix', () => {
  for (const command of COMMAND_CASES) {
    test(`${command.id} exposes exact source, state, preview, persistence, and native undo`, async ({ page }) => {
      await openReadyApp(page)
      await setSourceMarkdown(page, command.initial)
      await selectSourceRange(page, command.selection)
      await invokeCommand(page, command)
      await expectAuthorityMarkdown(page, command.expected)
      await expectToolbarState(page, command)
      await expectUndoRedo(page, command)
      await expectPreviewAndPersistence(page, command, 'source')
    })
  }
})

test.describe('11.7 visual command matrix', () => {
  for (const command of COMMAND_CASES) {
    test(`${command.id} exposes direct/semantic projection, exact source, state, preview, persistence, and one undo`, async ({ page }) => {
      await openReadyApp(page)
      await setSourceMarkdown(page, command.initial)
      await page.locator('[data-command-id="mode.visual"]').click()
      await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'visual')
      await selectVisualRange(page, command.selection)
      await invokeCommand(page, command)
      await expect(page.locator(command.visualSelector)).toHaveCount(1)
      await expectAuthorityMarkdown(page, command.expected)
      await expectToolbarState(page, command)
      await expectUndoRedo(page, command)
      await expectPreviewAndPersistence(page, command, 'visual')
    })
  }
})
