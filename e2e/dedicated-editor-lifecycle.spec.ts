import type { Locator, Page } from '@playwright/test'

import { FENCED_CODE_STARTER, panelStarterSource, serializeFencedCode } from '../src/codecs'
import { expect, test } from './fixtures/test'

type DedicatedKind = 'code' | 'panel'
type EditingMode = 'source' | 'visual'

interface LifecycleCase {
  readonly existing: boolean
  readonly kind: DedicatedKind
  readonly mode: EditingMode
}

interface AuthorityState {
  readonly markdown: string
  readonly revision: number
  readonly synchronizationStatus: string
}

const PANEL_INITIAL = panelStarterSource('panel.info')
const PANEL_UPDATED = '::: info Updated information\nUpdated panel body.\n:::'
const CODE_INITIAL = FENCED_CODE_STARTER
const CODE_UPDATED_BODY = 'const updated = true\nconsole.log(updated)'
const CODE_UPDATED = serializeFencedCode('typescript', CODE_UPDATED_BODY)

const lifecycleCases: readonly LifecycleCase[] = Object.freeze(
  (['source', 'visual'] as const).flatMap((mode) => (
    (['panel', 'code'] as const).flatMap((kind) => ([
      Object.freeze({ existing: false, kind, mode }),
      Object.freeze({ existing: true, kind, mode }),
    ]))
  )),
)

function caseName(value: LifecycleCase): string {
  return `${value.mode} ${value.existing ? 'existing' : 'new'} ${value.kind}`
}

function initialMarkdown(value: LifecycleCase): string {
  if (!value.existing) return 'Alpha'
  return value.kind === 'panel' ? PANEL_INITIAL : CODE_INITIAL
}

function updatedSource(kind: DedicatedKind): string {
  return kind === 'panel' ? PANEL_UPDATED : CODE_UPDATED
}

function expectedMarkdown(value: LifecycleCase): string {
  const source = updatedSource(value.kind)
  return value.existing ? source : `Alpha\n\n${source}`
}

function dialog(page: Page, kind: DedicatedKind): Locator {
  return kind === 'panel'
    ? page.locator('[data-picker-command="panel.info"]')
    : page.locator('[data-editor-command="insert.code-block"]')
}

function editorInput(page: Page, kind: DedicatedKind): Locator {
  return kind === 'panel'
    ? page.locator('#panel-source')
    : page.locator('[data-editor-command="insert.code-block"] .cm-content')
}

async function expectDraft(page: Page, kind: DedicatedKind, value: string): Promise<void> {
  if (kind === 'panel') await expect(editorInput(page, kind)).toHaveValue(value)
  else await expect.poll(() => editorInput(page, kind).locator('.cm-line').allTextContents()).toEqual(value.split('\n'))
}

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

