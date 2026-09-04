import type { Download, Page } from '@playwright/test'

import {
  CHART_TABLE_DESCRIPTORS,
  MERMAID_DESCRIPTORS,
  chartTableStarterSource,
  mermaidStarterSource,
} from '../src/codecs'
import type { CommandDescriptor } from '../src/services/commandRegistry'
import { createToolbarCommandDescriptors } from '../src/services/toolbarCommands'
import { openReadyApp, useEnglishUi } from './fixtures/app'
import { expect, test } from './fixtures/test'

type OutcomeAssertion =
  | Readonly<{ closeName?: RegExp; kind: 'dialog'; selector: string; selection?: 'all' | 'end' }>
  | Readonly<{ filename: string; kind: 'download' }>
  | Readonly<{ expected: string; kind: 'markdown'; selection: 'all' | 'end' }>
  | Readonly<{ kind: 'fullscreen' }>
  | Readonly<{ kind: 'history'; operation: 'redo' | 'undo' }>
  | Readonly<{ kind: 'language'; label: string }>
  | Readonly<{ kind: 'manual-save' }>
  | Readonly<{ kind: 'mode'; mode: 'preview' | 'source' | 'visual' }>
  | Readonly<{ kind: 'search'; selector: string }>
  | Readonly<{ columns: number; dataRows: number; expected: string; kind: 'table'; selection: 'end' }>

