import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { Locator, Page } from '@playwright/test'

import {
  chartTableStarterSource,
  columnLayoutStarterSource,
  disclosureStarterSource,
  mermaidSource,
} from '../src/codecs'
import { openReadyApp, useEnglishUi } from './fixtures/app'
import { expect, test } from './fixtures/test'

const welcomeMarkdown = readFileSync(resolve(process.cwd(), 'apps/playground/src/content/articles/welcome.md'), 'utf8')

async function authority(page: Page) {
  return page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read())
}

async function expectMarkdown(page: Page, markdown: string): Promise<void> {
  await expect.poll(async () => (await authority(page))?.markdown).toBe(markdown)
  await expect.poll(async () => (await authority(page))?.synchronizationStatus).toBe('synchronized')
}

async function prepare(page: Page, markdown: string): Promise<void> {
  await openReadyApp(page)
  await useEnglishUi(page)
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill(markdown)
  await expectMarkdown(page, markdown)
}

async function switchToVisual(page: Page): Promise<void> {
  await page.locator('[data-command-id="mode.visual"]').click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'visual')
}

async function selectParagraph(page: Page, text: string): Promise<void> {
  const paragraph = page.locator('.ProseMirror p', { hasText: text }).first()
  await expect(paragraph).toBeVisible()
  await paragraph.evaluate((element) => {
    const selection = window.getSelection()
    if (selection === null) throw new Error('Browser selection is unavailable.')
    const range = document.createRange()
    range.selectNodeContents(element)
    selection.removeAllRanges()
    selection.addRange(range)
    ;(element as HTMLElement).focus()
    document.dispatchEvent(new Event('selectionchange'))
  })
}

async function applyAlignment(page: Page, text: string, alignment: 'center' | 'right'): Promise<void> {
  await selectParagraph(page, text)
  await page.locator('[data-toolbar-menu="alignment"] .toolbar-menu__trigger').click()
  await page.locator(`[data-command-id="align.${alignment}"]`).click()
}

async function applyAlignmentAt(page: Page, index: number, alignment: 'center' | 'right'): Promise<void> {
  const paragraph = page.locator('.ProseMirror p').nth(index)
  await expect(paragraph).toBeVisible()
  await paragraph.evaluate((element) => {
    const selection = window.getSelection()
    if (selection === null) throw new Error('Browser selection is unavailable.')
    const range = document.createRange()
    range.selectNodeContents(element)
    selection.removeAllRanges()
    selection.addRange(range)
    ;(element as HTMLElement).focus()
    document.dispatchEvent(new Event('selectionchange'))
  })
  await page.locator('[data-toolbar-menu="alignment"] .toolbar-menu__trigger').click()
  await page.locator(`[data-command-id="align.${alignment}"]`).click()
}

async function setVisualCaretAtEnd(page: Page): Promise<void> {
  await page.locator('.ProseMirror').evaluate((editor) => {
    const block = editor.lastElementChild
    if (!(block instanceof HTMLElement)) throw new Error('Expected a final Visual block.')
    const selection = window.getSelection()
    if (selection === null) throw new Error('Browser selection is unavailable.')
    const range = document.createRange()
    range.selectNodeContents(block)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
    ;(editor as HTMLElement).focus()
    document.dispatchEvent(new Event('selectionchange'))
  })
}

async function openInsertCommand(page: Page, commandId: string): Promise<void> {
  await page.locator('[data-toolbar-menu="insert"] .toolbar-menu__trigger').click()
  await page.locator(`[data-command-id="${commandId}"]`).click()
}

function visibleLabel(root: SVGElement, label: string): boolean {
    const candidates = [...root.querySelectorAll<HTMLElement | SVGElement>('text, foreignObject *')]
      .filter((candidate) => candidate.textContent?.trim() === label)
    return candidates.some((candidate) => {
      const rect = candidate.getBoundingClientRect()
      const style = getComputedStyle(candidate)
      return rect.width > 0
        && rect.height > 0
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || '1') > 0
    })
}

