/* global document, HTMLInputElement, HTMLTextAreaElement */

import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { extname, isAbsolute, relative, resolve } from 'node:path'

import { chromium } from 'playwright'

const repositoryRoot = resolve(import.meta.dirname, '..')
const featureFixturePath = resolve(repositoryRoot, 'tests/fixtures/parity/w-editor-parity.md')
const representativeFixturePath = resolve(repositoryRoot, 'e2e/fixtures/documents/representative-long.md')
const performanceBudgetsPath = resolve(repositoryRoot, 'release/performance-budgets.json')
const viewport = Object.freeze({ width: 1440, height: 1000 })
const deviceScaleFactor = 1
const HOST = '127.0.0.1'
const SUPPORTED_METRICS = Object.freeze([
  'reader',
  'source-input',
  'first-editable',
  'representative-long',
])

function argument(name) {
  return process.argv.slice(2).find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
}

function hasFlag(name) {
  return process.argv.slice(2).includes(`--${name}`)
}

function positiveInteger(value, fallback) {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`--samples must be a positive integer; received ${value}.`)
  return parsed
}

const selectedMetric = argument('metric')
if (!SUPPORTED_METRICS.includes(selectedMetric)) {
  console.error(`Usage: corepack pnpm run test:release-performance-focused -- --metric=${SUPPORTED_METRICS.join('|')} [--samples=N] [--skip-build] [--output=path]`)
  process.exit(2)
}

const officialSampleCounts = Object.freeze({
  'first-editable': 5,
  'reader': 5,
  'representative-long': 5,
  'source-input': 20,
})
const sampleCount = positiveInteger(argument('samples'), officialSampleCounts[selectedMetric])
const cpuProfilePath = argument('cpu-profile') === undefined
  ? null
  : resolve(repositoryRoot, argument('cpu-profile'))
const rawPath = resolve(
  repositoryRoot,
  argument('output') ?? `artifacts/release-governance/performance-remediation-${selectedMetric}-focused-raw.json`,
)
const frozenBudgets = JSON.parse(readFileSync(performanceBudgetsPath, 'utf8'))

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

function metric(samples) {
  return Object.freeze({
    count: samples.length,
    max: samples.length === 0 ? null : roundMs(Math.max(...samples)),
    median: samples.length === 0 ? null : roundMs(median(samples)),
    p95NearestRank: samples.length === 0 ? null : roundMs(nearestRankP95(samples)),
    raw: Object.freeze(samples.map(roundMs)),
    unit: 'ms',
  })
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase()
}

function fileRecord(path) {
  return Object.freeze({
    bytes: statSync(path).size,
    path: relative(repositoryRoot, path).replaceAll('\\', '/'),
    sha256: sha256(path),
  })
}

function runProcess(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    })
    child.once('error', rejectPromise)
    child.once('exit', (code) => code === 0
      ? resolvePromise()
      : rejectPromise(new Error(`${command} ${args.join(' ')} exited with code ${String(code)}.`)))
  })
}

async function buildProduction() {
  if (process.platform === 'win32') {
    await runProcess(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'corepack pnpm run build'])
  } else {
    await runProcess('corepack', ['pnpm', 'run', 'build'])
  }
}

