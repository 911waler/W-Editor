import type { Locator, Page } from '@playwright/test'

import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

type VisualCaret = Readonly<{
  blockText: string
  offset: number
}>

type VisualCaretLocation = Readonly<{
  blockIndex: number
  blockText: string
  offset: number
  scrollTop: number
}>

type SourceCaret = Readonly<{
  lineText: string
  offset: number
}>

async function authorityMarkdown(page: Page): Promise<string> {
  const markdown = await page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().markdown)
  if (markdown === undefined) throw new Error('The E2E authority inspection seam is unavailable.')
  return markdown
}

async function visualCaret(page: Page): Promise<VisualCaret> {
  return page.locator('.ProseMirror').evaluate((editor) => {
    const selection = window.getSelection()
    const anchor = selection?.anchorNode
    const anchorElement = anchor instanceof Node
      ? anchor.nodeType === Node.ELEMENT_NODE ? anchor as Element : anchor.parentElement
      : null
    const block = anchorElement?.closest<HTMLElement>('.ordinary-block') ?? null
    if (selection === null || anchor === null || anchor === undefined || block === null || !editor.contains(block)) {
      throw new Error('Expected a Visual caret in an ordinary block.')
    }

    const prefix = document.createRange()
    prefix.selectNodeContents(block)
    prefix.setEnd(anchor, selection.anchorOffset)
    return {
      blockText: block.textContent ?? '',
      offset: prefix.toString().length,
    }
  })
}

async function visualCaretLocation(page: Page): Promise<VisualCaretLocation> {
  return page.locator('.ProseMirror').evaluate((editor) => {
    const selection = window.getSelection()
    const anchor = selection?.anchorNode
    const anchorElement = anchor instanceof Node
      ? anchor.nodeType === Node.ELEMENT_NODE ? anchor as Element : anchor.parentElement
      : null
    const block = anchorElement?.closest<HTMLElement>(':scope > .ordinary-block')
      ?? anchorElement?.closest<HTMLElement>('.ordinary-block')
      ?? null
    const blocks = Array.from(editor.querySelectorAll<HTMLElement>(':scope > .ordinary-block'))
    const surface = editor.closest<HTMLElement>('.editor-surface')
    if (
      selection === null
      || anchor === null
      || anchor === undefined
      || block === null
      || surface === null
      || !editor.contains(block)
    ) {
      throw new Error('Expected a Visual caret in an ordinary block.')
    }

    const prefix = document.createRange()
    prefix.selectNodeContents(block)
    prefix.setEnd(anchor, selection.anchorOffset)
    return {
      blockIndex: blocks.indexOf(block),
      blockText: block.textContent ?? '',
      offset: prefix.toString().length,
      scrollTop: surface.scrollTop,
    }
  })
}

async function editorScrollTop(page: Page): Promise<number> {
  return page.locator('.editor-surface').evaluate((surface) => surface.scrollTop)
}

async function expectVisualCaretVisible(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => {
    const selection = window.getSelection()
    const range = selection?.rangeCount === 1 ? selection.getRangeAt(0) : null
    const surface = document.querySelector('.editor-surface')
    if (range === null || surface === null) throw new Error('Expected a visible historical caret.')
    const anchor = selection?.anchorNode
    const anchorElement = anchor instanceof Node
      ? anchor.nodeType === Node.ELEMENT_NODE ? anchor as Element : anchor.parentElement
      : null
    const block = anchorElement?.closest<HTMLElement>('.ordinary-block') ?? null
    const caret = range.getBoundingClientRect()
    const target = caret.height > 0 || block === null ? caret : block.getBoundingClientRect()
    const viewport = surface.getBoundingClientRect()
    return { bottom: target.bottom, top: target.top, viewportBottom: viewport.bottom, viewportTop: viewport.top }
  })
  expect(geometry.top).toBeGreaterThanOrEqual(geometry.viewportTop)
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportBottom)
}

async function dispatchImmediateBackspaceAtBlockStart(block: Locator): Promise<void> {
  await block.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const node = walker.nextNode() ?? element
    const range = document.createRange()
    range.setStart(node, 0)
    range.collapse(true)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    const editor = element.closest<HTMLElement>('.ProseMirror')
    editor?.focus()
    editor?.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Backspace',
    }))
  })
}

