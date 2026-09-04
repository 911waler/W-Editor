/* global document, getComputedStyle, HTMLElement, matchMedia */

import { createRequire } from 'node:module'
import { execFile, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { constants, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { access, readFile, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'

import { chromium } from 'playwright'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)
const repositoryRoot = resolve(import.meta.dirname, '..')
const outputPath = resolve(process.env.W_EDITOR_A11Y_EVIDENCE_PATH ?? 'artifacts/release-governance/task-9-8-current-verification.json')
const desktopOutputPath = resolve(process.env.W_EDITOR_A11Y_DESKTOP_EVIDENCE_PATH ?? 'artifacts/release-governance/task-9-8-desktop-accessibility.json')
const nvdaJourneyOutputPath = resolve(process.env.W_EDITOR_A11Y_NVDA_EVIDENCE_PATH ?? 'artifacts/release-governance/task-9-8-nvda-journey.json')
const lifecycleEvidencePath = resolve(repositoryRoot, 'artifacts/release-governance/task-9-5-current-installer-lifecycle-rerun-20260829.json')
const desktopLocatorPath = join(
  process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming'),
  'com.weditor.desktop.spike',
  'data-root.json',
)
const originalDesktopLocator = existsSync(desktopLocatorPath) ? readFileSync(desktopLocatorPath) : null
const parityFixturePath = resolve(repositoryRoot, 'tests/fixtures/parity/w-editor-parity.md')
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')
const axeTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const webPort = Number(process.env.W_EDITOR_A11Y_WEB_PORT ?? 4250 + (process.pid % 200))
const publicPort = Number(process.env.W_EDITOR_A11Y_PUBLIC_PORT ?? 0)
const baseWebUrl = `http://127.0.0.1:${webPort}`

function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

function useCurrentLifecycleLocator() {
  const lifecycle = JSON.parse(readFileSync(lifecycleEvidencePath, 'utf8'))
  requireCondition(lifecycle.status === 'passed', 'Current installer lifecycle evidence is not passed.')
  const root = lifecycle.installers?.msi?.first?.dataRoot
  requireCondition(typeof root === 'string' && root.length > 0, 'Current MSI lifecycle Data Root is missing.')
  const manifest = JSON.parse(readFileSync(join(root.replace(/^\\\\\?\\/u, ''), 'manifest.json'), 'utf8'))
  mkdirSync(resolve(desktopLocatorPath, '..'), { recursive: true })
  writeFileSync(desktopLocatorPath, `${JSON.stringify({ schemaVersion: 1, root, health: 'ready', rootId: manifest.rootId }, null, 2)}\n`, 'utf8')
}

function restoreDesktopLocator() {
  if (originalDesktopLocator === null) {
    if (existsSync(desktopLocatorPath)) unlinkSync(desktopLocatorPath)
  }
  else {
    mkdirSync(resolve(desktopLocatorPath, '..'), { recursive: true })
    writeFileSync(desktopLocatorPath, originalDesktopLocator)
  }
}

function packageCommand(args) {
  if (process.platform === 'win32') return { command: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', ['corepack', 'pnpm', ...args].join(' ')] }
  return { command: 'corepack', args: ['pnpm', ...args] }
}

function run(command, args, env = process.env) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd: repositoryRoot, env, stdio: 'inherit', windowsHide: true })
    child.once('error', rejectPromise)
    child.once('exit', (code) => code === 0 ? resolvePromise() : rejectPromise(new Error(`${command} ${args.join(' ')} exited with code ${String(code)}.`)))
  })
}

