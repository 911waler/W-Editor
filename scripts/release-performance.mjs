/* global document, HTMLInputElement, HTMLTextAreaElement */

import { createHash } from 'node:crypto'
import { execFile, execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { extname, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

import { chromium } from 'playwright'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(import.meta.dirname, '..')
const rawPath = resolve(repositoryRoot, 'artifacts/release-governance/task-9-9-performance-raw.json')
const baselinePath = resolve(repositoryRoot, 'tests/fixtures/performance/performance-baseline.json')
const rawBaselinePath = resolve(repositoryRoot, 'tests/fixtures/performance/performance-raw.json')
const featureFixturePath = resolve(repositoryRoot, 'tests/fixtures/parity/w-editor-parity.md')
const representativeFixturePath = resolve(repositoryRoot, 'e2e/fixtures/documents/representative-long.md')
const approximately1MiBFixturePath = resolve(repositoryRoot, 'e2e/fixtures/documents/approximately-1mb.md')
const lifecycleEvidencePath = resolve(repositoryRoot, 'artifacts/release-governance/task-9-5-current-installer-lifecycle-rerun-20260829.json')
const manifestPath = resolve(repositoryRoot, 'artifacts/desktop/release-manifest.json')
const performanceBudgetsPath = resolve(repositoryRoot, 'release/performance-budgets.json')
const viewport = Object.freeze({ width: 1440, height: 1000 })
const deviceScaleFactor = 1
const COLD_SAMPLE_COUNT = 5
const ORDINARY_INPUT_SAMPLE_COUNT = 20
const IMPORT_SAMPLE_COUNT = 5
const DRAWIO_SAMPLE_COUNT = 5
const DESKTOP_STARTUP_SAMPLE_COUNT = 5
const HOST = '127.0.0.1'

function roundMs(value) {
  return Math.round(value * 100) / 100
}

function nearestRankP95(samples) {
  if (samples.length === 0) return null
  const ordered = [...samples].sort((left, right) => left - right)
  return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)]
}

function median(samples) {
  if (samples.length === 0) return null
  const ordered = [...samples].sort((left, right) => left - right)
  const middle = Math.floor(ordered.length / 2)
  return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle]
}

function metric(samples, unit = 'ms') {
  return {
    count: samples.length,
    max: samples.length === 0 ? null : roundMs(Math.max(...samples)),
    median: median(samples) === null ? null : roundMs(median(samples)),
    p95NearestRank: nearestRankP95(samples) === null ? null : roundMs(nearestRankP95(samples)),
    raw: samples.map(roundMs),
    unit,
  }
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase()
}

function fileRecord(path) {
  const absolutePath = resolve(path)
  return { path: relative(repositoryRoot, absolutePath).replaceAll('\\', '/'), bytes: statSync(absolutePath).size, sha256: sha256(absolutePath) }
}

function commandVersion(command, args) {
  try {
    const executable = process.platform === 'win32' && command === 'corepack' ? 'corepack.cmd' : command
    return execFileSync(executable, args, { cwd: repositoryRoot, encoding: 'utf8' }).trim()
  } catch {
    return 'unavailable'
  }
}

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

async function powershell(script) {
  const command = `${String.raw`$OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8;`}
${script}`
  const result = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  })
  return result.stdout.trim()
}

async function powershellJson(script) {
  const output = await powershell(script)
  if (output.length === 0) throw new Error('PowerShell performance helper returned no JSON.')
  return JSON.parse(output)
}

function runProcess(command, args, env = process.env) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd: repositoryRoot, env, stdio: 'inherit', windowsHide: true })
    child.once('error', rejectPromise)
    child.once('exit', (code) => code === 0 ? resolvePromise() : rejectPromise(new Error(`${command} ${args.join(' ')} exited with code ${String(code)}.`)))
  })
}

async function buildProduction() {
  if (process.platform === 'win32') await runProcess(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'corepack pnpm run build'])
  else await runProcess('corepack', ['pnpm', 'run', 'build'])
}

