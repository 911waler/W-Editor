import type { FrameLocator, Page } from '@playwright/test'

import { expect, test } from './fixtures/test'

function drawioEditor(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="drawio-bridge-frame"]').frameLocator('#drawio-editor')
}

async function openProductionDrawio(page: Page): Promise<FrameLocator> {
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill('')
  await page.locator('[data-toolbar-menu="insert"] .toolbar-menu__trigger').click()
  await page.locator('[data-command-id="insert.drawio"]').click()
  const editor = drawioEditor(page)
  await expect(editor.locator('.geMenubarContainer')).toBeVisible({ timeout: 30_000 })
  return editor
}

for (const palette of [
  { label: '剪贴画', resource: 'Earth_globe_128x128.png' },
  { label: '杂项', resource: 'Gear_128x128.png' },
] as const) {
  test(`UAT-DTR-004 applies a real bundled ${palette.label} image without hanging`, async ({ page }) => {
    const editor = await openProductionDrawio(page)
    const items = editor.locator('.geSidebarContainer .geItem')
    const before = await items.count()
    await editor.getByText(palette.label, { exact: true }).click()
    await expect(editor.getByText('加载中...', { exact: true })).toHaveCount(0, { timeout: 30_000 })
    await expect.poll(() => items.count()).toBeGreaterThan(before)
    const resourceIndex = await items.evaluateAll((elements, resource) => (
      elements.findIndex((element) => element.innerHTML.includes(resource))
    ), palette.resource)
    expect(resourceIndex).toBeGreaterThanOrEqual(0)
    const inserted = items.nth(resourceIndex)
    await expect(inserted).toBeVisible()
    await inserted.dblclick()
    await expect.poll(() => editor.locator('.geDiagramContainer').evaluate((element, resource) => (
      element.innerHTML.includes(resource)
    ), palette.resource)).toBe(true)

    await page.getByTestId('drawio-apply').click()
    await expect(page.locator('[data-editor-command="insert.drawio"]')).toHaveCount(0, { timeout: 30_000 })
    const source = page.locator('#markdown-source-editor')
    await expect(source).toContainText('data-type=drawio')
    await expect(source).toContainText('data-xml=')
  })
}
