import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { extname, resolve, sep } from 'node:path'

import { expect, test } from '@playwright/test'

const projectRoot = resolve(process.cwd())
let staticServer: Server | null = null
let staticOrigin = ''

test.beforeAll(async () => {
  staticServer = createServer((request, response) => {
    const requestPath = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    const relativePath = decodeURIComponent(requestPath).replace(/^\//u, '')
    if (!relativePath.startsWith('examples/web-consumer/') && !relativePath.startsWith('packages/editor-web/dist/')) {
      response.writeHead(404).end()
      return
    }
    const filePath = resolve(projectRoot, relativePath)
    if (!filePath.startsWith(`${projectRoot}${sep}`) || !existsSync(filePath) || !statSync(filePath).isFile()) {
      response.writeHead(404).end()
      return
    }
    const contentTypes: Record<string, string> = {
      '.css': 'text/css; charset=utf-8',
      '.eot': 'application/vnd.ms-fontobject',
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.ttf': 'font/ttf',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
    }
    const headers: Record<string, string> = {
      'Content-Type': contentTypes[extname(filePath)] ?? 'application/octet-stream',
    }
    if (relativePath.endsWith('.html')) {
      headers['Content-Security-Policy'] = "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self' data:; frame-src 'self'; img-src 'self' data: blob:; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
    }
    response.writeHead(200, headers)
    createReadStream(filePath).pipe(response)
  })
  await new Promise<void>((resolveServer, reject) => {
    staticServer?.once('error', reject)
    staticServer?.listen(0, '127.0.0.1', () => resolveServer())
  })
  const address = staticServer.address()
  if (address === null || typeof address === 'string') throw new Error('Offline consumer server did not expose a port.')
  staticOrigin = `http://127.0.0.1:${address.port}`
})

test.afterAll(async () => {
  if (staticServer === null) return
  await new Promise<void>((resolveServer, reject) => staticServer?.close((error) => error ? reject(error) : resolveServer()))
  staticServer = null
})

for (const entry of ['esm', 'iife'] as const) {
  test(`runs the ${entry.toUpperCase()} distribution with public network requests blocked`, async ({ page }) => {
    test.setTimeout(60_000)
    const externalRequests: string[] = []
    await page.route('**/*', async (route) => {
      const requestUrl = new URL(route.request().url())
      if (requestUrl.origin !== staticOrigin) {
        externalRequests.push(requestUrl.href)
        await route.abort('blockedbyclient')
        return
      }
      await route.continue()
    })
    const response = await page.goto(`${staticOrigin}/examples/web-consumer/offline-${entry}.html`)
    expect(response?.status()).toBe(200)
    await expect(page.locator('[data-offline-status]')).toHaveAttribute('data-offline-status', 'passed', { timeout: 30_000 })
    expect(externalRequests).toEqual([])
    const result = await page.locator('[data-offline-result]').textContent()
    expect(result).not.toBeNull()
    expect(JSON.parse(result ?? '{}')).toMatchObject({
      entry,
      editorMounted: true,
      formulaRendered: true,
      codeRendered: true,
      readerMounted: true,
      readerDestroyed: true,
      saved: true,
    })
  })
}
