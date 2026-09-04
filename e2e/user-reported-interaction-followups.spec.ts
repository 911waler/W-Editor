import { readFile } from 'node:fs/promises'

import type { Locator, Page } from '@playwright/test'

import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

type ListCommandId = 'list.ordered' | 'list.task' | 'list.unordered'

async function authority(page: Page) {
  return page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read() ?? null)
}

async function expectAuthority(page: Page, markdown: string): Promise<void> {
  await expect.poll(async () => (await authority(page))?.markdown).toBe(markdown)
  await expect.poll(async () => (await authority(page))?.synchronizationStatus).toBe('synchronized')
}

async function switchMode(page: Page, mode: 'source' | 'visual'): Promise<void> {
  const surface = page.getByTestId('editor-surface')
  if (await surface.getAttribute('data-mode') !== mode) {
    await page.locator(`[data-command-id="mode.${mode}"]`).click()
  }
  await expect(surface).toHaveAttribute('data-mode', mode)
}

async function openVisualMarkdown(page: Page, markdown: string): Promise<Locator> {
  await openReadyApp(page)
  await switchMode(page, 'source')
  await page.locator('.cm-content[contenteditable="true"]').fill(markdown)
  await expectAuthority(page, markdown)
  await switchMode(page, 'visual')
  const editor = page.locator('.ProseMirror')
  await expect(editor).toBeVisible()
  return editor
}

async function openBlockMenu(page: Page, block: Locator): Promise<Locator> {
  await block.hover()
  const handle = page.locator('.visual-block-handle')
  await expect(handle).toBeVisible()
  await handle.click()
  const menu = page.locator('.visual-block-menu').filter({ has: page.locator('[data-block-action="duplicate"]') })
  await expect(menu).toBeVisible()
  return menu
}

test('formula picker sections and symbol categories are interactive and render a real fraction preview', async ({ page }) => {
  await openReadyApp(page)
  await page.locator('[data-command-alias="insert.formula"]').click()
  const dialog = page.locator('[data-picker-command="insert.formula"]')
  await expect(dialog).toBeVisible()

  for (const section of ['templates', 'text-styles'] as const) {
    const trigger = dialog.locator(`[data-formula-section="${section}"]`)
    await expect(trigger).toHaveCount(1)
    await trigger.click()
    await expect(trigger).toHaveAttribute('aria-current', 'page')
    const tool = dialog.locator(`[data-formula-tools="${section}"] .formula-picker__symbol`).first()
    await expect(tool).toBeVisible()
    await tool.click()
    await expect(dialog.locator('#formula-source')).not.toHaveValue('E = mc^2')
  }

  await dialog.locator('[data-formula-section="quick-tools"]').click()
  for (const category of ['roots-indices', 'limits-logarithms', 'trigonometry'] as const) {
    const trigger = dialog.locator(`[data-formula-category="${category}"]`)
    await trigger.click()
    await expect(trigger).toHaveAttribute('aria-selected', 'true')
    await expect(dialog.locator(`[data-formula-tools="${category}"] .formula-picker__symbol`).first()).toBeVisible()
  }

  await dialog.locator('[data-formula-category="common-symbols"]').click()
  const fraction = dialog.locator('[data-formula-tool="fraction"]')
  await expect(fraction.locator('.katex .mfrac')).toHaveCount(1)
  await expect(fraction.locator('.mfrac')).toContainText('a')
  await expect(fraction.locator('.mfrac')).toContainText('b')
  await fraction.click()
  await expect(dialog.locator('#formula-source')).toHaveValue(String.raw`\frac{a}{b}`)
})

test('wheel scrolling is owned by the editor while the articles, toolbar, and mode controls remain fixed', async ({ page }) => {
  await page.setViewportSize({ height: 720, width: 1280 })
  const markdown = Array.from({ length: 90 }, (_, index) => `Paragraph ${index + 1}`).join('\n\n')
  await openVisualMarkdown(page, markdown)

  const tracked = page.locator('.article-panel, .toolbar-region, .workspace-controls')
  const before = await tracked.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, top: rect.top }
  }))
  const editorSurface = page.locator('.editor-surface')
  await editorSurface.hover({ position: { x: 60, y: 300 } })
  await page.mouse.wheel(0, 1_000)
  await expect.poll(() => editorSurface.evaluate((element) => element.scrollTop)).toBeGreaterThan(500)

  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  expect(await tracked.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, top: rect.top }
  }))).toEqual(before)
})

