import { EXCLUDED_TOOLBAR_CONTROL_IDS } from '../src/services'
import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

const EXCLUDED_LABELS = Object.freeze([
  'Smile',
  'Help',
  'Mobile preview',
  'Copy',
  'Code theme',
])

for (const viewport of [
  { height: 900, label: 'desktop', width: 1440 },
  { height: 844, label: 'compact mobile-width', width: 390 },
] as const) {
  test(`${viewport.label} product surface excludes demo menus and non-top Cherry sidebar controls`, async ({ page }) => {
    await page.setViewportSize({ height: viewport.height, width: viewport.width })
    await openReadyApp(page)

    const toolbar = page.getByRole('toolbar', { name: 'W-Editor toolbar' })
    for (const id of EXCLUDED_TOOLBAR_CONTROL_IDS) {
      await expect(toolbar.locator([
        `[data-command-alias="${id}"]`,
        `[data-command-id="${id}"]`,
        `[data-toolbar-menu="${id}"]`,
      ].join(','))).toHaveCount(0)
    }

    const menuTriggers = toolbar.locator('.toolbar-menu__trigger')
    const menuCount = await menuTriggers.count()
    for (let index = 0; index < menuCount; index += 1) {
      const trigger = menuTriggers.nth(index)
      await trigger.click()
      for (const label of EXCLUDED_LABELS) {
        await expect(toolbar.getByRole('button', { exact: true, name: label })).toHaveCount(0)
      }
      await trigger.evaluate((element) => { (element as HTMLButtonElement).click() })
    }

    for (const label of EXCLUDED_LABELS) {
      await expect(toolbar.getByRole('button', { exact: true, name: label })).toHaveCount(0)
    }
    await expect(page.locator([
      '.source-surface .ch-icon-phone',
      '.source-surface .ch-icon-copy',
      '.source-surface .ch-icon-main-theme',
      '.source-surface .ch-icon-code-theme',
      '.source-surface .ch-icon-help',
    ].join(','))).toHaveCount(0)
    await expect(page.locator('.source-surface .cherry-toolbar button')).toHaveCount(0)
  })
}
