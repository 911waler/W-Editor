import type { Page } from '@playwright/test'

import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

async function authority(page: Page) {
  const snapshot = await page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read())
  if (snapshot === undefined) throw new Error('The E2E authority inspection seam is unavailable.')
  return snapshot
}

async function placeCaretAtDocumentEnd(page: Page): Promise<void> {
  await page.locator('.ProseMirror').evaluate((editor) => {
    const selection = window.getSelection()
    if (selection === null) throw new Error('Selection is unavailable.')
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
    ;(editor as HTMLElement).focus()
    document.dispatchEvent(new Event('selectionchange'))
  })
}

async function recordWorkspaceErrors(page: Page): Promise<void> {
  await page.evaluate(() => {
    const key = '__W_EDITOR_CONTINUOUS_INPUT_ERRORS__'
    const errors: string[] = []
    const record = (): void => {
      const message = document.querySelector('.workspace-error')?.textContent?.trim()
      if (message !== undefined && message.length > 0 && !errors.includes(message)) errors.push(message)
    }
    const observer = new MutationObserver(record)
    observer.observe(document.body, { attributes: true, childList: true, characterData: true, subtree: true })
    Object.assign(globalThis, { [key]: errors })
  })
}

async function capturedWorkspaceErrors(page: Page): Promise<readonly string[]> {
  return await page.evaluate(() => {
    const errors = (globalThis as typeof globalThis & { readonly __W_EDITOR_CONTINUOUS_INPUT_ERRORS__?: unknown })
      .__W_EDITOR_CONTINUOUS_INPUT_ERRORS__
    return Array.isArray(errors) ? errors.filter((value): value is string => typeof value === 'string') : []
  })
}

const chineseInput = Array.from({ length: 500 }, (_, index) => '中文输入测试'[index % 6]).join('')
const englishInput = Array.from({ length: 500 }, (_, index) => String.fromCharCode(97 + (index % 26))).join('')

test('500 Chinese characters remain synchronized as one continuous input', async ({ page }) => {
  test.setTimeout(60_000)
  await openReadyApp(page)
  await expect.poll(() => authority(page)).toMatchObject({ synchronizationStatus: 'synchronized' })
  await recordWorkspaceErrors(page)
  await placeCaretAtDocumentEnd(page)
  await page.keyboard.insertText(chineseInput)

  await expect.poll(() => authority(page)).toMatchObject({ synchronizationStatus: 'synchronized' })
  expect(await capturedWorkspaceErrors(page)).toEqual([])
  await expect(page.locator('.workspace-error')).toHaveCount(0)
  await expect(page.locator('.ProseMirror')).toContainText(chineseInput)
})

test('500 English characters remain synchronized during continuous key input', async ({ page }) => {
  test.setTimeout(60_000)
  await openReadyApp(page)
  await expect.poll(() => authority(page)).toMatchObject({ synchronizationStatus: 'synchronized' })
  await recordWorkspaceErrors(page)
  await placeCaretAtDocumentEnd(page)
  await page.keyboard.type(englishInput, { delay: 0 })

  await expect.poll(() => authority(page)).toMatchObject({ synchronizationStatus: 'synchronized' })
  expect(await capturedWorkspaceErrors(page)).toEqual([])
  await expect(page.locator('.workspace-error')).toHaveCount(0)
  await expect(page.locator('.ProseMirror')).toContainText(englishInput)
})