const OUTCOMES: Readonly<Record<string, OutcomeAssertion>> = Object.freeze({
  'align.center': { expected: '::: center\nAlpha\n:::', kind: 'markdown', selection: 'all' },
  'align.justify': { expected: '::: justify\nAlpha\n:::', kind: 'markdown', selection: 'all' },
  'align.left': { expected: '::: left\nAlpha\n:::', kind: 'markdown', selection: 'all' },
  'align.right': { expected: '::: right\nAlpha\n:::', kind: 'markdown', selection: 'all' },
  'application.fullscreen': { kind: 'fullscreen' },
  'block.h1': { expected: '# Alpha', kind: 'markdown', selection: 'all' },
  'block.h2': { expected: '## Alpha', kind: 'markdown', selection: 'all' },
  'block.h3': { expected: '### Alpha', kind: 'markdown', selection: 'all' },
  'block.h4': { expected: '#### Alpha', kind: 'markdown', selection: 'all' },
  'block.h5': { expected: '##### Alpha', kind: 'markdown', selection: 'all' },
  'block.quote': { expected: '> Alpha', kind: 'markdown', selection: 'all' },
  'document.manual-save': { kind: 'manual-save' },
  'document.word-count': { closeName: /^Close$/u, kind: 'dialog', selector: '[data-testid="word-count-dialog"]' },
  'export.html': { filename: 'welcome.html', kind: 'download' },
  'export.markdown': { filename: 'welcome.md', kind: 'download' },
  'export.pdf': { filename: 'welcome.pdf', kind: 'download' },
  'export.screenshot': { filename: 'welcome.png', kind: 'download' },
  'export.word': { filename: 'welcome.doc', kind: 'download' },
  'history.redo': { kind: 'history', operation: 'redo' },
  'history.undo': { kind: 'history', operation: 'undo' },
  'insert.audio': { kind: 'dialog', selector: '[data-editor-command="insert.audio"]', selection: 'end' },
  'insert.code-block': { kind: 'dialog', selector: '[data-editor-command="insert.code-block"]', selection: 'end' },
  'insert.drawio': { closeName: /Cancel draw\.io editing/u, kind: 'dialog', selector: '[data-editor-command="insert.drawio"]', selection: 'end' },
  'insert.file': { kind: 'dialog', selector: '[data-editor-command="insert.file"]', selection: 'end' },
  'insert.formula': { kind: 'dialog', selector: '[data-picker-command="insert.formula"]', selection: 'end' },
  'insert.hard-break': { expected: 'Alpha  \n', kind: 'markdown', selection: 'end' },
  'insert.horizontal-rule': { expected: 'Alpha\n\n---', kind: 'markdown', selection: 'end' },
  'insert.image': { kind: 'dialog', selector: '[data-editor-command="insert.image"]', selection: 'end' },
  'insert.inline-code': { expected: '`Alpha`', kind: 'markdown', selection: 'all' },
  'insert.link': { kind: 'dialog', selector: '[data-picker-command="insert.link"]', selection: 'all' },
  'insert.pdf': { kind: 'dialog', selector: '[data-editor-command="insert.pdf"]', selection: 'end' },
  'insert.table': {
    columns: 2,
    dataRows: 1,
    expected: 'Alpha\n\n| Header | Header |\n| ------ | ------ |\n| Sample | Sample |',
    kind: 'table',
    selection: 'end',
  },
  'insert.toc': { expected: 'Alpha\n\n[[toc]]', kind: 'markdown', selection: 'end' },
  'insert.video': { kind: 'dialog', selector: '[data-editor-command="insert.video"]', selection: 'end' },
  'insert.word': { kind: 'dialog', selector: '[data-editor-command="insert.word"]', selection: 'end' },
  'language.en': { kind: 'language', label: 'Search' },
  'language.ru': { kind: 'language', label: 'Поиск' },
  'language.zh': { kind: 'language', label: '搜索' },
  'layout.accordion': { kind: 'dialog', selector: '[data-picker-command="layout.accordion"]', selection: 'end' },
  'layout.multi-column': { kind: 'dialog', selector: '[data-picker-command="layout.multi-column"]', selection: 'end' },
  'layout.tabs': { kind: 'dialog', selector: '[data-picker-command="layout.tabs"]', selection: 'end' },
  'layout.timeline': { kind: 'dialog', selector: '[data-picker-command="layout.timeline"]', selection: 'end' },
  'layout.two-column': { kind: 'dialog', selector: '[data-picker-command="layout.two-column"]', selection: 'end' },
  'list.ordered': { expected: '1. Alpha', kind: 'markdown', selection: 'all' },
  'list.task': { expected: '- [ ] Alpha', kind: 'markdown', selection: 'all' },
  'list.unordered': { expected: '- Alpha', kind: 'markdown', selection: 'all' },
  'mode.preview': { kind: 'mode', mode: 'preview' },
  'mode.source': { kind: 'mode', mode: 'source' },
  'mode.visual': { kind: 'mode', mode: 'visual' },
  'panel.danger': { kind: 'dialog', selector: '[data-picker-command="panel.danger"]', selection: 'end' },
  'panel.info': { kind: 'dialog', selector: '[data-picker-command="panel.info"]', selection: 'end' },
  'panel.primary': { kind: 'dialog', selector: '[data-picker-command="panel.primary"]', selection: 'end' },
  'panel.success': { kind: 'dialog', selector: '[data-picker-command="panel.success"]', selection: 'end' },
  'panel.warning': { kind: 'dialog', selector: '[data-picker-command="panel.warning"]', selection: 'end' },
  'search.replace': { kind: 'search', selector: '.search-dock' },
  'settings.shortcuts': { kind: 'dialog', selector: '[data-testid="shortcut-settings"]' },
  'text.background': { kind: 'dialog', selector: '[data-picker-command="text.background"]', selection: 'all' },
  'text.bold': { expected: '**Alpha**', kind: 'markdown', selection: 'all' },
  'text.color': { kind: 'dialog', selector: '[data-picker-command="text.color"]', selection: 'all' },
  'text.italic': { expected: '*Alpha*', kind: 'markdown', selection: 'all' },
  'text.ruby': { kind: 'dialog', selector: '[data-picker-command="text.ruby"]', selection: 'all' },
  'text.size': { kind: 'dialog', selector: '[data-picker-command="text.size"]', selection: 'all' },
  'text.strike': { expected: '~~Alpha~~', kind: 'markdown', selection: 'all' },
  'text.subscript': { expected: '~Alpha~', kind: 'markdown', selection: 'all' },
  'text.superscript': { expected: '^Alpha^', kind: 'markdown', selection: 'all' },
  'text.underline': { expected: '++Alpha++', kind: 'markdown', selection: 'all' },
  ...Object.fromEntries(MERMAID_DESCRIPTORS.map((descriptor) => [
    descriptor.commandId,
    { expected: `Alpha\n\n${mermaidStarterSource(descriptor.commandId)}`, kind: 'markdown', selection: 'end' },
  ])),
  ...Object.fromEntries(CHART_TABLE_DESCRIPTORS.map((descriptor) => [
    descriptor.commandId,
    { expected: `Alpha\n\n${chartTableStarterSource(descriptor.commandId)}`, kind: 'markdown', selection: 'end' },
  ])),
})

const descriptors = createToolbarCommandDescriptors()

async function authority(page: Page) {
  return page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read())
}

function sourceEditor(page: Page) {
  return page.locator('#markdown-source-editor')
}

async function setSource(page: Page, markdown: string): Promise<void> {
  const source = sourceEditor(page)
  if (!await source.isVisible()) {
    await page.locator('[data-command-id="mode.source"]').click()
    await expect(source).toBeVisible()
  }
  await source.fill(markdown)
  await expect.poll(async () => (await authority(page))?.markdown).toBe(markdown)
}

async function selectSource(page: Page, selection: 'all' | 'end'): Promise<void> {
  await sourceEditor(page).click()
  await page.keyboard.press(selection === 'all' ? 'Control+A' : 'Control+End')
}

async function commandControl(page: Page, descriptor: CommandDescriptor) {
  if (descriptor.surface.menuId !== null) {
    await page.locator(`[data-toolbar-menu="${descriptor.surface.menuId}"] .toolbar-menu__trigger`).click()
  }
  return page.locator(`[data-command-id="${descriptor.id}"]`)
}

