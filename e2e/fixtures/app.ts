import { expect, type Page } from '@playwright/test'

export async function openReadyApp(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
}

export async function useEnglishUi(page: Page): Promise<void> {
  await page.locator('[data-toolbar-menu="language"] .toolbar-menu__trigger').click()
  await page.locator('[data-command-id="language.en"]').click()
}
