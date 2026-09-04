import { expect, test, type Locator, type Page } from '@playwright/test'

async function switchMode(page: Page, mode: 'source' | 'visual'): Promise<void> {
  const surface = page.getByTestId('editor-surface')
  if (await surface.getAttribute('data-mode') !== mode) {
    await page.locator(`[data-command-id="mode.${mode}"]`).click()
  }
  await expect(surface).toHaveAttribute('data-mode', mode)
}

async function setMarkdown(page: Page, markdown: string, targetMode: 'source' | 'visual' = 'visual'): Promise<void> {
  await switchMode(page, 'source')
  await page.locator('.cm-content[contenteditable="true"]').fill(markdown)
  await switchMode(page, targetMode)
}

async function openBlockMenu(page: Page, block: Locator): Promise<Locator> {
  await block.hover()
  await page.locator('.visual-block-handle').click()
  const duplicate = page.getByRole('menuitem', { name: /Duplicate node|复制节点|Дублировать узел/u })
  const menu = page.locator('.visual-block-menu').filter({ has: duplicate }).first()
  await expect(menu).toBeVisible()
  return menu
}

async function duplicateBlock(page: Page, block: Locator): Promise<void> {
  const menu = await openBlockMenu(page, block)
  await menu.getByRole('menuitem', { name: /Duplicate node|复制节点|Дублировать узел/u }).click()
}

async function selectLocale(page: Page, locale: 'en' | 'ru' | 'zh'): Promise<void> {
  await page.locator('[data-toolbar-menu="language"] .toolbar-menu__trigger').click()
  await page.locator(`[data-command-id="language.${locale}"]`).click()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
})

test('ordinary text duplicate creates exactly one adjacent node', async ({ page }) => {
  await setMarkdown(page, 'Alpha paragraph\n\nOmega paragraph')
  const paragraph = page.locator('.ProseMirror > p').filter({ hasText: 'Alpha paragraph' }).first()
  await duplicateBlock(page, paragraph)
  await expect(page.locator('.ProseMirror > p').filter({ hasText: 'Alpha paragraph' })).toHaveCount(2)
})

test('code block duplicate creates exactly one adjacent node', async ({ page }) => {
  await setMarkdown(page, 'Before\n\n```ts\nconst answer = 42\n```\n\nAfter')
  const codeBlock = page.locator('.ProseMirror > [data-w-editor-node="code-block"]').first()
  await duplicateBlock(page, codeBlock)
  await expect(page.locator('.ProseMirror > [data-w-editor-node="code-block"]')).toHaveCount(2)
})

test('Chinese block and add menus contain no stale English application copy', async ({ page }) => {
  await setMarkdown(page, 'Alpha paragraph')
  await selectLocale(page, 'zh')
  const paragraph = page.locator('.ProseMirror > p').filter({ hasText: 'Alpha paragraph' })
  const menu = await openBlockMenu(page, paragraph)
  await expect(menu).toContainText('文本')
  for (const label of ['颜色', '转换为', '重置格式', '复制节点', '复制到剪贴板', '复制锚点链接', '删除']) {
    await expect(menu.getByRole('menuitem', { name: new RegExp(label, 'u') })).toBeVisible()
  }
  await expect(menu).not.toContainText(/Text|Color|Turn into|Reset formatting|Duplicate node|Copy to clipboard|Copy anchor link|Delete/u)

  await page.locator('.visual-block-handle').click()
  await page.locator('.visual-block-add').click()
  const addMenu = page.locator('.visual-block-menu--insert')
  await expect(addMenu).toContainText('上方添加行')
  await expect(addMenu).toContainText('下方添加行')
})

test('block handles are hidden and cannot overlap a toolbar dialog', async ({ page }) => {
  await setMarkdown(page, 'Alpha paragraph')
  await page.locator('.ProseMirror > p').hover()
  const handles = page.locator('.visual-block-context')
  await expect(handles).toBeVisible()
  await page.locator('[data-toolbar-menu="color"] .toolbar-menu__trigger').click()
  await expect(page.locator('[data-picker-command="text.color"]')).toBeVisible()
  await expect(handles).toBeHidden()
})

test('one Table of contents command produces one TOC in Visual', async ({ page }) => {
  await setMarkdown(page, '# Alpha\n\n## Beta')
  await page.locator('[data-toolbar-menu="insert"] .toolbar-menu__trigger').click()
  await page.locator('[data-command-id="insert.toc"]').click()
  await expect(page.locator('.ProseMirror [data-w-editor-node="toc"]')).toHaveCount(1)
})

