import type { Page } from '@playwright/test'

import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

async function authority(page: Page) {
  const snapshot = await page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read())
  if (snapshot === undefined) throw new Error('The E2E authority inspection seam is unavailable.')
  return snapshot
}

async function seedVisual(page: Page, markdown: string): Promise<void> {
  await openReadyApp(page)
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill(markdown)
  await expect.poll(() => authority(page)).toMatchObject({ markdown, synchronizationStatus: 'synchronized' })
  await page.locator('[data-command-id="mode.visual"]').click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'visual')
}

async function placeCaret(page: Page, index: number, edge: 'start' | 'end'): Promise<void> {
  await page.locator('.ProseMirror > *').nth(index).evaluate((node, side) => {
    const editor = node.closest<HTMLElement>('.ProseMirror')
    const selection = window.getSelection()
    if (editor === null || selection === null) throw new Error('Expected a mounted Visual editor.')
    const range = document.createRange()
    range.selectNodeContents(node)
    range.collapse(side === 'start')
    editor.focus()
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  }, edge)
}

function deleteForward(source: string, position: number): Readonly<{ source: string; position: number }> {
  if (source.startsWith('\n\n', position)) return { position, source: `${source.slice(0, position)}${source.slice(position + 2)}` }
  if (position >= source.length) return { position, source }
  return { position, source: `${source.slice(0, position)}${source.slice(position + 1)}` }
}

test('rapid consecutive Delete keeps the exact Markdown, synchronization, and history state', async ({ page }) => {
  test.setTimeout(60_000)
  const initial = Array.from({ length: 8 }, (_, index) => `Row ${index + 1}`).join('\n\n')
  await seedVisual(page, initial)
  await placeCaret(page, 0, 'end')

  const expected: string[] = [initial]
  let position = 'Row 1'.length
  for (let index = 0; index < 12; index += 1) {
    const next = deleteForward(expected.at(-1) ?? initial, position)
    expected.push(next.source)
    position = next.position
    await page.keyboard.press('Delete')
    await expect(page.locator('.workspace-error')).toHaveCount(0)
  }

  await expect.poll(() => authority(page)).toMatchObject({
    markdown: expected.at(-1),
    synchronizationStatus: 'synchronized',
  })
  await expect(page.locator('.workspace-error')).toHaveCount(0)

  await page.keyboard.press('Control+z')
  await expect.poll(() => authority(page)).toMatchObject({
    markdown: initial,
    synchronizationStatus: 'synchronized',
  })
  await expect(page.locator('.workspace-error')).toHaveCount(0)

  await page.keyboard.press('Control+Shift+z')
  await expect.poll(() => authority(page)).toMatchObject({
    markdown: expected.at(-1),
    synchronizationStatus: 'synchronized',
  })
  await expect(page.locator('.workspace-error')).toHaveCount(0)
})

test('rapid consecutive Backspace across explicit empty paragraphs does not lose identity or resurrect content', async ({ page }) => {
  test.setTimeout(60_000)
  const initial = ['Before', '', '', '', '', 'After'].join('\n\n')
  await seedVisual(page, initial)
  await placeCaret(page, 5, 'start')
  for (let index = 0; index < 4; index += 1) {
    await page.keyboard.press('Backspace')
    await expect(page.locator('.workspace-error')).toHaveCount(0)
  }
  await expect.poll(() => authority(page)).toMatchObject({
    markdown: 'Before\n\nAfter',
    synchronizationStatus: 'synchronized',
  })
  await expect(page.locator('.workspace-error')).toHaveCount(0)
})

