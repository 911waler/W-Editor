import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, isAbsolute, relative, resolve } from 'node:path'

import { chromium } from 'playwright'

const repositoryRoot = resolve(import.meta.dirname, '..')
const featureManifestPath = resolve(repositoryRoot, 'tests/fixtures/manifests/feature-manifest.json')
const featureManifest = JSON.parse(readFileSync(featureManifestPath, 'utf8'))
const parityFixture = resolve(repositoryRoot, 'tests/fixtures/parity/w-editor-parity.md')
const desktopEvidencePath = resolve(repositoryRoot, 'artifacts/release-governance/task-9-5-current-feature-matrix-rerun-20260829.json')
const outputPath = resolve(repositoryRoot, 'artifacts/release-governance/task-9-6-current-verification.json')

function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

function contentType(path) {
  return {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  }[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

function safePath(path) {
  const candidate = resolve(repositoryRoot, `.${path}`)
  const relativePath = relative(repositoryRoot, candidate)
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath)) ? candidate : null
}

function createStaticServer() {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const path = decodeURIComponent(url.pathname)
    const filePath = safePath(path === '/' ? '/dist/index.html' : path)
    if (filePath === null || !existsSync(filePath)) {
      response.writeHead(404)
      response.end('not found')
      return
    }
    response.writeHead(200, { 'cache-control': 'no-store', 'content-type': contentType(filePath) })
    response.end(readFileSync(filePath))
  })
  return server
}

function listen(server) {
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') reject(new Error('Parity server did not expose a TCP port.'))
      else resolvePromise(address.port)
    })
  })
}

function closeServer(server) {
  return new Promise((resolvePromise) => server.close(() => resolvePromise()))
}

async function waitForHttp(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // The preview server is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error(`Timed out waiting for ${url}.`)
}

function startPreview(port) {
  const command = `corepack pnpm exec vite preview --host 127.0.0.1 --port ${port} --strictPort`
  return spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', command], { cwd: repositoryRoot, stdio: 'ignore', windowsHide: true })
}

async function runBuiltWeb(browser, baseUrl, entry) {
  const page = await browser.newPage()
  const consoleErrors = []
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  try {
    await page.goto(`${baseUrl}/examples/web-consumer/feature-parity-${entry}.html`, { waitUntil: 'networkidle', timeout: 60000 })
    try {
      await page.waitForFunction(() => globalThis.document.querySelector('[data-feature-parity-status]')?.dataset.featureParityStatus === 'passed' || globalThis.document.querySelector('[data-feature-parity-status]')?.dataset.featureParityStatus === 'failed', null, { timeout: 60000 })
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({
        status: globalThis.document.querySelector('[data-feature-parity-status]')?.dataset.featureParityStatus ?? 'missing',
        text: globalThis.document.querySelector('[data-feature-parity-status]')?.textContent ?? '',
        editorChildren: globalThis.document.querySelector('[data-feature-parity-editor]')?.children.length ?? 0,
        readerChildren: globalThis.document.querySelector('[data-feature-parity-reader]')?.children.length ?? 0,
      }))
      throw new Error(`Built Web ${entry} page did not report parity status: ${JSON.stringify({ diagnostic, consoleErrors, error: error instanceof Error ? error.message : String(error) })}`, { cause: error })
    }
    const result = await page.evaluate(() => globalThis.__W_EDITOR_FEATURE_PARITY__)
    requireCondition(result?.status === 'passed', `Built Web ${entry} parity failed: ${JSON.stringify(result)}`)
    requireCondition(consoleErrors.length === 0, `Built Web ${entry} emitted browser errors: ${JSON.stringify(consoleErrors)}`)
    return result
  } finally {
    await page.close()
  }
}

function semanticKey(value) {
  return JSON.stringify({
    code: value?.code ?? [],
    headings: value?.headings ?? [],
    images: value?.images ?? 0,
    links: value?.links ?? [],
    svg: value?.svg ?? 0,
    tables: value?.tables ?? 0,
    text: value?.text ?? '',
  })
}