function contentType(path) {
  return {
    '.css': 'text/css; charset=utf-8',
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
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
    ? candidate
    : null
}

const performanceMarkdown = readFileSync(featureFixturePath, 'utf8')
const performanceMarkdownLiteral = JSON.stringify(performanceMarkdown).replace(/<\//gu, '<\\/')

function publicHarnessHtml(entry) {
  const apiLoader = entry === 'esm'
    ? `<script type="module">import * as api from '/packages/editor-web/dist/editor.es.js'; window.__bootFocusedPerformance(api, 'esm')</script>`
    : `<script src="/packages/editor-web/dist/w-editor.global.js"></script><script>window.__bootFocusedPerformance(window.WEditor, 'iife')</script>`
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>W-Editor focused performance ${entry}</title><link rel="stylesheet" href="/packages/editor-web/dist/w-editor.css"></head>
<body><main><section id="editor"></section><section id="reader"></section></main>
<script>
window.__bootFocusedPerformance = function (api, selectedEntry) {
  var state = { entry: selectedEntry, editorReadyMs: null, readerReadyMs: null, done: false };
  var markdown = ${performanceMarkdownLiteral};
  var editorStarted = performance.now();
  var editor = api.mountWEditor(document.querySelector('#editor'), { document: { documentId: 'focused-performance-' + selectedEntry, markdown: markdown, serverRevision: 'focused-performance-1' }, initialMode: 'visual', onReady: function () { state.editorReadyMs = performance.now() - editorStarted; } });
  var readerStarted = performance.now();
  var reader = api.mountWRenderer(document.querySelector('#reader'), { markdown: markdown, profile: 'reader', onReady: function () { state.readerReadyMs = performance.now() - readerStarted; } });
  window.__W_EDITOR_FOCUSED_PERF__ = state;
  window.__W_EDITOR_FOCUSED_INSTANCES__ = { editor: editor, reader: reader };
  var settle = function () {
    if (state.editorReadyMs !== null && state.readerReadyMs !== null && document.querySelector('#editor .ProseMirror') && document.querySelector('#reader [data-w-editor-renderer-content]')) state.done = true;
    else window.setTimeout(settle, 10);
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
      if (address === null || typeof address === 'string') rejectPromise(new Error('Focused performance server did not expose a TCP port.'))
      else resolvePromise(address.port)
    })
  })
}

function closeServer(server) {
  return new Promise((resolvePromise) => server.close(() => resolvePromise()))
}

function startPreview(port) {
  const vite = resolve(repositoryRoot, 'node_modules/vite/bin/vite.js')
  const child = spawn(process.execPath, [vite, 'preview', '--host', HOST, '--port', String(port), '--strictPort'], {
    cwd: repositoryRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
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
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push({ label, message: message.text(), type: 'console' })
  })
  page.on('pageerror', (error) => diagnostics.push({ label, message: error.message, type: 'pageerror' }))
}

async function waitForPlaygroundReady(page, url) {
  await page.goto(`${url}/?focusedPerformance=${Date.now()}-${Math.random()}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.locator('html[data-w-editor-ready="true"]').waitFor({ timeout: 90_000 })
  await page.locator('.workspace-shell').waitFor({ timeout: 30_000 })
}

async function measureReader(browser, publicUrl, diagnostics) {
  const result = {}
  for (const entry of ['esm', 'iife']) {
    const samples = []
    const details = []
    for (let index = 0; index < sampleCount; index += 1) {
      const context = await browser.newContext({ deviceScaleFactor, viewport, locale: 'zh-CN' })
      const page = await context.newPage()
      instrumentPage(page, diagnostics, `reader-${entry}-${index + 1}`)
      try {
        await page.goto(`${publicUrl}/performance/${entry}.html?sample=${index + 1}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
        await page.waitForFunction(() => globalThis.__W_EDITOR_FOCUSED_PERF__?.done === true, null, { timeout: 120_000 })
        const state = await page.evaluate(() => ({ ...globalThis.__W_EDITOR_FOCUSED_PERF__ }))
        samples.push(state.readerReadyMs)
        details.push({ sample: index + 1, ...state })
        await page.evaluate(async () => {
          const instances = globalThis.__W_EDITOR_FOCUSED_INSTANCES__
          if (instances) await Promise.all([instances.editor.destroy(), instances.reader.destroy()])
        })
      } finally {
        await context.close()
      }
    }
    result[entry] = Object.freeze({ details: Object.freeze(details), summary: metric(samples) })
  }
  return Object.freeze(result)
}