test('UAT-DTR-002 collapses a full Visual selection and scrolls the caret into view', async ({ page }) => {
  const markdown = Array.from({ length: 240 }, (_, index) => `Paragraph ${String(index + 1).padStart(3, '0')} — long viewport regression content`).join('\n\n')
  await page.setViewportSize({ height: 640, width: 1100 })
  await prepare(page, markdown)
  await switchToVisual(page)
  const editor = page.locator('.ProseMirror')
  const scroller = page.getByTestId('editor-surface')
  const maxScroll = await scroller.evaluate((element) => element.scrollHeight - element.clientHeight)
  expect(maxScroll).toBeGreaterThan(2_000)

  await scroller.evaluate((element) => { element.scrollTop = element.scrollHeight })
  await editor.click({ position: { x: 20, y: 20 } })
  await page.keyboard.press('Control+a')
  await page.keyboard.press('ArrowLeft')
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeLessThan(40)
  await expect(editor.locator('p').first()).toBeInViewport()

  await scroller.evaluate((element) => { element.scrollTop = 0 })
  await editor.click({ position: { x: 20, y: 20 } })
  await page.keyboard.press('Control+a')
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(maxScroll - 160)
  await expect(editor.locator('p').last()).toBeInViewport()
})

test('UAT-DTR-003 exposes a rainbow hue track whose input changes the chosen color', async ({ page }) => {
  await prepare(page, 'Alpha')
  const source = page.locator('#markdown-source-editor')
  await source.click()
  await page.keyboard.press('Control+a')
  await page.locator('[data-toolbar-menu="color"] .toolbar-menu__trigger').click()
  const picker = page.locator('[data-picker-command="text.color"]')
  const hue = picker.getByRole('slider', { name: 'Hue' })
  const chosen = picker.locator('#rich-picker-value')
  await expect(hue).toBeVisible()
  const backgroundImage = await hue.evaluate((element) => getComputedStyle(element).backgroundImage)
  expect(backgroundImage).toContain('linear-gradient')
  const before = await chosen.inputValue()
  await hue.evaluate((element) => {
    if (!(element instanceof HTMLInputElement)) throw new TypeError('Expected the hue range input.')
    element.value = '120'
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await expect.poll(() => chosen.inputValue()).not.toBe(before)
})

test('UAT-DTR-005 preserves nested task-list structure and indentation in Final Preview', async ({ page }) => {
  const markdown = '- [ ] Parent\n- [ ] Child'
  await prepare(page, markdown)
  await switchToVisual(page)
  const child = page.locator('.ProseMirror ul[data-type="taskList"] > li').nth(1).locator('p')
  await child.click()
  await page.keyboard.press('Tab')
  await expectMarkdown(page, '- [ ] Parent\n      - [ ] Child')
  await expect(page.locator('.ProseMirror ul[data-type="taskList"] ul[data-type="taskList"]')).toHaveCount(1)
  await page.locator('[data-command-id="mode.preview"]').click()
  const preview = page.locator('.visual-surface[data-mode="preview"] .ProseMirror')
  const nested = preview.locator('ul li ul')
  await expect(nested).toHaveCount(1)
  const geometry = await preview.getByText('Child', { exact: true }).locator('xpath=ancestor::li[1]').evaluate((item) => {
    const parent = item.parentElement?.parentElement?.closest('li')
    if (parent === null || parent === undefined) return null
    return {
      childLeft: item.getBoundingClientRect().left,
      parentLeft: parent.getBoundingClientRect().left,
    }
  })
  expect(geometry).not.toBeNull()
  expect(geometry!.childLeft).toBeGreaterThan(geometry!.parentLeft)
})

test('UAT-DTR-001 reuses the mounted Visual Tiptap presentation as a read-only Preview', async ({ page }) => {
  const initial = Array.from({ length: 80 }, (_, index) => (
    index === 0 ? '# Shared presentation' : `Paragraph ${String(index).padStart(2, '0')}`
  )).join('\n\n')
  await page.setViewportSize({ height: 640, width: 1100 })
  await prepare(page, initial)
  await switchToVisual(page)

  const editor = page.locator('.visual-surface .ProseMirror')
  const scroller = page.getByTestId('editor-surface')
  await expect(editor).toHaveAttribute('contenteditable', 'true')
  await editor.evaluate((element) => {
    ;(window as Window & { __uatDtr001VisualPresentation?: Element }).__uatDtr001VisualPresentation = element
  })
  await setVisualCaretAtEnd(page)
  await page.keyboard.type('!')
  const edited = `${initial}!`
  await expectMarkdown(page, edited)
  const revisionBeforePreview = (await authority(page))?.revision
  if (revisionBeforePreview === undefined) throw new Error('Authority inspection is unavailable.')
  await scroller.evaluate((element) => { element.scrollTop = Math.round(element.scrollHeight * 0.45) })
  const scrollBeforePreview = await scroller.evaluate((element) => element.scrollTop)
  expect(scrollBeforePreview).toBeGreaterThan(200)
  const viewportAnchor = await scroller.evaluate((element) => {
    const viewport = element.getBoundingClientRect()
    const paragraph = [...element.querySelectorAll<HTMLElement>('.ProseMirror > p')]
      .find((candidate) => candidate.getBoundingClientRect().bottom > viewport.top + 40)
    if (paragraph === undefined) throw new Error('Expected a visible paragraph anchor.')
    return {
      text: paragraph.textContent ?? '',
      top: paragraph.getBoundingClientRect().top - viewport.top,
    }
  })

  await page.locator('[data-command-id="mode.preview"]').click()
  await expect(scroller).toHaveAttribute('data-mode', 'preview')
  await expect(page.locator('.visual-surface')).toHaveAttribute('data-mode', 'preview')
  await expect(editor).toBeVisible()
  await expect(editor).toHaveAttribute('contenteditable', 'false')
  expect(await editor.evaluate((element) => (
    (window as Window & { __uatDtr001VisualPresentation?: Element }).__uatDtr001VisualPresentation === element
  ))).toBe(true)
  await expect(editor).toHaveAttribute('data-presentation-engine', 'tiptap')
  expect(await page.locator('.preview-rendered-content').evaluate((element) => (
    (window as Window & { __uatDtr001VisualPresentation?: Element }).__uatDtr001VisualPresentation === element
  ))).toBe(true)
  await expect(page.locator('.visual-block-context')).toBeHidden()
  expect((await authority(page))?.revision).toBe(revisionBeforePreview)
  const previewAnchorTop = await page.getByText(viewportAnchor.text, { exact: true }).evaluate((element) => {
    const scroller = element.closest<HTMLElement>('[data-testid="editor-surface"]')
    if (scroller === null) throw new Error('Expected the editor scroller.')
    return element.getBoundingClientRect().top - scroller.getBoundingClientRect().top
  })
  expect(Math.abs(previewAnchorTop - viewportAnchor.top)).toBeLessThan(1)
  await page.locator('.visual-surface').focus()
  await page.keyboard.type('x')
  await expectMarkdown(page, edited)

  await page.locator('[data-command-id="mode.visual"]').click()
  await expect(scroller).toHaveAttribute('data-mode', 'visual')
  await expect(editor).toHaveAttribute('contenteditable', 'true')
  expect(await editor.evaluate((element) => (
    (window as Window & { __uatDtr001VisualPresentation?: Element }).__uatDtr001VisualPresentation === element
  ))).toBe(true)
  await page.keyboard.press('Control+z')
  await expectMarkdown(page, initial)
})

test('UAT-DTR-001 keeps article presentation styles aligned between Visual and Final Preview', async ({ page }) => {
  await prepare(page, '# Presentation heading\n\nParagraph with *italic text*.\n\n> Quoted paragraph\n\n- Bullet item')
  await page.locator('[data-toolbar-menu="theme"] .toolbar-menu__trigger').click()
  await page.locator('[data-theme-option="abyss"]').click()
  await page.locator('[data-line-spacing-trigger]').click()
  await page.locator('[data-line-spacing-option="double"]').click()
  await switchToVisual(page)

  const readPresentation = async (rootSelector: string) => page.locator(rootSelector).evaluate((root) => {
    const read = (selector: string, properties: readonly string[]) => {
      const element = root.querySelector<HTMLElement>(selector)
      if (element === null) throw new Error(`Missing presentation node: ${selector}`)
      const style = getComputedStyle(element)
      return Object.fromEntries(properties.map((property) => [property, style.getPropertyValue(property)]))
    }
    return {
      blockquote: read('blockquote', ['border-left-width', 'margin-bottom', 'margin-top', 'padding-left']),
      heading: read('h1', ['font-family', 'font-size', 'font-weight', 'line-height', 'margin-bottom', 'margin-top']),
      italic: read('em', ['font-family', 'font-size', 'font-style', 'font-weight', 'line-height']),
      list: read('ul', ['font-family', 'font-size', 'line-height', 'margin-bottom', 'margin-top', 'padding-left']),
      paragraph: read(':scope > p', ['font-family', 'font-size', 'font-weight', 'line-height', 'margin-bottom', 'margin-top']),
    }
  })

  const visual = await readPresentation('.ProseMirror')
  await page.locator('[data-command-id="mode.preview"]').click()
  const final = await readPresentation('.visual-surface[data-mode="preview"] .ProseMirror')
  expect(final).toEqual(visual)
})

test('UAT-DTR-001 matches the complete blockquote box and hides Final heading-anchor chrome', async ({ page }) => {
  await prepare(page, '# 对比标题\n\n> 引用测试')
  await switchToVisual(page)
  const presentation = async (selector: string) => page.locator(selector).evaluate((element) => {
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return {
      backgroundColor: style.backgroundColor,
      borderLeftColor: style.borderLeftColor,
      borderLeftStyle: style.borderLeftStyle,
      borderLeftWidth: style.borderLeftWidth,
      borderRadius: style.borderRadius,
      height: rect.height,
      marginBottom: style.marginBottom,
      marginTop: style.marginTop,
      paddingBottom: style.paddingBottom,
      paddingLeft: style.paddingLeft,
      paddingRight: style.paddingRight,
      paddingTop: style.paddingTop,
      width: rect.width,
    }
  })
  const visual = await presentation('.ProseMirror > blockquote')

  await page.locator('[data-command-id="mode.preview"]').click()
  const preview = page.locator('.visual-surface[data-mode="preview"] .ProseMirror')
  await expect(preview.locator('h1 > a.anchor')).toHaveCount(0)
  const final = await presentation('.visual-surface[data-mode="preview"] .ProseMirror > blockquote')
  expect(final).toEqual(visual)
})

test('UAT-DTR-001 matches the Visual block-formula container in Final Preview', async ({ page }) => {
  const markdown = [
    '# 公式',
    '',
    String.raw`$\int_a^b f(x)\,dx$`,
    '',
    '$$',
    String.raw`\begin{bmatrix} a & b \\ c & d \end{bmatrix}`,
    '$$',
  ].join('\n')
  await prepare(page, markdown)
  await switchToVisual(page)
  const presentation = async (selector: string) => page.locator(selector).evaluate((element) => {
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return {
      alignItems: style.alignItems,
      backgroundColor: style.backgroundColor,
      borderBottomWidth: style.borderBottomWidth,
      borderLeftWidth: style.borderLeftWidth,
      borderRadius: style.borderRadius,
      borderRightWidth: style.borderRightWidth,
      borderTopWidth: style.borderTopWidth,
      display: style.display,
      height: rect.height,
      justifyContent: style.justifyContent,
      marginBottom: style.marginBottom,
      marginTop: style.marginTop,
      minHeight: style.minHeight,
      paddingBottom: style.paddingBottom,
      paddingLeft: style.paddingLeft,
      paddingRight: style.paddingRight,
      paddingTop: style.paddingTop,
      width: rect.width,
    }
  })
  const visual = await presentation('.formula-node--block')
  await expect(page.locator('.formula-node--block .katex')).toBeVisible()

  await page.locator('[data-command-id="mode.preview"]').click()
  await expect(page.locator('.visual-surface[data-mode="preview"] .formula-node--block .katex')).toBeVisible()
  const final = await presentation('.visual-surface[data-mode="preview"] .formula-node--block')
  expect(final).toEqual(visual)
})

test('UAT-DTR-015 makes author-preview task controls update authority, undo, autosave, and reload', async ({ page }) => {
  const initial = '- [ ] Parent\n- [x] Done'
  await prepare(page, initial)
  const revision = (await authority(page))?.revision
  if (revision === undefined) throw new Error('Authority inspection is unavailable.')
  await page.locator('[data-command-id="mode.preview"]').click()
  const tasks = page.locator('.visual-surface[data-mode="preview"] input[type="checkbox"]')
  await expect(tasks).toHaveCount(2)
  await expect(tasks.nth(0)).toHaveAccessibleName('Task item checkbox for Parent')
  await tasks.nth(0).check()
  await expectMarkdown(page, '- [x] Parent\n- [x] Done')
  expect((await authority(page))?.revision).toBe(revision + 1)

  await tasks.nth(0).focus()
  await page.keyboard.press('Control+z')
  await expectMarkdown(page, initial)
  await page.keyboard.press('Control+Shift+z')
  await expectMarkdown(page, '- [x] Parent\n- [x] Done')
  await expect.poll(async () => (await authority(page))?.autosaveStatus).toBe('saved')

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  await page.locator('[data-command-id="mode.preview"]').click()
  await expect(page.locator('.visual-surface[data-mode="preview"] input[type="checkbox"]').nth(0)).toBeChecked()
})

test('UAT-DTR-016 preserves italic when the same text also receives bold formatting', async ({ page }) => {
  await prepare(page, '斜体测试')
  await switchToVisual(page)
  await selectParagraph(page, '斜体测试')
  await page.locator('[data-command-id="text.italic"]').click()
  await expectMarkdown(page, '*斜体测试*')
  await selectParagraph(page, '斜体测试')
  await page.locator('[data-command-id="text.bold"]').click()
  await expectMarkdown(page, '***斜体测试***')
  const visual = page.locator('.ProseMirror')
  await expect(visual.locator('strong em, em strong')).toHaveText('斜体测试')
  await expect(visual).not.toContainText('*')

  await page.locator('[data-command-id="mode.preview"]').click()
  const preview = page.locator('.visual-surface[data-mode="preview"] .ProseMirror')
  await expect(preview.locator('strong em, em strong')).toHaveText('斜体测试')
  await expect(preview.locator('em')).toHaveCSS('font-style', 'italic')
  await expect(preview).not.toContainText('*')
})

test('UAT-DTR-016 preserves italic at an adjacent bold or underline delimiter boundary', async ({ page }) => {
  const markdown = [
    '**粗体在前***斜体在后*',
    '*斜体在前***粗体在后**',
    '++下划线在前++*相邻斜体*',
    '*斜体相邻*++下划线在后++',
  ].join('\n\n')
  await prepare(page, markdown)
  await switchToVisual(page)
  const visual = page.locator('.ProseMirror')
  await expect(visual.locator('strong')).toHaveCount(2)
  await expect(visual.locator('em')).toHaveCount(4)
  await expect(visual.locator('u')).toHaveCount(2)
  await expect(visual).not.toContainText('*')

  await page.locator('[data-command-id="mode.preview"]').click()
  const preview = page.locator('.visual-surface[data-mode="preview"] .ProseMirror')
  await expect(preview.locator('strong')).toHaveCount(2)
  await expect(preview.locator('em')).toHaveCount(4)
  await expect(preview.locator('u')).toHaveCount(2)
  expect(await preview.locator('em').evaluateAll((elements) => elements.map((element) => getComputedStyle(element).fontStyle)))
    .toEqual(['italic', 'italic', 'italic', 'italic'])
  await expect(preview).not.toContainText('*')
})

test('UAT-DTR-006 keeps columns and active tab content visibly structured in Final Preview', async ({ page }) => {
  const markdown = [
    columnLayoutStarterSource('layout.two-column'),
    columnLayoutStarterSource('layout.multi-column'),
    disclosureStarterSource('layout.tabs'),
  ].join('\n\n')
  await prepare(page, markdown)
  await page.locator('[data-command-id="mode.preview"]').click()
  const preview = page.locator('.visual-surface[data-mode="preview"] .ProseMirror')
  const twoColumns = preview.locator('.semantic-preview--two-column .semantic-preview__columns')
  const threeColumns = preview.locator('.semantic-preview--multi-column .semantic-preview__columns')
  const tabs = preview.locator('.semantic-preview--tabs')
  await expect(twoColumns).toBeVisible()
  await expect(threeColumns).toBeVisible()
  await expect(tabs).toBeVisible()
  expect(await twoColumns.locator(':scope > *').evaluateAll((columns) => (
    new Set(columns.map((column) => Math.round(column.getBoundingClientRect().left))).size
  ))).toBeGreaterThanOrEqual(2)
  expect(await threeColumns.locator(':scope > *').evaluateAll((columns) => (
    new Set(columns.map((column) => Math.round(column.getBoundingClientRect().left))).size
  ))).toBeGreaterThanOrEqual(3)
  await expect(tabs).toContainText('First tab content')
  await expect(tabs.getByText('First tab content', { exact: true })).toBeVisible()
})

test('UAT-DTR-007 applies alignment to adjacent paragraphs while autosave is pending', async ({ page }) => {
  await prepare(page, 'Alpha\n\nBeta')
  await switchToVisual(page)
  await applyAlignment(page, 'Alpha', 'center')
  await expect.poll(async () => (await authority(page))?.autosaveStatus).toBe('pending')
  await applyAlignment(page, 'Beta', 'right')
  await expectMarkdown(page, '::: center\nAlpha\n:::\n\n::: right\nBeta\n:::')
  await expect(page.locator('.workspace-error')).toHaveCount(0)
})

test('UAT-DTR-008 repeatedly applies the first alignment without projection failure', async ({ page }) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await prepare(page, `Alpha ${attempt}\n\nBeta ${attempt}`)
    await switchToVisual(page)
    await applyAlignment(page, `Alpha ${attempt}`, 'center')
    await expectMarkdown(page, `::: center\nAlpha ${attempt}\n:::\n\nBeta ${attempt}`)
    await expect(page.locator('.workspace-error')).toHaveCount(0)
  }
})

