import type { Locator, Page } from '@playwright/test'

import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

interface AuthorityState {
  readonly autosaveStatus: string
  readonly markdown: string
  readonly revision: number
  readonly synchronizationStatus: string
}

const FRACTION_SUM = String.raw`\frac{a}{b}\sum_{i=1}^{n}`
const INLINE_INITIAL = 'Alpha beta'
const INLINE_EXPECTED = `Alpha $${FRACTION_SUM}$`
const BLOCK_INITIAL = 'Alpha'
const BLOCK_PYTHAGOREAN = 'Alpha\n\n$$\na^2 + b^2 = c^2\n$$'
const BLOCK_EDITED = 'Alpha\n\n$$\nE = mc^2\n$$'
const IMPORTED = 'Before $x+y$ after\n\n$$\nz^2\n$$'
const IMPORTED_EDITED = 'Before $x-y$ after\n\n$$\nz^2\n$$'
const INLINE_GEOMETRY_SOURCE = 'E=mc^2'
const BLOCK_GEOMETRY_SOURCE = String.raw`\lim_{\Delta x \to 0} \frac{f(x+\Delta x)-f(x)}{\Delta x}`
const GEOMETRY_MARKDOWN = [
  `Inline $${INLINE_GEOMETRY_SOURCE}$.`,
  '',
  '$$',
  BLOCK_GEOMETRY_SOURCE,
  '$$',
].join('\n')

interface GeometryBox {
  readonly bottom: number
  readonly height: number
  readonly top: number
}

interface InlineFormulaGeometry {
  readonly base: GeometryBox
  readonly formula: GeometryBox
  readonly superscript: GeometryBox
}

interface BlockFormulaGeometry {
  readonly denominator: GeometryBox
  readonly fractionLine: GeometryBox
  readonly formula: GeometryBox
  readonly limitOperator: GeometryBox
  readonly limitSubscript: GeometryBox
  readonly numerator: GeometryBox
}

type FormulaGeometry = InlineFormulaGeometry | BlockFormulaGeometry

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

async function primeDocument(page: Page, markdown: string): Promise<void> {
  await openReadyApp(page)
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('.cm-content[contenteditable="true"]').fill(markdown)
  await expectAuthority(page, markdown)
}

async function selectSourceRange(page: Page, from: number, to: number): Promise<void> {
  const source = page.locator('.cm-content[contenteditable="true"]')
  await source.click()
  await page.keyboard.press('Control+Home')
  for (let index = 0; index < from; index += 1) await page.keyboard.press('ArrowRight')
  for (let index = from; index < to; index += 1) await page.keyboard.press('Shift+ArrowRight')
}

async function openFormulaPicker(page: Page): Promise<Readonly<{ dialog: Locator; trigger: Locator }>> {
  const insert = page.locator('[data-toolbar-menu="insert"] .toolbar-menu__trigger')
  await insert.click()
  const trigger = page.locator('[data-command-id="insert.formula"]')
  await expect(trigger).toHaveCount(1)
  await trigger.focus()
  await trigger.press('Enter')
  const dialog = page.locator('[data-picker-command="insert.formula"]')
  await expect(dialog).toBeVisible()
  return Object.freeze({ dialog, trigger: insert })
}

function formulaSource(dialog: Locator): Locator {
  return dialog.locator('#formula-source')
}

function formulaMode(dialog: Locator, mode: 'inline' | 'block'): Locator {
  return dialog.locator(`input[type="radio"][value="${mode}"]`)
}

function applyFormula(dialog: Locator): Locator {
  return dialog.locator('.dialog-panel__actions .primary-action')
}

function cancelFormula(dialog: Locator): Locator {
  return dialog.locator('.dialog-panel__actions button:not(.primary-action)')
}

function formulaTemplate(dialog: Locator, index: number): Locator {
  return dialog.locator('.formula-picker__symbol').nth(index)
}

