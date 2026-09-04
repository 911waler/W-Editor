import type { Locator, Page } from '@playwright/test'

import { createToolbarCommandDescriptors } from '../src/services'
import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

const MENU_COMMANDS = Object.freeze({
  'text-style': Object.freeze(['text.strike', 'text.underline', 'text.subscript', 'text.superscript', 'text.ruby', 'block.quote']),
  color: Object.freeze(['text.color', 'text.background']),
  alignment: Object.freeze(['align.left', 'align.center', 'align.right', 'align.justify']),
  mermaid: Object.freeze([
    'mermaid.flowchart',
    'mermaid.sequence',
    'mermaid.state',
    'mermaid.class',
    'mermaid.pie',
    'mermaid.gantt',
  ]),
  chart: Object.freeze([
    'chart.line',
    'chart.bar',
    'chart.radar',
    'chart.map',
    'chart.heatmap',
    'chart.scatter',
    'chart.pie',
    'chart.sankey',
  ]),
  export: Object.freeze([
    'export.markdown',
    'export.html',
    'export.word',
    'export.pdf',
    'export.screenshot',
  ]),
  heading: Object.freeze(['block.h1', 'block.h2', 'block.h3', 'block.h4', 'block.h5']),
  insert: Object.freeze([
    'insert.image',
    'insert.audio',
    'insert.video',
    'insert.link',
    'insert.horizontal-rule',
    'insert.hard-break',
    'insert.code-block',
    'insert.inline-code',
    'insert.formula',
    'insert.toc',
    'insert.table',
    'insert.pdf',
    'insert.word',
    'insert.file',
  ]),
  language: Object.freeze(['language.zh', 'language.en', 'language.ru']),
  panel: Object.freeze([
    'panel.primary',
    'panel.info',
    'panel.warning',
    'panel.danger',
    'panel.success',
    'layout.two-column',
    'layout.multi-column',
    'layout.tabs',
  ]),
})

const DIRECT_COMMANDS = Object.freeze([
  'text.bold',
  'text.italic',
  'text.size',
  'insert.drawio',
  'list.ordered',
  'list.unordered',
  'list.task',
  'layout.timeline',
  'layout.accordion',
  'history.undo',
  'history.redo',
  'document.manual-save',
  'settings.shortcuts',
  'search.replace',
  'document.word-count',
  'application.fullscreen',
])

const MODE_COMMANDS = Object.freeze(['mode.source', 'mode.visual', 'mode.preview'])

const TOP_LEVEL_ORDER = Object.freeze([
  'text.bold',
  'text.italic',
  'menu.text-style',
  'text.size',
  'separator.text-style',
  'menu.color',
  'menu.heading',
  'separator.text',
  'insert.drawio',
  'separator.drawing',
  'list.ordered',
  'list.unordered',
  'list.task',
  'menu.panel',
  'layout.timeline',
  'menu.alignment',
  'layout.accordion',
  'separator.structure',
  'insert.formula.alias',
  'menu.insert',
  'menu.mermaid',
  'menu.chart',
  'separator.history',
  'history.undo',
  'history.redo',
  'separator.reference-utilities',
  'settings.shortcuts',
  'search.replace',
  'mode.preview.alias',
  'document.manual-save',
  'spacer',
  'line-spacing',
  'document.word-count',
  'separator.right',
  'menu.theme',
  'menu.language',
  'menu.export',
  'separator.fullscreen',
  'application.fullscreen',
])

const registryIds = createToolbarCommandDescriptors().map(({ id }) => id)
const routedIds = [
  ...DIRECT_COMMANDS,
  ...Object.values(MENU_COMMANDS).flat(),
  ...MODE_COMMANDS,
]

function pngDimensions(bytes: Buffer): Readonly<{ height: number; width: number }> {
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG')
  return Object.freeze({
    height: bytes.readUInt32BE(20),
    width: bytes.readUInt32BE(16),
  })
}

async function authorityMarkdown(page: Page): Promise<string | undefined> {
  return page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().markdown)
}