test('selecting an existing TOC in Source never duplicates it when returning to Visual', async ({ page }) => {
  await setMarkdown(page, '# Alpha\n\n[[toc]]\n\n## Beta', 'source')
  await page.locator('[data-toolbar-menu="insert"] .toolbar-menu__trigger').click()
  await page.locator('[data-command-id="insert.toc"]').click()
  await switchMode(page, 'visual')
  await expect(page.locator('.ProseMirror [data-w-editor-node="toc"]')).toHaveCount(1)
})

test('inserting a new TOC in Source creates one marker and one Visual node', async ({ page }) => {
  await setMarkdown(page, '# Alpha\n\n## Beta', 'source')
  await page.locator('[data-toolbar-menu="insert"] .toolbar-menu__trigger').click()
  await page.locator('[data-command-id="insert.toc"]').click()
  await expect(page.locator('.cm-content')).toContainText('[[toc]]')
  expect((await page.locator('.cm-line').allTextContents()).filter((line) => line === '[[toc]]')).toHaveLength(1)
  await switchMode(page, 'visual')
  await expect(page.locator('.ProseMirror [data-w-editor-node="toc"]')).toHaveCount(1)
})

test('long code starts folded at 12 lines, fades out, expands fully, and folds from the top action', async ({ page }) => {
  const lines = Array.from({ length: 16 }, (_, index) => `const line${index + 1} = ${index + 1}`).join('\n')
  await setMarkdown(page, `\`\`\`ts\n${lines}\n\`\`\``)
  const block = page.locator('.ProseMirror > [data-w-editor-node="code-block"]')
  const pre = block.locator('pre')
  await expect(block).toHaveAttribute('data-code-lines', '16')
  await expect(block).toHaveAttribute('data-folded', 'true')
  await expect(pre).toBeVisible()
  await expect(block.locator('[data-code-fade]')).toBeVisible()
  await expect(block.locator('[data-code-action="expand"]')).toBeVisible()
  await expect(block.locator('[data-code-action="fold"]')).toBeHidden()
  await expect(block.locator('[data-code-action="copy"]')).toBeVisible()
  await expect(block.locator('[data-code-action="advanced"]')).toBeVisible()
  await expect(block.locator('[data-code-action="copy"] .ch-icon-copy')).toHaveCount(1)
  await expect(block.locator('[data-code-action="advanced"] .ch-icon-edit')).toHaveCount(1)

  const foldedHeight = await pre.evaluate((element) => element.getBoundingClientRect().height)
  await block.locator('[data-code-action="expand"]').click()
  await expect(block).toHaveAttribute('data-folded', 'false')
  await expect(block.locator('[data-code-action="fold"]')).toBeVisible()
  await expect(block.locator('[data-code-fade]')).toBeHidden()
  const expandedHeight = await pre.evaluate((element) => element.getBoundingClientRect().height)
  expect(expandedHeight).toBeGreaterThan(foldedHeight)

  await block.locator('[data-code-action="fold"]').click()
  await expect(block).toHaveAttribute('data-folded', 'true')
})

test('read-only Preview uses the same long-code fold, keeps copy, and hides its edit action', async ({ page }) => {
  const lines = Array.from({ length: 16 }, (_, index) => `const line${index + 1} = ${index + 1}`).join('\n')
  await setMarkdown(page, `Before\n\n\`\`\`ts\n${lines}\n\`\`\`\n\nAfter`)
  await page.locator('[data-command-id="mode.preview"]').click()
  const block = page.locator('.preview-rendered-content [data-w-editor-node="code-block"]')
  await expect(block).toHaveAttribute('data-code-lines', '16')
  await expect(block).toHaveAttribute('data-folded', 'true')
  await expect(block.locator('[data-semantic-copy="code-block"] .ch-icon-copy')).toHaveCount(1)
  await expect(block.locator('[data-semantic-edit="code-block-editor"]')).toBeHidden()
  await expect(block.locator('[data-code-action="expand"]')).toBeVisible()

  await block.locator('[data-code-action="expand"]').click()
  await expect(block).toHaveAttribute('data-folded', 'false')
  await expect(block.locator('[data-code-action="fold"]')).toBeVisible()
  await expect(page.locator('[data-editor-command="insert.code-block"]')).toHaveCount(0)
})