async function measureFirstEditable(browser, previewUrl, diagnostics) {
  const samples = []
  for (let index = 0; index < sampleCount; index += 1) {
    const context = await browser.newContext({ deviceScaleFactor, viewport, locale: 'zh-CN' })
    const page = await context.newPage()
    instrumentPage(page, diagnostics, `first-editable-${index + 1}`)
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

async function measureSourceInput(browser, previewUrl, diagnostics) {
  const context = await browser.newContext({ deviceScaleFactor, viewport, locale: 'zh-CN' })
  const page = await context.newPage()
  const profiler = cpuProfilePath === null ? null : await context.newCDPSession(page)
  instrumentPage(page, diagnostics, 'source-input')
  try {
    await waitForPlaygroundReady(page, previewUrl)
    await page.locator('[data-command-id="mode.source"]').click()
    const editor = page.locator('#markdown-source-editor')
    await editor.waitFor({ timeout: 30_000 })
    await editor.fill('# Focused performance input\n\nWarmup')
    await editor.focus()
    await page.evaluate(() => {
      const target = document.querySelector('#markdown-source-editor')
      const counts = { beforeinput: 0, input: 0, keyup: 0, mouseup: 0, select: 0, selectionchange: 0 }
      globalThis.__W_EDITOR_FOCUSED_SOURCE_EVENTS__ = counts
      for (const type of ['beforeinput', 'input', 'keyup', 'mouseup', 'select']) {
        target?.addEventListener(type, () => { counts[type] += 1 })
      }
      document.addEventListener('selectionchange', () => { counts.selectionchange += 1 })
    })
    if (profiler !== null) {
      await profiler.send('Profiler.enable')
      await profiler.send('Profiler.start')
    }
    const samples = []
    for (let index = 0; index < sampleCount; index += 1) {
      await page.keyboard.press('Control+End')
      const token = ` focused-source-${index}-${Date.now()}`
      const started = performance.now()
      await page.keyboard.insertText(token)
      await page.waitForFunction((value) => {
        const node = document.querySelector('#markdown-source-editor')
        const text = node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement
          ? node.value
          : node?.textContent ?? ''
        return text.includes(value)
      }, token, { timeout: 30_000 })
      samples.push(roundMs(performance.now() - started))
    }
    if (profiler !== null && cpuProfilePath !== null) {
      const { profile } = await profiler.send('Profiler.stop')
      await mkdir(resolve(cpuProfilePath, '..'), { recursive: true })
      await writeFile(cpuProfilePath, `${JSON.stringify(profile)}\n`, 'utf8')
      await profiler.send('Profiler.disable')
    }
    const eventCounts = await page.evaluate(() => ({ ...globalThis.__W_EDITOR_FOCUSED_SOURCE_EVENTS__ }))
    return Object.freeze({ ...metric(samples), eventCounts: Object.freeze(eventCounts) })
  } finally {
    await profiler?.detach()
    await context.close()
  }
}

async function measureRepresentativeLong(browser, previewUrl, diagnostics) {
  const samples = []
  const details = []
  for (let index = 0; index < sampleCount; index += 1) {
    const context = await browser.newContext({ deviceScaleFactor, viewport, locale: 'zh-CN' })
    const page = await context.newPage()
    instrumentPage(page, diagnostics, `representative-long-${index + 1}`)
    try {
      await waitForPlaygroundReady(page, previewUrl)
      const started = performance.now()
      await page.getByTestId('import-markdown-input').setInputFiles(representativeFixturePath)
      const confirmation = page.getByTestId('document-lifecycle-confirmation')
      await confirmation.waitFor({ state: 'visible', timeout: 30_000 })
      await confirmation.getByTestId('document-lifecycle-confirm').click()
      await confirmation.waitFor({ state: 'detached', timeout: 30_000 })
      if (await page.getByTestId('editor-surface').getAttribute('data-mode') !== 'source') {
        await page.locator('[data-command-id="mode.source"]').click()
      }
      const source = page.locator('.cm-content[contenteditable="true"]')
      await source.waitFor({ timeout: 120_000 })
      await page.waitForFunction(
        () => document.querySelector('.cm-content')?.textContent?.includes('# Representative long W-Editor document') === true,
        null,
        { timeout: 120_000 },
      )
      const milliseconds = roundMs(performance.now() - started)
      samples.push(milliseconds)
      details.push({ markerObserved: true, milliseconds, sample: index + 1 })
    } finally {
      await context.close()
    }
  }
  return Object.freeze({
    bytes: statSync(representativeFixturePath).size,
    fixture: 'e2e/fixtures/documents/representative-long.md',
    samples: Object.freeze(details),
    summary: metric(samples),
  })
}

function checksFor(metricName, measurements) {
  const candidates = metricName === 'reader'
    ? [
        ['web.esm.reader', measurements.esm.summary],
        ['web.iife.reader', measurements.iife.summary],
      ]
    : metricName === 'source-input'
      ? [['playground.ordinaryInputSource', measurements]]
      : metricName === 'first-editable'
        ? [['playground.firstEditable', measurements]]
        : [['documents.representativeLong', measurements.summary]]
  return Object.freeze(candidates.map(([id, observed]) => {
    const limitMs = frozenBudgets.latency[id]?.limitMs
    if (!Number.isInteger(limitMs) || observed.p95NearestRank === null) {
      return Object.freeze({ id, limitMs: limitMs ?? null, observedP95Ms: observed.p95NearestRank, status: 'failed' })
    }
    return Object.freeze({
      id,
      limitMs,
      observedP95Ms: observed.p95NearestRank,
      status: observed.p95NearestRank <= limitMs ? 'passed' : 'failed',
    })
  }))
}

const diagnostics = []
const report = {
  schemaVersion: 1,
  change: 'dual-target-release-performance-remediation',
  task: '1.2/1.3',
  status: 'running',
  capturedAt: new Date().toISOString(),
  selectedMetric,
  sampleCount,
  buildSkipped: hasFlag('skip-build'),
  cpuProfilePath: cpuProfilePath === null ? null : relative(repositoryRoot, cpuProfilePath).replaceAll('\\', '/'),
  environment: {
    browser: 'Playwright bundled Chromium',
    browserVersion: null,
    deviceScaleFactor,
    gitHead: null,
    viewport,
  },
  inputs: {
    featureFixture: fileRecord(featureFixturePath),
    performanceBudgets: fileRecord(performanceBudgetsPath),
    representativeFixture: fileRecord(representativeFixturePath),
  },
  measurements: null,
  checks: [],
  diagnostics,
  error: null,
}

let browser = null
let publicServer = null
let preview = null
try {
  report.environment.gitHead = (await import('node:child_process')).execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim()
  if (!hasFlag('skip-build')) await buildProduction()
  await runProcess(process.execPath, ['scripts/verify-e2e-build-seam.mjs', 'absent'])
  const previewPort = 4800 + (process.pid % 100)
  preview = startPreview(previewPort)
  const previewUrl = `http://${HOST}:${previewPort}`
  await waitForHttp(`${previewUrl}/`, preview)
  browser = await chromium.launch({ headless: true })
  report.environment.browserVersion = browser.version()
  if (selectedMetric === 'reader') {
    publicServer = createPublicServer()
    const port = await listen(publicServer)
    report.measurements = await measureReader(browser, `http://${HOST}:${port}`, diagnostics)
  } else {
    report.measurements = selectedMetric === 'source-input'
      ? await measureSourceInput(browser, previewUrl, diagnostics)
      : selectedMetric === 'first-editable'
        ? await measureFirstEditable(browser, previewUrl, diagnostics)
        : await measureRepresentativeLong(browser, previewUrl, diagnostics)
  }
  report.checks = checksFor(selectedMetric, report.measurements)
  report.status = diagnostics.length === 0 && report.checks.every(({ status }) => status === 'passed')
    ? 'passed'
    : 'failed'
} catch (error) {
  report.status = 'error'
  report.error = error instanceof Error ? error.stack ?? error.message : String(error)
} finally {
  if (browser !== null) await browser.close()
  if (publicServer !== null) await closeServer(publicServer)
  await stopPreview(preview)
  await mkdir(resolve(rawPath, '..'), { recursive: true })
  await writeFile(rawPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

console.log(JSON.stringify({
  status: report.status,
  selectedMetric,
  checks: report.checks,
  diagnostics: report.diagnostics.length,
  rawPath: relative(repositoryRoot, rawPath).replaceAll('\\', '/'),
}, null, 2))
if (report.status !== 'passed') process.exitCode = 1