async function readFormulaGeometry(locator: Locator, mode: 'inline' | 'block'): Promise<FormulaGeometry> {
  return locator.locator('.katex-html').evaluate((root, formulaMode) => {
    const normalize = (value: string): string => value
      .normalize('NFC')
      .replace(/[\s\u200b\u200c\u200d]+/gu, '')

    const box = (element: Element, name: string): GeometryBox => {
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) {
        throw new Error(`${name} has no visible bounding box.`)
      }
      return Object.freeze({ bottom: rect.bottom, height: rect.height, top: rect.top })
    }

    const candidates = (text: string, predicate: (element: HTMLElement) => boolean = () => true): HTMLElement[] => {
      const expected = normalize(text)
      return [...root.querySelectorAll<HTMLElement>('*')]
        .filter((element) => normalize(element.textContent ?? '') === expected && predicate(element))
        .filter((element) => {
          const rect = element.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0
        })
        .sort((left, right) => {
          const leftRect = left.getBoundingClientRect()
          const rightRect = right.getBoundingClientRect()
          const areaDelta = leftRect.width * leftRect.height - rightRect.width * rightRect.height
          if (areaDelta !== 0) return areaDelta
          return right.querySelectorAll('*').length - left.querySelectorAll('*').length
        })
    }

    const smallest = (text: string, predicate?: (element: HTMLElement) => boolean): HTMLElement => {
      const candidate = candidates(text, predicate)[0]
      if (candidate === undefined) throw new Error(`No visible KaTeX span matched ${JSON.stringify(text)}.`)
      return candidate
    }

    const merge = (elements: Element[], name: string): GeometryBox => {
      if (elements.length === 0) throw new Error(`${name} has no matching KaTeX spans.`)
      const rects = elements.map((element) => element.getBoundingClientRect())
      const top = Math.min(...rects.map((rect) => rect.top))
      const bottom = Math.max(...rects.map((rect) => rect.bottom))
      return Object.freeze({ bottom, height: bottom - top, top })
    }

    const formula = box(root.closest('.katex') ?? root, 'formula')
    if (formulaMode === 'inline') {
      const base = merge([
        smallest('m', (element) => element.closest('.msupsub') === null),
        smallest('c', (element) => element.closest('.msupsub') === null),
      ], 'mc base')
      const superscript = box(
        smallest('2', (element) => element.closest('.msupsub') !== null),
        'superscript',
      )
      return Object.freeze({ base, formula, superscript })
    }

    const fraction = root.querySelector<HTMLElement>('.mfrac')
    const fractionLineElement = fraction?.querySelector<HTMLElement>('.frac-line')
    if (fraction === null || fraction === undefined || fractionLineElement === null || fractionLineElement === undefined) {
      throw new Error('The complex formula is missing its KaTeX fraction line.')
    }
    const fractionLine = box(fractionLineElement, 'fraction line')
    const numerator = box(
      smallest('f(x+Δx)−f(x)', (element) => {
        if (!fraction.contains(element)) return false
        return (fractionLineElement.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
      }),
      'numerator',
    )
    const denominator = box(
      smallest('Δx', (element) => {
        if (!fraction.contains(element)) return false
        return (element.compareDocumentPosition(fractionLineElement) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
      }),
      'denominator',
    )
    const limitOperator = box(
      smallest('lim', (element) => element.classList.contains('mop')),
      'limit operator',
    )
    const limitSubscript = box(
      smallest('Δx→0', (element) => element.closest('.op-limits') !== null),
      'limit subscript',
    )
    return Object.freeze({
      denominator,
      fractionLine,
      formula,
      limitOperator,
      limitSubscript,
      numerator,
    })
  }, mode)
}

async function expectInlineFormulaGeometry(locator: Locator): Promise<void> {
  const geometry = await readFormulaGeometry(locator, 'inline') as InlineFormulaGeometry
  expect(geometry.superscript.bottom).toBeLessThan(geometry.base.bottom)
}

async function expectBlockFormulaGeometry(locator: Locator): Promise<void> {
  const geometry = await readFormulaGeometry(locator, 'block') as BlockFormulaGeometry
  expect(geometry.numerator.bottom).toBeLessThan(geometry.fractionLine.top + 1)
  expect(geometry.denominator.top).toBeGreaterThan(geometry.fractionLine.bottom - 1)
  expect(geometry.limitSubscript.top).toBeGreaterThan(geometry.limitOperator.top)
  expect(geometry.formula.height).toBeGreaterThan(geometry.fractionLine.height + 16)
}

test('Task 1 geometry preserves exact E=mc^2 and limit/fraction layout in Visual and Final', async ({ page }) => {
  await primeDocument(page, GEOMETRY_MARKDOWN)
  await page.locator('[data-command-id="mode.visual"]').click()

  const visualInline = page.locator('[data-w-editor-node="formula"][data-formula-mode="inline"]')
  const visualBlock = page.locator('[data-w-editor-node="formula"][data-formula-mode="block"]')
  await expect(visualInline).toHaveCount(1)
  await expect(visualBlock).toHaveCount(1)
  await expectInlineFormulaGeometry(visualInline)
  await expectBlockFormulaGeometry(visualBlock)

  await expect(visualInline.getByRole('button', { name: /edit/iu })).toHaveCount(0)
  await expect(visualBlock.getByRole('button', { name: /edit/iu })).toHaveCount(0)

  await visualInline.dblclick()
  let picker = page.locator('[data-picker-command="insert.formula"]')
  await expect(formulaMode(picker, 'inline')).toBeChecked()
  await expect(formulaSource(picker)).toHaveValue(INLINE_GEOMETRY_SOURCE)
  await cancelFormula(picker).click()
  await expect(picker).toHaveCount(0)

  await visualBlock.dblclick()
  picker = page.locator('[data-picker-command="insert.formula"]')
  await expect(formulaMode(picker, 'block')).toBeChecked()
  await expect(formulaSource(picker)).toHaveValue(BLOCK_GEOMETRY_SOURCE)
  await cancelFormula(picker).click()
  await expect(picker).toHaveCount(0)

  await page.locator('[data-command-id="mode.preview"]').click()
  const finalInline = page.locator('.preview-rendered-content .formula-node--inline')
  const finalBlock = page.locator('.preview-rendered-content .formula-node--block')
  await expect(finalInline).toHaveCount(1)
  await expect(finalBlock).toHaveCount(1)
  await expectInlineFormulaGeometry(finalInline)
  await expectBlockFormulaGeometry(finalBlock)
})

async function codeMirrorSource(editor: Locator): Promise<string> {
  return editor.locator('.cm-line').evaluateAll((lines) => lines.map((line) => line.textContent ?? '').join('\n'))
}

test('Task 22.5 one Formula command provides a keyboard-safe Inline picker with templates, symbols, invalid Retry, exact source, undo, Final, and reload', async ({ page }) => {
  await primeDocument(page, INLINE_INITIAL)
  await selectSourceRange(page, 6, 10)
  const before = await authority(page)

  let picker = await openFormulaPicker(page)
  const inline = formulaMode(picker.dialog, 'inline')
  const block = formulaMode(picker.dialog, 'block')
  await expect(inline).toBeChecked()
  await expect(block).not.toBeChecked()
  await expect(formulaSource(picker.dialog)).toBeFocused()
  await formulaSource(picker.dialog).press('Escape')
  await expect(picker.dialog).toHaveCount(0)
  await expect(picker.trigger).toBeFocused()
  await expectAuthority(page, before.markdown, before.revision)

  picker = await openFormulaPicker(page)
  await formulaMode(picker.dialog, 'inline').focus()
  await formulaMode(picker.dialog, 'inline').press('ArrowRight')
  await expect(formulaMode(picker.dialog, 'block')).toBeChecked()
  await formulaMode(picker.dialog, 'block').press('ArrowLeft')
  await expect(formulaMode(picker.dialog, 'inline')).toBeChecked()

  const source = formulaSource(picker.dialog)
  await source.fill('bad $ close')
  await applyFormula(picker.dialog).click()
  await expect(picker.dialog.getByRole('alert')).toContainText('unescaped $ delimiter')
  await expect(source).toBeFocused()
  await expect(applyFormula(picker.dialog)).toBeEnabled()
  await expectAuthority(page, before.markdown, before.revision)

  await source.fill('')
  await formulaTemplate(picker.dialog, 0).click()
  await formulaTemplate(picker.dialog, 2).click()
  await expect(source).toHaveValue(FRACTION_SUM)
  await applyFormula(picker.dialog).click()
  await expect(picker.dialog).toHaveCount(0)
  await expectAuthority(page, INLINE_EXPECTED, before.revision + 1)

  await page.locator('[data-command-id="history.undo"]').click()
  await expectAuthority(page, INLINE_INITIAL)
  await page.locator('[data-command-id="history.redo"]').click()
  await expectAuthority(page, INLINE_EXPECTED)
  await page.locator('[data-command-id="mode.preview"]').click()
  await expect(page.locator('.preview-rendered-content .formula-node--inline')).toBeVisible()
  await expect.poll(() => authority(page).then(({ autosaveStatus }) => autosaveStatus)).toBe('saved')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  await expectAuthority(page, INLINE_EXPECTED)
})

test('Task 22.5 Block Formula uses the same picker, renders and edits in Visual, retries invalid input, undoes once, and reaches read-only Preview', async ({ page }) => {
  await primeDocument(page, BLOCK_INITIAL)
  await page.locator('[data-command-id="mode.visual"]').click()
  await page.locator('.ProseMirror p').click()
  const before = await authority(page)

  let picker = await openFormulaPicker(page)
  await formulaMode(picker.dialog, 'block').check()
  await formulaTemplate(picker.dialog, 1).click()
  await expect(formulaSource(picker.dialog)).toHaveValue('a^2 + b^2 = c^2')
  await applyFormula(picker.dialog).click()
  await expectAuthority(page, BLOCK_PYTHAGOREAN, before.revision + 1)

  const formula = page.locator('[data-w-editor-node="formula"][data-formula-mode="block"]')
  await expect(formula).toHaveCount(1)
  await expect(formula).toBeVisible()
  await expect(formula.locator('[data-semantic-kind="formula"]')).toHaveCount(0)
  await expect(formula.locator('[data-formula-edit]')).toHaveCount(0)
  await expect(formula.getByRole('button', { name: /edit/iu })).toHaveCount(0)
  await expect(formula.locator('.katex')).toHaveCSS('font-family', /KaTeX_Main/)
  await expect(formula.locator('.msupsub .vlist-t').first()).toHaveCSS('display', 'inline-table')
  await formula.dblclick()
  picker = Object.freeze({
    dialog: page.locator('[data-picker-command="insert.formula"]'),
    trigger: page.locator('[data-toolbar-menu="insert"] .toolbar-menu__trigger'),
  })
  await expect(formulaMode(picker.dialog, 'block')).toBeChecked()
  await expect(formulaSource(picker.dialog)).toHaveValue('a^2 + b^2 = c^2')
  const beforeRetry = await authority(page)
  await formulaSource(picker.dialog).fill('bad $$ close')
  await applyFormula(picker.dialog).click()
  await expect(picker.dialog.getByRole('alert')).toContainText('delimiter')
  await expect(formulaSource(picker.dialog)).toBeFocused()
  await expectAuthority(page, beforeRetry.markdown, beforeRetry.revision)
  await formulaSource(picker.dialog).fill('E = mc^2')
  await applyFormula(picker.dialog).click()
  await expectAuthority(page, BLOCK_EDITED, beforeRetry.revision + 1)

  await page.locator('[data-command-id="history.undo"]').click()
  await expectAuthority(page, BLOCK_PYTHAGOREAN)
  await page.locator('[data-command-id="history.redo"]').click()
  await expectAuthority(page, BLOCK_EDITED)
  await page.locator('[data-command-id="mode.preview"]').click()
  await expect(page.locator('.preview-rendered-content .formula-node--block')).toBeVisible()
  await expect(page.locator('.preview-rendered-content .formula-node--block .katex')).toBeVisible()
  await expect.poll(() => authority(page).then(({ autosaveStatus }) => autosaveStatus)).toBe('saved')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  await expectAuthority(page, BLOCK_EDITED)
})

test('Task 22.5 double-click edits imported Inline and Block Formula with exact positions, Cancel, Source round-trip, and reload', async ({ page }) => {
  await primeDocument(page, IMPORTED)
  const before = await authority(page)
  await page.locator('[data-command-id="mode.visual"]').click()
  const inline = page.locator('[data-w-editor-node="formula"][data-formula-mode="inline"]')
  const block = page.locator('[data-w-editor-node="formula"][data-formula-mode="block"]')
  await expect(inline).toHaveCount(1)
  await expect(block).toHaveCount(1)
  await expect(inline).toBeVisible()
  await expect(block).toBeVisible()
  await expect(inline.locator('[data-formula-edit]')).toHaveCount(0)
  await expect(block.locator('[data-formula-edit]')).toHaveCount(0)
  await expect(inline.getByRole('button', { name: /edit/iu })).toHaveCount(0)
  await expect(block.getByRole('button', { name: /edit/iu })).toHaveCount(0)
  await expect(inline.locator('xpath=ancestor::p')).toContainText('Before')
  await expect(inline.locator('xpath=ancestor::p')).toContainText('after')

  await inline.dblclick()
  let picker = page.locator('[data-picker-command="insert.formula"]')
  await expect(formulaMode(picker, 'inline')).toBeChecked()
  await expect(formulaSource(picker)).toHaveValue('x+y')
  await cancelFormula(picker).click()
  await expect(picker).toHaveCount(0)
  await expect(page.locator('.ProseMirror')).toBeFocused()
  await expectAuthority(page, before.markdown, before.revision)

  await inline.dblclick()
  picker = page.locator('[data-picker-command="insert.formula"]')
  await formulaSource(picker).fill('x-y')
  await applyFormula(picker).click()
  await expectAuthority(page, IMPORTED_EDITED, before.revision + 1)
  await page.locator('[data-command-id="history.undo"]').click()
  await expectAuthority(page, IMPORTED)
  await page.locator('[data-command-id="history.redo"]').click()
  await expectAuthority(page, IMPORTED_EDITED)

  await page.locator('[data-command-id="mode.source"]').click()
  await expect.poll(() => codeMirrorSource(page.locator('.cm-content[contenteditable="true"]'))).toBe(IMPORTED_EDITED)
  await expect.poll(() => authority(page).then(({ autosaveStatus }) => autosaveStatus)).toBe('saved')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  await expectAuthority(page, IMPORTED_EDITED)
})