function contentType(path) {
  return {
    '.css': 'text/css; charset=utf-8',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ttf': 'font/ttf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  }[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

function safePath(path) {
  const candidate = resolve(repositoryRoot, `.${path}`)
  const relativePath = relative(repositoryRoot, candidate)
  return relativePath === '' || (!relativePath.startsWith('..') && !resolve(relativePath).startsWith('..')) ? candidate : null
}

const PERFORMANCE_MARKDOWN = readFileSync(featureFixturePath, 'utf8')
const PERFORMANCE_MARKDOWN_LITERAL = JSON.stringify(PERFORMANCE_MARKDOWN).replace(/<\//gu, '<\\/')

function publicHarnessHtml(entry) {
  const apiLoader = entry === 'esm'
    ? `<script type="module">import * as api from '/packages/editor-web/dist/editor.es.js'; window.__bootWEditorPerformance(api, 'esm')</script>`
    : `<script src="/packages/editor-web/dist/w-editor.global.js"></script><script>window.__bootWEditorPerformance(window.WEditor, 'iife')</script>`
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>W-Editor performance ${entry}</title><link rel="stylesheet" href="/packages/editor-web/dist/w-editor.css"></head>
<body><main><section id="editor"></section><section id="reader"></section></main>
<script>
window.__bootWEditorPerformance = function (api, selectedEntry) {
  var performanceState = { entry: selectedEntry, startedAt: performance.now(), editorReadyMs: null, readerReadyMs: null, done: false };
  var editorHost = document.querySelector('#editor');
  var readerHost = document.querySelector('#reader');
  var markdown = ${PERFORMANCE_MARKDOWN_LITERAL};
  window.__W_EDITOR_PERF__ = performanceState;
  if (!api || typeof api.mountWEditor !== 'function' || typeof api.mountWRenderer !== 'function') {
    performanceState.error = 'Public mount API is unavailable.';
    return;
  }
  var editorStarted = performance.now();
  var editor = api.mountWEditor(editorHost, { document: { documentId: 'release-performance-' + selectedEntry, markdown: markdown, serverRevision: 'release-performance-1' }, initialMode: 'visual', onReady: function () { performanceState.editorReadyMs = performance.now() - editorStarted; } });
  var readerStarted = performance.now();
  var reader = api.mountWRenderer(readerHost, { markdown: markdown, profile: 'reader', onReady: function () { performanceState.readerReadyMs = performance.now() - readerStarted; } });
  window.__W_EDITOR_PERF_INSTANCES__ = { editor: editor, reader: reader };
  var settle = function () {
    if (performanceState.editorReadyMs !== null && performanceState.readerReadyMs !== null && editorHost.querySelector('.ProseMirror') && readerHost.querySelector('[data-w-editor-renderer-content]')) {
      performanceState.done = true;
      performanceState.doneMs = performance.now() - performanceState.startedAt;
    } else {
      window.setTimeout(settle, 10);
    }
  };
  settle();
};
</script>${apiLoader}</body></html>`
}

function createPublicServer() {
  return createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${HOST}`)
    const path = decodeURIComponent(url.pathname)
    if (path === '/performance/esm.html' || path === '/performance/iife.html') {
      const entry = path.includes('iife') ? 'iife' : 'esm'
      response.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'text/html; charset=utf-8' })
      response.end(publicHarnessHtml(entry))
      return
    }
    const filePath = safePath(path)
    if (filePath === null || !existsSync(filePath) || !statSync(filePath).isFile()) {
      response.writeHead(404)
      response.end('not found')
      return
    }
    response.writeHead(200, { 'cache-control': 'no-store', 'content-type': contentType(filePath) })
    response.end(readFileSync(filePath))
  })
}

function listen(server) {
  return new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(0, HOST, () => {
      const address = server.address()
      if (address === null || typeof address === 'string') rejectPromise(new Error('Performance server did not expose a TCP port.'))
      else resolvePromise(address.port)
    })
  })
}

function closeServer(server) {
  return new Promise((resolvePromise) => server.close(() => resolvePromise()))
}

function startPreview(port) {
  const vite = resolve(repositoryRoot, 'node_modules/vite/bin/vite.js')
  const child = spawn(process.execPath, [vite, 'preview', '--host', HOST, '--port', String(port), '--strictPort'], { cwd: repositoryRoot, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let output = ''
  const collect = (chunk) => { output = `${output}${String(chunk)}`.slice(-12_000) }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  return { child, output: () => output }
}

async function waitForHttp(url, server, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) throw new Error(`Vite preview exited: ${server.output()}`)
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // The preview server is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error(`Timed out waiting for ${url}.`)
}

async function stopPreview(server) {
  if (server === null || server.child.exitCode !== null) return
  server.child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolvePromise) => server.child.once('exit', resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 3_000)),
  ])
  if (server.child.exitCode === null) server.child.kill('SIGKILL')
}

