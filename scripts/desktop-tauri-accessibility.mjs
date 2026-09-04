import { createRequire } from 'node:module'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const executable = resolve(process.env.W_EDITOR_DESKTOP_EXE ?? 'apps/desktop/src-tauri/target/debug/w-editor-desktop.exe')
const nativeDriver = resolve(process.env.W_EDITOR_EDGE_DRIVER ?? '.tmp/tauri-webdriver/msedgedriver.exe')
const tauriDriver = resolve(process.env.W_EDITOR_TAURI_DRIVER ?? '.tmp/tauri-driver.exe')
const outputPath = resolve(process.env.W_EDITOR_A11Y_DESKTOP_EVIDENCE_PATH ?? 'artifacts/release-governance/task-9-8-desktop-accessibility.json')
const portSeed = Number(process.env.W_EDITOR_A11Y_DESKTOP_PORT_SEED ?? process.pid % 300)
const port = Number(process.env.W_EDITOR_A11Y_DESKTOP_PORT ?? 6400 + portSeed * 4)
const nativePort = Number(process.env.W_EDITOR_A11Y_DESKTOP_NATIVE_PORT ?? 34_000 + portSeed * 4)
const base = `http://127.0.0.1:${port}`
const elementKey = 'element-6066-11e4-a52e-4f735466cecf'
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')
const axeTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

function requireFile(path, label) {
  if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`)
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

async function request(path, method = 'GET', body, timeoutMs = 120_000) {
  const response = await fetch(`${base}${path}`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { 'content-type': 'application/json' },
    method,
    signal: AbortSignal.timeout(timeoutMs),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`WebDriver ${method} ${path} failed: ${payload?.value?.message ?? response.status}`)
  return payload?.value
}

async function execute(sessionId, script, args = []) {
  return request(`/session/${sessionId}/execute/sync`, 'POST', { args, script })
}

async function find(sessionId, selector) {
  const value = await request(`/session/${sessionId}/element`, 'POST', { using: 'css selector', value: selector })
  const id = value?.[elementKey]
  if (typeof id !== 'string') throw new Error(`WebDriver returned no element for ${selector}.`)
  return id
}

async function click(sessionId, selector) {
  const id = await find(sessionId, selector)
  await request(`/session/${sessionId}/element/${id}/click`, 'POST', {})
}

async function waitFor(sessionId, script, expected, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  let lastValue = null
  while (Date.now() < deadline) {
    lastValue = await execute(sessionId, script)
    if (expected(lastValue)) return lastValue
    await sleep(150)
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(lastValue)}`)
}

async function waitForDriver() {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      await request('/status', 'GET', undefined, 5_000)
      return
    } catch {
      await sleep(100)
    }
  }
  throw new Error('tauri-driver did not become ready within 15 seconds.')
}

async function actions(sessionId, values) {
  await request(`/session/${sessionId}/actions`, 'POST', {
    actions: [{
      type: 'key',
      id: 'keyboard',
      actions: values.flatMap((value) => [{ type: 'keyDown', value }, { type: 'keyUp', value }]),
    }],
  })
}

async function runAxe(sessionId, label) {
  const result = await request(`/session/${sessionId}/execute/async`, 'POST', {
    args: [axeTags, label],
    script: `const done = arguments[arguments.length - 1]; const tags = arguments[0]; const label = arguments[1]; if (globalThis.axe === undefined) { done({ label, status: 'failed', error: 'axe-core was not injected.' }); } else { globalThis.axe.run(document, { runOnly: { type: 'tag', values: tags } }).then((result) => done({ label, status: result.violations.length === 0 ? 'passed' : 'failed', passes: result.passes.length, incomplete: result.incomplete.length, violations: result.violations.map((violation) => ({ id: violation.id, impact: violation.impact, help: violation.help, helpUrl: violation.helpUrl, nodes: violation.nodes.map((node) => ({ html: node.html, target: node.target, failureSummary: node.failureSummary })) })) })).catch((error) => done({ label, status: 'failed', error: String(error) })); }`,
  })
  return result
}

async function injectAxe(sessionId) {
  const injected = await execute(sessionId, `${axeSource}\nreturn typeof globalThis.axe?.run === 'function'`)
  if (injected !== true) throw new Error('axe-core could not be injected into the Desktop WebView2 page.')
}

async function focusSnapshot(sessionId) {
  return execute(sessionId, `const element = document.activeElement; if (!(element instanceof HTMLElement)) return { tag: document.activeElement?.tagName ?? null, visible: false, focusVisible: false, outline: '', boxShadow: '' }; const style = getComputedStyle(element); const rect = element.getBoundingClientRect(); return { tag: element.tagName, id: element.id, role: element.getAttribute('role'), label: element.getAttribute('aria-label'), visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden', focusVisible: element.matches(':focus-visible'), outline: style.outlineStyle + ' ' + style.outlineWidth, boxShadow: style.boxShadow };`)
}

