import type { Locator, Page } from '@playwright/test'

import { openReadyApp, useEnglishUi } from './fixtures/app'
import { countNonWhitePixelsAtRightEdge, countPixelsNear, decodePng } from './fixtures/png'
import { expect, test } from './fixtures/test'

const JUSTIFY_FIXTURES = Object.freeze([
  Object.freeze({
    body: 'Short justified line Z',
    label: 'single-line',
    minimumLines: 1,
  }),
  Object.freeze({
    body: `${'这是用于验证两端对齐最终视觉行的确定性中文内容。'.repeat(8)}\n终点界`,
    label: 'multiline Chinese',
    minimumLines: 2,
  }),
  Object.freeze({
    body: `${'This deterministic English paragraph verifies that justification reaches the available editing width. '.repeat(8)}\nEND Z`,
    label: 'multiline English',
    minimumLines: 2,
  }),
])

const TIMELINE_ALL_STATES = [
  '::: timeline Release plan',
  ':: [done] 2026-01-15 Complete',
  '  Stable completed item',
  ':: [doing] 2026-03-20 Active',
  '  Stable active item',
  ':: [todo] 2026-06-01 Planned',
  '  Stable planned item',
  ':: [error] 2026-07-01 Failed',
  '  Stable error item',
  ':: [milestone] 2026-08-01 Milestone',
  '  Stable milestone item',
  ':::',
].join('\n')

const TIMELINE_STATUS_COLORS = Object.freeze([
  Object.freeze({ blue: 87, green: 192, red: 64 }),
  Object.freeze({ blue: 230, green: 139, red: 34 }),
  Object.freeze({ blue: 189, green: 181, red: 173 }),
  Object.freeze({ blue: 5, green: 176, red: 250 }),
  Object.freeze({ blue: 107, green: 107, red: 255 }),
])

const INLINE_INITIAL = '**Prefix `inline code` suffix**'
const INLINE_EDITED = '**Prefix `inline-edited code` suffix**'

async function authorityMarkdown(page: Page): Promise<string | undefined> {
  return page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().markdown)
}

async function expectMarkdown(page: Page, markdown: string): Promise<void> {
  await expect.poll(() => authorityMarkdown(page)).toBe(markdown)
  await expect.poll(() => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().synchronizationStatus)).toBe('synchronized')
}

async function setMarkdown(page: Page, markdown: string): Promise<void> {
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill(markdown)
  await expectMarkdown(page, markdown)
}

async function expectSourceLiteral(page: Page, markdown: string): Promise<void> {
  await expect.poll(() => page.locator('#markdown-source-editor').evaluate((element) => (
    (element as HTMLElement).innerText.replace(/\r\n/gu, '\n')
  ))).toBe(markdown)
}

async function selectAllSource(page: Page): Promise<void> {
  await page.locator('#markdown-source-editor').click()
  await page.keyboard.press('Control+A')
}

async function switchMode(page: Page, mode: 'preview' | 'source' | 'visual'): Promise<void> {
  await page.locator(`.workspace-controls [data-command-id="mode.${mode}"]`).click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', mode)
}

async function preparePage(page: Page): Promise<void> {
  await page.setViewportSize({ height: 1000, width: 1440 })
  await openReadyApp(page)
  await useEnglishUi(page)
  await page.locator('[data-toolbar-menu="theme"] .toolbar-menu__trigger').click()
  await page.locator('[data-theme-option="default"]').click()
  await page.addStyleTag({
    content: '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }',
  })
}

async function scopedScreenshot(locator: Locator): Promise<Readonly<{ height: number; image: ReturnType<typeof decodePng>; width: number }>> {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  const image = decodePng(await locator.screenshot({ animations: 'disabled', caret: 'hide' }))
  const expectedWidth = Math.ceil((box?.x ?? 0) + (box?.width ?? 0)) - Math.floor(box?.x ?? 0)
  const expectedHeight = Math.ceil((box?.y ?? 0) + (box?.height ?? 0)) - Math.floor(box?.y ?? 0)
  expect(image.width).toBe(expectedWidth)
  expect(image.height).toBe(expectedHeight)
  return Object.freeze({ height: image.height, image, width: image.width })
}

