import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { extname, resolve, sep } from 'node:path'

import { expect, test } from '@playwright/test'

const projectRoot = resolve(process.cwd())
let staticServer: Server | null = null
let staticOrigin = ''
let firstApiKeys: string[] | null = null

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
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
    }
    response.writeHead(200, { 'Content-Type': contentTypes[extname(filePath)] ?? 'application/octet-stream' })
    createReadStream(filePath).pipe(response)
  })
  await new Promise<void>((resolveServer, reject) => {
    staticServer?.once('error', reject)
    staticServer?.listen(0, '127.0.0.1', () => resolveServer())
  })
  const address = staticServer.address()
  if (address === null || typeof address === 'string') throw new Error('Static consumer server did not expose a port.')
  staticOrigin = `http://127.0.0.1:${address.port}`
})

test.afterAll(async () => {
  if (staticServer === null) return
  await new Promise<void>((resolveServer, reject) => staticServer?.close((error) => error ? reject(error) : resolveServer()))
  staticServer = null
})

for (const entry of ['esm', 'iife'] as const) {
  test(`loads the ${entry.toUpperCase()} distribution from a static page`, async ({ page }) => {
    test.setTimeout(60_000)
    page.on('pageerror', (error) => console.log(`[consumer:${entry}:pageerror] ${error.message}\n${error.stack ?? ''}`))
    page.on('requestfailed', (request) => console.log(`[consumer:${entry}:requestfailed] ${request.url()} ${request.failure()?.errorText ?? ''}`))
    const response = await page.goto(`${staticOrigin}/examples/web-consumer/${entry}.html`)
    expect(response?.status()).toBe(200)
    try {
      await expect.poll(async () => page.locator('[data-consumer-status]').getAttribute('data-consumer-status'), { timeout: 30_000 }).toBe('passed')
    } catch (error) {
      console.log(`[consumer:${entry}:state] ${await page.locator('[data-consumer-status]').evaluate((node) => node.outerHTML)}`)
      console.log(`[consumer:${entry}:result] ${await page.locator('[data-consumer-result]').textContent()}`)
      throw error
    }

    const result = await page.locator('[data-consumer-result]').textContent()
    expect(result).not.toBeNull()
    const parsed = JSON.parse(result ?? '{}') as {
      readonly apiVersion: string
      readonly apiKeys: string[]
      readonly capabilities: string[]
      readonly destroyed: boolean
      readonly entry: string
      readonly readerProfile: string
      readonly saved: boolean
    }
    expect(parsed.entry).toBe(entry)
    expect(parsed.apiVersion).toBe('1.0.0')
    expect(parsed.capabilities).toEqual(expect.arrayContaining(['copy', 'readonly', 'heading']))
    if (firstApiKeys === null) firstApiKeys = parsed.apiKeys
    else expect(parsed.apiKeys).toEqual(firstApiKeys)
    expect(parsed.readerProfile).toBe('reader')
    expect(parsed.saved).toBe(true)
    expect(parsed.destroyed).toBe(true)
  })
}