async function openReadyApp(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`)
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
}

async function primeDocument(page: Page, markdown: string, query = ''): Promise<void> {
  await openReadyApp(page, query)
  await page.locator('[data-toolbar-menu="language"] .toolbar-menu__trigger').click()
  await page.locator('[data-command-id="language.en"]').click()
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill(markdown)
  await expectAuthority(page, markdown)
  await expect.poll(() => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().autosaveStatus)).toBe('saved')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  await expectAuthority(page, markdown)
  await page.locator('[data-toolbar-menu="language"] .toolbar-menu__trigger').click()
  await page.locator('[data-command-id="language.en"]').click()
  await page.locator('[data-command-id="mode.source"]').click()
}

async function placeVisualCaretAtEnd(page: Page): Promise<void> {
  const block = page.locator('.ProseMirror .ordinary-block:last-child')
  await block.click()
  await page.keyboard.press('End')
  await expect(page.locator('.ProseMirror')).toBeFocused()
}

async function openToolbarCommand(page: Page, kind: DedicatedKind): Promise<void> {
  const menuId = kind === 'panel' ? 'panel' : 'insert'
  const commandId = kind === 'panel' ? 'panel.info' : 'insert.code-block'
  await page.locator(`[data-toolbar-menu="${menuId}"] .toolbar-menu__trigger`).click()
  await page.locator(`[data-command-id="${commandId}"]`).click()
}

async function openDedicatedEditor(page: Page, value: LifecycleCase): Promise<Locator> {
  if (value.mode === 'visual') {
    await page.locator('[data-command-id="mode.visual"]').click()
    await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'visual')
  }

  if (value.existing) {
    if (value.mode === 'source') {
      await page.locator('#markdown-source-editor').selectText()
      await openToolbarCommand(page, value.kind)
    } else if (value.kind === 'code') {
      const block = page.locator('[data-w-editor-node="code-block"]')
      await block.locator('pre > code').click()
      await block.getByRole('button', { name: 'Advanced code editor' }).click()
    } else {
      const node = page.locator('[data-semantic-kind="panel"]')
      await node.hover()
      await node.click()
      await node.locator('[data-semantic-edit="panel-editor"]').click()
    }
  } else {
    if (value.mode === 'source') {
      await page.locator('#markdown-source-editor').click()
      await page.keyboard.press('Control+End')
    } else {
      await placeVisualCaretAtEnd(page)
    }
    await openToolbarCommand(page, value.kind)
  }

  const currentDialog = dialog(page, value.kind)
  await expect(currentDialog).toBeVisible()
  await expect(editorInput(page, value.kind)).toBeFocused()
  if (value.existing) {
    if (value.kind === 'panel') {
      await expect(editorInput(page, value.kind)).toHaveValue(PANEL_INITIAL)
    } else {
      await expectDraft(page, value.kind, CODE_INITIAL.split('\n').slice(1, -1).join('\n'))
    }
  }
  return currentDialog
}

async function fillUpdatedDraft(page: Page, kind: DedicatedKind): Promise<void> {
  if (kind === 'panel') {
    await editorInput(page, kind).fill(PANEL_UPDATED)
    return
  }
  await page.locator('#code-block-language').selectOption('typescript')
  await editorInput(page, kind).fill(CODE_UPDATED_BODY)
}

async function injectLanguageOption(page: Page, value: string): Promise<void> {
  await page.locator('#code-block-language').evaluate((element, injectedValue) => {
    if (!(element instanceof HTMLSelectElement)) throw new TypeError('Code language control must be a select element.')
    const option = new Option(injectedValue, injectedValue)
    element.add(option)
    element.value = injectedValue
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

async function applyDraft(page: Page, kind: DedicatedKind): Promise<void> {
  await dialog(page, kind).locator('.primary-action').click()
}

async function expectActiveSurfaceFocused(page: Page, mode: EditingMode): Promise<void> {
  if (mode === 'source') await expect(page.locator('#markdown-source-editor')).toBeFocused()
  else await expect(page.locator('.ProseMirror')).toBeFocused()
}

async function expectOneUndo(page: Page, before: string, after: string): Promise<void> {
  await expect(page.locator('[data-command-id="history.undo"]')).toBeEnabled()
  await page.locator('[data-command-id="history.undo"]').click()
  await expectAuthority(page, before)
  await expect(page.locator('[data-command-id="history.redo"]')).toBeEnabled()
  await page.locator('[data-command-id="history.redo"]').click()
  await expectAuthority(page, after)
}

test.describe('Task 22.1 accepted dedicated-editor lifecycle', () => {
  for (const value of lifecycleCases) {
    test(`${caseName(value)} closes only after one accepted Apply and restores the active surface`, async ({ page }) => {
      const initial = initialMarkdown(value)
      await primeDocument(page, initial)
      const before = await authority(page)
      await openDedicatedEditor(page, value)
      await fillUpdatedDraft(page, value.kind)
      await applyDraft(page, value.kind)

      await expect(dialog(page, value.kind)).toHaveCount(0)
      await expectActiveSurfaceFocused(page, value.mode)
      const expected = expectedMarkdown(value)
      await expectAuthority(page, expected, before.revision + 1)
      await expectOneUndo(page, initial, expected)
    })
  }
})

test.describe('Task 22.1 Cancel and dirty-close lifecycle', () => {
  for (const value of lifecycleCases) {
    test(`${caseName(value)} Cancel and discarded dirty close create zero revisions and zero undo`, async ({ page }) => {
      const initial = initialMarkdown(value)
      await primeDocument(page, initial)
      const before = await authority(page)
      const undoWasEnabled = await page.locator('[data-command-id="history.undo"]').isEnabled()

      await openDedicatedEditor(page, value)
      await fillUpdatedDraft(page, value.kind)
      await dialog(page, value.kind).getByRole('button', { exact: true, name: 'Cancel' }).click()
      await expect(dialog(page, value.kind)).toHaveCount(0)
      await expectActiveSurfaceFocused(page, value.mode)
      await expectAuthority(page, initial, before.revision)
      await expect(page.locator('[data-command-id="history.undo"]')).toBeEnabled({ enabled: undoWasEnabled })

      await openDedicatedEditor(page, value)
      await fillUpdatedDraft(page, value.kind)
      await page.locator('.dialog-backdrop').click({ position: { x: 5, y: 5 } })
      const confirmation = page.getByRole('alertdialog')
      await expect(confirmation).toBeVisible()
      await confirmation.getByRole('button', { name: 'Keep editing' }).click()
      await expect(confirmation).toHaveCount(0)
      await expect(editorInput(page, value.kind)).toBeFocused()
      await expectDraft(page, value.kind, value.kind === 'panel' ? PANEL_UPDATED : CODE_UPDATED_BODY)

      await page.locator('.dialog-backdrop').click({ position: { x: 5, y: 5 } })
      await page.getByRole('alertdialog').getByRole('button', { name: /Discard/u }).click()
      await expect(dialog(page, value.kind)).toHaveCount(0)
      await expectActiveSurfaceFocused(page, value.mode)
      await expectAuthority(page, initial, before.revision)
      await expect(page.locator('[data-command-id="history.undo"]')).toBeEnabled({ enabled: undoWasEnabled })
    })
  }
})

for (const mode of ['source', 'visual'] as const) {
  test(`Task 22.1 ${mode} panel validation failure keeps the new draft open and permits a successful retry`, async ({ page }) => {
    const value = Object.freeze({ existing: false, kind: 'panel' as const, mode })
    await primeDocument(page, initialMarkdown(value))
    const before = await authority(page)
    await openDedicatedEditor(page, value)
    const invalid = '::: info Missing body\n\n:::'
    await editorInput(page, 'panel').fill(invalid)
    await applyDraft(page, 'panel')

    await expect(dialog(page, 'panel')).toBeVisible()
    await expect(editorInput(page, 'panel')).toHaveValue(invalid)
    await expect(dialog(page, 'panel').getByRole('alert')).toContainText('one complete Info panel source')
    await expect(dialog(page, 'panel').locator('.primary-action')).toBeEnabled()
    await expectAuthority(page, 'Alpha', before.revision)

    await fillUpdatedDraft(page, 'panel')
    await applyDraft(page, 'panel')
    await expect(dialog(page, 'panel')).toHaveCount(0)
    await expectActiveSurfaceFocused(page, mode)
    await expectAuthority(page, `Alpha\n\n${PANEL_UPDATED}`, before.revision + 1)
  })

  test(`Task 22.1 ${mode} code serialization failure keeps the new draft open and permits a successful retry`, async ({ page }) => {
    const value = Object.freeze({ existing: false, kind: 'code' as const, mode })
    await primeDocument(page, initialMarkdown(value))
    const before = await authority(page)
    await openDedicatedEditor(page, value)
    await injectLanguageOption(page, 'unsafe language')
    await editorInput(page, 'code').fill(CODE_UPDATED_BODY)
    await applyDraft(page, 'code')

    await expect(dialog(page, 'code')).toBeVisible()
    await expect(page.locator('#code-block-language')).toHaveValue('unsafe language')
    await expectDraft(page, 'code', CODE_UPDATED_BODY)
    await expect(dialog(page, 'code').getByRole('alert')).toContainText('single safe identifier')
    await expect(dialog(page, 'code').locator('.primary-action')).toBeEnabled()
    await expectAuthority(page, 'Alpha', before.revision)

    await page.locator('#code-block-language').selectOption('typescript')
    await applyDraft(page, 'code')
    await expect(dialog(page, 'code')).toHaveCount(0)
    await expectActiveSurfaceFocused(page, mode)
    await expectAuthority(page, `Alpha\n\n${CODE_UPDATED}`, before.revision + 1)
  })
}

const injectedFailureCases = Object.freeze([
  Object.freeze({ failure: 'stale-selection-once', kind: 'panel' as const, mode: 'source' as const, message: 'selection changed before Apply' }),
  Object.freeze({ failure: 'stale-selection-once', kind: 'code' as const, mode: 'visual' as const, message: 'selection changed before Apply' }),
  Object.freeze({ failure: 'revision-once', kind: 'code' as const, mode: 'source' as const, message: 'document revision changed before Apply' }),
  Object.freeze({ failure: 'revision-once', kind: 'panel' as const, mode: 'visual' as const, message: 'document revision changed before Apply' }),
  Object.freeze({ failure: 'planning-once', kind: 'panel' as const, mode: 'source' as const, message: 'could not prepare the dedicated-editor update' }),
  Object.freeze({ failure: 'planning-once', kind: 'code' as const, mode: 'visual' as const, message: 'could not prepare the dedicated-editor update' }),
  Object.freeze({ failure: 'transaction-once', kind: 'code' as const, mode: 'source' as const, message: 'dedicated-editor transaction was rejected' }),
  Object.freeze({ failure: 'transaction-once', kind: 'panel' as const, mode: 'visual' as const, message: 'dedicated-editor transaction was rejected' }),
])

for (const injected of injectedFailureCases) {
  test(`Task 22.1 ${injected.mode} existing ${injected.kind} retains its draft after ${injected.failure} and retries once`, async ({ page }) => {
    const value = Object.freeze({ existing: true, kind: injected.kind, mode: injected.mode })
    const initial = initialMarkdown(value)
    await primeDocument(page, initial, `?dedicatedEditorFailure=${injected.failure}`)
    const before = await authority(page)
    const undoWasEnabled = await page.locator('[data-command-id="history.undo"]').isEnabled()
    await openDedicatedEditor(page, value)
    await fillUpdatedDraft(page, value.kind)
    await applyDraft(page, value.kind)

    const currentDialog = dialog(page, value.kind)
    await expect(currentDialog).toBeVisible()
    await expect(currentDialog.getByRole('alert')).toContainText(injected.message)
    await expect(currentDialog.locator('.primary-action')).toBeEnabled()
    await expectDraft(page, value.kind, value.kind === 'panel' ? PANEL_UPDATED : CODE_UPDATED_BODY)
    await expectAuthority(page, initial, before.revision)
    await expect(page.locator('[data-command-id="history.undo"]')).toBeEnabled({ enabled: undoWasEnabled })

    await applyDraft(page, value.kind)
    await expect(currentDialog).toHaveCount(0)
    await expectActiveSurfaceFocused(page, value.mode)
    const expected = expectedMarkdown(value)
    await expectAuthority(page, expected, before.revision + 1)
    await expectOneUndo(page, initial, expected)
  })
}
