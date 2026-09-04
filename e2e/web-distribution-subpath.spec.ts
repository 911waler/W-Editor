import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { extname, resolve, sep } from 'node:path'

import { expect, test, type Frame, type Page } from '@playwright/test'

const projectRoot = resolve(process.cwd())
const distributionSubpath = '/proxy/static/w-editor/1.0.0/'
const distributionSubpathPath = `proxy/static/w-editor/1.0.0/`
let staticServer: Server | null = null
let staticOrigin = ''

type BridgeMessageRecord = Readonly<{
  readonly data: unknown
  readonly origin: string
}>

function packagedDrawioFrame(page: Page): Frame {
  const frame = page.frames().find((candidate) => candidate.url().includes('/drawio/drawio_demo.html'))
  if (frame === undefined) throw new Error('Packaged draw.io editor frame is unavailable.')
  return frame
}

async function waitForPackagedDrawioFrame(page: Page): Promise<Frame> {
  await expect.poll(() => page.frames().some((frame) => frame.url().includes('/drawio/drawio_demo.html')), { timeout: 30_000 }).toBe(true)
  return packagedDrawioFrame(page)
}

async function captureBridgeMessages(page: Page): Promise<void> {
  await page.evaluate(() => {
    const host = window as Window & { __wEditorDrawioMessages?: BridgeMessageRecord[] }
    host.__wEditorDrawioMessages = []
    window.addEventListener('message', (event) => {
      host.__wEditorDrawioMessages?.push(Object.freeze({ data: event.data, origin: event.origin }))
    })
  })
}

async function postParentMessage(page: Page, message: Readonly<Record<string, unknown>>, origin = staticOrigin): Promise<void> {
  await page.evaluate(({ message: value, messageOrigin }) => {
    window.dispatchEvent(new MessageEvent('message', {
      data: value,
      origin: messageOrigin,
      source: window,
    }))
  }, { message, messageOrigin: origin })
}

async function waitForBridgeMessage(page: Page, requestId: string, type: string): Promise<Readonly<Record<string, unknown>>> {
  await expect.poll(async () => page.evaluate(({ expectedRequestId, expectedType }) => {
    const host = window as Window & { __wEditorDrawioMessages?: readonly BridgeMessageRecord[] }
    return host.__wEditorDrawioMessages?.some(({ data }) => {
      if (typeof data !== 'object' || data === null || Array.isArray(data)) return false
      const record = data as Record<string, unknown>
      return record['requestId'] === expectedRequestId && record['type'] === expectedType
    }) ?? false
  }, { expectedRequestId: requestId, expectedType: type }), { timeout: 30_000 }).toBe(true)
  const message = await page.evaluate(({ expectedRequestId, expectedType }) => {
    const host = window as Window & { __wEditorDrawioMessages?: readonly BridgeMessageRecord[] }
    const match = host.__wEditorDrawioMessages?.findLast(({ data }) => {
      if (typeof data !== 'object' || data === null || Array.isArray(data)) return false
      const record = data as Record<string, unknown>
      return record['requestId'] === expectedRequestId && record['type'] === expectedType
    })
    return match?.data ?? null
  }, { expectedRequestId: requestId, expectedType: type })
  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    throw new Error(`Packaged draw.io bridge did not return ${type}.`)
  }
  return message as Readonly<Record<string, unknown>>
}