async function placeCaretAtBlockStart(block: Locator): Promise<void> {
  await block.evaluate((element) => {
    const editor = element.closest<HTMLElement>('.ProseMirror')
    editor?.focus()
    const range = document.createRange()
    range.selectNodeContents(element)
    range.collapse(true)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  })
}

async function selectTextInVisualBlock(block: Locator, selectedText: string): Promise<void> {
  await block.evaluate((element, text) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node !== null && !(node.textContent ?? '').includes(text)) node = walker.nextNode()
    if (!node?.textContent) throw new Error(`Could not select ${JSON.stringify(text)} in the Visual block.`)
    const from = node.textContent.indexOf(text)
    const editor = element.closest<HTMLElement>('.ProseMirror')
    editor?.focus()
    const range = document.createRange()
    range.setStart(node, from)
    range.setEnd(node, from + text.length)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }, selectedText)
}

async function sourceCaret(page: Page): Promise<SourceCaret> {
  return page.locator('#markdown-source-editor').evaluate((source) => {
    const selection = window.getSelection()
    const anchor = selection?.anchorNode
    const anchorElement = anchor instanceof Node
      ? anchor.nodeType === Node.ELEMENT_NODE ? anchor as Element : anchor.parentElement
      : null
    const line = anchorElement?.closest<HTMLElement>('.cm-line') ?? null
    if (selection === null || anchor === null || anchor === undefined || line === null || !source.contains(line)) {
      throw new Error('Expected a Source caret in a CodeMirror line.')
    }

    const prefix = document.createRange()
    prefix.selectNodeContents(line)
    prefix.setEnd(anchor, selection.anchorOffset)
    return {
      lineText: line.textContent ?? '',
      offset: prefix.toString().length,
    }
  })
}

async function sourceScrollTop(page: Page): Promise<number> {
  return page.locator('.cm-scroller').evaluate((scroller) => scroller.scrollTop)
}

async function expectVisualState(
  page: Page,
  expectedMarkdown: string,
  expectedBlockText: string,
  expectedOffset: number,
  referenceScrollTop: number,
): Promise<void> {
  await expect.poll(() => authorityMarkdown(page)).toBe(expectedMarkdown)
  await expect.poll(() => visualCaret(page)).toEqual({
    blockText: expectedBlockText,
    offset: expectedOffset,
  })
  await expect.poll(() => editorScrollTop(page)).toBeGreaterThan(referenceScrollTop - 80)
  await expect.poll(() => editorScrollTop(page)).toBeLessThan(referenceScrollTop + 80)
}

test('Visual performs ten exact undo and redo steps without moving the caret or viewport away', async ({ page }) => {
  test.setTimeout(60_000)
  const paragraphs = Array.from({ length: 80 }, (_, index) => `Stable paragraph ${index + 1}`)
  const targetIndex = 54
  const targetBase = paragraphs[targetIndex] ?? ''
  const markdownFor = (suffix: string): string => paragraphs
    .map((paragraph, index) => index === targetIndex ? `${paragraph}${suffix}` : paragraph)
    .join('\n\n')

  await openReadyApp(page)
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill(markdownFor(''))
  await expect.poll(() => authorityMarkdown(page)).toBe(markdownFor(''))
  await page.locator('[data-command-id="mode.visual"]').click()

  const target = page.locator('.ProseMirror > .ordinary-block').filter({ hasText: targetBase })
  await expect(target).toHaveCount(1)
  await target.scrollIntoViewIfNeeded()
  await target.click()
  await page.keyboard.press('End')
  const referenceScrollTop = await editorScrollTop(page)

  const states = [markdownFor('')]
  const tokens = Array.from({ length: 10 }, (_, index) => String.fromCharCode(65 + index))
  let suffix = ''
  for (const token of tokens) {
    await page.keyboard.insertText(token)
    suffix += token
    states.push(markdownFor(suffix))
    await expectVisualState(page, states.at(-1) ?? '', `${targetBase}${suffix}`, targetBase.length + suffix.length, referenceScrollTop)
    await page.waitForTimeout(600)
  }

  for (let index = tokens.length; index > 0; index -= 1) {
    await page.keyboard.press('Control+z')
    const expectedSuffix = tokens.slice(0, index - 1).join('')
    await expectVisualState(page, states[index - 1] ?? '', `${targetBase}${expectedSuffix}`, targetBase.length + expectedSuffix.length, referenceScrollTop)
  }

  for (let index = 1; index <= tokens.length; index += 1) {
    await page.keyboard.press('Control+Shift+z')
    const expectedSuffix = tokens.slice(0, index).join('')
    await expectVisualState(page, states[index] ?? '', `${targetBase}${expectedSuffix}`, targetBase.length + expectedSuffix.length, referenceScrollTop)
  }
})

