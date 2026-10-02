import type { Locator, Page } from '@playwright/test'

import {
  PANEL_DESCRIPTORS,
  columnLayoutStarterSource,
  disclosureStarterSource,
  panelStarterSource,
  timelineStarterSource,
} from '../src/codecs'
import { openReadyApp, useEnglishUi } from './fixtures/app'
import { expect, test } from './fixtures/test'

interface CompoundCommandCase {
  readonly dialogInput: string
  readonly id: string
  readonly previewSelector: string
  readonly source: string
  readonly visualSelector: string
}

const panelCases: readonly CompoundCommandCase[] = PANEL_DESCRIPTORS.map((descriptor) => Object.freeze({
  dialogInput: '#panel-source',
  id: descriptor.commandId,
  previewSelector: `.preview-rendered-content [data-semantic-kind="panel"][data-semantic-variant="${descriptor.variant}"]`,
  source: panelStarterSource(descriptor.commandId),
  visualSelector: `.ProseMirror [data-semantic-kind="panel"][data-semantic-variant="${descriptor.variant}"]`,
}))

const columnCases: readonly CompoundCommandCase[] = (['layout.two-column', 'layout.multi-column'] as const).map((id) => {
  const columns = id === 'layout.two-column' ? 2 : 3
  return Object.freeze({
    dialogInput: '#column-layout-source',
    id,
    previewSelector: `.preview-rendered-content [data-semantic-kind="column-layout"] .semantic-preview__column:nth-child(${columns})`,
    source: columnLayoutStarterSource(id),
    visualSelector: `.ProseMirror [data-semantic-kind="column-layout"] .semantic-preview__column:nth-child(${columns})`,
  })
})

const disclosureCases: readonly CompoundCommandCase[] = (['layout.tabs', 'layout.accordion'] as const).map((id) => Object.freeze({
  dialogInput: '#disclosure-source',
  id,
  previewSelector: id === 'layout.tabs'
    ? '.preview-rendered-content [data-semantic-kind="disclosure"].semantic-preview--tabs'
    : '.preview-rendered-content [data-semantic-kind="disclosure"].semantic-preview--accordion',
  source: disclosureStarterSource(id),
  visualSelector: id === 'layout.tabs'
    ? '.ProseMirror [data-semantic-kind="disclosure"].semantic-preview--tabs'
    : '.ProseMirror [data-semantic-kind="disclosure"].semantic-preview--accordion',
}))

const compoundCases: readonly CompoundCommandCase[] = Object.freeze([
  ...panelCases,
  ...columnCases,
  ...disclosureCases,
  Object.freeze({
    dialogInput: '#timeline-source',
    id: 'layout.timeline',
    previewSelector: '.preview-rendered-content .cherry-timeline',
    source: timelineStarterSource(),
    visualSelector: '.ProseMirror [data-semantic-kind="timeline"] .cherry-markdown .cherry-timeline',
  }),
])

const alignments = ['left', 'center', 'right', 'justify'] as const
const alignmentInitial = '# Heading\n\nAligned paragraph'

async function readMarkdown(page: Page): Promise<string | undefined> {
  return page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().markdown)
}

async function expectMarkdown(page: Page, markdown: string): Promise<void> {
  await expect.poll(() => readMarkdown(page)).toBe(markdown)
  await expect.poll(() => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().synchronizationStatus)).toBe('synchronized')
}

async function setMarkdown(page: Page, markdown: string): Promise<void> {
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill(markdown)
  await expectMarkdown(page, markdown)
}

async function preparePage(page: Page): Promise<void> {
  await openReadyApp(page)
  await useEnglishUi(page)
}

async function selectSourceAll(page: Page): Promise<void> {
  await page.locator('#markdown-source-editor').click()
  await page.keyboard.press('Control+a')
}

async function setVisualCaretAtEnd(page: Page): Promise<void> {
  await page.locator('.ProseMirror').evaluate((editor) => {
    const block = editor.querySelector<HTMLElement>('.ordinary-block:last-child')
    if (block === null) throw new Error('Expected an ordinary text block.')
    const text = block.firstChild
    if (text === null || text.nodeType !== Node.TEXT_NODE) throw new Error('Expected an ordinary text block.')
    const range = document.createRange()
    range.setStart(text, text.textContent?.length ?? 0)
    range.collapse(true)
    const selection = window.getSelection()
    if (selection === null) throw new Error('Browser selection is unavailable.')
    selection.removeAllRanges()
    selection.addRange(range)
    ;(editor as HTMLElement).focus()
    document.dispatchEvent(new Event('selectionchange'))
  })
}

async function selectAllVisualBlocks(page: Page): Promise<void> {
  await page.locator('.ProseMirror').evaluate((editor) => {
    const blocks = editor.querySelectorAll<HTMLElement>('.ordinary-block')
    const first = blocks[0]?.firstChild
    const last = blocks[blocks.length - 1]?.firstChild
    if (first === undefined || first === null || last === undefined || last === null) throw new Error('Expected ordinary blocks.')
    const range = document.createRange()
    range.setStart(first, 0)
    range.setEnd(last, last.textContent?.length ?? 0)
    const selection = window.getSelection()
    if (selection === null) throw new Error('Browser selection is unavailable.')
    selection.removeAllRanges()
    selection.addRange(range)
    ;(editor as HTMLElement).focus()
    document.dispatchEvent(new Event('selectionchange'))
  })
}

async function structureCommand(page: Page, commandId: string): Promise<Locator> {
  const menuId = commandId.startsWith('align.')
    ? 'alignment'
    : commandId === 'layout.timeline' || commandId === 'layout.accordion' ? 'mermaid' : 'panel'
  await page.locator(`[data-toolbar-menu="${menuId}"] .toolbar-menu__trigger`).click()
  return page.locator(`[data-command-id="${commandId}"]`)
}

