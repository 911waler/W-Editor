import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { resolve } from 'node:path'

import { chromium } from 'playwright'

const HOST = '127.0.0.1'
const PORT = 4185
const BASE_URL = `http://${HOST}:${PORT}`
const RAW_PATH = resolve('tests/fixtures/performance/performance-raw.json')
const SUMMARY_PATH = resolve('tests/fixtures/performance/performance-baseline.json')
const REPRESENTATIVE_FIXTURE = resolve('e2e/fixtures/documents/representative-long.md')
const DIAGNOSTIC_FIXTURE = resolve('e2e/fixtures/documents/approximately-1mb.md')
const SAMPLE_COUNT = 5
const PACKAGE_MANAGER = JSON.parse(readFileSync('package.json', 'utf8')).packageManager ?? 'unknown'

function roundMs(value) {
  return Math.round(value * 100) / 100
}

function nearestRankP95(samples) {
  const ordered = [...samples].sort((left, right) => left - right)
  const rank = Math.max(1, Math.ceil(ordered.length * 0.95))
  return ordered[rank - 1] ?? null
}

function metric(samples, unit = 'ms') {
  return Object.freeze({
    count: samples.length,
    max: roundMs(Math.max(...samples)),
    median: roundMs([...samples].sort((left, right) => left - right)[Math.floor(samples.length / 2)] ?? 0),
    p95NearestRank: roundMs(nearestRankP95(samples) ?? 0),
    raw: Object.freeze([...samples]),
    unit,
  })
}

function candidateBudget(samples) {
  const p95 = nearestRankP95(samples)
  return p95 === null ? null : Object.freeze({
    basis: 'observed nearest-rank P95 × 1.25; candidate only, not a frozen formal budget',
    valueMs: Math.ceil(p95 * 1.25),
  })
}

function commandVersion(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8' }).trim()
  } catch {
    return 'unavailable'
  }
}

async function waitFor(label, probe, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const result = await probe()
      if (result) return result
    } catch (error) {
      lastError = error
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error(`Timed out waiting for ${label}.${lastError instanceof Error ? ` ${lastError.message}` : ''}`)
}

function spawnPreviewServer() {
  const vite = resolve('node_modules/vite/bin/vite.js')
  const child = spawn(process.execPath, [vite, 'preview', '--host', HOST, '--port', String(PORT), '--strictPort'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let output = ''
  const collect = (chunk) => { output = `${output}${String(chunk)}`.slice(-12_000) }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  return { child, output: () => output }
}

async function stopPreviewServer(server) {
  if (server === null || server.child.exitCode !== null) return
  server.child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolvePromise) => server.child.once('exit', resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 3_000)),
  ])
  if (server.child.exitCode === null) server.child.kill('SIGKILL')
}

async function waitForServer(server) {
  await waitFor('production preview server', async () => {
    if (server.child.exitCode !== null) throw new Error(server.output())
    try {
      return (await fetch(BASE_URL)).ok
    } catch {
      return false
    }
  }, 30_000)
}

async function waitForReady(page) {
  await page.goto(`${BASE_URL}/?performance=${Date.now()}`, { waitUntil: 'domcontentloaded' })
  await page.locator('html[data-w-editor-ready="true"]').waitFor({ timeout: 60_000 })
}

async function measureFirstEditable(browser, diagnostics) {
  const samples = []
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const context = await browser.newContext({ deviceScaleFactor: 1, viewport: { height: 1000, width: 1440 } })
    const page = await context.newPage()
    page.on('console', (message) => { if (message.type() === 'error') diagnostics.push(`[console] ${message.text()}`) })
    page.on('pageerror', (error) => diagnostics.push(`[pageerror] ${error.message}`))
    const started = performance.now()
    await waitForReady(page)
    await page.locator('.ProseMirror[contenteditable="true"]').waitFor({ timeout: 60_000 })
    samples.push(roundMs(performance.now() - started))
    await context.close()
  }
  return samples
}

async function switchToSource(page) {
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('.cm-content[contenteditable="true"]').waitFor({ timeout: 30_000 })
}

async function switchToPreview(page) {
  await page.locator('[data-command-id="mode.preview"]').click()
  await page.locator('.preview-surface').waitFor({ timeout: 60_000 })
  await page.locator('.preview-rendered-content').waitFor({ timeout: 60_000 })
}

async function measureOrdinaryInput(page) {
  await waitForReady(page)
  await switchToSource(page)
  const editor = page.locator('.cm-content[contenteditable="true"]')
  await editor.fill('# Performance baseline\n\nBase')
  await editor.focus()
  const samples = []
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    await page.keyboard.press('Control+End')
    const token = ` input-${index}`
    const started = performance.now()
    await page.keyboard.insertText(token)
    await waitFor(`ordinary input ${index}`, async () => (await editor.textContent())?.includes(token) === true)
    samples.push(roundMs(performance.now() - started))
  }
  return samples
}

async function measureFinalRender(page) {
  await waitForReady(page)
  const samples = []
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    await switchToSource(page)
    const editor = page.locator('.cm-content[contenteditable="true"]')
    await editor.fill(`# Final baseline ${index}\n\nFinal rendering sample.`)
    const started = performance.now()
    await switchToPreview(page)
    samples.push(roundMs(performance.now() - started))
  }
  return samples
}

async function measureImportedDocument(page, fixturePath, marker, timeoutMs = 120_000) {
  await waitForReady(page)
  const started = performance.now()
  await page.getByTestId('import-markdown-input').setInputFiles(fixturePath)
  const confirmation = page.getByTestId('document-lifecycle-confirmation')
  await confirmation.waitFor({ timeout: timeoutMs })
  await confirmation.getByTestId('document-lifecycle-confirm').click()
  await switchToSource(page)
  await waitFor(`imported ${marker} source`, async () => (
    (await page.locator('.cm-content[contenteditable="true"]').textContent())?.includes(marker) === true
  ), timeoutMs)
  return roundMs(performance.now() - started)
}