async function expectOverlayAnchored(trigger: Locator, overlay: Locator): Promise<void> {
  const triggerBox = await trigger.boundingBox()
  const overlayBox = await overlay.boundingBox()
  expect(triggerBox).not.toBeNull()
  expect(overlayBox).not.toBeNull()
  expect(Math.abs((overlayBox?.y ?? 0) - ((triggerBox?.y ?? 0) + (triggerBox?.height ?? 0)))).toBeLessThanOrEqual(8)
  expect(overlayBox?.x ?? -1).toBeGreaterThanOrEqual(0)
}

test('UA-007 renders all 80 commands once in the frozen top-level order and menu ownership', async ({ page }) => {
  expect(routedIds).toHaveLength(80)
  expect(new Set(routedIds).size).toBe(80)
  expect([...routedIds].sort()).toEqual([...registryIds].sort())

  await openReadyApp(page)
  const toolbar = page.locator('.toolbar-region[role="toolbar"]')
  await expect(toolbar.locator('[data-toolbar-slot]')).toHaveCount(TOP_LEVEL_ORDER.length)
  expect(await toolbar.locator('[data-toolbar-slot]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-toolbar-slot')),
  )).toEqual(TOP_LEVEL_ORDER)

  for (const [menuId, commandIds] of Object.entries(MENU_COMMANDS)) {
    const owner = toolbar.locator(`[data-toolbar-menu="${menuId}"]`)
    await expect(owner).toHaveCount(1)
    expect(await owner.locator('[data-command-id]').evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-command-id')),
    )).toEqual(commandIds)
  }

  for (const legacyMenuId of ['draw', 'format', 'structure', 'more']) {
    await expect(toolbar.locator(`[data-toolbar-menu="${legacyMenuId}"]`)).toHaveCount(0)
  }

  const commandIds = await page.locator('[data-command-id]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-command-id')),
  )
  expect(commandIds).toHaveLength(80)
  expect(new Set(commandIds).size).toBe(80)
  expect([...commandIds].sort()).toEqual([...registryIds].sort())
  await expect(toolbar.locator('[data-command-alias="insert.formula"]')).toHaveCount(1)
})

test('UA-007 toolbar keyboard, state, focus, and a moved command outcome remain truthful', async ({ page }) => {
  await openReadyApp(page)
  await page.locator('.workspace-controls [data-command-id="mode.source"]').click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'source')
  const source = page.locator('.cm-content[contenteditable="true"]')
  await source.fill('Alpha')
  await source.click()
  await page.keyboard.press('Control+A')

  const bold = page.locator('[data-command-id="text.bold"]')
  const italic = page.locator('[data-command-id="text.italic"]')
  await bold.focus()
  await page.keyboard.press('ArrowRight')
  await expect(italic).toBeFocused()

  const textStyleTrigger = page.locator('[data-toolbar-menu="text-style"] .toolbar-menu__trigger')
  await textStyleTrigger.focus()
  await page.keyboard.press('Enter')
  const textStyleMenu = page.locator('[data-toolbar-menu="text-style"] [role="menu"]')
  await expect(textStyleMenu).toBeVisible()
  await page.keyboard.press('ArrowDown')
  const strike = page.locator('[data-command-id="text.strike"]')
  await expect(strike).toBeFocused()
  await page.keyboard.press('Enter')
  await expect.poll(() => authorityMarkdown(page)).toBe('~~Alpha~~')
  await expect(source).toBeFocused()
  await expect(strike).toHaveAttribute('aria-checked', 'true')
  await expect(textStyleMenu).toBeHidden()

  const headingTrigger = page.locator('[data-toolbar-menu="heading"] .toolbar-menu__trigger')
  await headingTrigger.focus()
  await page.keyboard.press('Enter')
  const headingMenu = page.locator('[data-toolbar-menu="heading"] [role="menu"]')
  await expect(headingMenu).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('[data-command-id="block.h1"]')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(headingTrigger).toBeFocused()

  await page.locator('.workspace-controls [data-command-id="mode.preview"]').click()
  await expect(strike).toBeDisabled()
  await expect(page.locator('[data-command-id="search.replace"]')).toBeEnabled()
  await expect(page.locator('[data-command-id="document.manual-save"]')).toBeEnabled()
  await expect(page.getByTestId('toolbar-preview-toggle')).toHaveAttribute('aria-pressed', 'true')
})