test('UAT-DTR-018 keeps the Preview viewport fixed while visible task controls update Markdown', async ({ page }) => {
  await page.setViewportSize({ height: 720, width: 1280 })
  const before = Array.from(
    { length: 24 },
    (_, index) => `## Before ${index + 1}\n\nStable paragraph ${index + 1}.`,
  ).join('\n\n')
  const tasksSource = [
    '- [ ] 1',
    '- [ ] 2',
    '  - [ ] 3',
    '  - [ ] 3',
    '    - [ ] 4',
  ].join('\n')
  const after = Array.from(
    { length: 8 },
    (_, index) => `## Panel ${index + 1}\n\n::: info Information\nStable panel body ${index + 1}.\n:::`,
  ).join('\n\n')
  const markdown = `# Preview task scroll repro\n\n${before}\n\n${tasksSource}\n\n${after}`
  await openVisualMarkdown(page, markdown)
  const startingRevision = (await authority(page))?.revision
  if (startingRevision === undefined) throw new Error('Authority inspection is unavailable.')

  await page.locator('[data-command-id="mode.preview"]').click()
  const editorSurface = page.getByTestId('editor-surface')
  await expect(editorSurface).toHaveAttribute('data-mode', 'preview')
  await expect(editorSurface).toHaveClass(/editor-surface--preview/u)
  await expect(editorSurface).toHaveCSS('overflow-anchor', 'none')
  const tasks = page.locator('.visual-surface[data-mode="preview"] input[type="checkbox"]')
  await expect(tasks).toHaveCount(5)
  const anchor = page.locator('.visual-surface[data-mode="preview"] h2', { hasText: 'Panel 1' })
  await tasks.nth(2).evaluate((element) => element.scrollIntoView({ block: 'center' }))
  const baseline = await editorSurface.evaluate((element) => element.scrollTop)
  const anchorTop = await anchor.evaluate((element) => element.getBoundingClientRect().top)

  for (const [step, index] of [2, 4, 0, 3].entries()) {
    const target = tasks.nth(index)
    const box = await target.boundingBox()
    if (box === null) throw new Error(`Preview task ${index} is not visible.`)
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect(target).toBeChecked()
    await expect.poll(async () => (await authority(page))?.revision).toBe(startingRevision + step + 1)
    await expect.poll(() => editorSurface.evaluate((element) => element.scrollTop)).toBe(baseline)
    await expect.poll(() => anchor.evaluate((element) => element.getBoundingClientRect().top)).toBe(anchorTop)
    expect(await tasks.evaluateAll((elements) => elements.findIndex((element) => element === document.activeElement))).toBe(index)
  }

  await expect.poll(async () => (await authority(page))?.autosaveStatus).toBe('saved')
  await page.keyboard.press('Control+z')
  await expect(tasks.nth(3)).not.toBeChecked()
  await expect.poll(() => editorSurface.evaluate((element) => element.scrollTop)).toBe(baseline)
  await expect.poll(() => anchor.evaluate((element) => element.getBoundingClientRect().top)).toBe(anchorTop)

  await page.locator('[data-command-id="mode.visual"]').click()
  await expect(editorSurface).toHaveAttribute('data-mode', 'visual')
  await expect(editorSurface).not.toHaveClass(/editor-surface--preview/u)
  await expect(editorSurface).not.toHaveCSS('overflow-anchor', 'none')
  await page.locator('[data-command-id="mode.source"]').click()
  await expect(editorSurface).toHaveAttribute('data-mode', 'source')
  await expect(editorSurface).not.toHaveClass(/editor-surface--preview/u)
  await expect(editorSurface).not.toHaveCSS('overflow-anchor', 'none')
})

