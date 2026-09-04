import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { extname, resolve, sep } from 'node:path'

import { expect, test } from '@playwright/test'

const projectRoot = resolve(process.cwd())
const editorFixture = [
  '# Foreign editor',
  '',
  'Inline $x^2+y^2$.',
  '',
  '| :line: {"title":"Line chart"} | a | b |',
  '| :-: | :-: | :-: |',
  '| x | 1 | 2 |',
  '| y | 2 | 4 |',
  '',
  '```javascript',
  'const answer = 42',
  '```',
].join('\n')

let staticServer: Server | null = null
let staticOrigin = ''

function editorPage(entry: 'esm' | 'iife', origin: string): string {
  const apiSource = entry === 'esm'
    ? `<script type="module">import * as api from '${origin}/packages/editor-web/dist/editor.es.js'; window.startForeignEditor(api)</script>`
    : `<script src="${origin}/packages/editor-web/dist/w-editor.global.js"></script><script>window.startForeignEditor(window.WEditor)</script>`
  return `<!doctype html>
<html><head><meta charset="utf-8"><link rel="stylesheet" href="${origin}/packages/editor-web/dist/w-editor.css"></head>
<body><main id="editor-target"></main><script>
window.startForeignEditor = function (api) {
  var clipboardWrites = []
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async function (value) { clipboardWrites.push(value); document.body.dataset.clipboard = value } } })
  try {
    var instance = api.mountWEditor(document.getElementById('editor-target'), {
      document: { documentId: 'foreign-editor', markdown: ${JSON.stringify(editorFixture)}, serverRevision: 'server-1' },
      initialMode: 'visual',
      onReady: function () { document.body.dataset.ready = 'true' },
    })
    window.foreignEditor = instance
    window.foreignClipboardWrites = clipboardWrites
    document.body.dataset.mount = 'true'
  } catch (error) {
    document.body.dataset.error = error instanceof Error ? error.message : String(error)
  }
}
</script>${apiSource}</body></html>`
}

test.beforeAll(async () => {
  staticServer = createServer((request, response) => {
    const requestPath = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    const relativePath = decodeURIComponent(requestPath).replace(/^\//u, '')
    if (relativePath === 'editor-iframe-esm.html' || relativePath === 'editor-iframe-iife.html') {
      const entry = relativePath.endsWith('esm.html') ? 'esm' : 'iife'
      const origin = `http://${request.headers.host ?? '127.0.0.1'}`
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(editorPage(entry, origin))
      return
    }
    if (!relativePath.startsWith('packages/editor-web/dist/')) {
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
  if (address === null || typeof address === 'string') throw new Error('Editor iframe server did not expose a port.')
  staticOrigin = `http://127.0.0.1:${address.port}`
})

test.afterAll(async () => {
  if (staticServer === null) return
  await new Promise<void>((resolveServer, reject) => staticServer?.close((error) => error ? reject(error) : resolveServer()))
  staticServer = null
})

for (const entry of ['esm', 'iife'] as const) {
  test(`mounts the ${entry.toUpperCase()} Editor with real Visual content paths inside an iframe`, async ({ page }) => {
    test.setTimeout(60_000)
    const pageErrors: string[] = []
    const failedRequests: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('requestfailed', (request) => failedRequests.push(`${request.url()} :: ${request.failure()?.errorText ?? 'unknown'}`))
    await page.setContent(`<iframe id="consumer" src="${staticOrigin}/editor-iframe-${entry}.html"></iframe>`)
    const frame = page.frameLocator('#consumer')
    try {
      await expect(frame.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 })
    } catch (error) {
      const bodyState = await page.locator('#consumer').contentFrame().locator('body').evaluate((body) => ({
        attributes: Object.fromEntries(Array.from(body.attributes).map((attribute) => [attribute.name, attribute.value])),
        html: body.innerHTML,
      }))
      throw new Error(`${error instanceof Error ? error.message : String(error)}\niframe body: ${JSON.stringify(bodyState)}\npage errors: ${JSON.stringify(pageErrors)}\nfailed requests: ${JSON.stringify(failedRequests)}`, { cause: error })
    }

    const visual = frame.locator('[data-w-editor-surface="visual"]')
    await expect(visual.locator('.ProseMirror')).toHaveCount(1)
    await expect(visual.locator('[data-w-editor-node="formula"]')).toHaveCount(1)
    await expect(visual.locator('[data-w-editor-node="formula"] .formula-rendered')).toHaveCount(1)
    await expect(visual.locator('[data-w-editor-node="code-block"]')).toHaveCount(1)
    await expect(visual.locator('[data-w-editor-node="code-block"] code')).toHaveText('const answer = 42')
    await expect(visual.locator('[data-semantic-kind="chart-table"]')).toHaveCount(1)
    await expect(visual.locator('[data-semantic-kind="chart-table"] .semantic-preview__chart-rendered svg')).toHaveCount(1)
    await visual.locator('[data-semantic-copy="code-block"]').click()
    await expect(frame.locator('body')).toHaveAttribute('data-clipboard', 'const answer = 42')
    await expect(frame.locator('[data-w-editor-instance]')).toHaveAttribute('data-w-editor-profile', 'editor')
    await expect(frame.locator('[data-w-editor-instance]')).toHaveAttribute('data-w-editor-api-version', '1.0.0')
  })
}