function instrumentPage(page, diagnostics, label) {
  page.on('console', (message) => { if (message.type() === 'error') diagnostics.push({ label, type: 'console', message: message.text() }) })
  page.on('pageerror', (error) => diagnostics.push({ label, type: 'pageerror', message: error.message }))
}

async function waitForPlaygroundReady(page, url) {
  await page.goto(`${url}/?performance=${Date.now()}-${Math.random()}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.locator('html[data-w-editor-ready="true"]').waitFor({ timeout: 90_000 })
  await page.locator('.workspace-shell').waitFor({ timeout: 30_000 })
}

async function measurePlaygroundFirstEditable(browser, previewUrl, diagnostics) {
  const samples = []
  for (let index = 0; index < COLD_SAMPLE_COUNT; index += 1) {
    const context = await browser.newContext({ deviceScaleFactor, viewport, locale: 'zh-CN' })
    const page = await context.newPage()
    instrumentPage(page, diagnostics, `playground-first-editable-${index + 1}`)
    const started = performance.now()
    try {
      await waitForPlaygroundReady(page, previewUrl)
      await page.locator('.ProseMirror[contenteditable="true"]').waitFor({ timeout: 90_000 })
      samples.push(roundMs(performance.now() - started))
    } finally {
      await context.close()
    }
  }
  return metric(samples)
}

async function measurePlaygroundOrdinaryInput(browser, previewUrl, diagnostics, mode) {
  const context = await browser.newContext({ deviceScaleFactor, viewport, locale: 'zh-CN' })
  const page = await context.newPage()
  instrumentPage(page, diagnostics, `playground-${mode}-ordinary-input`)
  try {
    await waitForPlaygroundReady(page, previewUrl)
    if (mode === 'source') {
      await page.locator('[data-command-id="mode.source"]').click()
      const editor = page.locator('#markdown-source-editor')
      await editor.waitFor({ timeout: 30_000 })
      await editor.fill('# Performance input\n\nWarmup')
      await editor.focus()
    } else {
      const editor = page.locator('.ProseMirror[contenteditable="true"]')
      await editor.focus()
      await page.keyboard.press('Control+End')
    }
    const samples = []
    for (let index = 0; index < ORDINARY_INPUT_SAMPLE_COUNT; index += 1) {
      await page.keyboard.press('Control+End')
      const token = ` performance-input-${mode}-${index}-${Date.now()}`
      const started = performance.now()
      await page.keyboard.insertText(token)
      if (mode === 'source') await page.waitForFunction((value) => { const node = document.querySelector('#markdown-source-editor'); const text = node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement ? node.value : node?.textContent ?? ''; return text.includes(value) }, token, { timeout: 30_000 })
      else await page.waitForFunction((value) => document.querySelector('.ProseMirror')?.textContent?.includes(value) === true, token, { timeout: 30_000 })
      samples.push(roundMs(performance.now() - started))
    }
    return metric(samples)
  } finally {
    await context.close()
  }
}

async function measurePlaygroundFinalRender(browser, previewUrl, diagnostics) {
  const samples = []
  for (let index = 0; index < COLD_SAMPLE_COUNT; index += 1) {
    const context = await browser.newContext({ deviceScaleFactor, viewport, locale: 'zh-CN' })
    const page = await context.newPage()
    instrumentPage(page, diagnostics, `playground-final-render-${index + 1}`)
    try {
      await waitForPlaygroundReady(page, previewUrl)
      await page.locator('[data-command-id="mode.source"]').click()
      await page.locator('#markdown-source-editor').fill(`# Final performance ${index}\n\nRendered content.`)
      const started = performance.now()
      await page.locator('[data-command-id="mode.preview"]').click()
      await page.locator('.preview-rendered-content').waitFor({ timeout: 90_000 })
      samples.push(roundMs(performance.now() - started))
    } finally {
      await context.close()
    }
  }
  return metric(samples)
}