async function expectForcedLastLine(locator: Locator, minimumLines: number): Promise<void> {
  const metrics = await locator.evaluate((element) => {
    const owner = element as HTMLElement
    const ownerBox = owner.getBoundingClientRect()
    const walker = document.createTreeWalker(owner, NodeFilter.SHOW_TEXT)
    const rectangles: Array<{ bottom: number; left: number; right: number; top: number }> = []
    let textNode = walker.nextNode()
    while (textNode !== null) {
      const text = textNode.textContent ?? ''
      for (let offset = 0; offset < text.length; offset += 1) {
        if (/\s/u.test(text[offset] ?? '')) continue
        const range = document.createRange()
        range.setStart(textNode, offset)
        range.setEnd(textNode, offset + 1)
        const rect = range.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) rectangles.push({ bottom: rect.bottom, left: rect.left, right: rect.right, top: rect.top })
      }
      textNode = walker.nextNode()
    }
    const lineTops = [...new Set(rectangles.map((rect) => Math.round(rect.top * 2) / 2))].sort((left, right) => left - right)
    const lastTop = lineTops.at(-1)
    const lastLine = rectangles.filter((rect) => lastTop !== undefined && Math.abs(rect.top - lastTop) <= 1)
    const style = getComputedStyle(owner)
    return {
      blockLeft: ownerBox.left,
      blockRight: ownerBox.right,
      lastLeft: Math.min(...lastLine.map((rect) => rect.left)),
      lastRight: Math.max(...lastLine.map((rect) => rect.right)),
      lineCount: lineTops.length,
      textAlign: style.textAlign,
      textAlignLast: style.textAlignLast,
    }
  })
  expect(metrics.lineCount).toBeGreaterThanOrEqual(minimumLines)
  expect(metrics.textAlign).toBe('justify')
  expect(metrics.textAlignLast).toBe('justify')
  expect(Math.abs(metrics.lastLeft - metrics.blockLeft)).toBeLessThanOrEqual(3)
  expect(Math.abs(metrics.blockRight - metrics.lastRight)).toBeLessThanOrEqual(3)
  const capture = await scopedScreenshot(locator)
  expect(countNonWhitePixelsAtRightEdge(capture.image, 12)).toBeGreaterThan(0)
}

test.describe('Task 21.4 UA-010 forced Justify regressions', () => {
  for (const fixture of JUSTIFY_FIXTURES) {
    test(`${fixture.label} preserves Source and fills the Visual and Final last line`, async ({ page }) => {
      await preparePage(page)
      await setMarkdown(page, fixture.body)
      await selectAllSource(page)
      await page.locator('[data-toolbar-menu="alignment"] .toolbar-menu__trigger').click()
      await page.locator('[data-command-id="align.justify"]').click()
      const justified = `::: justify\n${fixture.body}\n:::`
      await expectMarkdown(page, justified)
      await expectSourceLiteral(page, justified)
      await page.locator('[data-command-id="history.undo"]').click()
      await expectMarkdown(page, fixture.body)
      await page.locator('[data-command-id="history.redo"]').click()
      await expectMarkdown(page, justified)

      await switchMode(page, 'visual')
      await expectForcedLastLine(page.locator('.ProseMirror .alignment-block[data-alignment="justify"] > :is(p, h1, h2, h3, h4, h5)').first(), fixture.minimumLines)

      await switchMode(page, 'preview')
      await expectForcedLastLine(page.locator('.preview-rendered-content .alignment-block[data-alignment="justify"] > :is(p, h1, h2, h3, h4, h5)').first(), fixture.minimumLines)

      await switchMode(page, 'source')
      await expectSourceLiteral(page, justified)
      await expect.poll(() => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().autosaveStatus)).toBe('saved')
      await page.reload()
      await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
      await expectMarkdown(page, justified)
    })
  }
})

