import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

for (const platform of ['Linux x86_64', 'Win32', 'MacIntel']) {
  test(`Source toolbar redo restores the undone edit on ${platform}`, async ({ page }) => {
    // Set platform before Cherry/CodeMirror initialize their platform keymaps.
    await page.addInitScript((value) => {
      Object.defineProperty(navigator, 'platform', { get: () => value })
    }, platform)
    await openReadyApp(page)
    await page.locator('[data-command-id="mode.source"]').click()
    await page.locator('#markdown-source-editor').fill('Alpha')
    const markdown = () => page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().markdown)
    await expect.poll(markdown).toBe('Alpha')
    await page.locator('#markdown-source-editor').click()
    await page.keyboard.press(platform === 'MacIntel' ? 'Meta+a' : 'Control+a')
    await page.locator('[data-command-id="text.bold"]').click()
    await expect.poll(markdown).toBe('**Alpha**')
    for (let cycle = 0; cycle < 2; cycle += 1) {
      await page.locator('[data-command-id="history.undo"]').click()
      await expect.poll(markdown).toBe('Alpha')
      await page.locator('[data-command-id="history.redo"]').click()
      await expect.poll(markdown).toBe('**Alpha**')
    }
  })
}