test('UA-007 official Formula alias and Insert table route preserve picker anchoring and focus', async ({ page }) => {
  await openReadyApp(page)

  const formulaAlias = page.locator('[data-command-alias="insert.formula"]')
  await formulaAlias.click()
  const formulaPicker = page.locator('[data-picker-command="insert.formula"]')
  await expect(formulaPicker).toBeVisible()
  await formulaPicker.locator('.dialog-panel__actions button').first().click()
  await expect(formulaAlias).toBeFocused()

  const insertTrigger = page.locator('[data-toolbar-menu="insert"] .toolbar-menu__trigger')
  await insertTrigger.click()
  await page.locator('[data-command-id="insert.table"]').click()
  const tablePicker = page.locator('[data-table-dimension-picker]')
  await expect(tablePicker).toBeVisible()
  await expectOverlayAnchored(insertTrigger, tablePicker)
  await page.keyboard.press('Escape')
  await expect(tablePicker).toBeHidden()
  await expect(insertTrigger).toBeFocused()
})

for (const viewport of [
  Object.freeze({ height: 1000, label: 'desktop', width: 1692 }),
  Object.freeze({ height: 900, label: 'narrow', width: 768 }),
] as const) {
  test(`UA-007 ${viewport.label} toolbar screenshot uses the frozen Cherry row and responsive geometry`, async ({ page }) => {
    await page.setViewportSize({ height: viewport.height, width: viewport.width })
    await openReadyApp(page)
    await page.addStyleTag({
      content: '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }',
    })
    const toolbar = page.locator('.toolbar-region[role="toolbar"]')
    const box = await toolbar.boundingBox()
    expect(box).not.toBeNull()
    const screenshot = await toolbar.screenshot({ animations: 'disabled', caret: 'hide' })
    expect(pngDimensions(screenshot)).toEqual({
      height: 48,
      width: Math.round(box?.width ?? 0),
    })

    const geometry = await toolbar.evaluate((element) => {
      const style = getComputedStyle(element)
      const slots = [...element.querySelectorAll<HTMLElement>('[data-toolbar-slot]')]
      const toolbarBox = element.getBoundingClientRect()
      const buttons = slots
        .map((slot) => slot.querySelector<HTMLButtonElement>(':scope > button'))
        .filter((button): button is HTMLButtonElement => button !== null)
      const iconButtons = buttons.filter((button) => button.querySelector(':scope > .ch-icon'))
      const icons = iconButtons.map((button) => button.querySelector<HTMLElement>(':scope > .ch-icon'))
        .filter((icon): icon is HTMLElement => icon !== null)
      const dividers = slots.filter((slot) => slot.classList.contains('toolbar-divider'))
      return {
        background: style.backgroundColor,
        buttonHeights: [...new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().height)))],
        buttonPaddings: [...new Set(buttons.map((button) => {
          const buttonStyle = getComputedStyle(button)
          return `${buttonStyle.paddingTop} ${buttonStyle.paddingRight} ${buttonStyle.paddingBottom} ${buttonStyle.paddingLeft}`
        }))],
        clientWidth: element.clientWidth,
        dividerBoxes: dividers.map((divider) => {
          const box = divider.getBoundingClientRect()
          const dividerStyle = getComputedStyle(divider)
          return {
            height: Math.round(box.height),
            marginLeft: dividerStyle.marginLeft,
            marginRight: dividerStyle.marginRight,
            width: Math.round(box.width),
          }
        }),
        firstSlotOffset: Math.round((slots[0]?.getBoundingClientRect().left ?? toolbarBox.left) - toolbarBox.left),
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        gap: style.gap,
        iconBoxes: icons.map((icon) => {
          const box = icon.getBoundingClientRect()
          const iconStyle = getComputedStyle(icon)
          const beforeStyle = getComputedStyle(icon, '::before')
          return {
            beforeFontFamily: beforeStyle.fontFamily,
            fontSize: iconStyle.fontSize,
            height: Math.round(box.height),
            width: Math.round(box.width),
          }
        }),
        iconButtonWidths: [...new Set(iconButtons.map((button) => Math.round(button.getBoundingClientRect().width)))],
        padding: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
        rowCenters: [...new Set(slots.map((slot) => {
          const box = slot.getBoundingClientRect()
          return Math.round(box.top + (box.height / 2))
        }))],
        scrollWidth: element.scrollWidth,
      }
    })
    expect(geometry.background).toBe('rgb(255, 255, 255)')
    expect(geometry.fontFamily).toContain('Helvetica Neue')
    expect(geometry.fontFamily).toContain('Microsoft YaHei')
    expect(geometry.fontSize).toBe('14px')
    expect(geometry.gap).toBe('0px')
    expect(geometry.buttonHeights).toEqual([38])
    expect(geometry.buttonPaddings).toEqual(['0px 12px 0px 12px'])
    expect(geometry.iconButtonWidths).toEqual([38])
    expect(geometry.iconBoxes.length).toBeGreaterThan(15)
    expect(geometry.iconBoxes.every((icon) => icon.beforeFontFamily.replaceAll('"', '') === 'w-editor-ch-icon')).toBe(true)
    expect(geometry.iconBoxes.every((icon) => icon.fontSize === '14px' && icon.height === 14 && icon.width === 14)).toBe(true)
    expect(geometry.dividerBoxes.every((divider) => (
      divider.height === 21
      && divider.width === 2
      && divider.marginLeft === '4px'
      && divider.marginRight === '4px'
    ))).toBe(true)
    expect(geometry.rowCenters).toHaveLength(1)
    if (viewport.label === 'desktop') {
      expect(geometry.padding).toBe('4px 24px 4px 24px')
      expect(geometry.firstSlotOffset).toBe(24)
    } else {
      expect(geometry.scrollWidth).toBeGreaterThan(geometry.clientWidth)
    }
  })
}

