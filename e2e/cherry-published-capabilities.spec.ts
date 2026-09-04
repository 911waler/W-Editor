import { expect, test } from './fixtures/test'

test('published Cherry supplies the complete source and render capability baseline', async ({ page }) => {
  await page.goto('/?capability=cherry')
  const probe = page.getByTestId('cherry-capability-probe')
  await expect(probe).toHaveAttribute('data-ready', 'true')
  await expect(probe).toHaveAttribute('data-lifecycle', 'mounted')
  await expect(page.getByTestId('cherry-value')).toHaveText('# Published source\n\nhistory')

  await page.getByRole('button', { name: 'Select Published' }).click()
  await expect(page.getByTestId('cherry-selection')).toHaveText('2:11')

  const content = page.locator('.cherry-capability-probe .cm-content')
  await content.dispatchEvent('compositionstart', { data: '中' })
  await expect(page.getByTestId('cherry-composing')).toHaveText('true')
  await content.dispatchEvent('compositionend', { data: '中' })
  await expect(page.getByTestId('cherry-composing')).toHaveText('false')

  await content.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('\nchanged')
  await expect(page.getByTestId('cherry-value')).toHaveText('# Published source\n\nhistory\nchanged')

  await page.getByRole('button', { name: 'Undo Published' }).click()
  await expect(page.getByTestId('cherry-value')).toHaveText('# Published source\n\nhistory')
  await page.getByRole('button', { name: 'Redo Published' }).click()
  await expect(page.getByTestId('cherry-value')).toHaveText('# Published source\n\nhistory\nchanged')

  await page.getByRole('button', { name: 'Render current' }).click()
  await expect(page.getByTestId('cherry-rendered-html')).toContainText('<h1')
  await expect(page.getByTestId('cherry-rendered-html')).toContainText('changed')

  await page.getByRole('button', { name: 'Destroy Cherry' }).click()
  await expect(probe).toHaveAttribute('data-lifecycle', 'destroyed')
  await expect(page.locator('.cherry-capability-probe .cm-editor')).toHaveCount(0)
})
