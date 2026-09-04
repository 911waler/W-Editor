import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

test('production shell becomes ready, changes mode, and reloads cleanly', async ({ page }) => {
  await openReadyApp(page)

  const shell = page.locator('main.workspace-shell')
  await expect(shell).toBeVisible()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'visual')

  await page.locator('[data-command-id="mode.source"]').click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'source')
  await page.locator('[data-command-id="mode.preview"]').click()
  await expect(page.locator('[data-command-id="mode.preview"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'preview')

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  await expect(shell).toBeVisible()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'visual')
})