test('UAT-DTR-009 applies alignment after a real undo', async ({ page }) => {
  await prepare(page, 'Alpha\n\nBeta')
  await switchToVisual(page)
  await applyAlignment(page, 'Alpha', 'center')
  await expectMarkdown(page, '::: center\nAlpha\n:::\n\nBeta')
  await page.keyboard.press('Control+z')
  await expectMarkdown(page, 'Alpha\n\nBeta')
  await applyAlignment(page, 'Beta', 'right')
  await expectMarkdown(page, 'Alpha\n\n::: right\nBeta\n:::')
  await expect(page.locator('.workspace-error')).toHaveCount(0)
})

test('UAT-DTR-007 through 009 keep adjacent duplicate paragraph identities distinct', async ({ page }) => {
  await prepare(page, 'Same\n\nSame\n\nTail')
  await switchToVisual(page)
  await applyAlignmentAt(page, 0, 'center')
  await expect.poll(async () => (await authority(page))?.autosaveStatus).toBe('pending')
  await applyAlignmentAt(page, 1, 'right')
  await expectMarkdown(page, '::: center\nSame\n:::\n\n::: right\nSame\n:::\n\nTail')
  await page.locator('.ProseMirror .alignment-block[data-alignment="right"] p').click()
  const undo = page.locator('[data-command-id="history.undo"]')
  await expect(undo).toBeEnabled()
  await undo.click()
  await expectMarkdown(page, '::: center\nSame\n:::\n\nSame\n\nTail')
  await applyAlignmentAt(page, 1, 'right')
  await expectMarkdown(page, '::: center\nSame\n:::\n\n::: right\nSame\n:::\n\nTail')
  await expect(page.locator('.workspace-error')).toHaveCount(0)
})