test('block handles expose the Notion-like menu, dismiss predictably, vary by node type, and add a paragraph below', async ({ page }) => {
  const sampleImage = await readFile(new URL('./fixtures/files/sample-image.png', import.meta.url))
  await page.route('https://assets.example.test/image.png', (route) => route.fulfill({
    body: sampleImage,
    contentType: 'image/png',
  }))
  const editor = await openVisualMarkdown(page, 'Alpha\n\n```ts\nconst answer = 42\n```\n\n![Example](https://assets.example.test/image.png)')

  const paragraph = editor.locator(':scope > p', { hasText: 'Alpha' })
  await paragraph.hover()
  const add = page.locator('.visual-block-add')
  const handle = page.locator('.visual-block-handle')
  await expect(add).toBeVisible()
  await expect(handle).toBeVisible()

  let menu = await openBlockMenu(page, paragraph)
  await expect(menu).toContainText('文本')
  for (const label of ['颜色', '转换为', '重置格式', '复制节点', '复制到剪贴板', '复制锚点链接', '删除']) {
    await expect(menu.getByRole('menuitem', { name: new RegExp(label, 'iu') })).toBeVisible()
  }
  await expect(menu).not.toContainText('Ask AI')

  await handle.click()
  await expect(menu).toHaveCount(0)
  menu = await openBlockMenu(page, paragraph)
  await paragraph.click()
  await expect(menu).toHaveCount(0)

  await paragraph.hover()
  await add.click()
  await page.locator('.visual-block-menu--insert [data-block-insert="below"]').click()
  await page.keyboard.type('Beta')
  await expectAuthority(page, 'Alpha\n\nBeta\n\n```ts\nconst answer = 42\n```\n\n![Example](https://assets.example.test/image.png)')

  menu = await openBlockMenu(page, editor.locator('[data-w-editor-node="code-block"]'))
  await expect(menu).toContainText('代码块')
  await expect(menu.locator('[data-block-action="turn-into"]')).toBeVisible()
  await expect(menu.locator('[data-block-action="color"]')).toHaveCount(0)
  await page.keyboard.press('Escape')

  menu = await openBlockMenu(page, editor.locator('[data-semantic-kind="media"]'))
  await expect(menu).toContainText('图片')
  await expect(menu.locator('[data-block-action="download-image"]')).toBeVisible()
  await expect(menu.locator('[data-block-action="copy-anchor"]')).toBeDisabled()
})

test('Quote is available from the text-style toolbar menu with a matching compact icon', async ({ page }) => {
  const editor = await openVisualMarkdown(page, 'Alpha')
  await editor.locator('p').click()
  await page.locator('[data-toolbar-menu="text-style"] .toolbar-menu__trigger').click()
  const quote = page.locator('[data-toolbar-menu="text-style"] [data-command-id="block.quote"]')
  await expect(quote).toBeVisible()
  await expect(quote.locator('.toolbar-menu__icon')).toHaveText('>')
  await quote.click()
  await expectAuthority(page, '> Alpha')
})

test('font size, color, timeline, accordion, formula, and shortcut controls close their own overlays on the second click', async ({ page }) => {
  await openReadyApp(page)
  const initial = await authority(page)
  const cases = [
    { overlay: '[data-picker-command="text.size"]', trigger: '[data-command-id="text.size"]' },
    { overlay: '[data-picker-command="text.color"]', trigger: '[data-toolbar-menu="color"] .toolbar-menu__trigger' },
    { overlay: '[data-picker-command="layout.timeline"]', trigger: '[data-command-id="layout.timeline"]' },
    { overlay: '[data-picker-command="layout.accordion"]', trigger: '[data-command-id="layout.accordion"]' },
    { overlay: '[data-picker-command="insert.formula"]', trigger: '[data-command-alias="insert.formula"]' },
    { overlay: '[data-testid="shortcut-settings"]', trigger: '[data-command-id="settings.shortcuts"]' },
  ] as const

  for (const current of cases) {
    const trigger = page.locator(current.trigger)
    await trigger.click()
    await expect(page.locator(current.overlay)).toBeVisible()
    await trigger.click()
    await expect(page.locator(current.overlay)).toHaveCount(0)
  }
  expect((await authority(page))?.markdown).toBe(initial?.markdown)
  expect((await authority(page))?.revision).toBe(initial?.revision)
})

for (const current of [
  { applied: 'Before\n\n1. Alpha\n\nAfter', commandId: 'list.ordered', paragraph: 'ol > li > p' },
  { applied: 'Before\n\n- Alpha\n\nAfter', commandId: 'list.unordered', paragraph: 'ul:not([data-type="taskList"]) > li > p' },
  { applied: 'Before\n\n- [ ] Alpha\n\nAfter', commandId: 'list.task', paragraph: 'ul[data-type="taskList"] > li p' },
] as const satisfies readonly Readonly<{ applied: string; commandId: ListCommandId; paragraph: string }>[]) {
  test(`${current.commandId} cancellation unwraps in place without inserting an empty line`, async ({ page }) => {
    const editor = await openVisualMarkdown(page, 'Before\n\nAlpha\n\nAfter')
    await editor.locator(':scope > p', { hasText: 'Alpha' }).click()
    await page.keyboard.press('End')
    await page.locator(`[data-command-id="${current.commandId}"]`).click()
    await expectAuthority(page, current.applied)
    await editor.locator(current.paragraph).click()
    await page.keyboard.press('End')
    await page.locator(`[data-command-id="${current.commandId}"]`).click()

    await expectAuthority(page, 'Before\n\nAlpha\n\nAfter')
    await expect(editor.locator(':scope > p')).toHaveCount(3)
    await expect(editor.locator(':scope > p').nth(1)).toHaveText('Alpha')
  })
}
