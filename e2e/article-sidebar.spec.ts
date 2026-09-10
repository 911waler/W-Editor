import { expect, test } from './fixtures/test'

for (const height of [900, 500]) {
  test(`NWU categories and fixed article actions at height ${height}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height })
    const categories = { software_tutorial: '软件教程', study: '学习笔记', custom: '课题讨论', other: '其他' }
    const items = Array.from({ length: 80 }, (_, i) => ({
      documentId: `blog:${i + 1}`, title: `文章 ${i + 1}`,
      group: Object.values(categories)[i % 4],
    }))
    await page.route('**/api/blog-editor/**', route => {
      const path = new URL(route.request().url()).pathname
      const id = decodeURIComponent(path.split('/').at(-1) ?? '')
      const body = path.endsWith('/documents') ? { items, nextCursor: null }
        : path.includes('/state/') ? { workspace: null, draft: null }
        : { document: { documentId: id, markdown: '# 示例', revision: 1, serverRevision: 'r1' }, metadata: { title: '文章 1', category: 'software_tutorial', visibility: 'private', allowedUsernames: [] } }
      return route.fulfill({ json: body })
    })
    await page.route('http://127.0.0.1:4173/', async route => {
      const response = await route.fetch()
      const bootstrap = { userId: 1, csrfToken: 'test', initialDocumentId: 'blog:1', readonly: false, apiBase: '/api/blog-editor', blogListUrl: '/blogs', categories, categoryOrder: ['study','custom','software_tutorial','other'] }
      await route.fulfill({ response, body: (await response.text()).replace('<head>', `<head><script type="application/json" id="nwu-editor-bootstrap">${JSON.stringify(bootstrap)}</script>`) })
    })
    await page.goto('/')
    await expect(page.getByTestId('desktop-library-article')).toHaveCount(80)
    await expect(page.getByTestId('article-category-heading')).toHaveText(['学习笔记', '课题讨论', '软件教程', '其他'])
    await expect(page.getByTestId('article-date-heading')).toHaveCount(0)
    const firstGroup = page.getByTestId('article-category-group').first()
    const toggle = firstGroup.getByTestId('article-category-toggle')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await toggle.click()
    await expect(firstGroup.locator('.article-group-items')).toBeHidden()
    await expect(page.getByTestId('article-category-group').nth(1).locator('.article-group-items')).toBeVisible()
    await toggle.press('Space')
    await expect(firstGroup.locator('.article-group-items')).toBeVisible()
    await expect(firstGroup.locator('.article-category-count')).toHaveText('20')
    if (height === 900) await page.locator('.article-panel').screenshot({ path: '/tmp/sidebar-fold-preview.png' })
    const create = page.getByTestId('desktop-new-article')
    const imports = page.getByTestId('import-markdown')
    await expect(create).toBeInViewport()
    await expect(imports).toBeInViewport()
    const before = await create.boundingBox()
    await page.locator('.article-list').evaluate(list => { list.scrollTop = list.scrollHeight })
    await expect.poll(() => page.locator('.article-list').evaluate(list => list.scrollTop)).toBeGreaterThan(0)
    await expect(create).toBeInViewport()
    expect(await create.boundingBox()).toEqual(before)
    await create.click({ trial: true })
    const chooser = page.waitForEvent('filechooser')
    await imports.click()
    expect((await chooser).isMultiple()).toBe(false)
  })
}
