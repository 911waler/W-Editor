import { expect, test } from './fixtures/test'

async function openAdapterProbe(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/?capability=cherry-adapter')
  await expect(page.getByTestId('cherry-source-adapter-probe')).toHaveAttribute('data-ready', 'true')
}

test('source typing, composition, and adapter-native undo/redo commit without loops', async ({ page }) => {
  await openAdapterProbe(page)
  const initial = '# Adapter source\n\nhistory'
  const content = page.locator('.cherry-source-adapter-probe .cm-content')

  await content.dispatchEvent('compositionstart', { data: '中' })
  await expect(page.getByTestId('adapter-composing')).toHaveText('true')
  await content.dispatchEvent('compositionend', { data: '中' })
  await expect(page.getByTestId('adapter-composing')).toHaveText('false')

  await content.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('\nchanged')
  await expect(page.getByTestId('adapter-authority')).toHaveText(`${initial}\nchanged`)
  await expect(page.getByTestId('adapter-revision')).toHaveText('1')

  await page.getByRole('button', { name: 'Adapter undo' }).click()
  await expect(page.getByTestId('adapter-authority')).toHaveText(initial)
  await expect(page.getByTestId('adapter-revision')).toHaveText('2')
  await page.getByRole('button', { name: 'Adapter redo' }).click()
  await expect(page.getByTestId('adapter-authority')).toHaveText(`${initial}\nchanged`)
  await expect(page.getByTestId('adapter-revision')).toHaveText('3')
})

test('selection replacement, search, external hydration, and teardown remain single-commit', async ({ page }) => {
  await openAdapterProbe(page)

  await page.getByRole('button', { name: 'Search source' }).click()
  await expect(page.getByTestId('adapter-search-matches')).toHaveText('[{"from":10,"to":16}]')

  await page.getByRole('button', { name: 'Select history' }).click()
  await expect(page.getByTestId('adapter-selection')).toHaveText('18:25')
  await page.getByRole('button', { name: 'Replace selection' }).click()
  await expect(page.getByTestId('adapter-authority')).toHaveText('# Adapter source\n\nreplaced')
  await expect(page.getByTestId('adapter-selection')).toHaveText('18:26')
  await expect(page.getByTestId('adapter-change-count')).toHaveText('1')

  await page.getByRole('button', { name: 'Import external snapshot' }).click()
  expect(await page.getByTestId('adapter-authority').textContent()).toBe('# External\r\n\r\nexact  source\r\n')
  expect(await page.getByTestId('adapter-value').textContent()).toBe('# External\r\n\r\nexact  source\r\n')
  await expect(page.getByTestId('adapter-revision')).toHaveText('2')
  await expect(page.getByTestId('adapter-change-count')).toHaveText('2')

  await page.getByRole('button', { name: 'Destroy adapter' }).click()
  await expect(page.getByTestId('cherry-source-adapter-probe')).toHaveAttribute('data-lifecycle', 'destroyed')
  await expect(page.locator('.cherry-source-adapter-probe .cm-editor')).toHaveCount(0)
  expect(await page.getByTestId('adapter-authority').textContent()).toBe('# External\r\n\r\nexact  source\r\n')
  await expect(page.getByTestId('adapter-origins')).toHaveText('["toolbar-command","import"]')
  await expect(page.getByTestId('adapter-revision')).toHaveText('2')
  await expect(page.getByTestId('adapter-change-count')).toHaveText('2')
  await page.getByRole('button', { name: 'Commit after destroy' }).click()
  await expect(page.getByTestId('adapter-authority')).toHaveText('after destroy')
  await expect(page.getByTestId('adapter-revision')).toHaveText('3')
  await expect(page.getByTestId('adapter-change-count')).toHaveText('3')
  await expect(page.locator('.cherry-source-adapter-probe .cm-editor')).toHaveCount(0)
})