async function buildProduction() {
  const command = packageCommand(['run', 'build'])
  await run(command.command, command.args)
  await run(process.execPath, [resolve(repositoryRoot, 'scripts/verify-e2e-build-seam.mjs'), 'absent'])
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

function safePath(pathname) {
  const candidate = resolve(repositoryRoot, `.${pathname}`)
  const candidateRelative = relative(repositoryRoot, candidate)
  return candidateRelative === '' || (!candidateRelative.startsWith('..') && !isAbsolute(candidateRelative)) ? candidate : null
}

function publicHarnessHtml(entry, markdown) {
  const bootstrap = entry === 'esm'
    ? `<script type="module">import * as api from '/packages/editor-web/dist/editor.es.js'; try { globalThis.__startWEditorA11y(api); } catch (error) { document.documentElement.dataset.wEditorA11yError = error instanceof Error ? error.message : String(error); }</script>`
    : `<script src="/packages/editor-web/dist/w-editor.global.js"></script><script>try { globalThis.__startWEditorA11y(globalThis.WEditor); } catch (error) { document.documentElement.dataset.wEditorA11yError = error instanceof Error ? error.message : String(error); }</script>`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>W-Editor public accessibility ${entry}</title><link rel="stylesheet" href="/packages/editor-web/dist/w-editor.css"></head><body><main aria-labelledby="a11y-public-title"><h1 id="a11y-public-title">W-Editor public API accessibility target</h1><section id="a11y-editor" aria-label="Public Editor"></section><section id="a11y-reader" aria-label="Public Reader"></section></main><script>globalThis.__startWEditorA11y = function(api) { var editorHost = document.getElementById('a11y-editor'); var readerHost = document.getElementById('a11y-reader'); var markdown = ${JSON.stringify(markdown)}; var ready = 0; function markReady() { ready += 1; if (ready === 2) document.documentElement.dataset.wEditorA11yReady = 'true'; } if (!api || typeof api.mountWEditor !== 'function' || typeof api.mountWRenderer !== 'function') throw new Error('The public API did not expose both mount functions.'); globalThis.__wEditorA11yEditor = api.mountWEditor(editorHost, { document: { documentId: 'a11y-public-${entry}', markdown: markdown, serverRevision: 'a11y-1' }, initialMode: 'visual', onReady: markReady }); globalThis.__wEditorA11yReader = api.mountWRenderer(readerHost, { markdown: markdown, profile: 'reader', onReady: markReady }); };</script>${bootstrap}</body></html>`
}

function createPublicServer(markdown) {
  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname)
    if (pathname === '/a11y-public-esm.html' || pathname === '/a11y-public-iife.html') {
      const entry = pathname.includes('iife') ? 'iife' : 'esm'
      response.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'text/html; charset=utf-8' })
      response.end(publicHarnessHtml(entry, markdown))
      return
    }
    const filePath = safePath(pathname === '/' ? '/dist/index.html' : pathname)
    if (filePath === null) {
      response.writeHead(403)
      response.end('forbidden')
      return
    }
    try {
      const bytes = await readFile(filePath)
      response.writeHead(200, { 'cache-control': 'no-store', 'content-type': contentType(filePath) })
      response.end(bytes)
    } catch {
      response.writeHead(404)
      response.end('not found')
    }
  })
  return server
}

function listen(server, port) {
  return new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(port, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') rejectPromise(new Error('Accessibility server did not expose a TCP port.'))
      else resolvePromise(address.port)
    })
  })
}

function startPreview() {
  const vite = resolve(repositoryRoot, 'node_modules/vite/bin/vite.js')
  const child = spawn(process.execPath, [vite, 'preview', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], { cwd: repositoryRoot, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let output = ''
  const collect = (chunk) => { output = `${output}${String(chunk)}`.slice(-12_000) }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  return { child, output: () => output }
}

async function waitForHttp(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // The preview server is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200))
  }
  throw new Error(`Timed out waiting for ${url}.`)
}

async function stopPreview(preview) {
  if (preview?.child.exitCode !== null) return
  preview?.child.kill('SIGTERM')
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
  if (preview?.child.exitCode === null) preview.child.kill('SIGKILL')
}

function simplifyAxe(result) {
  return {
    label: result.label,
    status: result.status,
    passes: result.passes ?? 0,
    incomplete: result.incomplete ?? 0,
    ...(result.error === undefined ? {} : { error: result.error }),
    violations: (result.violations ?? []).map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      helpUrl: violation.helpUrl,
      nodes: violation.nodes,
    })),
  }
}

async function injectAxe(page) {
  await page.addScriptTag({ content: axeSource })
  await page.waitForFunction(() => typeof globalThis.axe?.run === 'function')
}

async function runAxe(page, label) {
  const result = await page.evaluate(async ({ tags, label: runLabel }) => {
    const axeResult = await globalThis.axe.run(document, { runOnly: { type: 'tag', values: tags } })
    return {
      label: runLabel,
      status: axeResult.violations.length === 0 ? 'passed' : 'failed',
      passes: axeResult.passes.length,
      incomplete: axeResult.incomplete.length,
      violations: axeResult.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        helpUrl: violation.helpUrl,
        nodes: violation.nodes.map((node) => ({ html: node.html, target: node.target, failureSummary: node.failureSummary })),
      })),
    }
  }, { tags: axeTags, label })
  return simplifyAxe(result)
}

async function waitForPlayground(page) {
  await page.goto(baseWebUrl, { waitUntil: 'networkidle', timeout: 60_000 })
  await page.locator('html[data-w-editor-ready="true"]').waitFor({ timeout: 30_000 })
  await page.locator('.workspace-shell').waitFor({ timeout: 30_000 })
  const seamAbsent = await page.evaluate(() => !('__W_EDITOR_AUTHORITY__' in globalThis))
  requireCondition(seamAbsent, 'The accessibility runner received an E2E build instead of the production build.')
}

async function focusDetails(page) {
  return page.evaluate(() => {
    const element = document.activeElement
    if (!(element instanceof HTMLElement)) return { tag: document.activeElement?.tagName ?? null, visible: false, focusVisible: false, outline: '', boxShadow: '' }
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return { tag: element.tagName, id: element.id, role: element.getAttribute('role'), label: element.getAttribute('aria-label'), visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden', focusVisible: element.matches(':focus-visible'), outline: style.outlineStyle + ' ' + style.outlineWidth, boxShadow: style.boxShadow }
  })
}

async function runKeyboardFocus(page) {
  const trigger = page.locator('[data-toolbar-menu="insert"] .toolbar-menu__trigger')
  await trigger.focus()
  const beforeMenu = await focusDetails(page)
  await page.keyboard.press('Enter')
  const menu = page.locator('[data-toolbar-menu="insert"] [role="menu"]')
  await menu.waitFor({ state: 'visible', timeout: 10_000 })
  const expanded = await trigger.getAttribute('aria-expanded')
  await page.keyboard.press('ArrowDown')
  const menuFocus = await focusDetails(page)
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.activeElement?.matches('[data-toolbar-menu="insert"] .toolbar-menu__trigger') === true)
  const returnedFocus = await focusDetails(page)

  const sourceMode = page.locator('.mode-control [data-command-id="mode.source"]')
  await sourceMode.focus()
  await page.keyboard.press('Enter')
  await page.locator('[data-testid="editor-surface"][data-mode="source"]').waitFor({ timeout: 20_000 })
  const sourceEditor = page.locator('#markdown-source-editor')
  await sourceEditor.waitFor()
  const sourceFocus = await focusDetails(page)
  const sourceLabel = await sourceEditor.getAttribute('aria-label')
  await page.keyboard.press('Control+End')
  const visualMode = page.locator('.mode-control [data-command-id="mode.visual"]')
  await visualMode.focus()
  await page.keyboard.press('Enter')
  await page.locator('[data-testid="editor-surface"][data-mode="visual"] .ProseMirror').waitFor({ timeout: 20_000 })
  const visualEditor = page.locator('.ProseMirror')
  await visualEditor.focus()
  const visualFocus = await focusDetails(page)

  await trigger.focus()
  await page.keyboard.press('Enter')
  await page.locator('[data-toolbar-menu="insert"] [role="menu"] [data-command-id="insert.table"]').focus()
  await page.keyboard.press('Enter')
  const picker = page.locator('[data-table-dimension-picker]')
  await picker.waitFor({ state: 'visible', timeout: 10_000 })
  const initialCell = page.locator('[data-table-dimension-picker] [role="gridcell"][tabindex="0"]')
  await initialCell.waitFor()
  await page.keyboard.press('ArrowRight')
  const movedCell = page.locator('[data-table-dimension-picker] [role="gridcell"][tabindex="0"]')
  const moved = await movedCell.getAttribute('aria-colindex')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.activeElement?.matches('[data-toolbar-menu="insert"] .toolbar-menu__trigger') === true)
  const pickerReturn = await focusDetails(page)

  const aria = await page.evaluate(() => {
    const toolbar = document.querySelector('[role="toolbar"]')
    const status = document.querySelector('.status-region')
    const mode = document.querySelector('.mode-control')
    const namedButtonFailures = [...document.querySelectorAll('button')].filter((button) => {
      const style = getComputedStyle(button)
      const rect = button.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
        && (button.getAttribute('aria-label') ?? button.textContent ?? '').trim().length === 0
    }).length
    return {
      toolbar: toolbar instanceof HTMLElement ? { role: toolbar.getAttribute('role'), name: toolbar.getAttribute('aria-label') } : null,
      status: status instanceof HTMLElement ? { role: status.getAttribute('role'), name: status.getAttribute('aria-label') } : null,
      mode: mode instanceof HTMLElement ? { name: mode.getAttribute('aria-label'), busy: mode.getAttribute('aria-busy') } : null,
      namedButtonFailures,
    }
  })
  const status = beforeMenu.visible && beforeMenu.focusVisible && expanded === 'true'
    && menuFocus.visible && returnedFocus.visible && returnedFocus.focusVisible
    && sourceFocus.visible && sourceLabel !== null && visualFocus.visible
    && moved === '2' && pickerReturn.visible && pickerReturn.focusVisible
    && aria.toolbar?.role === 'toolbar' && (aria.toolbar.name ?? '').length > 0
    && (aria.status?.name ?? '').length > 0 && (aria.mode?.name ?? '').length > 0 && aria.namedButtonFailures === 0
  return { status: status ? 'passed' : 'failed', beforeMenu, expanded, menuFocus, returnedFocus, sourceFocus, sourceLabel, visualFocus, tablePicker: { movedColumn: moved, returnFocus: pickerReturn }, aria }
}

async function runZoomCheck(browser) {
  const context = await browser.newContext({ viewport: { width: 640, height: 800 } })
  const page = await context.newPage()
  try {
    await waitForPlayground(page)
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 })
    const result = await page.evaluate(() => {
      const html = document.documentElement
      const visualViewportScale = globalThis.visualViewport?.scale ?? null
      const visibleControls = [...document.querySelectorAll('button, input, [contenteditable="true"]')].filter((element) => {
        const node = element
        const style = getComputedStyle(node)
        const rect = node.getBoundingClientRect()
        return !node.hasAttribute('disabled') && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
      }).length
      return { method: 'Chromium CDP page scale 2 plus 640px reflow viewport', visualViewportScale, clientWidth: html.clientWidth, scrollWidth: html.scrollWidth, horizontalOverflow: html.scrollWidth > html.clientWidth + 1, visibleControls }
    })
    return { status: result.visualViewportScale === 2 && !result.horizontalOverflow && result.visibleControls > 0 ? 'passed' : 'failed', ...result }
  } finally {
    await context.close()
  }
}

async function runReducedMotionCheck(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await waitForPlayground(page)
    const result = await page.evaluate(() => {
      const animated = [...document.querySelectorAll('.w-editor-instance *')].flatMap((element) => {
        const style = getComputedStyle(element)
        const transitionMs = style.transitionDuration.split(',').map((value) => value.trim()).map((value) => value.endsWith('ms') ? Number.parseFloat(value) : Number.parseFloat(value) * 1000).filter(Number.isFinite)
        const animationMs = style.animationDuration.split(',').map((value) => value.trim()).map((value) => value.endsWith('ms') ? Number.parseFloat(value) : Number.parseFloat(value) * 1000).filter(Number.isFinite)
        return [...transitionMs, ...animationMs].some((value) => value > 0.01) ? { tag: element.tagName, className: element.className, transition: style.transitionDuration, animation: style.animationDuration } : []
      })
      return { prefersReducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, animatedElements: animated.slice(0, 20), animatedCount: animated.length }
    })
    return { status: result.prefersReducedMotion && result.animatedCount === 0 ? 'passed' : 'failed', ...result }
  } finally {
    await context.close()
  }
}

async function runPublicA11y(browser, basePublicUrl, entry) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  try {
    await page.goto(`${basePublicUrl}/a11y-public-${entry}.html`, { waitUntil: 'networkidle', timeout: 60_000 })
    await page.waitForFunction(() => document.documentElement.dataset.wEditorA11yError || (document.querySelector('#a11y-editor [data-w-editor-instance]') !== null && document.querySelector('#a11y-reader [data-w-editor-renderer-content]') !== null), null, { timeout: 30_000 })
    const harnessError = await page.locator('html').getAttribute('data-w-editor-a11y-error')
    requireCondition(harnessError === null, `Public ${entry} accessibility harness failed: ${harnessError}`)
    await injectAxe(page)
    return await runAxe(page, `public-${entry}-editor-reader`)
  } finally {
    await page.close()
  }
}

async function runPlaygroundA11y(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  try {
    await waitForPlayground(page)
    await injectAxe(page)
    const editor = await runAxe(page, 'playground-editor-visual')
    const keyboard = await runKeyboardFocus(page)
    await page.locator('.mode-control [data-command-id="mode.preview"]').click()
    await page.locator('[data-testid="editor-surface"][data-mode="preview"] .preview-rendered-content').waitFor({ timeout: 20_000 })
    const reader = await runAxe(page, 'playground-reader-preview')
    return { status: [editor, reader, keyboard].every((check) => check.status === 'passed') ? 'passed' : 'failed', editor, reader, keyboard }
  } finally {
    await page.close()
  }
}

async function discoverNvda() {
  const candidates = [
    process.env.NVDA_PATH,
    process.env.ProgramFiles && resolve(process.env.ProgramFiles, 'NVDA/nvda.exe'),
    process.env['ProgramFiles(x86)'] && resolve(process.env['ProgramFiles(x86)'], 'NVDA/nvda.exe'),
    process.env.LOCALAPPDATA && resolve(process.env.LOCALAPPDATA, 'Programs/NVDA/nvda.exe'),
  ].filter(Boolean)
  try {
    const result = await execFileAsync(process.platform === 'win32' ? 'where.exe' : 'which', ['nvda.exe'], { encoding: 'utf8' })
    candidates.unshift(...result.stdout.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean))
  } catch {
    // Continue with known installation locations.
  }
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.F_OK)
      return { status: 'available', executable: candidate }
    } catch {
      // Continue through known installation locations.
    }
  }
  return { status: 'unavailable', searched: candidates }
}

async function runDesktopA11y() {
  requireCondition(existsSync(lifecycleEvidencePath), `Current lifecycle evidence is missing: ${lifecycleEvidencePath}`)
  const lifecycle = JSON.parse(readFileSync(lifecycleEvidencePath, 'utf8'))
  requireCondition(lifecycle.status === 'passed', 'Current installer lifecycle evidence is not passed.')
  const executable = join(lifecycle.lifecycleRoot, 'msi', 'install', 'w-editor-desktop.exe')
  requireCondition(existsSync(executable), `Current installed MSI executable is missing: ${executable}`)
  try {
    await execFileAsync(process.execPath, [resolve(repositoryRoot, 'scripts/desktop-tauri-accessibility.mjs')], { cwd: repositoryRoot, env: { ...process.env, W_EDITOR_DESKTOP_EXE: executable, W_EDITOR_A11Y_DESKTOP_EVIDENCE_PATH: desktopOutputPath }, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  } catch {
    // The child always writes a structured report before returning a gate failure.
  }
  return existsSync(desktopOutputPath) ? JSON.parse(readFileSync(desktopOutputPath, 'utf8')) : { status: 'failed', error: 'Desktop accessibility child report is missing.' }
}

async function runNvdaJourney(nvda) {
  if (nvda.status !== 'available') return nvda
  try {
    await execFileAsync(process.execPath, [resolve(repositoryRoot, 'scripts/windows-nvda-journey.mjs')], {
      cwd: repositoryRoot,
      env: { ...process.env, W_EDITOR_NVDA_PATH: nvda.executable, W_EDITOR_NVDA_JOURNEY_EVIDENCE_PATH: nvdaJourneyOutputPath },
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    })
  } catch {
    // The child writes a structured report before returning a gate failure.
  }
  return existsSync(nvdaJourneyOutputPath) ? JSON.parse(readFileSync(nvdaJourneyOutputPath, 'utf8')) : { status: 'failed', error: 'NVDA journey child report is missing.' }
}

const checks = []
let preview = null
let publicServer = null
try {
  await buildProduction()
  const markdown = readFileSync(parityFixturePath, 'utf8')
  publicServer = createPublicServer(markdown)
  const publicServerPort = await listen(publicServer, publicPort)
  const publicBaseUrl = `http://127.0.0.1:${publicServerPort}`
  preview = startPreview()
  await waitForHttp(`${baseWebUrl}/`)
  const browser = await chromium.launch({ headless: true })
  try {
    const playground = await runPlaygroundA11y(browser)
    checks.push({ name: 'playground-editor-reader-keyboard-aria', ...playground })
    checks.push({ name: 'zoom-reflow', ...(await runZoomCheck(browser)) })
    checks.push({ name: 'reduced-motion', ...(await runReducedMotionCheck(browser)) })
    checks.push({ name: 'public-esm-editor-reader', ...(await runPublicA11y(browser, publicBaseUrl, 'esm')) })
    checks.push({ name: 'public-iife-editor-reader', ...(await runPublicA11y(browser, publicBaseUrl, 'iife')) })
  } finally {
    await browser.close()
  }
  useCurrentLifecycleLocator()
  checks.push({ name: 'desktop-webview2-accessibility', ...(await runDesktopA11y()) })
  const nvda = await discoverNvda()
  const nvdaJourney = await runNvdaJourney(nvda)
  checks.push({ name: 'windows-nvda-journey', ...nvdaJourney, note: 'The gate requires actual NVDA Speech Viewer output and Windows keyboard input; DOM/axe results cannot replace this journey.' })
  const blockingChecks = checks.filter((check) => check.status !== 'passed')
  const result = {
    schemaVersion: 1,
    change: 'dual-target-release',
    task: '9.8',
    status: blockingChecks.length === 0 ? 'passed' : 'failed',
    formalEligible: false,
    browser: 'Playwright bundled Chromium',
    browserVersion: 'captured in nested browser reports',
    axe: { version: '4.13.0', tags: axeTags },
    checks,
    notExecuted: [
      ...(nvdaJourney.status === 'passed' ? [] : ['real Windows NVDA journey was not passed']),
      ...(blockingChecks.length === 0 ? ['9.9-9.11'] : ['9.9-9.11 blocked by failed 9.8 accessibility gate']),
    ],
    blockers: blockingChecks.map((check) => check.name),
  }
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(result, null, 2))
  if (result.status !== 'passed') process.exitCode = 1
} catch (error) {
  const result = {
    schemaVersion: 1,
    change: 'dual-target-release',
    task: '9.8',
    status: 'failed',
    formalEligible: false,
    checks,
    error: error instanceof Error ? error.message : String(error),
    notExecuted: ['remaining 9.8 checks after the first failed prerequisite', '9.9-9.11'],
  }
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.error(JSON.stringify(result, null, 2))
  process.exitCode = 1
} finally {
  await stopPreview(preview)
  if (publicServer !== null) await new Promise((resolvePromise) => publicServer.close(() => resolvePromise()))
  restoreDesktopLocator()
}