test('UAT-DTR-007 through 009 remain safe in the full complex Welcome projection', async ({ page }) => {
  test.setTimeout(60_000)
  const initial = `${welcomeMarkdown}\n\nUAT Alpha\n\nUAT Beta\n\nUAT Gamma`
  await prepare(page, initial)
  await switchToVisual(page)
  await applyAlignment(page, 'UAT Alpha', 'center')
  await expect.poll(async () => (await authority(page))?.autosaveStatus).toBe('pending')
  await applyAlignment(page, 'UAT Beta', 'right')
  const adjacent = `${welcomeMarkdown}\n\n::: center\nUAT Alpha\n:::\n\n::: right\nUAT Beta\n:::\n\nUAT Gamma`
  await expectMarkdown(page, adjacent)
  await page.locator('.ProseMirror .alignment-block[data-alignment="right"] p', { hasText: 'UAT Beta' }).click()
  const undo = page.locator('[data-command-id="history.undo"]')
  await expect(undo).toBeEnabled()
  await undo.click()
  await expectMarkdown(page, `${welcomeMarkdown}\n\n::: center\nUAT Alpha\n:::\n\nUAT Beta\n\nUAT Gamma`)
  await applyAlignment(page, 'UAT Gamma', 'right')
  await expectMarkdown(page, `${welcomeMarkdown}\n\n::: center\nUAT Alpha\n:::\n\nUAT Beta\n\n::: right\nUAT Gamma\n:::`)
  await expect(page.locator('.workspace-error')).toHaveCount(0)
})

