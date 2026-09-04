import { mkdirSync } from 'node:fs'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { extname, resolve, sep } from 'node:path'

import { expect, test } from '@playwright/test'

import { decodePng, type DecodedPng } from './fixtures/png'

const projectRoot = resolve(process.cwd())
const candidateRoot = resolve(projectRoot, 'artifacts/renderer/parity-candidates')
const fixtures = ['ordinary', 'formula-code', 'async-graphics', 'complex-layout'] as const
const pixelTolerances = Object.freeze({
  'async-graphics': Object.freeze({ maximumChannelDelta: 8, maximumDifferenceRatio: 0.0002 }),
  'complex-layout': Object.freeze({ maximumChannelDelta: 2, maximumDifferenceRatio: 0 }),
  'formula-code': Object.freeze({ maximumChannelDelta: 2, maximumDifferenceRatio: 0 }),
  ordinary: Object.freeze({ maximumChannelDelta: 2, maximumDifferenceRatio: 0 }),
})
let staticServer: Server | null = null
let staticOrigin = ''

function pixelDifference(left: DecodedPng, right: DecodedPng): Readonly<{
  bounds: Readonly<{ bottom: number; left: number; right: number; top: number }> | null
  changed: number
  ratio: number
  maximumChannelDelta: number
}> {
  expect(right.width).toBe(left.width)
  expect(right.height).toBe(left.height)
  let changed = 0
  let maximumChannelDelta = 0
  let bottom = -1
  let leftEdge = left.width
  let rightEdge = -1
  let top = left.height
  for (let offset = 0; offset < left.data.length; offset += 4) {
    let pixelChanged = false
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs((left.data[offset + channel] ?? 0) - (right.data[offset + channel] ?? 0))
      maximumChannelDelta = Math.max(maximumChannelDelta, delta)
      if (delta > 2) pixelChanged = true
    }
    if (pixelChanged) {
      changed += 1
      const pixel = offset / 4
      const x = pixel % left.width
      const y = Math.floor(pixel / left.width)
      leftEdge = Math.min(leftEdge, x)
      rightEdge = Math.max(rightEdge, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
  }
  return Object.freeze({
    bounds: changed === 0 ? null : Object.freeze({ bottom, left: leftEdge, right: rightEdge, top }),
    changed,
    maximumChannelDelta,
    ratio: changed / (left.width * left.height),
  })
}

test.beforeAll(async () => {
  mkdirSync(candidateRoot, { recursive: true })
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
    staticServer?.listen(43_000 + (process.pid % 1_000), '127.0.0.1', () => resolveServer())
  })
  const address = staticServer.address()
  if (address === null || typeof address === 'string') throw new Error('Parity candidate server did not expose a port.')
  staticOrigin = `http://127.0.0.1:${address.port}`
})

test.afterAll(async () => {
  if (staticServer === null) return
  await new Promise<void>((resolveServer, reject) => staticServer?.close((error) => error ? reject(error) : resolveServer()))
  staticServer = null
})

for (const entry of ['esm', 'iife'] as const) {
  for (const fixture of fixtures) {
    test(`${entry.toUpperCase()} ${fixture} Reader and Final produce controlled parity candidates`, async ({ page }) => {
      test.setTimeout(60_000)
      await page.setViewportSize({ height: 1200, width: 1560 })
      const response = await page.goto(`${staticOrigin}/examples/web-consumer/parity-${entry}.html?fixture=${fixture}`)
      expect(response?.status()).toBe(200)
      await expect(page.locator('[data-parity-status]')).toHaveAttribute('data-parity-status', 'ready', { timeout: 30_000 })

      const reader = page.locator('[data-parity-reader] .w-editor-renderer-content')
      const finalPreview = page.locator('[data-parity-final] .w-editor-renderer-content')
      await expect(reader).toBeVisible()
      await expect(finalPreview).toBeVisible()
      const [readerSemantic, finalSemantic] = await Promise.all([reader, finalPreview].map((locator) => locator.evaluate((node) => {
        const clone = node.cloneNode(true) as HTMLElement
        clone.querySelectorAll([
          'style',
          '[data-semantic-edit]',
          '[data-raw-edit]',
          '.visual-code-block__language',
          '.table-node-view__handle',
          '.table-node-view__menu',
          '.table-cell-selection-overlay',
        ].join(', ')).forEach((element) => element.remove())
        return {
          code: [...clone.querySelectorAll('pre > code')].map((codeNode) => codeNode.textContent ?? ''),
          headings: [...clone.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((heading) => `${heading.tagName}:${heading.textContent ?? ''}`),
          svgCount: clone.querySelectorAll('svg').length,
          svgText: [...clone.querySelectorAll('svg text')].map((textNode) => textNode.textContent?.trim() ?? ''),
          tableCount: clone.querySelectorAll('table').length,
          text: clone.textContent?.replace(/\s+/gu, ' ').trim() ?? '',
        }
      })))
      expect(readerSemantic).toEqual(finalSemantic)
      const readerPath = resolve(candidateRoot, `${entry}-${fixture}-reader.png`)
      const finalPath = resolve(candidateRoot, `${entry}-${fixture}-final.png`)
      const readerBytes = await reader.screenshot({ animations: 'disabled', caret: 'hide', path: readerPath })
      const finalBytes = await finalPreview.screenshot({ animations: 'disabled', caret: 'hide', path: finalPath })
      const difference = pixelDifference(decodePng(readerBytes), decodePng(finalBytes))
      const tolerance = pixelTolerances[fixture]

      expect(difference.maximumChannelDelta, JSON.stringify(difference)).toBeLessThanOrEqual(tolerance.maximumChannelDelta)
      expect(difference.ratio, JSON.stringify(difference)).toBeLessThanOrEqual(tolerance.maximumDifferenceRatio)
    })
  }
}