test.beforeAll(async () => {
  staticServer = createServer((request, response) => {
    const requestPath = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    const relativePath = decodeURIComponent(requestPath).replace(/^\//u, '')
    const virtualDistribution = relativePath.startsWith(distributionSubpathPath)
    const virtualSuffix = virtualDistribution ? relativePath.slice(distributionSubpathPath.length) : ''
    const virtualPage = virtualSuffix === 'esm.html'
      ? 'subpath-esm.html'
      : virtualSuffix === 'iife.html'
        ? 'subpath-iife.html'
          : virtualSuffix === 'subpath-consumer-runner.js'
            ? 'subpath-consumer-runner.js'
            : null
    const virtualRootAsset = virtualSuffix === 'drawio-bridge.html'
      || virtualSuffix.startsWith('assets/')
      || virtualSuffix.startsWith('e2e/fixtures/')
      || virtualSuffix.startsWith('vendor/')
    const sourceRelativePath = virtualPage === null
      ? virtualDistribution
        ? virtualRootAsset
          ? `dist/${virtualSuffix}`
          : `packages/editor-web/dist/${virtualSuffix}`
        : relativePath
      : `examples/web-consumer/${virtualPage}`
    if (!relativePath.startsWith('examples/web-consumer/')
      && !relativePath.startsWith('packages/editor-web/dist/')
      && !virtualDistribution) {
      response.writeHead(404).end()
      return
    }
    const filePath = resolve(projectRoot, sourceRelativePath)
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
    if (sourceRelativePath.endsWith('.html')) {
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
  if (address === null || typeof address === 'string') throw new Error('Subpath consumer server did not expose a port.')
  staticOrigin = `http://127.0.0.1:${address.port}`
})

test.afterAll(async () => {
  if (staticServer === null) return
  await new Promise<void>((resolveServer, reject) => staticServer?.close((error) => error ? reject(error) : resolveServer()))
  staticServer = null
})

for (const entry of ['esm', 'iife'] as const) {
  test(`loads the ${entry.toUpperCase()} distribution below a reverse-proxy subpath`, async ({ page }) => {
    test.setTimeout(60_000)
    const requests: string[] = []
    page.on('request', (request) => requests.push(request.url()))
    const response = await page.goto(`${staticOrigin}${distributionSubpath}${entry}.html`)
    expect(response?.status()).toBe(200)
    await expect(page.locator('[data-subpath-status]')).toHaveAttribute('data-subpath-status', 'passed', { timeout: 30_000 })
    const result = JSON.parse(await page.locator('[data-subpath-result]').textContent() ?? '{}') as {
      readonly assetBaseUrl: string
      readonly entry: string
      readonly fontsReady: boolean
      readonly resourceRequests: string[]
    }
    expect(result.entry).toBe(entry)
    expect(result.assetBaseUrl).toBe(`${staticOrigin}${distributionSubpath}`)
    expect(result.resourceRequests.every((requestUrl) => new URL(requestUrl).pathname.startsWith(distributionSubpath))).toBe(true)
    expect(result.resourceRequests.some((requestUrl) => requestUrl.endsWith('.css'))).toBe(true)
    expect(result.resourceRequests.some((requestUrl) => requestUrl.endsWith('.js'))).toBe(true)
    expect(result.fontsReady).toBe(true)
    const css = readFileSync(resolve(projectRoot, 'packages/editor-web/dist/w-editor.css'), 'utf8')
    const fontUrls = [...css.matchAll(/@font-face[^{]*\{[^}]*src:[^}]*url\(([^)]+)\)/gu)]
      .map((match) => (match[1] ?? '').trim().replace(/^['"]|['"]$/gu, ''))
    expect(fontUrls.length).toBeGreaterThan(0)
    expect(fontUrls.every((fontUrl) => fontUrl.startsWith('data:') || new URL(fontUrl, `${staticOrigin}${distributionSubpath}w-editor.css`).pathname.startsWith(distributionSubpath))).toBe(true)
    expect(requests.filter((requestUrl) => new URL(requestUrl).pathname.startsWith('/packages/'))).toEqual([])
  })
}

test('loads the built draw.io bridge below a reverse-proxy subpath', async ({ page }) => {
  test.setTimeout(60_000)
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  const editorUrl = `${staticOrigin}${distributionSubpath}e2e/fixtures/drawio/fake-drawio.html`
  const response = await page.goto(`${staticOrigin}${distributionSubpath}drawio-bridge.html?editor=${encodeURIComponent(editorUrl)}`)
  expect(response?.status()).toBe(200)
  await expect(page.locator('[data-drawio-bridge-status]')).toHaveText('Diagram editor loaded', { timeout: 30_000 })
  expect(requests.every((requestUrl) => new URL(requestUrl).pathname.startsWith(distributionSubpath))).toBe(true)
})

test('loads the packaged draw.io bridge with an exact subpath resource root', async ({ page }) => {
  test.setTimeout(60_000)
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  const editorUrl = `${staticOrigin}${distributionSubpath}e2e/fixtures/drawio/fake-drawio.html`
  const response = await page.goto(`${staticOrigin}${distributionSubpath}drawio/bridge.html?editor=${encodeURIComponent(editorUrl)}`)
  expect(response?.status()).toBe(200)
  await expect(page.locator('[data-drawio-bridge-status]')).toHaveText('Diagram editor loaded', { timeout: 30_000 })
  expect(requests.every((requestUrl) => new URL(requestUrl).pathname.startsWith(distributionSubpath))).toBe(true)
  expect(requests.some((requestUrl) => new URL(requestUrl).pathname.endsWith('/drawio/bridge.js'))).toBe(true)
  expect(requests.some((requestUrl) => new URL(requestUrl).pathname.endsWith('/drawio/drawio_demo.html'))).toBe(false)
})

test('initializes the packaged draw.io runtime only inside the requested bridge', async ({ page }) => {
  test.setTimeout(60_000)
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  const response = await page.goto(`${staticOrigin}${distributionSubpath}drawio/bridge.html`)
  expect(response?.status()).toBe(200)
  await expect(page.locator('[data-drawio-bridge-status]')).toHaveText('Diagram editor loaded', { timeout: 30_000 })

  const editor = page.frameLocator('#drawio-editor')
  await expect(editor.locator('.geMenubarContainer')).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => page.locator('#drawio-editor').evaluate((node) => {
    const editorWindow = (node as HTMLIFrameElement).contentWindow as (Window & { editorUIInstance?: unknown }) | null
    return Boolean(editorWindow?.editorUIInstance)
  }), { timeout: 30_000 }).toBe(true)
  expect(requests.every((requestUrl) => new URL(requestUrl).pathname.startsWith(distributionSubpath))).toBe(true)
  expect(requests.some((requestUrl) => new URL(requestUrl).pathname.endsWith('/drawio/drawio_demo.html'))).toBe(true)
  expect(requests.some((requestUrl) => new URL(requestUrl).pathname.endsWith('/drawio/assets/drawio_lib/Init.js'))).toBe(true)
})

test('runs packaged draw.io create/edit/apply/reopen protocol and rejects hostile parent messages', async ({ page }) => {
  test.setTimeout(90_000)
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  const response = await page.goto(`${staticOrigin}${distributionSubpath}drawio/bridge.html`)
  expect(response?.status()).toBe(200)
  await expect(page.locator('[data-drawio-bridge-status]')).toHaveText('Diagram editor loaded', { timeout: 30_000 })
  const editor = await waitForPackagedDrawioFrame(page)
  await expect(editor.locator('.geMenubarContainer')).toBeVisible({ timeout: 30_000 })
  await captureBridgeMessages(page)

  const initialXml = '<mxfile host="W-Editor"><diagram id="page-1" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>'
  await postParentMessage(page, {
    requestId: 'packaged-create-edit',
    type: 'w-editor:drawio:load',
    xml: initialXml,
  })
  await waitForBridgeMessage(page, 'packaged-create-edit', 'w-editor:drawio:ready')

  await postParentMessage(page, {
    requestId: 'packaged-create-edit',
    type: 'w-editor:drawio:save-request',
  }, 'https://hostile.example.test')
  await expect.poll(async () => page.evaluate(() => {
    const host = window as Window & { __wEditorDrawioMessages?: readonly BridgeMessageRecord[] }
    return host.__wEditorDrawioMessages?.some(({ data }) => typeof data === 'object'
      && data !== null
      && !Array.isArray(data)
      && (data as Record<string, unknown>)['type'] === 'w-editor:drawio:save') ?? false
  })).toBe(false)

  await editor.evaluate(() => {
    type EditorWindow = Window & {
      editorUIInstance?: {
        editor?: {
          graph?: {
            getDefaultParent: () => unknown
            getModel: () => { beginUpdate: () => void; endUpdate: () => void }
            insertVertex: (parent: unknown, id: string, value: string, x: number, y: number, width: number, height: number) => unknown
          }
        }
      }
    }
    const editorInstance = (window as EditorWindow).editorUIInstance?.editor
    const graph = editorInstance?.graph
    if (graph === undefined) throw new Error('Packaged draw.io graph API is unavailable.')
    const model = graph.getModel()
    model.beginUpdate()
    try {
      graph.insertVertex(graph.getDefaultParent(), 'w-editor-edit', 'Edited in packaged runtime', 80, 80, 180, 40)
    } finally {
      model.endUpdate()
    }
  })
  await postParentMessage(page, {
    requestId: 'packaged-create-edit',
    type: 'w-editor:drawio:save-request',
  })
  const saved = await waitForBridgeMessage(page, 'packaged-create-edit', 'w-editor:drawio:save')
  expect(saved['xml']).toContain('Edited in packaged runtime')
  expect(typeof saved['png']).toBe('string')
  expect(String(saved['png'])).toMatch(/^data:image\/png;base64,/u)

  await page.reload()
  await expect(page.locator('[data-drawio-bridge-status]')).toHaveText('Diagram editor loaded', { timeout: 30_000 })
  const reopenedEditor = await waitForPackagedDrawioFrame(page)
  await expect(reopenedEditor.locator('.geMenubarContainer')).toBeVisible({ timeout: 30_000 })
  await captureBridgeMessages(page)
  const reopenedXml = '<mxfile host="W-Editor"><diagram id="page-1" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="reopened" value="Reopened" vertex="1" parent="1"/></root></mxGraphModel></diagram></mxfile>'
  await postParentMessage(page, {
    requestId: 'packaged-reopen',
    type: 'w-editor:drawio:load',
    xml: reopenedXml,
  })
  await waitForBridgeMessage(page, 'packaged-reopen', 'w-editor:drawio:ready')
  const reopenedGraphXml = await reopenedEditor.evaluate(() => {
    type EditorWindow = Window & {
      editorUIInstance?: { editor?: { getGraphXml?: () => Node } }
    }
    const graphXml = (window as EditorWindow).editorUIInstance?.editor?.getGraphXml?.()
    return graphXml === undefined ? '' : new XMLSerializer().serializeToString(graphXml)
  })
  expect(reopenedGraphXml).toContain('Reopened')
  expect(requests.every((requestUrl) => new URL(requestUrl).pathname.startsWith(distributionSubpath))).toBe(true)
  expect(requests.some((requestUrl) => new URL(requestUrl).pathname.endsWith('/drawio/drawio_demo.html'))).toBe(true)
})