test('UA-008 page scroll is suppressed while the article panel, toolbar, and mode controls stay fixed', async ({ page }) => {
  await openReadyApp(page)
  const fixedRegions = page.locator('.article-panel, .toolbar-region, .workspace-controls')
  const before = await fixedRegions.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect()
    return { left: Math.round(rect.left), top: Math.round(rect.top) }
  }))
  await page.evaluate(() => window.scrollTo(0, 800))

  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  expect(await fixedRegions.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect()
    return { left: Math.round(rect.left), top: Math.round(rect.top) }
  }))).toEqual(before)

  const insertTrigger = page.locator('[data-toolbar-menu="insert"] .toolbar-menu__trigger')
  await insertTrigger.scrollIntoViewIfNeeded()
  await insertTrigger.click()
  const menu = page.locator('[data-toolbar-menu="insert"] [role="menu"]')
  await expect(menu).toBeVisible()
  await expectOverlayAnchored(insertTrigger, menu)
})

test('UA-008 internal scroll and narrow toolbar keep menus, popovers, and tooltips anchored', async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 768 })
  await openReadyApp(page)
  await page.addStyleTag({ content: '.editor-surface { height: 320px !important; }' })
  await page.locator('.workspace-controls [data-command-id="mode.source"]').click()
  await page.locator('.cm-content[contenteditable="true"]').fill(
    Array.from({ length: 80 }, (_, index) => `Paragraph ${index + 1}`).join('\n\n'),
  )
  await page.locator('.workspace-controls [data-command-id="mode.visual"]').click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'visual')

  const toolbar = page.locator('.toolbar-region[role="toolbar"]')
  const initialToolbarY = Math.round((await toolbar.boundingBox())?.y ?? -1)
  await page.locator('.editor-surface').evaluate((element) => { element.scrollTop = 240 })
  expect(Math.round((await toolbar.boundingBox())?.y ?? -1)).toBe(initialToolbarY)

  const bold = page.locator('[data-command-id="text.bold"]')
  await bold.scrollIntoViewIfNeeded()
  await bold.focus()
  const tooltip = page.locator('.toolbar-tooltip')
  await expect(tooltip).toBeVisible()
  await expectOverlayAnchored(bold, tooltip)

  const wordCount = page.locator('[data-command-id="document.word-count"]')
  await wordCount.scrollIntoViewIfNeeded()
  await wordCount.click()
  const popover = page.locator('[data-toolbar-popover="word-count"]')
  await expect(popover).toBeVisible()
  await expect(popover).not.toHaveAttribute('aria-modal', 'true')
  await expectOverlayAnchored(wordCount, popover)
  const popoverBox = await popover.boundingBox()
  expect((popoverBox?.x ?? 0) + (popoverBox?.width ?? 0)).toBeLessThanOrEqual(768)
})
