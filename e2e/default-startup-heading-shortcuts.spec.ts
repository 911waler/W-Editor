import { readFileSync } from 'node:fs'

import type { Page } from '@playwright/test'

import { expect, test } from './fixtures/test'

const BODY = 'begin'
const ORIGINAL_MARKDOWN = readFileSync(new URL('../apps/playground/src/content/articles/welcome.md', import.meta.url), 'utf8')

async function authorityMarkdown(page: Page): Promise<string | undefined> {
  return page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().markdown)
}

test('starts in Chinese Visual mode with Ctrl+1-5 heading toggles', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')

  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'visual')
  await expect(page.locator('[data-command-id="mode.source"]')).toHaveText('源码')
  await expect(page.locator('[data-command-id="mode.visual"]')).toHaveText('可视化')
  await expect(page.locator('[data-command-id="mode.visual"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-toolbar-menu="heading"] .toolbar-menu__trigger')).toHaveAttribute('aria-label', '标题')
  await expect(page.locator('[data-command-id="settings.shortcuts"]')).toHaveAttribute('aria-label', '快捷键')

  const expectedFontSizes = ['32px', '24px', '20px', '16px', '14px'] as const
  for (const level of [1, 2, 3, 4, 5] as const) {
    const paragraph = page.locator('.ProseMirror > p', { hasText: BODY })
    await paragraph.click({ clickCount: 3 })
    await page.keyboard.press(`Control+${level}`)

    const heading = page.locator(`.ProseMirror > h${level}`, { hasText: BODY })
    await expect(heading).toBeVisible()
    await expect(heading).toHaveCSS('font-size', expectedFontSizes[level - 1] as string)
    await expect.poll(() => authorityMarkdown(page))
      .toBe(ORIGINAL_MARKDOWN.replace(/^begin/u, `${'#'.repeat(level)} ${BODY}`))

    await page.keyboard.press(`Control+${level}`)
    await expect(page.locator('.ProseMirror > p', { hasText: BODY })).toBeVisible()
    await expect.poll(() => authorityMarkdown(page)).toBe(ORIGINAL_MARKDOWN)
  }

  await page.locator('[data-command-id="settings.shortcuts"]').click()
  const shortcutDialog = page.getByTestId('shortcut-settings')
  await expect(shortcutDialog).toBeVisible()
  for (const level of [1, 2, 3, 4, 5] as const) {
    await expect(shortcutDialog.locator(`[data-shortcut-command="block.h${level}"] [data-shortcut-recorder]`))
      .toHaveAttribute('data-shortcut-value', `Mod-${level}`)
  }
})
