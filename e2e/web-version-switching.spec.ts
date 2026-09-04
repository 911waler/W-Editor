import { cpSync, createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { extname, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'

import { expect, test, type Page } from '@playwright/test'

const projectRoot = resolve(process.cwd())
const distributionRoot = resolve(projectRoot, 'packages/editor-web/dist')
const versions = ['1.0.0', '1.1.0'] as const
let temporaryRoot = ''
let server: Server | null = null
let origin = ''

const versionSwitchScript = `import * as oldApi from '/static/vendor/w-editor/1.0.0/renderer.es.js'
import * as newApi from '/static/vendor/w-editor/1.1.0/renderer.es.js'

const oldReader = oldApi.mountWRenderer(document.querySelector('[data-old-reader]'), {
  markdown: '# Old article',
  profile: 'reader',
})
const newReader = newApi.mountWRenderer(document.querySelector('[data-new-reader]'), {
  markdown: '# New article',
  profile: 'reader',
})
const resources = performance.getEntriesByType('resource').map((entry) => entry.name)
document.querySelector('[data-version-status]').dataset.versionStatus = 'passed'
window.__versionSwitchResult = {
  oldApiVersion: oldReader.apiVersion,
  oldHeading: document.querySelector('[data-old-reader] h1')?.textContent,
  newApiVersion: newReader.apiVersion,
  newHeading: document.querySelector('[data-new-reader] h1')?.textContent,
  resources,
  sameSchema: oldReader.schemaVersion === newReader.schemaVersion,
  destroyed: false,
}
await oldReader.destroy()
await newReader.destroy()
window.__versionSwitchResult.destroyed = document.querySelectorAll('[data-w-editor-instance]').length === 0`

test.beforeAll(async () => {
  temporaryRoot = mkdtempSync(join(tmpdir(), 'w-editor-web-versions-'))
  for (const version of versions) cpSync(distributionRoot, join(temporaryRoot, version), { recursive: true })
  server = createServer((request, response) => {
    const requestPath = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    if (requestPath === '/switch.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }).end(versionSwitchScript)
      return
    }
    if (requestPath === '/switch.html') {
      response.writeHead(200, {
        'Content-Security-Policy': "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self' data:; img-src 'self' data: blob:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'",
        'Content-Type': 'text/html; charset=utf-8',
      })
      response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <link rel="stylesheet" href="/static/vendor/w-editor/1.0.0/w-editor.css">
    <link rel="stylesheet" href="/static/vendor/w-editor/1.1.0/w-editor.css">
  </head>
  <body>
    <main>
      <p data-version-status="pending">version switching</p>
      <section data-old-reader></section>
      <section data-new-reader></section>
    </main>
    <script type="module" src="/switch.js"></script>
  </body>
</html>`)
      return
    }
    const match = /^\/static\/vendor\/w-editor\/(1\.0\.0|1\.1\.0)\/(.+)$/u.exec(requestPath)
    const version = match?.[1]
    const resourcePath = match?.[2]
    if (version === undefined || resourcePath === undefined) {
      response.writeHead(404).end()
      return
    }
    const versionRoot = resolve(temporaryRoot, version)
    const filePath = resolve(versionRoot, resourcePath)
    const normalized = relative(versionRoot, filePath).replaceAll('\\', '/')
    if (normalized === '' || normalized.startsWith('../') || normalized === '..' || !existsSync(filePath) || !statSync(filePath).isFile()) {
      response.writeHead(404).end()
      return
    }
    const contentTypes: Record<string, string> = {
      '.css': 'text/css; charset=utf-8',
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.map': 'application/json',
      '.svg': 'image/svg+xml',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
    }
    response.writeHead(200, { 'Content-Type': contentTypes[extname(filePath)] ?? 'application/octet-stream' })
    createReadStream(filePath).pipe(response)
  })
  await new Promise<void>((resolveServer, reject) => {
    server?.once('error', reject)
    server?.listen(0, '127.0.0.1', () => resolveServer())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Web version switching server did not expose a port.')
  origin = `http://127.0.0.1:${address.port}`
})

test.afterAll(async () => {
  if (server !== null) {
    await new Promise<void>((resolveServer, reject) => server?.close((error) => error ? reject(error) : resolveServer()))
    server = null
  }
  if (temporaryRoot.length > 0) rmSync(temporaryRoot, { force: true, recursive: true })
})

async function versionResult(page: Page): Promise<Readonly<{
  readonly destroyed: boolean
  readonly newApiVersion: string
  readonly newHeading: string
  readonly oldApiVersion: string
  readonly oldHeading: string
  readonly resources: readonly string[]
  readonly sameSchema: boolean
}>> {
  return page.evaluate(() => (window as Window & { __versionSwitchResult?: Readonly<{
    readonly destroyed: boolean
    readonly newApiVersion: string
    readonly newHeading: string
    readonly oldApiVersion: string
    readonly oldHeading: string
    readonly resources: readonly string[]
    readonly sameSchema: boolean
  }> }).__versionSwitchResult ?? null) as Promise<Readonly<{
    readonly destroyed: boolean
    readonly newApiVersion: string
    readonly newHeading: string
    readonly oldApiVersion: string
    readonly oldHeading: string
    readonly resources: readonly string[]
    readonly sameSchema: boolean
  }>>
}

test('serves old and new Web version directories concurrently without cache-root mixing', async ({ page }) => {
  test.setTimeout(90_000)
  const response = await page.goto(`${origin}/switch.html`)
  expect(response?.status()).toBe(200)
  await expect(page.locator('[data-version-status]')).toHaveAttribute('data-version-status', 'passed', { timeout: 30_000 })
  await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __versionSwitchResult?: unknown }).__versionSwitchResult))).toBe(true)
  const result = await versionResult(page)
  expect(result).not.toBeNull()
  expect(result.oldApiVersion).toBe('1.0.0')
  expect(result.newApiVersion).toBe('1.0.0')
  expect(result.sameSchema).toBe(true)
  expect(result.oldHeading).toBe('Old article')
  expect(result.newHeading).toBe('New article')
  expect(result.destroyed).toBe(true)
  expect(result.resources.some((resource) => new URL(resource).pathname.startsWith('/static/vendor/w-editor/1.0.0/'))).toBe(true)
  expect(result.resources.some((resource) => new URL(resource).pathname.startsWith('/static/vendor/w-editor/1.1.0/'))).toBe(true)
  expect(result.resources
    .filter((resource) => new URL(resource).pathname.includes('/static/vendor/w-editor/'))
    .every((resource) => {
      const path = new URL(resource).pathname
      return path.startsWith('/static/vendor/w-editor/1.0.0/') || path.startsWith('/static/vendor/w-editor/1.1.0/')
    })).toBe(true)
})