test('UAT-DTR-010 inserts a hard break through the Visual toolbar without projection failure', async ({ page }) => {
  await prepare(page, 'Alpha')
  await switchToVisual(page)
  await setVisualCaretAtEnd(page)
  await openInsertCommand(page, 'insert.hard-break')
  await expectMarkdown(page, 'Alpha  \n')
  await expect(page.locator('.workspace-error')).toHaveCount(0)
})

test('UAT-DTR-011 rebuilds a Visual horizontal rule after Source and Preview round trips', async ({ page }) => {
  await prepare(page, 'Alpha')
  await switchToVisual(page)
  await setVisualCaretAtEnd(page)
  await openInsertCommand(page, 'insert.horizontal-rule')
  await expectMarkdown(page, 'Alpha\n\n---')
  await expect(page.locator('.ProseMirror hr')).toBeVisible()
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('[data-command-id="mode.preview"]').click()
  await expect(page.locator('.visual-surface[data-mode="preview"] hr')).toHaveCount(1)
  await switchToVisual(page)
  await expect(page.locator('.ProseMirror hr')).toBeVisible()
})

test('UAT-DTR-010 and 011 preserve hard breaks and horizontal rules beside duplicate paragraphs', async ({ page }) => {
  await prepare(page, 'Same\n\nSame')
  await switchToVisual(page)
  const second = page.locator('.ProseMirror p').nth(1)
  await second.click()
  await page.keyboard.press('End')
  await openInsertCommand(page, 'insert.hard-break')
  await expectMarkdown(page, 'Same\n\nSame  \n')
  await setVisualCaretAtEnd(page)
  await openInsertCommand(page, 'insert.horizontal-rule')
  await expect.poll(async () => (await authority(page))?.markdown).toContain('---')
  await page.locator('[data-command-id="mode.preview"]').click()
  await expect(page.locator('.visual-surface[data-mode="preview"] hr').last()).toBeVisible()
  await switchToVisual(page)
  await expect(page.locator('.ProseMirror hr').last()).toBeVisible()
  await expect(page.locator('.workspace-error')).toHaveCount(0)
})

