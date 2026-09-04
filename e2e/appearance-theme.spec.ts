import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

const THEMES = ['default', 'dark', 'gray', 'abyss', 'green', 'red', 'violet', 'blue'] as const

async function selectTheme(page: Parameters<typeof openReadyApp>[0], theme: (typeof THEMES)[number]): Promise<void> {
  await page.locator('[data-toolbar-menu="theme"] .toolbar-menu__trigger').click()
  await page.locator(`[data-theme-option="${theme}"]`).click()
  await expect(page.locator('.workspace-shell')).toHaveAttribute('data-theme', theme)
}

test('whole-workspace themes switch, reach Cherry surfaces, persist, and preserve Markdown', async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 })
  await openReadyApp(page)

  const authorityBefore = await page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read())
  const surfaceColors = new Set<string>()
  await page.locator('[data-toolbar-menu="theme"] .toolbar-menu__trigger').click()
  await expect(page.locator('[data-theme-option]')).toHaveCount(THEMES.length)
  await page.keyboard.press('Escape')

  for (const theme of THEMES) {
    await selectTheme(page, theme)
    const colors = await page.evaluate(() => {
      const shell = document.querySelector('.workspace-shell')
      const toolbar = document.querySelector('.toolbar-region')
      const editor = document.querySelector('.editor-surface')
      const status = document.querySelector('.status-region')
      if (!(shell && toolbar && editor && status)) throw new Error('Theme surfaces are unavailable.')
      return [shell, toolbar, editor, status].map((element) => getComputedStyle(element).backgroundColor).join('|')
    })
    surfaceColors.add(colors)
  }
  expect(surfaceColors.size).toBe(THEMES.length)
  expect(await page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read())).toEqual(authorityBefore)

  await page.locator('[data-command-id="mode.source"]').click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'source')
  await selectTheme(page, 'abyss')
  await expect(page.locator('.source-editor-host .cherry')).toHaveClass(/theme__abyss/u)

  await page.locator('[data-command-id="mode.preview"]').click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'preview')
  await expect(page.locator('.workspace-shell')).toHaveClass(/theme__abyss/u)
  await expect(page.locator('.preview-rendered-content')).toHaveAttribute('data-presentation-engine', 'tiptap')
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem('w-editor:appearance-theme'))).toBe('abyss')

  await page.reload()
  await expect(page.locator('.workspace-shell')).toHaveAttribute('data-theme', 'abyss')
  await page.locator('[data-toolbar-menu="theme"] .toolbar-menu__trigger').click()
  await expect(page.locator('[data-theme-option="abyss"]')).toHaveAttribute('aria-checked', 'true')
})

test('theme menu remains keyboard-operable at compact width', async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 })
  await openReadyApp(page)
  const trigger = page.locator('[data-toolbar-menu="theme"] .toolbar-menu__trigger')
  await trigger.scrollIntoViewIfNeeded()
  await trigger.focus()
  await page.keyboard.press('Enter')
  const menu = page.locator('[data-toolbar-menu="theme"] [role="menu"]')
  await expect(menu).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('[data-theme-option="default"]')).toBeFocused()
  await page.keyboard.press('End')
  await expect(page.locator('[data-theme-option="blue"]')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('.workspace-shell')).toHaveAttribute('data-theme', 'blue')
  await expect(trigger).toBeFocused()
})