test('Source performs ten exact undo and redo steps without moving the caret or viewport away', async ({ page }) => {
  test.setTimeout(60_000)
  const paragraphs = Array.from({ length: 80 }, (_, index) => `Stable source paragraph ${index + 1}`)
  const targetBase = paragraphs.at(-1) ?? ''
  const markdownFor = (suffix: string): string => [
    ...paragraphs.slice(0, -1),
    `${targetBase}${suffix}`,
  ].join('\n\n')

  await openReadyApp(page)
  await page.locator('[data-command-id="mode.source"]').click()
  const source = page.locator('#markdown-source-editor')
  await source.fill(markdownFor(''))
  await expect.poll(() => authorityMarkdown(page)).toBe(markdownFor(''))
  await source.press('Control+End')
  const referenceScrollTop = await sourceScrollTop(page)

  const states = [markdownFor('')]
  const tokens = Array.from({ length: 10 }, (_, index) => String.fromCharCode(65 + index))
  let suffix = ''
  for (const token of tokens) {
    await page.keyboard.insertText(token)
    suffix += token
    states.push(markdownFor(suffix))
    await expect.poll(() => authorityMarkdown(page)).toBe(states.at(-1) ?? '')
    await expect.poll(() => sourceCaret(page)).toEqual({
      lineText: `${targetBase}${suffix}`,
      offset: targetBase.length + suffix.length,
    })
    await page.waitForTimeout(600)
  }

  for (let index = tokens.length; index > 0; index -= 1) {
    await page.keyboard.press('Control+z')
    const expectedSuffix = tokens.slice(0, index - 1).join('')
    await expect.poll(() => authorityMarkdown(page)).toBe(states[index - 1] ?? '')
    await expect.poll(() => sourceCaret(page)).toEqual({
      lineText: `${targetBase}${expectedSuffix}`,
      offset: targetBase.length + expectedSuffix.length,
    })
    await expect.poll(() => sourceScrollTop(page)).toBeGreaterThan(referenceScrollTop - 80)
  }

  for (let index = 1; index <= tokens.length; index += 1) {
    await page.keyboard.press('Control+Shift+z')
    const expectedSuffix = tokens.slice(0, index).join('')
    await expect.poll(() => authorityMarkdown(page)).toBe(states[index] ?? '')
    await expect.poll(() => sourceCaret(page)).toEqual({
      lineText: `${targetBase}${expectedSuffix}`,
      offset: targetBase.length + expectedSuffix.length,
    })
    await expect.poll(() => sourceScrollTop(page)).toBeGreaterThan(referenceScrollTop - 80)
  }
})

test('Source undo in the middle of a long article keeps the caret and viewport at the reversed edit', async ({ page }) => {
  const paragraphs = Array.from({ length: 90 }, (_, index) => `Middle source paragraph ${index + 1}`)
  const targetIndex = 43
  const targetBase = paragraphs[targetIndex] ?? ''
  const original = paragraphs.join('\n\n')
  const edited = paragraphs
    .map((paragraph, index) => index === targetIndex ? `${paragraph}[edited]` : paragraph)
    .join('\n\n')

  await openReadyApp(page)
  await page.locator('[data-command-id="mode.source"]').click()
  const source = page.locator('#markdown-source-editor')
  await source.fill(original)
  await expect.poll(() => authorityMarkdown(page)).toBe(original)

  await source.click()
  await page.keyboard.press('Control+Home')
  for (let index = 0; index < targetIndex * 2; index += 1) {
    await page.keyboard.press('ArrowDown')
  }
  await page.keyboard.press('End')
  const referenceScrollTop = await sourceScrollTop(page)
  await page.keyboard.insertText('[edited]')
  await expect.poll(() => authorityMarkdown(page)).toBe(edited)

  await page.keyboard.press('Control+z')
  await expect.poll(() => authorityMarkdown(page)).toBe(original)
  await expect.poll(() => sourceCaret(page)).toEqual({
    lineText: targetBase,
    offset: targetBase.length,
  })
  await expect.poll(() => sourceScrollTop(page)).toBeGreaterThan(referenceScrollTop - 80)
  await expect.poll(() => sourceScrollTop(page)).toBeLessThan(referenceScrollTop + 80)
})

