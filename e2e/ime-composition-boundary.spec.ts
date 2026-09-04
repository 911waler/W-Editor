import type { CDPSession, Page } from '@playwright/test'

import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

type CandidateCommitOrder = 'after-compositionend' | 'before-compositionend'
type ImeTraceEvent = Readonly<Record<string, unknown>>

declare global {
  interface Window {
    readonly __W_EDITOR_IME_TRACE__?: readonly ImeTraceEvent[]
  }
}

async function authority(page: Page) {
  const snapshot = await page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read())
  if (snapshot === undefined) throw new Error('The E2E authority inspection seam is unavailable.')
  return snapshot
}

async function seedVisual(page: Page): Promise<void> {
  await openReadyApp(page)
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill('Alpha\n\nBeta')
  await expect.poll(() => authority(page)).toMatchObject({
    markdown: 'Alpha\n\nBeta',
    synchronizationStatus: 'synchronized',
  })
  await page.locator('[data-command-id="mode.visual"]').click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'visual')
  await page.locator('.ProseMirror > p').first().evaluate((element) => {
    const editor = element.closest<HTMLElement>('.ProseMirror')
    const selection = window.getSelection()
    if (editor === null || selection === null) throw new Error('Expected a mounted Visual editor.')
    const range = document.createRange()
    range.selectNodeContents(element)
    range.collapse(false)
    editor.focus()
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
}

async function installCompositionTrace(page: Page): Promise<void> {
  await page.evaluate(() => {
    const editor = document.querySelector('.ProseMirror')
    if (editor === null) throw new Error('Expected a mounted Visual editor.')
    const trace: ImeTraceEvent[] = []
    for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input']) {
      editor.addEventListener(type, (event) => {
        const input = event instanceof InputEvent ? event : null
        trace.push(Object.freeze({
          data: input?.data ?? (event instanceof CompositionEvent ? event.data : null),
          inputType: input?.inputType ?? null,
          isComposing: input?.isComposing ?? null,
          type,
        }))
      }, true)
    }
    Object.assign(globalThis, { __W_EDITOR_IME_TRACE__: trace })
  })
}

async function commitCandidate(
  page: Page,
  client: CDPSession,
  preedit: string,
  candidate: string,
  order: CandidateCommitOrder,
): Promise<void> {
  await client.send('Input.imeSetComposition', {
    selectionEnd: preedit.length,
    selectionStart: preedit.length,
    text: preedit,
  })
  await client.send('Input.dispatchKeyEvent', {
    code: 'Space',
    key: ' ',
    type: 'keyDown',
    windowsVirtualKeyCode: 32,
  })
  await client.send('Input.dispatchKeyEvent', {
    code: 'Space',
    key: ' ',
    type: 'keyUp',
    windowsVirtualKeyCode: 32,
  })
  if (order === 'before-compositionend') await client.send('Input.insertText', { text: candidate })
  await client.send('Input.imeSetComposition', { selectionEnd: 0, selectionStart: 0, text: '' })
  if (order === 'after-compositionend') await client.send('Input.insertText', { text: candidate })
}

async function imeTrace(page: Page): Promise<readonly ImeTraceEvent[]> {
  return await page.evaluate(() => window.__W_EDITOR_IME_TRACE__ ?? [])
}

for (const order of ['before-compositionend', 'after-compositionend'] as const) {
  test(`consecutive Chinese IME candidates synchronize (${order})`, async ({ page }) => {
    test.setTimeout(60_000)
    await seedVisual(page)
    await installCompositionTrace(page)
    const client = await page.context().newCDPSession(page)
    await commitCandidate(page, client, 'ni', '你', order)
    await commitCandidate(page, client, 'hao', '好', order)

    await expect.poll(() => authority(page)).toMatchObject({
      markdown: 'Alpha你好\n\nBeta',
      synchronizationStatus: 'synchronized',
    })
    await expect(page.locator('.workspace-error')).toHaveCount(0)
    await expect(page.locator('.ProseMirror > p').first()).toHaveText('Alpha你好')

    const trace = await imeTrace(page)
    expect(trace.filter((event) => event['type'] === 'compositionstart')).toHaveLength(2)
    expect(trace.filter((event) => event['type'] === 'compositionend')).toHaveLength(2)
    expect(trace.some((event) => event['inputType'] === 'insertCompositionText' && event['isComposing'] === true)).toBe(true)
    if (order === 'after-compositionend') {
      expect(trace.some((event) => event['inputType'] === 'insertText')).toBe(true)
    }

    await page.keyboard.press('Control+z')
    await expect.poll(() => authority(page)).toMatchObject({
      markdown: 'Alpha\n\nBeta',
      synchronizationStatus: 'synchronized',
    })
    await page.keyboard.press('Control+Shift+z')
    await expect.poll(() => authority(page)).toMatchObject({
      markdown: 'Alpha你好\n\nBeta',
      synchronizationStatus: 'synchronized',
    })
    await expect(page.locator('.workspace-error')).toHaveCount(0)
  })
}