async function invokeDownload(page: Page, control: ReturnType<Page['locator']>): Promise<Download> {
  const pending = page.waitForEvent('download')
  await control.click()
  return pending
}

test('registry and command-specific Playwright outcomes have exact one-to-one coverage', () => {
  const registryIds = descriptors.map(({ id }) => id).sort()
  const outcomeIds = Object.keys(OUTCOMES).sort()
  expect(outcomeIds).toEqual(registryIds)
})

for (const descriptor of descriptors) {
  test(`registry outcome ${descriptor.id}`, async ({ page }) => {
    const outcome = OUTCOMES[descriptor.id]
    if (outcome === undefined) throw new Error(`Missing command-specific Playwright outcome for ${descriptor.id}.`)
    await openReadyApp(page)
    await useEnglishUi(page)
    await setSource(page, 'Alpha')
    if ('selection' in outcome && outcome.selection !== undefined) await selectSource(page, outcome.selection)

    if (outcome.kind === 'history') {
      await selectSource(page, 'all')
      const bold = descriptors.find(({ id }) => id === 'text.bold')
      if (bold === undefined) throw new Error('The history outcome requires the text.bold registry command.')
      await (await commandControl(page, bold)).click()
      await expect.poll(async () => (await authority(page))?.markdown).toBe('**Alpha**')
      if (outcome.operation === 'redo') {
        const undo = descriptors.find(({ id }) => id === 'history.undo')
        if (undo === undefined) throw new Error('The redo outcome requires the history.undo registry command.')
        await (await commandControl(page, undo)).click()
        await expect.poll(async () => (await authority(page))?.markdown).toBe('Alpha')
      }
      const control = await commandControl(page, descriptor)
      await control.click()
      await expect.poll(async () => (await authority(page))?.markdown).toBe(outcome.operation === 'undo' ? 'Alpha' : '**Alpha**')
      return
    }

    const before = await authority(page)
    const control = await commandControl(page, descriptor)
    await expect(control).toBeEnabled()

    if (outcome.kind === 'download') {
      const download = await invokeDownload(page, control)
      expect(download.suggestedFilename()).toBe(outcome.filename)
    } else {
      const isColorPicker = descriptor.id === 'text.color' || descriptor.id === 'text.background'
      if (!isColorPicker) await control.click()
      else if (descriptor.id === 'text.background') {
        const colorPicker = page.locator('[data-picker-command="text.color"]')
        await expect(colorPicker).toBeVisible()
        await colorPicker.getByRole('tab').nth(1).click()
      }
      if (outcome.kind === 'table') {
        const grid = page.getByRole('grid', { name: 'Table size' })
        await expect(grid).toBeVisible()
        await grid.getByRole('gridcell', {
          name: `${outcome.columns} columns by ${outcome.dataRows} data row`,
        }).click()
        await expect.poll(async () => (await authority(page))?.markdown).toBe(outcome.expected)
      } else if (outcome.kind === 'markdown') {
        await expect.poll(async () => (await authority(page))?.markdown).toBe(outcome.expected)
      } else if (outcome.kind === 'dialog') {
        const dialog = page.locator(outcome.selector)
        await expect(dialog).toBeVisible()
        if (isColorPicker) await dialog.press('Escape')
        else {
          const closeName = outcome.closeName ?? /^(?:Cancel|Close)$/u
          await dialog.getByRole('button', { name: closeName }).first().click()
        }
        await expect(dialog).toHaveCount(0)
        await expect.poll(async () => (await authority(page))?.revision).toBe(before?.revision)
      } else if (outcome.kind === 'search') {
        const search = page.locator(outcome.selector)
        await expect(search).toBeVisible()
        await expect(page.locator('.dialog-backdrop')).toHaveCount(0)
        await search.locator('.search-dock__close').click()
        await expect(search).toHaveCount(0)
        await expect.poll(async () => (await authority(page))?.revision).toBe(before?.revision)
      } else if (outcome.kind === 'fullscreen') {
        await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains('workspace-shell') ?? false)).toBe(true)
      } else if (outcome.kind === 'language') {
        await expect(page.locator('[data-command-id="search.replace"]')).toContainText(outcome.label)
        await expect.poll(async () => (await authority(page))?.revision).toBe(before?.revision)
      } else if (outcome.kind === 'manual-save') {
        await expect(page.locator('.status-region')).toContainText('Manual checkpoint clean')
        await expect.poll(async () => (await authority(page))?.revision).toBe(before?.revision)
      } else if (outcome.kind === 'mode') {
        await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', outcome.mode)
        await expect.poll(async () => (await authority(page))?.revision).toBe(before?.revision)
      }
    }
  })
}
