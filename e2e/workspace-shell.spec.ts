import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

test('production workspace keeps one active surface and presents the visual canvas continuously', async ({ page }) => {
  await openReadyApp(page)
  await page.locator('[data-toolbar-menu="language"] .toolbar-menu__trigger').click()
  await page.locator('[data-command-id="language.en"]').click()

  const activeSurfaces = page.locator('.content-surface')
  await expect(activeSurfaces).toHaveCount(1)
  await expect(activeSurfaces).toHaveAttribute('data-mode', 'visual')

  await page.locator('[data-command-id="mode.source"]').click()
  await expect(activeSurfaces).toHaveAttribute('data-mode', 'source')
  await expect(page.locator('.status-region')).toContainText('Source mode')
  await page.locator('[data-command-id="mode.visual"]').click()
  await expect(activeSurfaces).toHaveCount(1)
  await expect(activeSurfaces).toHaveAttribute('data-mode', 'visual')
  await expect(page.locator('.source-surface')).toHaveCount(0)
  await expect(page.locator('.preview-surface')).toHaveCount(0)
  await expect(page.locator('.status-region')).toContainText('Visual mode')

  const canvasContract = await page.locator('.continuous-canvas').evaluate((canvas) => {
    const canvasStyle = getComputedStyle(canvas)
    const ordinary = canvas.querySelector<HTMLElement>('.ordinary-block')
    if (ordinary === null) throw new Error('Expected an ordinary visual block.')
    const ordinaryStyle = getComputedStyle(ordinary)
    return {
      background: canvasStyle.backgroundColor,
      border: ordinaryStyle.borderStyle,
      boxShadow: ordinaryStyle.boxShadow,
      pageBreaks: canvas.querySelectorAll('[data-page-break]').length,
      width: canvas.getBoundingClientRect().width,
    }
  })
  expect(canvasContract).toEqual({
    background: 'rgb(255, 255, 255)',
    border: 'none',
    boxShadow: 'none',
    pageBreaks: 0,
    width: 960,
  })

  await page.locator('[data-command-id="mode.preview"]').click()
  await expect(activeSurfaces).toHaveCount(1)
  await expect(activeSurfaces).toHaveAttribute('data-mode', 'preview')
  await expect(page.locator('.preview-surface')).not.toHaveAttribute('aria-readonly', /.+/u)
  await expect(page.locator('.preview-surface [data-renderer-profile="author-preview"]'))
    .toHaveAttribute('data-renderer-profile', 'author-preview')
  await expect(page.locator('.preview-surface textarea, .preview-surface [contenteditable="true"]')).toHaveCount(0)
  await expect(page.locator('.tool-button--strong')).toBeDisabled()
  await expect(page.locator('.tool-button--strong')).toHaveAttribute(
    'title',
    'Unavailable in final preview.',
  )
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Save version', exact: true })).toBeEnabled()
  await expect(page.locator('.status-region')).toContainText('Preview mode')
})

