import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { extname, resolve, sep } from 'node:path'

import { expect, test } from '@playwright/test'

const projectRoot = resolve(process.cwd())
const sanitizedCompatibilityFixture = readFileSync(resolve(projectRoot, 'tests/fixtures/nwu/lagging-copy-sanitized.md'), 'utf8')
let hostServer: Server | null = null
let hostOrigin = ''

test.beforeAll(async () => {
  hostServer = createServer((request, response) => {
    const requestPath = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    const relative = requestPath === '/'
      ? 'examples/nwu-host/dist/index.html'
      : requestPath.startsWith('/assets/')
        ? `examples/nwu-host/dist${requestPath}`
        : requestPath.replace(/^\//u, '')
    if (!relative.startsWith('examples/nwu-host/dist/')) {
      response.writeHead(404).end()
      return
    }
    const filePath = resolve(projectRoot, relative)
    if (!filePath.startsWith(`${projectRoot}${sep}`) || !existsSync(filePath) || !statSync(filePath).isFile()) {
      response.writeHead(404).end()
      return
    }
    const contentTypes: Record<string, string> = {
      '.css': 'text/css; charset=utf-8',
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
    }
    response.writeHead(200, {
      'Content-Security-Policy': "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self' data:; img-src 'self' data: blob:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'",
      'Content-Type': contentTypes[extname(filePath)] ?? 'application/octet-stream',
    })
    createReadStream(filePath).pipe(response)
  })
  await new Promise<void>((resolveServer, reject) => {
    hostServer?.once('error', reject)
    hostServer?.listen(0, '127.0.0.1', () => resolveServer())
  })
  const address = hostServer.address()
  if (address === null || typeof address === 'string') throw new Error('NWU mock host server did not expose a port.')
  hostOrigin = `http://127.0.0.1:${address.port}`
})

test.afterAll(async () => {
  if (hostServer === null) return
  await new Promise<void>((resolveServer, reject) => hostServer?.close((error) => error ? reject(error) : resolveServer()))
  hostServer = null
})

async function action(page: import('@playwright/test').Page, name: string): Promise<void> {
  await page.locator(`[data-nwu-action="${name}"]`).click()
}

async function ready(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.locator('[data-nwu-status]')).toHaveAttribute('data-nwu-status-value', /^ready:/u, { timeout: 30_000 })
}

