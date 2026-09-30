import type { Page } from '@playwright/test'

import { openReadyApp, useEnglishUi } from './fixtures/app'
import { expect, test } from './fixtures/test'

const imageUrl = '/image-editing-fixture.png'
const markdown = `![First](${imageUrl}){width=240 height=120} ![Second](${imageUrl}){width=240 height=120}`

async function source(page: Page): Promise<string> {
  return page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().markdown ?? '')
}

async function seed(page: Page, value = markdown): Promise<void> {
  // Stable local fixture, independent of external image services.
  await page.route(`**${imageUrl}`, (route) => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#6489ba"/></svg>',
  }))
  await openReadyApp(page)
  await useEnglishUi(page)
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill(value)
  await page.locator('[data-command-id="mode.visual"]').click()
  await expect(page.locator('.ProseMirror [data-inline-image] img[src]')).toHaveCount(2)
  await expect.poll(() => page.locator('.ProseMirror [data-inline-image] img[src]').first().evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(400)
}

test('image resize, precision, alignment, preview and source round-trip', async ({ page }) => {
  await seed(page)
  const first = page.locator('.ProseMirror [data-inline-image]').first()
  await first.locator('img[src]').click()
  await expect(first.locator('[data-image-resize-handle]')).toHaveCount(8)
  const handle = await first.locator('[data-image-resize-handle="se"]').boundingBox()
  if (handle === null) throw new Error('Resize handle has no bounding box')
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2 + 40, handle.y + handle.height / 2 + 20, { steps: 4 })
  await expect.poll(() => source(page)).toBe(markdown)
  await page.mouse.up()
  await expect.poll(() => source(page)).toBe(markdown.replace('width=240 height=120', 'width=280 height=140'))
  await page.keyboard.press('Control+z')
  await expect.poll(() => source(page)).toBe(markdown)

  await first.locator('img[src]').click()
  await first.locator('[data-image-dimension="width"]').fill('300')
  await first.locator('[data-image-dimension="width"]').press('Enter')
  const sized = markdown.replace('width=240 height=120', 'width=300 height=150')
  await expect.poll(() => source(page)).toBe(sized)
  await first.locator('img[src]').click()
  await page.locator('[data-toolbar-menu="alignment"] .toolbar-menu__trigger').click()
  await page.locator('[data-command-id="align.center"]').click()
  await expect.poll(() => source(page)).toBe(`::: center\n${sized}\n:::`)
  await page.locator('[data-command-id="mode.preview"]').click()
  await expect(page.locator('[data-inline-image] img[src]').first()).toHaveAttribute('width', '300')
  await expect(page.locator('[data-image-resize-handle]:visible')).toHaveCount(0)
  await page.locator('[data-command-id="mode.source"]').click()
  await expect(page.locator('#markdown-source-editor')).toContainText('width=300 height=150')
  await page.locator('[data-command-id="mode.visual"]').click()
  await expect(page.locator('.ProseMirror [data-inline-image] img[src]').first()).toHaveAttribute('width', '300')
  await expect(page.locator('.ProseMirror [data-alignment="center"]')).toHaveCount(1)
})

for (const width of [390, 800, 1280]) {
  test(`inline images wrap without changing saved sizes at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await seed(page)
    const images = page.locator('.ProseMirror [data-inline-image] img[src]')
    const a = await images.nth(0).boundingBox()
    const b = await images.nth(1).boundingBox()
    if (a === null || b === null) throw new Error('Image has no layout box')
    if (width === 1280) expect(Math.abs(a.y - b.y)).toBeLessThan(2)
    if (width === 390) expect(b.y).toBeGreaterThan(a.y + a.height - 2)
    await images.nth(1).click()
    const overflow = await page.locator('.ProseMirror').evaluate((node) => node.scrollWidth - node.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
    await expect.poll(() => source(page)).toBe(markdown)
  })
}