const checks = []
let driverProcess = null
let sessionId = null
try {
  requireFile(executable, 'Installed Desktop executable')
  requireFile(nativeDriver, 'Edge WebDriver')
  requireFile(tauriDriver, 'tauri-driver')
  driverProcess = spawn(tauriDriver, ['--port', String(port), '--native-port', String(nativePort), '--native-driver', nativeDriver], { stdio: 'ignore', windowsHide: true })
  await waitForDriver()
  const session = await request('/session', 'POST', {
    capabilities: {
      alwaysMatch: {
        browserName: 'webview2',
        'tauri:options': { application: executable, webviewOptions: {} },
      },
    },
  })
  sessionId = session?.sessionId ?? null
  if (sessionId === null) throw new Error('WebDriver did not return a session id.')
  await waitFor(sessionId, `return { ready: document.documentElement.dataset.desktopReady === 'true' || document.documentElement.dataset.wEditorReady === 'true', desktopReady: document.documentElement.dataset.desktopReady === 'true', wEditorReady: document.documentElement.dataset.wEditorReady === 'true', workspace: Boolean(document.querySelector('.workspace-shell')), toolbar: Boolean(document.querySelector('[role="toolbar"]')), visual: Boolean(document.querySelector('.ProseMirror')) }`, (value) => value?.ready === true && value.workspace === true && value.toolbar === true && value.visual === true, 'Desktop workspace readiness')
  await injectAxe(sessionId)
  const visualAxe = await runAxe(sessionId, 'desktop-visual')
  checks.push({ name: 'axe-wcag-2.2-aa-visual', ...visualAxe })

  await execute(sessionId, `const trigger = document.querySelector('[data-toolbar-menu="insert"] .toolbar-menu__trigger'); if (!(trigger instanceof HTMLElement)) throw new Error('Insert toolbar trigger is unavailable.'); trigger.focus(); return true`)
  const beforeMenu = await focusSnapshot(sessionId)
  await actions(sessionId, ['\uE007'])
  const menu = await waitFor(sessionId, `return { expanded: document.querySelector('[data-toolbar-menu="insert"] .toolbar-menu__trigger')?.getAttribute('aria-expanded'), visible: (() => { const node = document.querySelector('[data-toolbar-menu="insert"] [role="menu"]'); return node instanceof HTMLElement && getComputedStyle(node).display !== 'none'; })() }`, (value) => value?.expanded === 'true' && value.visible === true, 'Desktop Insert menu keyboard open')
  await actions(sessionId, ['\uE015'])
  const menuFocus = await focusSnapshot(sessionId)
  await actions(sessionId, ['\uE00C'])
  const returnedFocus = await waitFor(sessionId, `return { active: document.activeElement?.matches('[data-toolbar-menu="insert"] .toolbar-menu__trigger') === true, expanded: document.querySelector('[data-toolbar-menu="insert"] .toolbar-menu__trigger')?.getAttribute('aria-expanded') }`, (value) => value?.active === true && value.expanded === 'false', 'Desktop menu focus return')
  checks.push({
    name: 'keyboard-focus-menu-return',
    status: beforeMenu.visible && beforeMenu.focusVisible && menu.visible && menuFocus.visible && returnedFocus.active ? 'passed' : 'failed',
    beforeMenu,
    menu,
    menuFocus,
    returnedFocus,
  })

  await click(sessionId, '[data-command-id="mode.preview"]')
  await waitFor(sessionId, `return document.querySelector('[data-testid="editor-surface"]')?.dataset.mode`, (value) => value === 'preview', 'Desktop Final Preview')
  const previewAxe = await runAxe(sessionId, 'desktop-reader-preview')
  checks.push({ name: 'axe-wcag-2.2-aa-reader', ...previewAxe })
  const aria = await execute(sessionId, `const toolbar = document.querySelector('[role="toolbar"]'); const status = document.querySelector('.status-region'); const mode = document.querySelector('.mode-control'); return { toolbar: toolbar instanceof HTMLElement ? { name: toolbar.getAttribute('aria-label'), role: toolbar.getAttribute('role') } : null, status: status instanceof HTMLElement ? { name: status.getAttribute('aria-label'), role: status.getAttribute('role') } : null, mode: mode instanceof HTMLElement ? { name: mode.getAttribute('aria-label'), busy: mode.getAttribute('aria-busy') } : null, namedButtons: [...document.querySelectorAll('button')].filter((button) => { const style = getComputedStyle(button); const rect = button.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0 && (button.getAttribute('aria-label') ?? button.textContent ?? '').trim().length === 0 }).length }`)
  checks.push({
    name: 'aria-runtime-contract',
    ...aria,
    status: aria.toolbar?.role === 'toolbar' && aria.toolbar.name?.length > 0 && aria.status?.name?.length > 0 && aria.mode?.name?.length > 0 && aria.namedButtons === 0 ? 'passed' : 'failed',
  })

  const failures = checks.filter((check) => check.status !== 'passed')
  const result = {
    schemaVersion: 1,
    change: 'dual-target-release',
    task: '9.8',
    status: failures.length === 0 ? 'passed' : 'failed',
    browser: 'Microsoft Edge WebView2',
    browserVersion: session?.capabilities?.browserVersion ?? 'unknown',
    executable,
    checks,
    notExecuted: [],
  }
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(result, null, 2))
  if (failures.length > 0) process.exitCode = 1
} catch (error) {
  const result = {
    schemaVersion: 1,
    change: 'dual-target-release',
    task: '9.8',
    status: 'failed',
    checks,
    error: error instanceof Error ? error.message : String(error),
    notExecuted: ['Desktop a11y checks after the first failed prerequisite'],
  }
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.error(JSON.stringify(result, null, 2))
  process.exitCode = 1
} finally {
  if (sessionId !== null) await request(`/session/${sessionId}`, 'DELETE').catch(() => {})
  driverProcess?.kill()
}