async function invokeCompound(page: Page, command: CompoundCommandCase): Promise<void> {
  const control = await structureCommand(page, command.id)
  await expect(control).toBeEnabled()
  await control.click()
  const dialog = page.locator(`[data-picker-command="${command.id}"]`)
  await expect(dialog).toBeVisible()
  await expect(dialog.locator(command.dialogInput)).toHaveValue(command.source)
  await dialog.locator('.primary-action').click()
  await expect(dialog).toHaveCount(0)
}

async function expectUndoRedo(page: Page, initial: string, expected: string): Promise<void> {
  await page.locator('[data-command-id="history.undo"]').click()
  await expectMarkdown(page, initial)
  await page.locator('[data-command-id="history.redo"]').click()
  await expectMarkdown(page, expected)
}

async function expectReadOnlyPreview(page: Page, selector: string, markdown: string): Promise<void> {
  await page.locator('[data-command-id="mode.preview"]').click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'preview')
  await expect(page.locator(selector)).toHaveCount(1)
  await expect(page.locator('.preview-rendered-content script, .preview-rendered-content [onclick], .preview-rendered-content [onerror]')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().autosaveStatus)).toBe('saved')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  await expectMarkdown(page, markdown)
  await page.locator('[data-command-id="mode.source"]').click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'source')
}

test.describe('12.7 source variant and compound-layout matrix', () => {
  for (const command of compoundCases) {
    test(`${command.id} inserts an exact starter through its real source UI`, async ({ page }) => {
      await preparePage(page)
      await setMarkdown(page, 'Alpha')
      await page.locator('#markdown-source-editor').click()
      await page.keyboard.press('Control+End')
      await invokeCompound(page, command)
      const expected = `Alpha\n\n${command.source}`
      await expectMarkdown(page, expected)
      await expectUndoRedo(page, 'Alpha', expected)
      await page.locator('[data-command-id="mode.visual"]').click()
      await expect(page.locator(command.visualSelector)).toHaveCount(1)
      await expectReadOnlyPreview(page, command.previewSelector, expected)
    })
  }

  for (const alignment of alignments) {
    test(`align.${alignment} wraps the compatible source block range and renders in read-only Preview`, async ({ page }) => {
      await preparePage(page)
      await setMarkdown(page, alignmentInitial)
      await selectSourceAll(page)
      const commandId = `align.${alignment}`
      const control = await structureCommand(page, commandId)
      await expect(control).toBeEnabled()
      await control.click()
      const expected = `::: ${alignment}\n${alignmentInitial}\n:::`
      await expectMarkdown(page, expected)
      await expectUndoRedo(page, alignmentInitial, expected)
      await page.locator('[data-command-id="mode.visual"]').click()
      await expect(page.locator(`.ProseMirror .alignment-block[data-alignment="${alignment}"]`)).toHaveCount(1)
      await expectReadOnlyPreview(page, `.preview-rendered-content .alignment-block[data-alignment="${alignment}"]`, expected)
    })
  }
})

test.describe('12.7 visual variant and compound-layout matrix', () => {
  for (const command of compoundCases) {
    test(`${command.id} inserts a selected semantic node through its real visual UI`, async ({ page }) => {
      await preparePage(page)
      await setMarkdown(page, 'Alpha')
      await page.locator('[data-command-id="mode.visual"]').click()
      await setVisualCaretAtEnd(page)
      await invokeCompound(page, command)
      const expected = `Alpha\n\n${command.source}`
      await expect(page.locator(command.visualSelector)).toHaveCount(1)
      await expectMarkdown(page, expected)
      await expectUndoRedo(page, 'Alpha', expected)
      await expectReadOnlyPreview(page, command.previewSelector, expected)
    })
  }

  for (const alignment of alignments) {
    test(`align.${alignment} wraps a compatible real visual selection and renders in read-only Preview`, async ({ page }) => {
      await preparePage(page)
      await setMarkdown(page, alignmentInitial)
      await page.locator('[data-command-id="mode.visual"]').click()
      await selectAllVisualBlocks(page)
      const commandId = `align.${alignment}`
      const control = await structureCommand(page, commandId)
      await expect(control).toBeEnabled()
      await control.click()
      const expected = `::: ${alignment}\n${alignmentInitial}\n:::`
      await expect(page.locator(`.ProseMirror .alignment-block[data-alignment="${alignment}"]`)).toHaveCount(1)
      await expectMarkdown(page, expected)
      await expectUndoRedo(page, alignmentInitial, expected)
      await expectReadOnlyPreview(page, `.preview-rendered-content .alignment-block[data-alignment="${alignment}"]`, expected)
    })
  }
})

test('alignment controls are disabled with an actionable reason for incompatible source and visual selections', async ({ page }) => {
  await preparePage(page)
  const taskSource = '- [ ] Task item'
  await setMarkdown(page, taskSource)
  await selectSourceAll(page)
  let control = await structureCommand(page, 'align.center')
  await expect(control).toBeDisabled()
  await expect(control).toHaveAttribute('title', 'Alignment accepts only paragraph and H1-H5 block ranges.')
  await expectMarkdown(page, taskSource)

  await page.keyboard.press('Escape')
  const panelSource = panelStarterSource('panel.info')
  await setMarkdown(page, panelSource)
  await page.locator('[data-command-id="mode.visual"]').click()
  const semanticNode = page.locator('.ProseMirror [data-semantic-kind="panel"]')
  await semanticNode.click()
  control = await structureCommand(page, 'align.center')
  await expect(control).toBeDisabled()
  await expect(control).toHaveAttribute('title', 'Unavailable in the current mode.')
  await expectMarkdown(page, panelSource)
})