async function runPlayground(browser, previewUrl) {
  const page = await browser.newPage()
  const consoleErrors = []
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  try {
    await page.goto(previewUrl, { waitUntil: 'networkidle', timeout: 60000 })
    await page.locator('[data-testid="import-markdown-input"]').setInputFiles(parityFixture)
    const confirmation = page.getByTestId('document-lifecycle-confirmation')
    await confirmation.waitFor({ state: 'visible', timeout: 30000 })
    requireCondition(await confirmation.getAttribute('data-confirmation-kind') === 'import', 'Playground import confirmation kind is not import.')
    await confirmation.getByTestId('document-lifecycle-confirm').click()
    await confirmation.waitFor({ state: 'detached', timeout: 30000 })
    try {
      await page.waitForFunction(() => (globalThis.document.querySelector('.ProseMirror')?.textContent ?? '').includes('W-Editor parity fixture') || (globalThis.document.querySelector('#markdown-source-editor')?.value ?? '').includes('W-Editor parity fixture'), null, { timeout: 30000 })
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({
        title: globalThis.document.title,
        documentId: globalThis.document.querySelector('.workspace-shell')?.getAttribute('data-document-id') ?? '',
        articleTitle: globalThis.document.querySelector('.workspace-controls__meta span')?.textContent ?? '',
        errors: [...globalThis.document.querySelectorAll('.workspace-error')].map((node) => node.textContent?.trim() ?? '').filter(Boolean),
        lifecycleError: globalThis.document.querySelector('[data-testid="document-lifecycle-error"]')?.textContent?.trim() ?? '',
        lifecycleFeedback: globalThis.document.querySelector('[data-testid="document-lifecycle-feedback"]')?.textContent?.trim() ?? '',
        importFiles: globalThis.document.querySelector('[data-testid="import-markdown-input"]')?.files?.length ?? 0,
        sourceValue: globalThis.document.querySelector('#markdown-source-editor')?.value?.slice(0, 120) ?? '',
        visualValue: globalThis.document.querySelector('.ProseMirror')?.textContent?.slice(0, 120) ?? '',
        bodyText: globalThis.document.body.textContent?.slice(0, 500) ?? '',
      }))
      throw new Error(`Playground parity import did not complete: ${JSON.stringify({ diagnostic, consoleErrors, error: error instanceof Error ? error.message : String(error) })}`, { cause: error })
    }
    await page.locator('[data-command-id="mode.preview"]').click()
    const content = page.locator('.preview-rendered-content.ProseMirror[data-presentation-engine="tiptap"]')
    await content.waitFor({ state: 'visible', timeout: 30000 })
    const semantic = await content.evaluate((root) => {
      const clone = root.cloneNode(true)
      clone.querySelectorAll('style, script, [data-semantic-edit], [data-raw-edit], .visual-code-block__language, .table-node-view__handle, .table-node-view__menu, .table-cell-selection-overlay').forEach((node) => node.remove())
      const normalize = (value) => value.replace(/\s+/gu, ' ').trim()
      return {
        code: [...clone.querySelectorAll('pre > code')].map((node) => node.textContent ?? ''),
        headings: [...clone.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((node) => `${node.tagName}:${normalize(node.textContent ?? '')}`),
        images: clone.querySelectorAll('img').length,
        links: [...clone.querySelectorAll('a')].map((node) => normalize(node.textContent ?? '')),
        svg: clone.querySelectorAll('svg').length,
        tables: clone.querySelectorAll('table').length,
        text: normalize(clone.textContent ?? ''),
      }
    })
    const commands = await page.locator('[data-command-id]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-command-id')).filter(Boolean))
    requireCondition(consoleErrors.length === 0, `Playground emitted browser errors: ${JSON.stringify(consoleErrors)}`)
    return { status: 'passed', commands, semantic }
  } finally {
    await page.close()
  }
}

function readDesktopEvidence() {
  requireCondition(existsSync(desktopEvidencePath), `Desktop feature evidence is missing: ${desktopEvidencePath}`)
  const value = JSON.parse(readFileSync(desktopEvidencePath, 'utf8'))
  requireCondition(value.status === 'passed', 'Desktop feature evidence is not passed.')
  requireCondition(value.featureManifest?.expectedCommandCount === featureManifest.commands.count, 'Desktop expected command count differs from the feature manifest.')
  requireCondition(value.featureManifest?.runtimeCommandCount === featureManifest.commands.count && value.featureManifest?.missingCommands?.length === 0, 'Desktop runtime command inventory is incomplete.')
  return {
    status: 'passed',
    commands: featureManifest.commands.ids,
    semantic: value.readerFinalParity?.finalSemantic,
    readerSemantic: value.readerFinalParity?.readerSemantic,
    browserVersion: value.browserVersion,
    sourceEvidence: 'artifacts/release-governance/task-9-5-current-feature-matrix-rerun-20260829.json',
  }
}