test('Task 21.4 UA-011 Visual Timeline uses the Cherry hierarchy and pixels for every supported state', async ({ page }) => {
  await preparePage(page)
  await setMarkdown(page, TIMELINE_ALL_STATES)
  await switchMode(page, 'visual')

  const node = page.locator('.ProseMirror [data-semantic-kind="timeline"]')
  const timeline = node.locator('.cherry-markdown .cherry-timeline')
  await expect(timeline.locator('.cherry-timeline--header')).toHaveText('Release plan')
  const items = timeline.locator('.cherry-timeline--body > .cherry-timeline--item')
  await expect(items).toHaveCount(5)
  for (const [index, status] of ['done', 'doing', 'todo', 'error', 'milestone'].entries()) {
    const item = items.nth(index)
    await expect(item).toHaveClass(new RegExp(`cherry-timeline--item__${status}`, 'u'))
    await expect(item).toHaveAttribute('data-timeline-status', status)
    await expect(item.locator('.cherry-timeline--node')).toHaveCount(1)
    await expect(item.locator('.cherry-timeline--content > .cherry-timeline--time')).toHaveCount(1)
    await expect(item.locator('.cherry-timeline--content > .cherry-timeline--title')).toHaveCount(1)
    await expect(item.locator('.cherry-timeline--content > .cherry-timeline--desc')).toHaveCount(1)
  }

  const geometry = await items.evaluateAll((elements) => elements.map((element) => {
    const marker = element.querySelector<HTMLElement>('.cherry-timeline--node')
    if (marker === null) throw new Error('Timeline state is missing its marker.')
    const markerBox = marker.getBoundingClientRect()
    const connector = getComputedStyle(element, '::before')
    return {
      connectorBackground: connector.backgroundColor === 'rgba(0, 0, 0, 0)' ? connector.backgroundImage : connector.backgroundColor,
      markerCenter: markerBox.left + markerBox.width / 2,
      markerColor: getComputedStyle(marker).backgroundColor,
    }
  }))
  expect(new Set(geometry.map(({ markerCenter }) => Math.round(markerCenter * 2) / 2)).size).toBe(1)
  expect(new Set(geometry.map(({ markerColor }) => markerColor)).size).toBeGreaterThanOrEqual(4)
  expect(geometry.every(({ connectorBackground }) => connectorBackground !== 'none' && connectorBackground !== 'rgba(0, 0, 0, 0)')).toBe(true)
  const capture = await scopedScreenshot(node)
  for (const color of TIMELINE_STATUS_COLORS) expect(countPixelsNear(capture.image, color, 5)).toBeGreaterThan(3)

  await node.hover()
  const edit = node.locator('[data-semantic-edit="timeline-editor"]')
  await expect(edit).toBeVisible()
  await edit.click()
  const dialog = page.locator('[data-picker-command="layout.timeline"]')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('#timeline-source')).toHaveValue(TIMELINE_ALL_STATES)
  const invalid = TIMELINE_ALL_STATES.replace('[error]', '[unknown]')
  await dialog.locator('#timeline-source').fill(invalid)
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('alert')).toContainText('valid Timeline source')
  await expectMarkdown(page, TIMELINE_ALL_STATES)

  const updated = TIMELINE_ALL_STATES.replace('Release plan', 'Release plan updated')
  await dialog.locator('#timeline-source').fill(updated)
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expectMarkdown(page, updated)

  await node.hover()
  await node.locator('[data-semantic-edit="timeline-editor"]').click()
  await page.locator('#timeline-source').fill(updated.replace('updated', 'cancelled'))
  await page.locator('[data-picker-command="layout.timeline"]').getByRole('button', { name: 'Cancel', exact: true }).click()
  await expectMarkdown(page, updated)
  await page.locator('[data-command-id="history.undo"]').click()
  await expectMarkdown(page, TIMELINE_ALL_STATES)
  await page.locator('[data-command-id="history.redo"]').click()
  await expectMarkdown(page, updated)

  await switchMode(page, 'preview')
  const finalTimeline = page.locator('.preview-rendered-content .cherry-timeline')
  await expect(finalTimeline.locator('.cherry-timeline--item')).toHaveCount(5)
  await scopedScreenshot(finalTimeline)
  await expect.poll(() => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().autosaveStatus)).toBe('saved')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  await expectMarkdown(page, updated)
})

