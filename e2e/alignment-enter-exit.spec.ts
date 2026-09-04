import type { Page } from '@playwright/test'

import { openReadyApp, useEnglishUi } from './fixtures/app'
import { expect, test } from './fixtures/test'

async function authority(page: Page) {
  const snapshot = await page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read())
  if (snapshot === undefined) throw new Error('The E2E authority inspection seam is unavailable.')
  return snapshot
}

async function seed(page: Page): Promise<void> {
  await openReadyApp(page)
  await useEnglishUi(page)
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill('Alpha\n\nBeta')
  await page.locator('[data-command-id="mode.visual"]').click()
  await expect(page.locator('.ProseMirror > p')).toHaveCount(2)
  await expect.poll(() => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().synchronizationStatus)).toBe('synchronized')
}

for (const alignment of ['left', 'center', 'right', 'justify'] as const) {
  test(`${alignment} alignment exits after two Enter presses and maps subsequent typing`, async ({ page }) => {
    await seed(page)
    const alpha = page.locator('.ProseMirror > p', { hasText: 'Alpha' })
    await alpha.evaluate((paragraph) => {
      const selection = window.getSelection()
      if (selection === null) throw new Error('Selection is unavailable.')
      const range = document.createRange()
      range.selectNodeContents(paragraph)
      selection.removeAllRanges()
      selection.addRange(range)
      ;(paragraph as HTMLElement).focus()
    })
    await page.locator('[data-toolbar-menu="alignment"] .toolbar-menu__trigger').click()
    await page.locator(`[data-command-id="align.${alignment}"]`).click()
    await expect.poll(() => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().markdown))
      .toBe(`::: ${alignment}\nAlpha\n:::\n\nBeta`)

    const aligned = page.locator(`.ProseMirror .alignment-block[data-alignment="${alignment}"] p`, { hasText: 'Alpha' })
    await aligned.click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Outside')

    await expect.poll(() => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read())).toMatchObject({
      markdown: `::: ${alignment}\nAlpha\n:::\n\nOutside\n\nBeta`,
      synchronizationStatus: 'synchronized',
    })
    await expect(page.locator('.workspace-error')).toHaveCount(0)
  })
}

test('projected alignment switches, clears, and updates child formatting', async ({ page }) => {
  await seed(page)
  const alpha = page.locator('.ProseMirror > p', { hasText: 'Alpha' })
  await alpha.evaluate((paragraph) => {
    const selection = window.getSelection()
    if (selection === null) throw new Error('Selection is unavailable.')
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    selection.removeAllRanges()
    selection.addRange(range)
    ;(paragraph as HTMLElement).focus()
  })
  await page.locator('[data-toolbar-menu="alignment"] .toolbar-menu__trigger').click()
  await page.locator('[data-command-id="align.center"]').click()
  await expect.poll(() => authority(page)).toMatchObject({
    markdown: '::: center\nAlpha\n:::\n\nBeta',
    synchronizationStatus: 'synchronized',
  })

  const aligned = page.locator('.ProseMirror .alignment-block[data-alignment="center"] p', { hasText: 'Alpha' })
  await aligned.click()
  await page.keyboard.press('End')
  await page.locator('[data-toolbar-menu="alignment"] .toolbar-menu__trigger').click()
  await page.locator('[data-command-id="align.right"]').click()
  await expect.poll(() => authority(page)).toMatchObject({
    markdown: '::: right\nAlpha\n:::\n\nBeta',
    synchronizationStatus: 'synchronized',
  })
  await expect(page.locator('.ProseMirror > .alignment-block')).toHaveCount(1)
  await expect(page.locator('.workspace-error')).toHaveCount(0)

  const switched = page.locator('.ProseMirror .alignment-block[data-alignment="right"] p', { hasText: 'Alpha' })
  await switched.click()
  await page.keyboard.press('End')
  await page.locator('[data-toolbar-menu="alignment"] .toolbar-menu__trigger').click()
  await page.locator('[data-command-id="align.right"]').click()
  await expect.poll(() => authority(page)).toMatchObject({
    markdown: 'Alpha\n\nBeta',
    synchronizationStatus: 'synchronized',
  })
  await expect(page.locator('.ProseMirror > .alignment-block')).toHaveCount(0)
  await expect(page.locator('.workspace-error')).toHaveCount(0)
})

for (const key of ['Backspace', 'Delete'] as const) {
  test(`alignment boundary ${key} remains mapped through undo and redo`, async ({ page }) => {
    await seed(page)
    const alpha = page.locator('.ProseMirror > p', { hasText: 'Alpha' })
    await alpha.evaluate((paragraph) => {
      const selection = window.getSelection()
      if (selection === null) throw new Error('Selection is unavailable.')
      const range = document.createRange()
      range.selectNodeContents(paragraph)
      selection.removeAllRanges()
      selection.addRange(range)
      ;(paragraph as HTMLElement).focus()
    })
    await page.locator('[data-toolbar-menu="alignment"] .toolbar-menu__trigger').click()
    await page.locator('[data-command-id="align.center"]').click()
    await expect.poll(() => authority(page)).toMatchObject({
      markdown: '::: center\nAlpha\n:::\n\nBeta',
      synchronizationStatus: 'synchronized',
    })

    const aligned = page.locator('.ProseMirror .alignment-block[data-alignment="center"] p', { hasText: 'Alpha' })
    await aligned.click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await expect.poll(() => authority(page)).toMatchObject({
      markdown: '::: center\nAlpha\n:::\n\n\n\nBeta',
      synchronizationStatus: 'synchronized',
    })

    await page.keyboard.press(key)
    const afterKey = key === 'Backspace'
      ? '::: center\nAlpha\n\n\n:::\n\nBeta'
      : '::: center\nAlpha\n:::\n\nBeta'
    await expect.poll(() => authority(page)).toMatchObject({
      markdown: afterKey,
      synchronizationStatus: 'synchronized',
    })
    await expect(page.locator('.workspace-error')).toHaveCount(0)

    await page.keyboard.press('Control+z')
    await expect.poll(() => authority(page)).toMatchObject({
      markdown: '::: center\nAlpha\n:::\n\n\n\nBeta',
      synchronizationStatus: 'synchronized',
    })
    await page.keyboard.press('Control+Shift+z')
    await expect.poll(() => authority(page)).toMatchObject({
      markdown: afterKey,
      synchronizationStatus: 'synchronized',
    })
    await expect(page.locator('.workspace-error')).toHaveCount(0)
  })
}