async function measureImportedDocument(browser, previewUrl, fixturePath, fixture, marker, diagnostics) {
  const samples = []
  const details = []
  for (let index = 0; index < IMPORT_SAMPLE_COUNT; index += 1) {
    const context = await browser.newContext({ deviceScaleFactor, viewport, locale: 'zh-CN' })
    const page = await context.newPage()
    instrumentPage(page, diagnostics, `${fixture}-${index + 1}`)
    try {
      await waitForPlaygroundReady(page, previewUrl)
      const started = performance.now()
      await page.getByTestId('import-markdown-input').setInputFiles(fixturePath)
      const confirmation = page.getByTestId('document-lifecycle-confirmation')
      await confirmation.waitFor({ state: 'visible', timeout: 30_000 })
      await confirmation.getByTestId('document-lifecycle-confirm').click()
      await confirmation.waitFor({ state: 'detached', timeout: 30_000 })
      if (await page.getByTestId('editor-surface').getAttribute('data-mode') !== 'source') await page.locator('[data-command-id="mode.source"]').click()
      const source = page.locator('.cm-content[contenteditable="true"]')
      await source.waitFor({ timeout: 120_000 })
      await page.waitForFunction((value) => document.querySelector('.cm-content')?.textContent?.includes(value) === true, marker, { timeout: 120_000 })
      const milliseconds = roundMs(performance.now() - started)
      samples.push(milliseconds)
      details.push({ sample: index + 1, milliseconds, markerObserved: true })
    } finally {
      await context.close()
    }
  }
  return { fixture, bytes: statSync(fixturePath).size, samples: details, summary: metric(samples) }
}