test('Task 21.4 UA-015 inline code keeps the same Tiptap presentation in read-only Preview without mark loss', async ({ page }) => {
  await preparePage(page)
  await setMarkdown(page, INLINE_INITIAL)
  await switchMode(page, 'visual')

  const code = page.locator('.ProseMirror code')
  await expect(code).toHaveCount(1)
  await expect(code).toHaveText('inline code')
  expect(await code.evaluate((element) => element.closest('strong') !== null || element.querySelector('strong') !== null)).toBe(true)
  await code.evaluate((element) => {
    const text = element.firstChild
    if (text === null || text.nodeType !== Node.TEXT_NODE) throw new Error('Expected directly editable inline-code text.')
    const range = document.createRange()
    range.setStart(text, 'inline'.length)
    range.collapse(true)
    const selection = window.getSelection()
    if (selection === null) throw new Error('Browser selection is unavailable.')
    selection.removeAllRanges()
    selection.addRange(range)
    ;(element.closest('.ProseMirror') as HTMLElement | null)?.focus()
    document.dispatchEvent(new Event('selectionchange'))
  })
  await page.keyboard.type('-edited')
  await expectMarkdown(page, INLINE_EDITED)
  await expect(code).toHaveText('inline-edited code')

  const visualStyle = await code.evaluate((element) => {
    const text = element.firstChild
    if (text === null || text.nodeType !== Node.TEXT_NODE) throw new Error('Expected directly selectable inline-code text.')
    const range = document.createRange()
    range.setStart(text, 'inline-'.length)
    range.setEnd(text, 'inline-edited'.length)
    const selection = window.getSelection()
    if (selection === null) throw new Error('Browser selection is unavailable.')
    selection.removeAllRanges()
    selection.addRange(range)
    const style = getComputedStyle(element)
    const selectionStyle = getComputedStyle(element, '::selection')
    return {
      background: style.backgroundColor,
      borderRadius: style.borderRadius,
      fontFamily: style.fontFamily,
      paddingLeft: style.paddingLeft,
      paddingRight: style.paddingRight,
      selectedText: selection.toString(),
      selectionBackground: selectionStyle.backgroundColor,
    }
  })
  expect(visualStyle).toMatchObject({
    background: 'rgb(243, 244, 246)',
    borderRadius: '4px',
    paddingLeft: '4px',
    paddingRight: '4px',
    selectedText: 'edited',
    selectionBackground: 'rgb(165, 216, 255)',
  })
  expect(visualStyle.fontFamily).toContain('ui-monospace')
  const visualCapture = await scopedScreenshot(code)
  expect(countPixelsNear(visualCapture.image, { blue: 246, green: 244, red: 243 }, 4)).toBeGreaterThan(visualCapture.width * visualCapture.height * 0.35)

  await page.locator('[data-command-id="history.undo"]').click()
  await expectMarkdown(page, INLINE_INITIAL)
  await page.locator('[data-command-id="history.redo"]').click()
  await expectMarkdown(page, INLINE_EDITED)

  await switchMode(page, 'preview')
  const finalCode = page.locator('.preview-rendered-content :not(pre) > code').filter({ hasText: 'inline-edited code' })
  await expect(finalCode).toHaveCount(1)
  const finalStyle = await finalCode.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      background: style.backgroundColor,
      borderRadius: style.borderRadius,
      fontFamily: style.fontFamily,
      paddingLeft: style.paddingLeft,
      paddingRight: style.paddingRight,
    }
  })
  expect(finalStyle).toMatchObject({
    background: visualStyle.background,
    borderRadius: visualStyle.borderRadius,
    paddingLeft: visualStyle.paddingLeft,
    paddingRight: visualStyle.paddingRight,
  })
  expect(finalStyle.fontFamily).toBe(visualStyle.fontFamily)
  const finalCapture = await scopedScreenshot(finalCode)
  expect(countPixelsNear(finalCapture.image, { blue: 246, green: 244, red: 243 }, 4)).toBeGreaterThan(finalCapture.width * finalCapture.height * 0.35)

  await switchMode(page, 'source')
  await expectSourceLiteral(page, INLINE_EDITED)
  await expect.poll(() => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().autosaveStatus)).toBe('saved')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  await expectMarkdown(page, INLINE_EDITED)
})
