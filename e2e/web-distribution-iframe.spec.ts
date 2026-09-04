import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { extname, resolve, sep } from 'node:path'

import { expect, test } from '@playwright/test'

const repositoryRoot = resolve(process.cwd())
let staticServer: Server | null = null
let staticOrigin = ''

test.beforeAll(async () => {
  staticServer = createServer((request, response) => {
    const requestPath = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    const relativePath = decodeURIComponent(requestPath).replace(/^\//u, '')
    if (relativePath === 'iframe-esm.html' || relativePath === 'iframe-iife.html') {
      const origin = `http://${request.headers.host ?? '127.0.0.1'}`
      const entry = relativePath === 'iframe-esm.html' ? 'esm' : 'iife'
      const body = entry === 'esm'
        ? `<script>document.body.dataset.script = 'started'</script><script type="module">import * as api from '${origin}/packages/editor-web/dist/renderer.es.js'; try { const target = document.createElement('section'); document.body.append(target); const instance = api.mountWRenderer(target, { markdown: '# Iframe ${entry}', profile: 'reader' }); document.body.dataset.ready = 'true'; document.body.dataset.markdown = instance.snapshot().markdown; window.setTimeout(async () => { await instance.destroy(); document.body.dataset.destroyed = 'true'; }, 0) } catch (error) { document.body.dataset.error = String(error); console.error(error) }</script>`
        : `<script>document.body.dataset.script = 'started'</script><script src="${origin}/packages/editor-web/dist/w-editor.global.js"></script><script>try { const target = document.createElement('section'); document.body.append(target); const instance = WEditor.mountWRenderer(target, { markdown: '# Iframe ${entry}', profile: 'reader' }); document.body.dataset.ready = 'true'; document.body.dataset.markdown = instance.snapshot().markdown; window.setTimeout(async () => { await instance.destroy(); document.body.dataset.destroyed = 'true'; }, 0) } catch (error) { document.body.dataset.error = String(error); console.error(error) }</script>`
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<!doctype html><html><body>${body}</body></html>`)
      return
    }
    if (!relativePath.startsWith('packages/editor-web/dist/')) {
      response.writeHead(404).end()
      return
    }
    const filePath = resolve(repositoryRoot, relativePath)
    if (!filePath.startsWith(`${repositoryRoot}${sep}`) || !existsSync(filePath) || !statSync(filePath).isFile()) {
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
  if (address === null || typeof address === 'string') throw new Error('Iframe static server did not expose a port.')
  staticOrigin = `http://127.0.0.1:${address.port}`
})

test.afterAll(async () => {
  if (staticServer === null) return
  await new Promise<void>((resolveServer, reject) => staticServer?.close((error) => error ? reject(error) : resolveServer()))
  staticServer = null
})

for (const entry of ['esm', 'iife'] as const) {
  test(`mounts the ${entry.toUpperCase()} distribution inside an iframe realm`, async ({ page }) => {
    test.setTimeout(60_000)
    const pageErrors: string[] = []
    const failedRequests: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('requestfailed', (request) => failedRequests.push(`${request.url()} :: ${request.failure()?.errorText ?? 'unknown'}`))
    await page.setContent(`
      <!doctype html>
      <html><body><p id="parent-sentinel">parent</p><iframe id="consumer" src="${staticOrigin}/iframe-${entry}.html"></iframe></body></html>
    `)
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
    await expect(frame.locator('body')).toHaveAttribute('data-markdown', `# Iframe ${entry}`)
    await expect(frame.locator('body')).toHaveAttribute('data-destroyed', 'true', { timeout: 30_000 })
    await expect(page.locator('#parent-sentinel')).toHaveText('parent')
    expect(await page.locator('body > [data-w-editor-instance]').count()).toBe(0)
  })
}