test('Visual restores ten edits made at different document positions with each historical caret visible', async ({ page }) => {
  test.setTimeout(60_000)
  const paragraphs = Array.from({ length: 70 }, (_, index) => `Position paragraph ${index + 1}`)
  const targetIndexes = [4, 11, 18, 25, 32, 39, 46, 53, 60, 67]
  const suffixes = targetIndexes.map((_, index) => `[${index + 1}]`)
  const markdownFor = (count: number): string => paragraphs.map((paragraph, index) => {
    const actionIndex = targetIndexes.indexOf(index)
    return actionIndex >= 0 && actionIndex < count ? `${paragraph}${suffixes[actionIndex]}` : paragraph
  }).join('\n\n')
  const editor = page.locator('.ProseMirror')

  await openReadyApp(page)
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill(markdownFor(0))
  await expect.poll(() => authorityMarkdown(page)).toBe(markdownFor(0))
  await page.locator('[data-command-id="mode.visual"]').click()

  for (let index = 0; index < targetIndexes.length; index += 1) {
    const block = editor.locator(':scope > .ordinary-block').nth(targetIndexes[index] ?? 0)
    await block.scrollIntoViewIfNeeded()
    await block.click()
    await page.keyboard.press('End')
    await page.keyboard.insertText(suffixes[index] ?? '')
    await expect.poll(() => authorityMarkdown(page)).toBe(markdownFor(index + 1))
  }

  for (let index = targetIndexes.length; index > 0; index -= 1) {
    await page.keyboard.press('Control+z')
    await expect.poll(() => authorityMarkdown(page)).toBe(markdownFor(index - 1))
    const paragraph = paragraphs[targetIndexes[index - 1] ?? 0] ?? ''
    await expect.poll(() => visualCaret(page)).toEqual({ blockText: paragraph, offset: paragraph.length })
    await expectVisualCaretVisible(page)
  }

  for (let index = 1; index <= targetIndexes.length; index += 1) {
    await page.keyboard.press('Control+Shift+z')
    await expect.poll(() => authorityMarkdown(page)).toBe(markdownFor(index))
    const paragraph = paragraphs[targetIndexes[index - 1] ?? 0] ?? ''
    const suffix = suffixes[index - 1] ?? ''
    await expect.poll(() => visualCaret(page)).toEqual({
      blockText: `${paragraph}${suffix}`,
      offset: paragraph.length + suffix.length,
    })
    await expectVisualCaretVisible(page)
  }
})

test('Visual undo restores the caret belonging to the edit it reverses', async ({ page }) => {
  const original = 'First\n\nMiddle\n\nLast'
  await openReadyApp(page)
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill(original)
  await expect.poll(() => authorityMarkdown(page)).toBe(original)
  await page.locator('[data-command-id="mode.visual"]').click()

  const blocks = page.locator('.ProseMirror > .ordinary-block')
  await blocks.nth(0).click()
  await page.keyboard.press('End')
  await page.keyboard.insertText('[one]')
  await expect.poll(() => authorityMarkdown(page)).toBe('First[one]\n\nMiddle\n\nLast')

  await blocks.nth(2).click()
  await page.keyboard.press('End')
  await page.keyboard.insertText('[two]')
  await expect.poll(() => authorityMarkdown(page)).toBe('First[one]\n\nMiddle\n\nLast[two]')

  await page.keyboard.press('Control+z')
  await expect.poll(() => authorityMarkdown(page)).toBe('First[one]\n\nMiddle\n\nLast')
  await expect.poll(() => visualCaret(page)).toEqual({ blockText: 'Last', offset: 4 })
})