test('UAT-DTR-010 and 011 remain safe after a full complex Welcome projection', async ({ page }) => {
  test.setTimeout(60_000)
  const initial = `${welcomeMarkdown}\n\nUAT Tail`
  await prepare(page, initial)
  await switchToVisual(page)
  await setVisualCaretAtEnd(page)
  await openInsertCommand(page, 'insert.hard-break')
  await expectMarkdown(page, `${initial}  \n`)
  await setVisualCaretAtEnd(page)
  await openInsertCommand(page, 'insert.horizontal-rule')
  await expect.poll(async () => (await authority(page))?.markdown).toContain('---')
  await page.locator('[data-command-id="mode.preview"]').click()
  await expect(page.locator('.visual-surface[data-mode="preview"] hr').last()).toBeVisible()
  await switchToVisual(page)
  await expect(page.locator('.ProseMirror hr').last()).toBeVisible()
  await expect(page.locator('.workspace-error')).toHaveCount(0)
})

test('UAT-DTR-012 renders visible node labels for flowchart, state, and class diagrams', async ({ page }) => {
  const diagrams = [
    { label: 'Flow label', source: 'flowchart TD\nA[Flow label] --> B[Done]' },
    { label: 'Idle', source: 'stateDiagram-v2\n[*] --> Idle\nIdle --> [*]' },
    { label: 'Animal', source: 'classDiagram\nclass Animal {\n  +String name\n}' },
  ] as const
  await prepare(page, diagrams.map(({ source }) => mermaidSource(source)).join('\n\n'))
  await switchToVisual(page)
  const svgs = page.locator('.semantic-preview__mermaid-rendered svg')
  await expect(svgs).toHaveCount(3, { timeout: 15_000 })
  for (const [index, diagram] of diagrams.entries()) {
    const svg = svgs.nth(index)
    await expect(svg).toBeVisible()
    expect(await svg.evaluate(visibleLabel, diagram.label)).toBe(true)
  }
})

test('UAT-DTR-013 renders non-empty map geometry in Visual and Final', async ({ page }) => {
  const markdown = chartTableStarterSource('chart.map')
  await prepare(page, markdown)
  await switchToVisual(page)
  const visual = page.locator('.semantic-preview--chart-table .cherry-echarts-wrapper[data-chart-type="map"] svg')
  await expect(visual).toBeVisible()
  await expect.poll(() => renderedPathArea(visual), { timeout: 15_000 }).toBeGreaterThan(100)
  await page.locator('[data-command-id="mode.preview"]').click()
  const final = page.locator('.visual-surface[data-mode="preview"] .cherry-echarts-wrapper[data-chart-type="map"] svg')
  await expect(final).toBeVisible()
  await expect.poll(() => renderedPathArea(final), { timeout: 15_000 }).toBeGreaterThan(100)
})

async function renderedPathArea(svg: Locator): Promise<number> {
  return svg.locator('path').evaluateAll((paths) => paths.reduce((area, path) => {
    const rect = path.getBoundingClientRect()
    return area + rect.width * rect.height
  }, 0))
}