test('runs the framework-free Jinja-shaped NWU host through the real Web adapters and Reader', async ({ page }) => {
  test.setTimeout(120_000)
  const response = await page.goto(hostOrigin)
  expect(response?.status()).toBe(200)
  await expect(page.locator('[data-nwu-reference-host]')).toBeVisible()
  await ready(page)
  await expect(page.locator('[data-w-editor-profile="reader"]')).toBeVisible()
  await expect(page.locator('[data-w-editor-profile="editor"]')).toHaveAttribute('data-theme', 'blue')

  const source = page.locator('[data-nwu-editor] [data-w-editor-source]')
  await expect(source).toHaveValue('# Jinja initial Markdown\n\nServer content.')
  await source.fill('# Browser draft\n\nDraft body.')
  await action(page, 'set-form-data')
  await action(page, 'autosave')
  await expect(page.locator('[data-nwu-status]')).toHaveAttribute('data-nwu-status-value', 'autosave:dirty')
  await action(page, 'save-workspace')
  await expect(page.locator('[data-nwu-status]')).toHaveAttribute('data-nwu-status-value', 'workspace:source')

  await action(page, 'reopen')
  await ready(page)
  await action(page, 'export')
  await expect(page.locator('[data-nwu-export]')).toHaveText('# Browser draft\n\nDraft body.')
  await action(page, 'recover')
  await expect(page.locator('[data-nwu-status]')).toHaveAttribute('data-nwu-status-value', /^recovered:/u)
  await expect(page.locator('[data-nwu-reader] h1')).toHaveText('Browser draft')

  await action(page, 'manual-save')
  await expect(page.locator('[data-nwu-status]')).toHaveAttribute('data-nwu-status-value', 'manual:saved')
  await action(page, 'export')
  await expect(page.locator('[data-nwu-export]')).toHaveText('')

  await source.fill('# Transient failure draft')
  await action(page, 'fail-next-save')
  await action(page, 'autosave')
  await expect(page.locator('[data-nwu-status]')).toHaveAttribute('data-nwu-status-value', 'action-failed')
  await expect(page.locator('[data-nwu-result]')).toContainText('SAVE_FAILED')
  await action(page, 'retry')
  await expect(page.locator('[data-nwu-status]')).toHaveAttribute('data-nwu-status-value', 'retry:saved')
  await action(page, 'reopen')
  await ready(page)
  await action(page, 'export')
  await expect(page.locator('[data-nwu-export]')).toHaveText('# Transient failure draft')
  await action(page, 'discard')
  await expect(page.locator('[data-nwu-status]')).toHaveAttribute('data-nwu-status-value', 'discarded')
  await action(page, 'export')
  await expect(page.locator('[data-nwu-export]')).toHaveText('')

  await action(page, 'set-dark-theme')
  await expect(page.locator('[data-w-editor-profile="editor"]')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('[data-w-editor-profile="reader"]')).toHaveAttribute('data-theme', 'dark')
  await action(page, 'reset-theme')
  await expect(page.locator('[data-w-editor-profile="editor"]')).toHaveAttribute('data-theme', 'blue')

  await source.fill('# Auth retry draft')
  await action(page, 'expire-auth')
  await action(page, 'autosave')
  await expect(page.locator('[data-nwu-status]')).toHaveAttribute('data-nwu-status-value', 'action-failed')
  await expect(page.locator('[data-nwu-result]')).toContainText('AUTH_REQUIRED')
  await action(page, 'restore-auth')
  await action(page, 'retry')
  await expect(page.locator('[data-nwu-status]')).toHaveAttribute('data-nwu-status-value', 'retry:saved')

  await source.fill('# CSRF retry draft')
  await action(page, 'rotate-csrf')
  await action(page, 'autosave')
  await expect(page.locator('[data-nwu-status]')).toHaveAttribute('data-nwu-status-value', 'action-failed')
  await expect(page.locator('[data-nwu-result]')).toContainText('CSRF_REJECTED')
  await action(page, 'refresh-csrf')
  await action(page, 'retry')
  await expect(page.locator('[data-nwu-status]')).toHaveAttribute('data-nwu-status-value', 'retry:saved')

  await source.fill('# Conflict draft')
  await action(page, 'force-conflict')
  await action(page, 'manual-save')
  await expect(page.locator('[data-nwu-status]')).toHaveAttribute('data-nwu-status-value', 'manual:conflict')
  await expect(page.locator('[data-nwu-result]')).toContainText('REVISION_CONFLICT')
  await action(page, 'set-json')
  await action(page, 'authorized-save')
  await expect(page.locator('[data-nwu-status]')).toHaveAttribute('data-nwu-status-value', 'authorized:saved')

  const requests = JSON.parse(await page.locator('[data-nwu-request-log]').textContent() ?? '[]') as Array<{ credentials: string; transport: string; headers: Record<string, string> }>
  expect(requests.some((request) => request.transport === 'form-data')).toBe(true)
  expect(requests.some((request) => request.transport === 'json')).toBe(true)
  expect(requests.every((request) => request.credentials === 'same-origin')).toBe(true)
  expect(requests.filter((request) => request.transport === 'json').every((request) => request.headers['content-type'] === 'application/json')).toBe(true)
  expect(requests.filter((request) => request.transport === 'form-data').every((request) => request.headers['content-type'] === undefined)).toBe(true)
  expect(requests.every((request) => request.headers['x-requested-with'] === 'XMLHttpRequest')).toBe(true)
  expect(requests.every((request) => request.headers['x-csrftoken'] !== undefined)).toBe(true)
})

test('round-trips the sanitized lagging-copy compatibility fixture through the production Editor and Reader', async ({ page }) => {
  test.setTimeout(120_000)
  const response = await page.goto(hostOrigin)
  expect(response?.status()).toBe(200)
  await ready(page)

  const source = page.locator('[data-nwu-editor] [data-w-editor-source]')
  await source.fill(sanitizedCompatibilityFixture)
  await expect(page.locator('[data-nwu-reader] h1')).toHaveText('NWU 脱敏兼容样例')
  const image = page.locator('[data-nwu-reader] img[src="/static/blog_images/sanitized/example.png"]')
  await expect(image).toBeVisible()
  await expect(image).not.toHaveAttribute('data-image-width')
  await expect(page.locator('[data-nwu-reader] span[style*="color"]')).toContainText('脱敏强调文本')
  await expect(page.locator('[data-nwu-reader] div[style*="text-align: center"]')).toContainText('脱敏居中文本')
  await expect(page.locator('[data-nwu-reader] pre code')).toContainText('inspect_device')
  await expect(page.locator('[data-nwu-reader] .katex')).not.toHaveCount(0)
  await expect(page.locator('[data-nwu-reader] .toc')).not.toHaveCount(0)
  await expect(page.locator('[data-nwu-reader]')).not.toContainText('<!-- script:')

  await action(page, 'manual-save')
  await expect(page.locator('[data-nwu-status]')).toHaveAttribute('data-nwu-status-value', 'manual:saved')
  await action(page, 'reopen')
  await ready(page)
  await expect(page.locator('[data-nwu-editor] [data-w-editor-source]')).toHaveValue(sanitizedCompatibilityFixture)
})