test('Visual uses a just-moved browser caret for Backspace history instead of the stale article end', async ({ page }) => {
  const paragraphs = Array.from({ length: 100 }, (_, index) => `Rapid undo paragraph ${index + 1}`)
  const targetIndex = 48
  const targetText = paragraphs[targetIndex] ?? ''
  const previousText = paragraphs[targetIndex - 1] ?? ''
  const original = paragraphs.join('\n\n')
  const joined = [
    ...paragraphs.slice(0, targetIndex - 1),
    `${previousText}${targetText}`,
    ...paragraphs.slice(targetIndex + 1),
  ].join('\n\n')

  await openReadyApp(page)
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill(original)
  await expect.poll(() => authorityMarkdown(page)).toBe(original)
  await page.locator('[data-command-id="mode.visual"]').click()

  const blocks = page.locator('.ProseMirror > .ordinary-block')
  const target = blocks.nth(targetIndex)
  await target.scrollIntoViewIfNeeded()
  await target.click()
  const referenceScrollTop = await editorScrollTop(page)

  const last = blocks.last()
  await last.scrollIntoViewIfNeeded()
  await last.click()
  await page.keyboard.press('Home')
  await page.waitForTimeout(150)

  await dispatchImmediateBackspaceAtBlockStart(target)
  await expect.poll(() => authorityMarkdown(page)).toBe(joined)

  await page.keyboard.press('Control+z')
  await expect.poll(() => authorityMarkdown(page)).toBe(original)
  await expect.poll(() => visualCaret(page)).toEqual({ blockText: targetText, offset: 0 })
  await expect.poll(async () => Math.abs(await editorScrollTop(page) - referenceScrollTop)).toBeLessThan(300)
  await expectVisualCaretVisible(page)
})

test('Visual keeps every historical caret local across ten consecutive paragraph breaks', async ({ page }) => {
  test.setTimeout(90_000)
  const paragraphs = Array.from({ length: 100 }, (_, index) => `Paragraph-break history ${index + 1}`)
  const targetIndex = 48
  const markdownFor = (blankCount: number): string => [
    ...paragraphs.slice(0, targetIndex + 1),
    ...Array.from({ length: blankCount }, () => ''),
    ...paragraphs.slice(targetIndex + 1),
  ].join('\n\n')

  await openReadyApp(page)
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill(markdownFor(0))
  await expect.poll(() => authorityMarkdown(page)).toBe(markdownFor(0))
  await page.locator('[data-command-id="mode.visual"]').click()

  const blocks = page.locator('.ProseMirror > .ordinary-block')
  const target = blocks.nth(targetIndex)
  await target.scrollIntoViewIfNeeded()
  await target.click()
  await page.keyboard.press('End')
  const referenceScrollTop = await editorScrollTop(page)

  for (let count = 1; count <= 10; count += 1) {
    await page.keyboard.press('Enter')
    await expect.poll(() => authorityMarkdown(page)).toBe(markdownFor(count))
    await page.waitForTimeout(600)
  }

  const observed: VisualCaretLocation[] = []
  for (let remaining = 9; remaining >= 0; remaining -= 1) {
    await page.keyboard.press('Control+z')
    await expect.poll(() => authorityMarkdown(page)).toBe(markdownFor(remaining))
    observed.push(await visualCaretLocation(page))
  }

  expect(observed.map(({ blockIndex }) => blockIndex)).toEqual(
    Array.from({ length: 10 }, (_, index) => targetIndex + 9 - index),
  )
  expect(observed.every(({ scrollTop }) => Math.abs(scrollTop - referenceScrollTop) < 300)).toBe(true)
  await expectVisualCaretVisible(page)
})

