import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

test('visible UI actions update authority observed through a read-only E2E seam', async ({ page }) => {
  await openReadyApp(page)

  await page.locator('[data-command-id="mode.source"]').click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'source')
  await page.locator('[data-command-id="mode.visual"]').click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'visual')

  const authority = await page.evaluate(() => {
    const inspection = window.__W_EDITOR_AUTHORITY__
    return {
      inspectionKeys: inspection ? Object.keys(inspection) : [],
      snapshot: inspection?.read(),
    }
  })

  expect(authority.inspectionKeys).toEqual(['read'])
  expect(authority.snapshot).toMatchObject({
    actionCount: 2,
    autosaveStatus: expect.stringMatching(/^(?:idle|pending|saved|saving)$/u),
    documentId: 'welcome',
    markdown: expect.any(String),
    mode: 'visual',
    revision: expect.any(Number),
    synchronizationStatus: 'synchronized',
  })
})