async function measurePublicCold(browser, baseUrl, entry, diagnostics) {
  const editorSamples = []
  const readerSamples = []
  const wallSamples = []
  const details = []
  for (let index = 0; index < COLD_SAMPLE_COUNT; index += 1) {
    const context = await browser.newContext({ deviceScaleFactor, viewport, locale: 'zh-CN' })
    const page = await context.newPage()
    instrumentPage(page, diagnostics, `web-${entry}-${index + 1}`)
    const started = performance.now()
    try {
      await page.goto(`${baseUrl}/performance/${entry}.html?sample=${index + 1}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.waitForFunction(() => globalThis.__W_EDITOR_PERF__?.done === true, null, { timeout: 120_000 })
      const state = await page.evaluate(() => ({ ...globalThis.__W_EDITOR_PERF__ }))
      const wallClockMs = roundMs(performance.now() - started)
      editorSamples.push(state.editorReadyMs)
      readerSamples.push(state.readerReadyMs)
      wallSamples.push(wallClockMs)
      details.push({ sample: index + 1, ...state, wallClockMs })
      await page.evaluate(async () => { const instances = globalThis.__W_EDITOR_PERF_INSTANCES__; if (instances) await Promise.all([instances.editor.destroy(), instances.reader.destroy()]) })
    } finally {
      await context.close()
    }
  }
  return { entry, editor: metric(editorSamples), reader: metric(readerSamples), wallClock: metric(wallSamples), samples: details }
}

function isDrawioRequest(url) {
  return /drawio|cherry-drawio/iu.test(url)
}

function isDrawioLazyPayloadRequest(url) {
  return /\/drawio-bridge\.html(?:[?#]|$)|\/vendor\/cherry-drawio\//iu.test(url)
}

function isSameOrigin(url, origin) {
  try {
    return new URL(url).origin === origin
  } catch {
    return false
  }
}

async function measureDrawioLazyLoad(browser, previewUrl, diagnostics) {
  const previewOrigin = new URL(previewUrl).origin
  const samples = []
  for (let index = 0; index < DRAWIO_SAMPLE_COUNT; index += 1) {
    const context = await browser.newContext({ deviceScaleFactor, viewport, locale: 'zh-CN' })
    const page = await context.newPage()
    instrumentPage(page, diagnostics, `drawio-lazy-${index + 1}`)
    const requests = []
    page.on('request', (request) => { if (isDrawioRequest(request.url())) requests.push({ url: request.url(), at: performance.now() }) })
    try {
      await waitForPlaygroundReady(page, previewUrl)
      const preOpenRequests = requests.filter(({ url }) => isDrawioLazyPayloadRequest(url))
      const initialRequests = preOpenRequests.length
      const started = performance.now()
      await page.locator('[data-command-id="insert.drawio"]').first().click()
      const dialog = page.locator('[data-editor-command="insert.drawio"]')
      await dialog.waitFor({ state: 'visible', timeout: 30_000 })
      const bridge = page.frameLocator('[data-testid="drawio-bridge-frame"]')
      // draw.io keeps its body hidden while EditorUi bootstraps. The menubar is
      // the same concrete readiness marker used by the installed-package
      // lifecycle smoke, so waiting for the body itself would create a false
      // timeout even after the runtime has loaded its offline resources.
      await bridge.frameLocator('#drawio-editor').locator('.geMenubarContainer').waitFor({ state: 'visible', timeout: 120_000 })
      const readyMs = roundMs(performance.now() - started)
      const loadedRequests = requests.filter(({ url, at }) => at >= started && isDrawioRequest(url))
      await dialog.locator('.drawio-dialog__actions button').first().click()
      await dialog.waitFor({ state: 'detached', timeout: 30_000 })
      samples.push({ sample: index + 1, readyMs, initialRequests, initialRequestUrls: preOpenRequests.map(({ url }) => url), loadedRequests: loadedRequests.map(({ url, at }) => ({ url, afterOpenMs: roundMs(at - started) })), resourceCount: loadedRequests.length, externalResources: loadedRequests.filter(({ url }) => !isSameOrigin(url, previewOrigin)).map(({ url }) => url) })
    } finally {
      await context.close()
    }
  }
  return { samples, summary: metric(samples.map(({ readyMs }) => readyMs)) }
}

async function measureDesktopStartup(executable, sample, profileRoot) {
  const script = [String.raw`
$ErrorActionPreference = 'Stop'
$desktopPath = ${psQuote(executable)}
$profilePath = ${psQuote(profileRoot)}
$env:APPDATA = $profilePath
$env:LOCALAPPDATA = $profilePath
$existing = @(Get-CimInstance Win32_Process -Filter "Name='w-editor-desktop.exe'" | Where-Object { $_.ExecutablePath -ieq $desktopPath })
if ($existing.Count -gt 0) { throw "Desktop process already exists before startup sample $(${sample})." }
$watch = [Diagnostics.Stopwatch]::StartNew()
$started = Start-Process -FilePath $desktopPath -PassThru
$ready = $null
try {
  while ($watch.Elapsed.TotalSeconds -lt 90) {
    $candidate = Get-Process -Id $started.Id -ErrorAction SilentlyContinue
    if ($null -ne $candidate -and $candidate.MainWindowHandle -ne 0 -and $candidate.MainWindowTitle -match 'W-Editor') { $ready = $candidate; break }
    Start-Sleep -Milliseconds 75
  }
  if ($null -eq $ready) { throw "Desktop startup did not expose a W-Editor main window within 90 seconds." }
  $watch.Stop()
  [pscustomobject]@{ status = 'passed'; sample = ${sample}; processId = $ready.Id; title = $ready.MainWindowTitle; milliseconds = [Math]::Round($watch.Elapsed.TotalMilliseconds, 2); profilePath = $profilePath } | ConvertTo-Json -Compress
}
finally {
  if ($null -ne $started -and (Get-Process -Id $started.Id -ErrorAction SilentlyContinue)) { Stop-Process -Id $started.Id -Force -ErrorAction SilentlyContinue }
}
`].join('\n')
  return powershellJson(script)
}

async function measureDesktopStartups(executable, diagnostics) {
  const samples = []
  for (let index = 0; index < DESKTOP_STARTUP_SAMPLE_COUNT; index += 1) {
    const profileRoot = resolve(repositoryRoot, '.tmp', `release-performance-desktop-${process.pid}-${index + 1}`)
    try {
      samples.push(await measureDesktopStartup(executable, index + 1, profileRoot))
    } catch (error) {
      diagnostics.push({ label: `desktop-startup-${index + 1}`, type: 'measurement', message: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }
  return { samples, summary: metric(samples.map(({ milliseconds }) => milliseconds)) }
}

function budget(metricValue, frozenBudget, label) {
  if (metricValue.p95NearestRank === null) return { label, status: 'failed', limitMs: null, observedP95Ms: null, basis: 'No raw samples were recorded.' }
  if (!Number.isInteger(frozenBudget?.limitMs)) return { label, status: 'failed', limitMs: null, observedP95Ms: metricValue.p95NearestRank, basis: 'Frozen performance budget is missing or invalid.' }
  return { label, status: 'frozen', limitMs: frozenBudget.limitMs, observedP95Ms: metricValue.p95NearestRank, basis: frozenBudget.basis }
}

function artifactRecords(manifest) {
  return Object.fromEntries(['webZip', 'nsis', 'msi'].map((key) => {
    const record = manifest.artifacts[key]
    const path = resolve(record.path)
    const actual = fileRecord(path)
    if (actual.bytes !== record.bytes || actual.sha256 !== record.sha256) throw new Error(`${key} does not match the current release manifest.`)
    return [key, { ...actual, manifestPath: record.path }]
  }))
}

async function main() {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const lifecycle = JSON.parse(readFileSync(lifecycleEvidencePath, 'utf8'))
  const frozenBudgets = JSON.parse(readFileSync(performanceBudgetsPath, 'utf8'))
  if (frozenBudgets.change !== 'dual-target-release' || frozenBudgets.task !== '9.9') throw new Error('Frozen performance budget identity is invalid.')
  const executable = join(lifecycle.lifecycleRoot, 'msi', 'install', 'w-editor-desktop.exe')
  const diagnostics = []
  const report = {
    schemaVersion: 1,
    change: 'dual-target-release',
    task: '9.9',
    generatedAt: new Date().toISOString(),
    status: 'failed',
    capturedAt: new Date().toISOString(),
    policy: {
      coldSamples: COLD_SAMPLE_COUNT,
      ordinaryInputSamples: ORDINARY_INPUT_SAMPLE_COUNT,
      importSamples: IMPORT_SAMPLE_COUNT,
      drawioSamples: DRAWIO_SAMPLE_COUNT,
      desktopStartupSamples: DESKTOP_STARTUP_SAMPLE_COUNT,
      viewport,
      deviceScaleFactor,
      budget: 'Use the existing Phase 0 observed P95 × 1.25 policy where a comparable metric exists; new metrics freeze their first controlled current P95 × 1.25. Package-size budgets freeze the current verified manifest bytes. No old baseline is overwritten and no threshold is relaxed.',
    },
    environment: {
      node: process.version,
      pnpm: commandVersion('corepack', ['pnpm', '--version']),
      gitHead: commandVersion('git', ['rev-parse', 'HEAD']),
      workingTreeStatus: commandVersion('git', ['status', '--short']),
      browser: 'Playwright bundled Chromium',
      browserVersion: null,
      preview: { root: 'dist', url: null },
      buildCommand: 'corepack pnpm run build',
      seam: null,
      phase0Baseline: { summary: fileRecord(baselinePath), raw: fileRecord(rawBaselinePath) },
    },
    inputs: {
      featureFixture: fileRecord(featureFixturePath),
      representativeLongFixture: fileRecord(representativeFixturePath),
      approximately1MiBFixture: fileRecord(approximately1MiBFixturePath),
      releaseManifest: fileRecord(manifestPath),
      performanceBudgets: fileRecord(performanceBudgetsPath),
      lifecycleRoot: lifecycle.lifecycleRoot,
    },
    measurements: {},
    budgets: {},
    artifacts: null,
    diagnostics,
    error: null,
  }
  let preview = null
  let publicServer = null
  let browser = null
  try {
    if (lifecycle.status !== 'passed') throw new Error('Current installer lifecycle evidence is not passed.')
    if (!existsSync(executable)) throw new Error(`Current installed MSI executable is missing: ${executable}`)
    await buildProduction()
    report.environment.seam = execFileSync(process.execPath, ['scripts/verify-e2e-build-seam.mjs', 'absent'], { cwd: repositoryRoot, encoding: 'utf8' }).trim()
    publicServer = createPublicServer()
    const publicPort = await listen(publicServer)
    const publicUrl = `http://${HOST}:${publicPort}`
    preview = startPreview(4500 + (process.pid % 300))
    const previewUrl = `http://${HOST}:${4500 + (process.pid % 300)}`
    await waitForHttp(`${previewUrl}/`, preview)
    report.environment.preview.url = previewUrl
    browser = await chromium.launch({ headless: true })
    report.environment.browserVersion = browser.version()

    report.measurements.web = {
      esm: await measurePublicCold(browser, publicUrl, 'esm', diagnostics),
      iife: await measurePublicCold(browser, publicUrl, 'iife', diagnostics),
    }
    report.measurements.playground = {
      firstEditable: await measurePlaygroundFirstEditable(browser, previewUrl, diagnostics),
      ordinaryInputSource: await measurePlaygroundOrdinaryInput(browser, previewUrl, diagnostics, 'source'),
      ordinaryInputVisual: await measurePlaygroundOrdinaryInput(browser, previewUrl, diagnostics, 'visual'),
      finalRender: await measurePlaygroundFinalRender(browser, previewUrl, diagnostics),
    }
    report.measurements.documents = {
      representativeLong: await measureImportedDocument(browser, previewUrl, representativeFixturePath, 'representativeLong', '# Representative long W-Editor document', diagnostics),
      approximately1MiB: await measureImportedDocument(browser, previewUrl, approximately1MiBFixturePath, 'approximately1MiB', '# Approximately one megabyte diagnostic document', diagnostics),
    }
    report.measurements.drawioLazyLoad = await measureDrawioLazyLoad(browser, previewUrl, diagnostics)
    report.measurements.desktopStartup = await measureDesktopStartups(executable, diagnostics)
    report.artifacts = artifactRecords(manifest)

    report.budgets = {
      'web.esm.editor': budget(report.measurements.web.esm.editor, frozenBudgets.latency['web.esm.editor'], 'Web ESM editor cold mount'),
      'web.esm.reader': budget(report.measurements.web.esm.reader, frozenBudgets.latency['web.esm.reader'], 'Web ESM Reader cold mount'),
      'web.iife.editor': budget(report.measurements.web.iife.editor, frozenBudgets.latency['web.iife.editor'], 'Web IIFE editor cold mount'),
      'web.iife.reader': budget(report.measurements.web.iife.reader, frozenBudgets.latency['web.iife.reader'], 'Web IIFE Reader cold mount'),
      'playground.firstEditable': budget(report.measurements.playground.firstEditable, frozenBudgets.latency['playground.firstEditable'], 'Playground first editable'),
      'playground.ordinaryInputSource': budget(report.measurements.playground.ordinaryInputSource, frozenBudgets.latency['playground.ordinaryInputSource'], 'Playground ordinary source input P95'),
      'playground.ordinaryInputVisual': budget(report.measurements.playground.ordinaryInputVisual, frozenBudgets.latency['playground.ordinaryInputVisual'], 'Playground ordinary visual input P95'),
      'playground.finalRender': budget(report.measurements.playground.finalRender, frozenBudgets.latency['playground.finalRender'], 'Playground Final render'),
      'documents.representativeLong': budget(report.measurements.documents.representativeLong.summary, frozenBudgets.latency['documents.representativeLong'], 'Representative long document import'),
      'documents.approximately1MiB': budget(report.measurements.documents.approximately1MiB.summary, frozenBudgets.latency['documents.approximately1MiB'], 'Approximately 1 MiB document import'),
      'drawio.lazyLoad': budget(report.measurements.drawioLazyLoad.summary, frozenBudgets.latency['drawio.lazyLoad'], 'draw.io first-use lazy load'),
      'desktop.startup': budget(report.measurements.desktopStartup.summary, frozenBudgets.latency['desktop.startup'], 'Installed Desktop startup to visible main window'),
    }
    report.budgets.packageSize = Object.fromEntries(Object.entries(report.artifacts).map(([key, record]) => {
      const frozen = frozenBudgets.packageSize[key]
      return [key, { status: 'frozen', limitBytes: frozen?.limitBytes ?? null, observedBytes: record.bytes, sha256: frozen?.sha256 ?? null, basis: 'Frozen to the verified package bytes and hash recorded by release/performance-budgets.json.' }]
    }))
    if (diagnostics.length > 0) throw new Error(`Performance sampling produced browser diagnostics: ${JSON.stringify(diagnostics)}`)
    report.status = 'completed'
  } catch (error) {
    report.error = error instanceof Error ? error.stack ?? error.message : String(error)
  } finally {
    if (browser !== null) await browser.close()
    if (publicServer !== null) await closeServer(publicServer)
    await stopPreview(preview)
    await mkdir(resolve(rawPath, '..'), { recursive: true })
    await writeFile(rawPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }
  console.log(JSON.stringify({ status: report.status, rawPath: 'artifacts/release-governance/task-9-9-performance-raw.json', error: report.error }, null, 2))
  if (report.status !== 'completed') process.exitCode = 1
}

await main()