const checks = []
let server = null
let preview = null
try {
  requireCondition(featureManifest.change === 'dual-target-release' && featureManifest.schemaVersion === 1, 'Feature manifest identity is invalid.')
  requireCondition(Array.isArray(featureManifest.commands?.ids) && featureManifest.commands.ids.length === featureManifest.commands.count, 'Feature manifest commands are incomplete.')
  requireCondition(Array.isArray(featureManifest.platformExceptions) && featureManifest.platformExceptions.length > 0 && featureManifest.platformExceptions.every(({ id, capability, validation }) => id && capability && validation), 'Feature manifest platform exceptions are incomplete.')
  server = createStaticServer()
  const staticPort = await listen(server)
  const baseUrl = `http://127.0.0.1:${staticPort}`
  const browser = await chromium.launch({ headless: true })
  try {
    const esm = await runBuiltWeb(browser, baseUrl, 'esm')
    const iife = await runBuiltWeb(browser, baseUrl, 'iife')
    const previewPort = 4700 + (process.pid % 300)
    preview = startPreview(previewPort)
    await waitForHttp(`http://127.0.0.1:${previewPort}/`)
    const playground = await runPlayground(browser, `http://127.0.0.1:${previewPort}/`)
    const desktop = readDesktopEvidence()
    const expected = featureManifest.commands.ids
    const targetResults = { webEsm: esm, webIife: iife, playground, desktop }
    const commandParity = Object.fromEntries(Object.entries(targetResults).map(([target, value]) => [target, expected.every((id) => value.commands.includes(id)) && new Set(value.commands).size === expected.length]))
    const commandIdsEqual = Object.values(commandParity).every(Boolean)
    requireCondition(commandIdsEqual, `Feature command parity failed: ${JSON.stringify(commandParity)}`)
    const semanticValues = [esm.finalSemantic, esm.readerSemantic, iife.finalSemantic, iife.readerSemantic, playground.semantic, desktop.semantic, desktop.readerSemantic]
    const baselineSemantic = semanticKey(semanticValues[0])
    const contentSemanticEqual = semanticValues.every((value) => semanticKey(value) === baselineSemantic)
    requireCondition(contentSemanticEqual, `Feature content semantic parity failed across targets: ${JSON.stringify({
      webEsmFinal: semanticKey(esm.finalSemantic),
      webEsmReader: semanticKey(esm.readerSemantic),
      webIifeFinal: semanticKey(iife.finalSemantic),
      webIifeReader: semanticKey(iife.readerSemantic),
      playground: semanticKey(playground.semantic),
      desktopFinal: semanticKey(desktop.semantic),
      desktopReader: semanticKey(desktop.readerSemantic),
    })}`)
    for (const [target, value] of Object.entries(targetResults)) requireCondition(value.status === 'passed', `${target} did not report passed.`)
    checks.push({ name: 'feature-manifest-command-parity', status: 'passed', expectedCommandCount: expected.length, commandParity })
    checks.push({ name: 'content-semantic-parity', status: 'passed', targetCount: Object.keys(targetResults).length })
    checks.push({ name: 'platform-exceptions', status: 'passed', count: featureManifest.platformExceptions.length })
    const result = {
      schemaVersion: 1,
      change: 'dual-target-release',
      task: '9.6',
      status: 'passed',
      browser: 'Playwright bundled Chromium',
      browserVersion: browser.version(),
      featureManifest: {
        path: 'tests/fixtures/manifests/feature-manifest.json',
        commandCount: featureManifest.commands.count,
        componentCount: featureManifest.components.count,
      },
      targets: targetResults,
      parity: { commandIdsEqual, contentSemanticEqual },
      platformExceptions: featureManifest.platformExceptions,
      checks,
      notExecuted: ['9.7-9.11'],
    }
    writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify(result, null, 2))
  } finally {
    await browser.close()
  }
} catch (error) {
  const result = {
    schemaVersion: 1,
    change: 'dual-target-release',
    task: '9.6',
    status: 'failed',
    checks,
    error: error instanceof Error ? error.message : String(error),
    notExecuted: ['remaining 9.6 targets', '9.7-9.11'],
  }
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.error(JSON.stringify(result, null, 2))
  process.exitCode = 1
} finally {
  if (preview !== null) preview.kill()
  if (server !== null) await closeServer(server)
}