test('left panel switches between article recovery and a live outline that navigates every mode', async ({ page }) => {
  const markdown = '# Alpha\n\n## 章节 一\n\n# Alpha\n\n### Custom {#chosen}\n\nParagraph'
  await openReadyApp(page)
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill(markdown)
  await expect.poll(() => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().markdown)).toBe(markdown)

  const articleTab = page.locator('[data-article-panel-tab="articles"]')
  const outlineTab = page.locator('[data-article-panel-tab="outline"]')
  await expect(articleTab).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.article-card')).toHaveCount(3)
  await expect(page.locator('.article-lifecycle')).toBeVisible()

  await outlineTab.click()
  await expect(outlineTab).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.article-card')).toHaveCount(0)
  await expect(page.locator('.article-lifecycle')).toHaveCount(0)
  await expect(page.locator('.article-outline__text').allTextContents())
    .resolves.toEqual(['Alpha', '章节 一', 'Alpha', 'Custom'])

  await page.locator('[data-outline-anchor="%E7%AB%A0%E8%8A%82-%E4%B8%80"]').click()
  await expect(page.locator('.cm-activeLine')).toContainText('## 章节 一')
  await expect(page).toHaveURL(/#%E7%AB%A0%E8%8A%82-%E4%B8%80$/u)

  await page.locator('[data-command-id="mode.visual"]').click()
  await page.locator('[data-outline-anchor="chosen"]').click()
  await expect(page).toHaveURL(/#chosen$/u)
  await expect(page.locator('.ProseMirror')).toBeFocused()
  await expect.poll(() => page.evaluate(() => {
    const anchor = window.getSelection()?.anchorNode
    const element = anchor instanceof Element ? anchor : anchor?.parentElement
    return element?.closest('h1, h2, h3, h4, h5')?.id ?? null
  })).toBe('chosen')

  await page.locator('[data-command-id="mode.preview"]').click()
  await page.locator('[data-outline-anchor="alpha-2"]').click()
  await expect(page.locator('.preview-rendered-content h1#alpha-2')).toBeFocused()
  await expect(page).toHaveURL(/#alpha-2$/u)
  await expect.poll(() => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().markdown)).toBe(markdown)

  await articleTab.click()
  await expect(page.locator('.article-card')).toHaveCount(3)
  await expect(page.locator('.article-lifecycle')).toBeVisible()
})

test('inactive visual semantic selection cannot disable commands for the active source selection', async ({ page }) => {
  await openReadyApp(page)
  await page.locator('[data-toolbar-menu="language"] .toolbar-menu__trigger').click()
  await page.locator('[data-command-id="language.en"]').click()
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill('Ordinary source anchor')
  await page.locator('[data-command-id="mode.visual"]').click()

  await page.locator('[data-toolbar-menu="mermaid"] .toolbar-menu__trigger').click()
  await page.locator('[data-command-id="mermaid.flowchart"]').click()
  const mermaid = page.locator('[data-semantic-kind="mermaid"]')
  await mermaid.locator('[data-semantic-edit="mermaid-editor"]').click()
  const mermaidDialog = page.locator('[data-editor-command="mermaid.source"]')
  await mermaidDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await mermaid.click()
  await page.locator('[data-toolbar-menu="chart"] .toolbar-menu__trigger').click()
  await expect(page.locator('[data-command-id="chart.line"]')).toBeDisabled()
  await expect(page.locator('[data-command-id="chart.line"]')).toHaveAttribute(
    'title',
    'Unavailable in the current mode.',
  )

  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').locator('.cm-line').last().click()
  await page.keyboard.press('End')
  await page.locator('[data-toolbar-menu="chart"] .toolbar-menu__trigger').click()
  await expect(page.locator('[data-command-id="chart.line"]')).toBeEnabled()
})

test('failed preview preparation preserves the source surface, content, and actionable status', async ({ page }) => {
  await page.goto('/?modeFailure=preview')
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')

  await page.locator('[data-toolbar-menu="language"] .toolbar-menu__trigger').click()
  await page.locator('[data-command-id="language.en"]').click()
  await page.locator('[data-command-id="mode.source"]').click()
  const source = page.locator('#markdown-source-editor')
  await source.fill('# Preserved after failure\n\nExact visible draft.')
  await page.locator('[data-command-id="mode.preview"]').click()

  await expect(page.locator('.content-surface')).toHaveCount(1)
  await expect(page.locator('.content-surface')).toHaveAttribute('data-mode', 'source')
  await expect(source).toContainText('Preserved after failure')
  await expect.poll(() => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().markdown))
    .toBe('# Preserved after failure\n\nExact visible draft.')
  await expect(page.getByRole('alert')).toContainText('INVALID_TIPTAP_SCHEMA')
  await expect(page.getByRole('alert')).toContainText('Injected read-only Tiptap presentation failure.')
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open source', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export raw Markdown', exact: true })).toBeVisible()
  await expect(page.locator('.status-region')).toContainText('Synchronization needs attention')
  await expect(page.locator('[data-command-id="mode.preview"]')).toBeFocused()
})
