import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

async function openSingleParagraphVisual(page: Parameters<typeof openReadyApp>[0]): Promise<void> {
  await openReadyApp(page)
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill('Alpha')
  await expect.poll(() => authority(page)).toMatchObject({ markdown: 'Alpha', synchronizationStatus: 'synchronized' })
  await page.locator('[data-command-id="mode.visual"]').click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'visual')
  const paragraph = page.locator('.ProseMirror p').first()
  await paragraph.click()
  await page.keyboard.press('Control+End')
  await expect.poll(() => paragraph.evaluate((node) => {
    const selection = window.getSelection()
    return {
      activeVisual: document.activeElement?.classList.contains('ProseMirror') === true,
      inParagraph: selection?.anchorNode === node.firstChild,
      offset: selection?.anchorOffset,
    }
  })).toEqual({ activeVisual: true, inParagraph: true, offset: 5 })
}

async function authority(page: Parameters<typeof openReadyApp>[0]) {
  return page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read())
}

test('real Enter and continued typing converge through Source, undo, reload, and controlled rhythm', async ({ page }) => {
  await openSingleParagraphVisual(page)
  const visual = page.locator('.ProseMirror')

  await page.keyboard.press('Enter')
  await page.keyboard.type('Bravo')

  const paragraphs = visual.locator('p')
  await expect(paragraphs).toHaveCount(2)
  await expect(paragraphs.nth(0)).toHaveText('Alpha')
  await expect(paragraphs.nth(1)).toHaveText('Bravo')
  const editingState = await paragraphs.evaluateAll((nodes) => {
    const ids = nodes.map((node) => node.getAttribute('data-projection-id')).filter((id) => id !== null)
    const first = nodes[0]?.getBoundingClientRect()
    const second = nodes[1]?.getBoundingClientRect()
    const style = nodes[0] === undefined ? null : getComputedStyle(nodes[0])
    const selection = window.getSelection()
    const selectedParagraph = selection?.anchorNode instanceof Node
      ? selection.anchorNode.parentElement?.closest('p')
      : null
    return {
      activeVisual: document.activeElement?.classList.contains('ProseMirror') === true,
      gap: first === undefined || second === undefined ? null : second.top - first.bottom,
      ids,
      lineHeight: style?.lineHeight ?? null,
      selectedText: selectedParagraph?.textContent ?? null,
      selectionOffset: selection?.anchorOffset ?? null,
    }
  })
  expect(new Set(editingState.ids).size).toBe(editingState.ids.length)
  expect(editingState).toMatchObject({
    activeVisual: true,
    gap: 16,
    lineHeight: '28px',
    selectedText: 'Bravo',
    selectionOffset: 5,
  })
  await expect(page.locator('.status-region')).not.toContainText('failed')
  await expect.poll(() => authority(page)).toMatchObject({
    markdown: 'Alpha\n\nBravo',
    revision: 2,
    synchronizationStatus: 'synchronized',
  })

  await page.keyboard.press('Control+z')
  await expect.poll(() => authority(page)).toMatchObject({ markdown: 'Alpha', revision: 3 })
  await expect(paragraphs).toHaveCount(1)
  await page.keyboard.press('Control+Shift+z')
  await expect.poll(() => authority(page)).toMatchObject({ markdown: 'Alpha\n\nBravo', revision: 4 })

  await page.locator('[data-command-id="mode.source"]').click()
  await expect(page.locator('#markdown-source-editor')).toBeVisible()
  await expect(page.locator('#markdown-source-editor').locator('.cm-line')).toHaveCount(3)
  await expect(page.locator('#markdown-source-editor').locator('.cm-line').nth(2)).toHaveText('Bravo')
  await expect(page.locator('#markdown-source-editor')).toBeFocused()

  await expect.poll(() => authority(page)).toMatchObject({ autosaveStatus: 'saved' })
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  await expect.poll(() => authority(page)).toMatchObject({ markdown: 'Alpha\n\nBravo' })
  await expect(page.locator('.status-region')).not.toContainText('failed')
})

test('real Shift+Enter stays one paragraph and serializes the exact hard-break source', async ({ page }) => {
  await openSingleParagraphVisual(page)

  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('Bravo')

  const visual = page.locator('.ProseMirror')
  await expect(visual.locator('p')).toHaveCount(1)
  await expect(visual.locator('p br')).toHaveCount(1)
  await expect(visual.locator('p')).toHaveText('AlphaBravo')
  await expect.poll(() => authority(page)).toMatchObject({
    markdown: 'Alpha  \nBravo',
    revision: 2,
    synchronizationStatus: 'synchronized',
  })

  await page.locator('[data-command-id="mode.source"]').click()
  await expect(page.locator('#markdown-source-editor').locator('.cm-line')).toHaveCount(2)
  await expect(page.locator('#markdown-source-editor').locator('.cm-line').nth(0)).toHaveText('Alpha  ')
  await expect(page.locator('#markdown-source-editor').locator('.cm-line').nth(1)).toHaveText('Bravo')
})