test('deterministic mixed deletion stress never enters an unmapped Visual transaction', async ({ page }) => {
  test.setTimeout(60_000)
  const initial = ['Before', '', '', '', 'Middle', '', '', 'After'].join('\n\n')
  const actions = [
    { edge: 'end', index: 0, kind: 'enter' },
    { edge: 'start', index: 7, key: 'Delete', kind: 'delete' },
    { edge: 'end', index: 7, key: 'Delete', kind: 'delete' },
    { edge: 'end', index: 5, kind: 'type' },
    { edge: 'end', index: 4, kind: 'enter' },
    { edge: 'end', index: 8, key: 'Backspace', kind: 'delete' },
    { edge: 'start', index: 1, key: 'Delete', kind: 'delete' },
    { edge: 'start', index: 6, key: 'Backspace', kind: 'delete' },
    { edge: 'start', index: 4, key: 'Backspace', kind: 'delete' },
    { edge: 'start', index: 0, kind: 'enter' },
    { edge: 'end', index: 3, key: 'Backspace', kind: 'delete' },
    { kind: 'redo' },
    { edge: 'start', index: 0, key: 'Backspace', kind: 'delete' },
    { edge: 'end', index: 4, key: 'Delete', kind: 'delete' },
    { edge: 'start', index: 3, key: 'Delete', kind: 'delete' },
    { edge: 'end', index: 0, key: 'Delete', kind: 'delete' },
    { edge: 'start', index: 2, kind: 'type' },
    { edge: 'end', index: 2, key: 'Delete', kind: 'delete' },
    { edge: 'end', index: 0, key: 'Delete', kind: 'delete' },
    { edge: 'end', index: 1, kind: 'enter' },
    { edge: 'start', index: 1, kind: 'enter' },
    { edge: 'start', index: 1, key: 'Delete', kind: 'delete' },
    { edge: 'start', index: 2, kind: 'type' },
  ] as const
  await seedVisual(page, initial)
  for (const action of actions) {
    if ('index' in action && 'edge' in action) await placeCaret(page, action.index, action.edge)
    if (action.kind === 'delete') await page.keyboard.press(action.key)
    if (action.kind === 'enter') await page.keyboard.press('Enter')
    if (action.kind === 'redo') await page.keyboard.press('Control+Shift+z')
    if (action.kind === 'type') await page.keyboard.insertText('x')
    await expect(page.locator('.workspace-error')).toHaveCount(0)
  }
  await expect.poll(() => authority(page)).toMatchObject({ synchronizationStatus: 'synchronized' })
  await expect(page.locator('.workspace-error')).toHaveCount(0)
  const projectionIds = await page.locator('.ProseMirror > *').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-projection-id')))
  expect(projectionIds.every((id) => typeof id === 'string' && id.length > 0)).toBe(true)
  expect(new Set(projectionIds).size).toBe(projectionIds.length)
})

test('paced and rapid mixed paragraph edits keep the Visual projection mappable', async ({ page }) => {
  test.setTimeout(120_000)
  const initial = Array.from({ length: 12 }, (_, index) => `Paragraph ${index + 1}`).join('\n\n')
  await seedVisual(page, initial)

  const editor = page.locator('.ProseMirror')
  for (let index = 0; index < 36; index += 1) {
    const blockCount = await editor.locator(':scope > *').count()
    if (blockCount === 0) throw new Error('The mixed-edit stress case lost every Visual block.')
    await placeCaret(page, (index * 7 + 3) % blockCount, index % 2 === 0 ? 'end' : 'start')
    switch (index % 6) {
      case 0:
        await page.keyboard.press('Delete')
        break
      case 1:
        await page.keyboard.press('Backspace')
        break
      case 2:
        await page.keyboard.press('Enter')
        break
      case 3:
        await page.keyboard.insertText('x')
        break
      case 4:
        await page.keyboard.press('Delete')
        break
      default:
        await page.keyboard.press('Backspace')
        break
    }
    if (index % 6 === 5) await page.waitForTimeout(350)
    await expect(page.locator('.workspace-error')).toHaveCount(0)
  }

  await expect.poll(() => authority(page)).toMatchObject({ synchronizationStatus: 'synchronized' })
  await expect(page.locator('.workspace-error')).toHaveCount(0)
  const projectionIds = await editor.locator(':scope > *').evaluateAll((nodes) => (
    nodes.map((node) => node.getAttribute('data-projection-id'))
  ))
  expect(projectionIds.every((id) => typeof id === 'string' && id.length > 0)).toBe(true)
  expect(new Set(projectionIds).size).toBe(projectionIds.length)
})