test('Visual keeps ten rapid paragraph-break undo and redo steps local instead of entering older article-end history', async ({ page }) => {
  test.setTimeout(90_000)
  const paragraphs = Array.from({ length: 100 }, (_, index) => `Rapid paragraph-break history ${index + 1}`)
  const targetIndex = 48
  const original = paragraphs.join('\n\n')
  const endEdit = ' [older end edit]'
  const baselineParagraphs = [...paragraphs]
  baselineParagraphs[baselineParagraphs.length - 1] += endEdit
  const markdownFor = (blankCount: number): string => [
    ...baselineParagraphs.slice(0, targetIndex + 1),
    ...Array.from({ length: blankCount }, () => ''),
    ...baselineParagraphs.slice(targetIndex + 1),
  ].join('\n\n')

  await openReadyApp(page)
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill(original)
  await expect.poll(() => authorityMarkdown(page)).toBe(original)
  await page.locator('[data-command-id="mode.visual"]').click()

  const blocks = page.locator('.ProseMirror > .ordinary-block')
  const last = blocks.last()
  await last.scrollIntoViewIfNeeded()
  await last.click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(endEdit)
  await expect.poll(() => authorityMarkdown(page)).toBe(markdownFor(0))

  const target = blocks.nth(targetIndex)
  await target.scrollIntoViewIfNeeded()
  await target.click()
  await page.keyboard.press('End')
  const referenceScrollTop = await editorScrollTop(page)
  for (let count = 0; count < 10; count += 1) await page.keyboard.press('Enter')
  await expect.poll(() => authorityMarkdown(page)).toBe(markdownFor(10))

  for (let remaining = 9; remaining >= 0; remaining -= 1) {
    await page.keyboard.press('Control+z')
    await expect.poll(() => authorityMarkdown(page)).toBe(markdownFor(remaining))
    await expect.poll(async () => (await visualCaretLocation(page)).blockIndex).toBe(targetIndex + remaining)
    await expect.poll(async () => Math.abs((await visualCaretLocation(page)).scrollTop - referenceScrollTop))
      .toBeLessThan(300)
    await expectVisualCaretVisible(page)
  }
  expect(await authorityMarkdown(page)).toContain(`${paragraphs.at(-1)}${endEdit}`)

  for (let count = 1; count <= 10; count += 1) {
    await page.keyboard.press('Control+Shift+z')
    await expect.poll(() => authorityMarkdown(page)).toBe(markdownFor(count))
    await expect.poll(async () => (await visualCaretLocation(page)).blockIndex).toBe(targetIndex + count)
    await expect.poll(async () => Math.abs((await visualCaretLocation(page)).scrollTop - referenceScrollTop))
      .toBeLessThan(300)
    await expectVisualCaretVisible(page)
  }
  expect(await authorityMarkdown(page)).toContain(`${paragraphs.at(-1)}${endEdit}`)
})

test('Visual preserves a table beside twenty pre-existing empty paragraphs across ten local undo and redo steps', async ({ page }) => {
  test.setTimeout(90_000)
  const table = '| Plain | Explicit | Score |\n| --- | :------ | ---: |\n| A | B | 9 |'
  const existingEmptyCount = 20
  const targetIndex = 10
  const endEdit = ' [older end edit]'
  const markdownFor = (addedEmptyCount: number): string => [
    'Before paragraph',
    ...Array.from({ length: existingEmptyCount + addedEmptyCount }, () => ''),
    table,
    `After paragraph${endEdit}`,
  ].join('\n\n')
  const original = markdownFor(0).replace(endEdit, '')

  await openReadyApp(page)
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill(original)
  await expect.poll(() => authorityMarkdown(page)).toBe(original)
  await page.locator('[data-command-id="mode.visual"]').click()

  const blocks = page.locator('.ProseMirror > .ordinary-block')
  const after = blocks.filter({ hasText: 'After paragraph' }).last()
  await after.scrollIntoViewIfNeeded()
  await after.click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(endEdit)
  await expect.poll(() => authorityMarkdown(page)).toBe(markdownFor(0))

  const target = blocks.nth(targetIndex)
  await target.scrollIntoViewIfNeeded()
  await placeCaretAtBlockStart(target)
  const referenceScrollTop = await editorScrollTop(page)
  for (let count = 0; count < 10; count += 1) await page.keyboard.press('Enter')
  await expect.poll(() => authorityMarkdown(page)).toBe(markdownFor(10))
  await expect(blocks).toHaveCount(existingEmptyCount + 12)
  await expect(page.locator('[data-w-editor-node="ordinary-table"]')).toHaveCount(1)

  for (let remaining = 9; remaining >= 0; remaining -= 1) {
    await page.keyboard.press('Control+z')
    await expect.poll(() => authorityMarkdown(page)).toBe(markdownFor(remaining))
    await expect.poll(async () => (await visualCaretLocation(page)).blockIndex).toBe(targetIndex + remaining)
    await expect.poll(async () => Math.abs((await visualCaretLocation(page)).scrollTop - referenceScrollTop)).toBeLessThan(300)
    await expectVisualCaretVisible(page)
  }

  for (let count = 1; count <= 10; count += 1) {
    await page.keyboard.press('Control+Shift+z')
    await expect.poll(() => authorityMarkdown(page)).toBe(markdownFor(count))
    await expect.poll(async () => (await visualCaretLocation(page)).blockIndex).toBe(targetIndex + count)
    await expect.poll(async () => Math.abs((await visualCaretLocation(page)).scrollTop - referenceScrollTop)).toBeLessThan(300)
    await expectVisualCaretVisible(page)
  }

  expect(await authorityMarkdown(page)).toContain(table)
  expect(await authorityMarkdown(page)).toContain(`After paragraph${endEdit}`)
})

