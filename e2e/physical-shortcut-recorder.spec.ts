import type { Locator, Page } from '@playwright/test'

import { openReadyApp, useEnglishUi } from './fixtures/app'
import { expect, test } from './fixtures/test'

interface AuthorityState {
  readonly autosaveStatus: string
  readonly markdown: string
  readonly revision: number
  readonly synchronizationStatus: string
}

const DOCUMENT_STORAGE_KEY = 'w-editor:v1:document:welcome'

async function authority(page: Page): Promise<AuthorityState> {
  const snapshot = await page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read())
  if (snapshot === undefined) throw new Error('The E2E authority inspection seam is unavailable.')
  return snapshot
}

async function setSource(page: Page, markdown: string): Promise<AuthorityState> {
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill(markdown)
  await expect.poll(() => authority(page)).toMatchObject({ markdown, synchronizationStatus: 'synchronized' })
  return authority(page)
}

async function waitForSavedAuthority(page: Page): Promise<AuthorityState> {
  await expect.poll(() => authority(page)).toMatchObject({ autosaveStatus: 'saved' })
  return authority(page)
}

async function openSettingsWithKeyboard(page: Page): Promise<Readonly<{ dialog: Locator; trigger: Locator }>> {
  const trigger = page.locator('[data-command-id="settings.shortcuts"]')
  await trigger.focus()
  await trigger.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(dialog).toBeVisible()
  return Object.freeze({ dialog, trigger })
}

function recorder(dialog: Locator, commandId: string): Locator {
  return shortcutRow(dialog, commandId).locator('[data-shortcut-recorder]')
}

function shortcutRow(dialog: Locator, commandId: string): Locator {
  return dialog.locator(`[data-shortcut-command="${commandId}"]`)
}

async function expectKeycaps(dialog: Locator, commandId: string, labels: readonly string[]): Promise<void> {
  await expect(shortcutRow(dialog, commandId).locator('kbd')).toHaveText(labels)
}

async function recordShortcut(page: Page, dialog: Locator, commandId: string, shortcut: string): Promise<void> {
  const control = recorder(dialog, commandId)
  await control.press('Enter')
  await expect(control).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press(shortcut)
  await expect(control).toHaveAttribute('aria-pressed', 'false')
}

async function applyWithKeyboard(dialog: Locator): Promise<void> {
  const apply = dialog.getByRole('button', { exact: true, name: 'Apply shortcuts' })
  await apply.focus()
  await apply.press('Enter')
  await expect(dialog).toBeHidden()
}

async function selectAllSource(page: Page): Promise<void> {
  const source = page.locator('#markdown-source-editor')
  await source.click()
  await page.keyboard.press('Control+A')
}

test('Task 23.4 records physical keys into normalized keycaps and rejects reserved and duplicate conflicts without a content revision', async ({ page }) => {
  await openReadyApp(page)
  await useEnglishUi(page)
  const before = await setSource(page, 'Alpha')
  const { dialog, trigger } = await openSettingsWithKeyboard(page)
  const boldRecorder = recorder(dialog, 'text.bold')

  await expect(dialog.locator('[data-shortcut-recorder]').first()).toBeFocused()
  await recordShortcut(page, dialog, 'text.bold', 'Control+Alt+k')
  await expectKeycaps(dialog, 'text.bold', ['Ctrl', 'Alt', 'K'])

  await boldRecorder.press('Enter')
  await page.keyboard.press('Control+r')
  await expect(dialog.getByRole('alert')).toContainText(/Ctrl\+R.*reserved/iu)
  await expectKeycaps(dialog, 'text.bold', ['Ctrl', 'Alt', 'K'])

  await boldRecorder.press('Enter')
  await page.keyboard.press('Control+i')
  await expect(dialog.getByRole('alert')).toContainText(/Ctrl\+I.*Italic.*duplicate/iu)
  await expectKeycaps(dialog, 'text.bold', ['Ctrl', 'Alt', 'K'])
  await expect.poll(() => authority(page)).toMatchObject({ markdown: before.markdown, revision: before.revision })

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
  await expect.poll(() => authority(page)).toMatchObject({ markdown: before.markdown, revision: before.revision })
})

test('Task 23.4 accepts a recorded shortcut, routes it immediately, persists it across reload, and leaves preference changes outside document history', async ({ page }) => {
  await openReadyApp(page)
  await useEnglishUi(page)
  await setSource(page, 'Alpha')
  const beforeSettings = await waitForSavedAuthority(page)
  const documentEnvelope = await page.evaluate((key) => localStorage.getItem(key), DOCUMENT_STORAGE_KEY)
  const { dialog, trigger } = await openSettingsWithKeyboard(page)

  await recordShortcut(page, dialog, 'text.bold', 'Control+Alt+k')
  await expectKeycaps(dialog, 'text.bold', ['Ctrl', 'Alt', 'K'])
  await applyWithKeyboard(dialog)
  await expect(trigger).toBeFocused()
  await page.locator('[data-command-id="mode.source"]').click()
  await expect.poll(() => authority(page)).toMatchObject({
    markdown: beforeSettings.markdown,
    revision: beforeSettings.revision,
  })
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), DOCUMENT_STORAGE_KEY)).toBe(documentEnvelope)

  await selectAllSource(page)
  await page.keyboard.press('Control+Alt+k')
  await expect.poll(() => authority(page)).toMatchObject({
    markdown: '**Alpha**',
    revision: beforeSettings.revision + 1,
  })
  const persisted = await waitForSavedAuthority(page)

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  await page.locator('[data-command-id="mode.source"]').click()
  await expect.poll(() => authority(page)).toMatchObject({ markdown: '**Alpha**', revision: persisted.revision })
  await selectAllSource(page)
  await page.keyboard.press('Control+Alt+k')
  await expect.poll(() => authority(page)).toMatchObject({
    markdown: 'Alpha',
    revision: persisted.revision + 1,
  })
})

test('Task 23.4 resets persisted bindings to defaults through the keyboard with zero preference revision', async ({ page }) => {
  await openReadyApp(page)
  await useEnglishUi(page)
  await setSource(page, 'Alpha')
  const beforeSettings = await waitForSavedAuthority(page)
  let { dialog } = await openSettingsWithKeyboard(page)
  await recordShortcut(page, dialog, 'text.bold', 'Control+Alt+k')
  await applyWithKeyboard(dialog)

  ;({ dialog } = await openSettingsWithKeyboard(page))
  await expectKeycaps(dialog, 'text.bold', ['Ctrl', 'Alt', 'K'])
  const reset = dialog.getByRole('button', { exact: true, name: 'Reset to defaults' })
  await reset.focus()
  await reset.press('Enter')
  await expectKeycaps(dialog, 'text.bold', ['Ctrl', 'B'])
  await applyWithKeyboard(dialog)
  await expect.poll(() => authority(page)).toMatchObject({
    markdown: beforeSettings.markdown,
    revision: beforeSettings.revision,
  })

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  await page.locator('[data-command-id="mode.source"]').click()
  const restored = await authority(page)
  await selectAllSource(page)
  await page.keyboard.press('Control+Alt+k')
  await expect.poll(() => authority(page)).toMatchObject({
    markdown: restored.markdown,
    revision: restored.revision,
  })
  await page.keyboard.press('Control+b')
  await expect.poll(() => authority(page)).toMatchObject({
    markdown: '**Alpha**',
    revision: restored.revision + 1,
  })
})