async function main() {
  await mkdir(resolve('tests/fixtures/performance'), { recursive: true })
  const server = spawnPreviewServer()
  const diagnostics = []
  let browser = null
  let failure = null
  const report = {
    schemaVersion: 1,
    task: '1.9',
    capturedAt: new Date().toISOString(),
    status: 'diagnostic-error',
    environment: {
      baseUrl: BASE_URL,
      browser: 'Playwright bundled Chromium',
      browserVersion: null,
      deviceScaleFactor: 1,
      viewport: { height: 1000, width: 1440 },
      node: process.version,
      pnpm: PACKAGE_MANAGER,
      productBaselineCommit: '39dddc311f0afb23339b4bba6d816fcfb285ef91',
      workingTreeHead: commandVersion('git', ['rev-parse', 'HEAD']),
      workingTreeStatus: commandVersion('git', ['status', '--short']),
      seam: 'verified absent before measurement',
    },
    samples: {},
    readerFinal: {
      reader: { status: 'not-implemented-at-baseline', reason: 'Current feature manifest has Source, Visual and Final Preview only.' },
      final: null,
    },
    documents: {},
    diagnostics,
    budgetCandidates: {},
  }

  try {
    await waitForServer(server)
    const seam = execFileSync(process.execPath, ['scripts/verify-e2e-build-seam.mjs', 'absent'], { encoding: 'utf8' }).trim()
    report.environment.seamEvidence = seam
    browser = await chromium.launch({ headless: true })
    report.environment.browserVersion = browser.version()

    report.samples.firstEditable = metric(await measureFirstEditable(browser, diagnostics))

    const inputContext = await browser.newContext({ deviceScaleFactor: 1, viewport: { height: 1000, width: 1440 } })
    const inputPage = await inputContext.newPage()
    report.samples.ordinaryInput = metric(await measureOrdinaryInput(inputPage))
    await inputContext.close()

    const finalContext = await browser.newContext({ deviceScaleFactor: 1, viewport: { height: 1000, width: 1440 } })
    const finalPage = await finalContext.newPage()
    const finalSamples = await measureFinalRender(finalPage)
    report.readerFinal.final = metric(finalSamples)
    await finalContext.close()

    const longContext = await browser.newContext({ deviceScaleFactor: 1, viewport: { height: 1000, width: 1440 } })
    const longPage = await longContext.newPage()
    report.documents.representativeLongDocument = {
      fixture: 'e2e/fixtures/documents/representative-long.md',
      bytes: (await stat(REPRESENTATIVE_FIXTURE)).size,
      importToVisibleSourceMs: await measureImportedDocument(longPage, REPRESENTATIVE_FIXTURE, '# Representative long W-Editor document'),
    }
    await longContext.close()

    const diagnosticContext = await browser.newContext({ deviceScaleFactor: 1, viewport: { height: 1000, width: 1440 } })
    const diagnosticPage = await diagnosticContext.newPage()
    report.documents.approximately1MiB = {
      fixture: 'e2e/fixtures/documents/approximately-1mb.md',
      bytes: (await stat(DIAGNOSTIC_FIXTURE)).size,
      importToVisibleSourceMs: await measureImportedDocument(diagnosticPage, DIAGNOSTIC_FIXTURE, '# Approximately one megabyte diagnostic document', 180_000),
    }
    await diagnosticContext.close()

    report.budgetCandidates = {
      firstEditable: candidateBudget(report.samples.firstEditable.raw),
      ordinaryInput: candidateBudget(report.samples.ordinaryInput.raw),
      finalRender: candidateBudget(report.readerFinal.final.raw),
      representativeLongDocument: { basis: 'diagnostic sample only; no formal latency budget frozen in Phase 0', valueMs: null },
      approximately1MiB: { basis: 'diagnostic sample only; no formal latency budget frozen in Phase 0', valueMs: null },
    }
    if (diagnostics.length > 0) throw new Error(`Browser diagnostics occurred during performance sampling: ${diagnostics.join(' | ')}`)
    report.status = 'completed'
  } catch (error) {
    failure = error
    report.error = error instanceof Error ? error.stack ?? error.message : String(error)
  } finally {
    if (browser !== null) await browser.close()
    await stopPreviewServer(server)
    await writeFile(RAW_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    const summary = {
      schemaVersion: report.schemaVersion,
      task: report.task,
      capturedAt: report.capturedAt,
      status: report.status,
      environment: report.environment,
      metrics: {
        firstEditable: report.samples.firstEditable ?? null,
        ordinaryInput: report.samples.ordinaryInput ?? null,
        reader: report.readerFinal.reader,
        final: report.readerFinal.final,
        representativeLongDocument: report.documents.representativeLongDocument ?? null,
        approximately1MiB: report.documents.approximately1MiB ?? null,
      },
      budgetCandidates: report.budgetCandidates,
      diagnostics: report.diagnostics,
      error: report.error ?? null,
      rawPath: 'tests/fixtures/performance/performance-raw.json',
      policy: 'Initial candidates are not formal budgets; Reader is explicitly not implemented at this baseline; large-document timings are diagnostic-only.',
    }
    await writeFile(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  }
  if (failure !== null) throw failure
  console.log(JSON.stringify({ status: report.status, rawPath: 'tests/fixtures/performance/performance-raw.json', summaryPath: 'tests/fixtures/performance/performance-baseline.json' }, null, 2))
}

await main()