test('Visual Backspace and Delete preserve multiple empty paragraphs, table syntax, and local selection', async ({ page }) => {
  const table = '| Plain | Explicit |\n| --- | :------ |\n| A | B |'
  const targetText = 'Target paragraph delete-me suffix.'
  const markdownFor = (emptyCount: number, target = targetText): string => [
    'Before paragraph',
    ...Array.from({ length: emptyCount }, () => ''),
    table,
    target,
    'After paragraph',
  ].join('\n\n')
  const original = markdownFor(6)
  await openReadyApp(page)
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill(original)
  await expect.poll(() => authorityMarkdown(page)).toBe(original)
  await page.locator('[data-command-id="mode.visual"]').click()

  const blocks = page.locator('.ProseMirror > .ordinary-block')
  const emptyIndex = 3
  await blocks.nth(emptyIndex).scrollIntoViewIfNeeded()
  await placeCaretAtBlockStart(blocks.nth(emptyIndex))
  await page.keyboard.press('Backspace')
  await expect.poll(() => authorityMarkdown(page)).toBe(markdownFor(5))
  await expect.poll(async () => (await visualCaretLocation(page)).blockIndex).toBe(emptyIndex - 1)
  await expectVisualCaretVisible(page)

  await page.keyboard.press('Control+z')
  await expect.poll(() => authorityMarkdown(page)).toBe(original)
  await expect.poll(async () => (await visualCaretLocation(page)).blockIndex).toBe(emptyIndex)

  await placeCaretAtBlockStart(blocks.nth(emptyIndex))
  await page.keyboard.press('Delete')
  await expect.poll(() => authorityMarkdown(page)).toBe(markdownFor(5))
  await expect.poll(async () => (await visualCaretLocation(page)).blockIndex).toBe(emptyIndex)
  await expectVisualCaretVisible(page)

  await page.keyboard.press('Control+z')
  await expect.poll(() => authorityMarkdown(page)).toBe(original)

  const target = blocks.filter({ hasText: 'Target paragraph' }).first()
  await target.scrollIntoViewIfNeeded()
  await selectTextInVisualBlock(target, 'delete-me')
  await page.keyboard.press('Delete')
  const deletedTarget = targetText.replace('delete-me', '')
  await expect.poll(() => authorityMarkdown(page)).toBe(markdownFor(6, deletedTarget))
  await expect(target).toHaveText(deletedTarget)
  await expect.poll(async () => (await visualCaretLocation(page)).blockIndex).toBe(7)
  await expectVisualCaretVisible(page)
  expect(await authorityMarkdown(page)).toContain(table)

  await page.keyboard.press('Control+z')
  await expect.poll(() => authorityMarkdown(page)).toBe(original)
  await expect(target).toHaveText(targetText)
})

test('Visual table cell edit undo and redo preserve unspecified and explicit-left delimiters byte-for-byte', async ({ page }) => {
  const original = '| Plain | Explicit | Score |\n| --- | :------ | ---: |\n| A | B | 9 |'
  const edited = '| Plain | Explicit | Score |\n| --- | :------ | ---: |\n| A | B | Perfect 9 |'
  await openReadyApp(page)
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill(original)
  await expect.poll(() => authorityMarkdown(page)).toBe(original)
  await page.locator('[data-command-id="mode.visual"]').click()

  const score = page.locator('[data-w-editor-node="ordinary-table"] td').last()
  await score.click()
  await page.keyboard.press('Home')
  await page.keyboard.insertText('Perfect ')
  await expect.poll(() => authorityMarkdown(page)).toBe(edited)
  await expect(score).toHaveText('Perfect 9')

  await page.keyboard.press('Control+z')
  await expect.poll(() => authorityMarkdown(page)).toBe(original)
  await expect(score).toHaveText('9')

  await page.keyboard.press('Control+Shift+z')
  await expect.poll(() => authorityMarkdown(page)).toBe(edited)
  await expect(score).toHaveText('Perfect 9')
})
