import { expect, test } from './fixtures/test'
import { openReadyApp } from './fixtures/app'

test('keeps the editor isolated from conflicting host CSS, variables, and DOM', async ({ page }) => {
  await openReadyApp(page)
  await page.evaluate(() => {
    const sentinel = document.createElement('div')
    sentinel.id = 'host-sentinel'
    sentinel.textContent = 'host remains unchanged'
    sentinel.dataset['before'] = 'true'
    document.body.insertBefore(sentinel, document.body.firstElementChild)
  })
  await page.addStyleTag({
    content: `
      :root { --app-accent: hotpink; --app-text: lime; }
      body { margin: 37px; font-family: "Comic Sans MS", cursive; background: rgb(2, 3, 5); }
      button { color: rgb(255, 0, 255); background: rgb(250, 250, 0); border: 9px solid rgb(255, 0, 255); }
      input { color: rgb(255, 0, 255); background: rgb(250, 250, 0); }
      table { border-collapse: separate; background: rgb(250, 250, 0); }
      pre { font-family: "Comic Sans MS", cursive; background: rgb(250, 250, 0); }
    `,
  })

  const before = await page.locator('#host-sentinel').evaluate((node) => ({
    dataset: { ...node.dataset },
    text: node.textContent,
  }))
  const toolbarButton = page.locator('.w-editor-instance .toolbar-region button').first()
  await expect(toolbarButton).toBeVisible()
  const surface = page.locator('.w-editor-instance.workspace-shell')
  const computed = await toolbarButton.evaluate((node) => {
    const style = getComputedStyle(node)
    return {
      background: style.backgroundColor,
      borderWidth: style.borderTopWidth,
      color: style.color,
      fontFamily: style.fontFamily,
    }
  })
  expect(computed.background).not.toBe('rgb(250, 250, 0)')
  expect(computed.borderWidth).not.toBe('9px')
  expect(computed.color).not.toBe('rgb(255, 0, 255)')
  expect(computed.fontFamily).not.toContain('Comic Sans')
  await expect(surface).toHaveAttribute('data-theme', 'gray')

  const after = await page.locator('#host-sentinel').evaluate((node) => ({
    dataset: { ...node.dataset },
    text: node.textContent,
  }))
  expect(after).toEqual(before)
  await expect(page.locator('#host-sentinel')).toHaveText('host remains unchanged')
})
