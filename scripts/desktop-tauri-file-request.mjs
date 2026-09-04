import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'

const executable = resolve(process.env.W_EDITOR_DESKTOP_EXE ?? 'apps/desktop/src-tauri/target/debug/w-editor-desktop.exe')
const nativeDriver = resolve(process.env.W_EDITOR_EDGE_DRIVER ?? '.tmp/tauri-webdriver/msedgedriver.exe')
const tauriDriver = resolve(process.env.W_EDITOR_TAURI_DRIVER ?? '.tmp/tauri-driver.exe')
const port = Number(process.env.W_EDITOR_DESKTOP_FILE_REQUEST_PORT ?? 4456)
const nativePort = Number(process.env.W_EDITOR_DESKTOP_FILE_REQUEST_NATIVE_PORT ?? 9527)
const base = `http://127.0.0.1:${port}`
const testParent = mkdtempSync(resolve('.tmp', 'desktop-file-request-'))
const externalPath = join(testParent, 'forwarded-request.md')
const externalMarkdown = '# Forwarded request\n\nOpened through the single-instance Library import path.'
writeFileSync(externalPath, externalMarkdown)

function requireFile(path, label) {
  if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`)
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

async function request(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { 'content-type': 'application/json' },
    method,
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`WebDriver ${method} ${path}: ${payload?.value?.message ?? response.status}`)
  return payload?.value
}

async function waitForDriver() {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      await request('/status')
      return
    } catch {
      await sleep(100)
    }
  }
  throw new Error('tauri-driver did not become ready.')
}

async function execute(sessionId, script, args = []) {
  return request(`/session/${sessionId}/execute/sync`, 'POST', { args, script })
}

async function invoke(sessionId, command, args = []) {
  return request(`/session/${sessionId}/execute/async`, 'POST', {
    args,
    script: `const done = arguments[arguments.length - 1]; const bridge = globalThis.__TAURI_INTERNALS__; if (bridge === undefined || typeof bridge.invoke !== 'function') { done({ status: 'unavailable' }); } else { bridge.invoke(${JSON.stringify(command)}, arguments[0]).then((value) => done({ status: 'fulfilled', value })).catch((error) => done({ status: 'rejected', error: String(error) })); }`,
  })
}

async function waitFor(sessionId, script, predicate, label, timeout = 15_000) {
  const deadline = Date.now() + timeout
  let lastValue = null
  while (Date.now() < deadline) {
    lastValue = await execute(sessionId, script)
    if (predicate(lastValue)) return lastValue
    await sleep(150)
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(lastValue)}`)
}

async function waitForNative(sessionId, command, predicate, label, timeout = 15_000) {
  const deadline = Date.now() + timeout
  let lastValue = null
  while (Date.now() < deadline) {
    lastValue = await invoke(sessionId, command)
    if (predicate(lastValue)) return lastValue
    await sleep(150)
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(lastValue)}`)
}

requireFile(executable, 'Desktop debug executable')
requireFile(nativeDriver, 'Edge WebDriver')
requireFile(tauriDriver, 'tauri-driver')
const driverProcess = spawn(tauriDriver, ['--port', String(port), '--native-port', String(nativePort), '--native-driver', nativeDriver], { stdio: 'ignore', windowsHide: true })
let sessionId = null
let secondProcess = null
try {
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
  await request(`/session/${sessionId}/timeouts`, 'POST', { script: 10_000 })
  const selected = await invoke(sessionId, 'select_data_root', [{ parentPath: testParent }])
  if (selected?.status !== 'fulfilled' || selected.value?.state !== 'ready') throw new Error(`Data Root setup failed: ${JSON.stringify(selected)}`)
  await waitFor(sessionId, `return document.documentElement.dataset.desktopReady === 'true'`, (value) => value === true, 'the Desktop workspace')
  const before = await invoke(sessionId, 'single_instance_status')
  secondProcess = spawn(executable, [externalPath], { stdio: 'ignore', windowsHide: true })
  const forwarded = await waitFor(sessionId,
    `return window.__desktopForwardedRequest__ ?? null`,
    (value) => value !== null,
    'the frontend file-request event',
  )
  const nativeForwarded = await waitForNative(sessionId, 'single_instance_status', (value) => value?.status === 'fulfilled' && value.value?.forwardedCount >= 1, 'native single-instance forwarding')
  const imported = await waitFor(sessionId,
    `return { title: document.querySelector('.workspace-controls__meta span')?.textContent ?? '', cards: document.querySelectorAll('[data-testid="desktop-library-article"]').length }`,
    (value) => value?.title === 'forwarded-request' && value.cards >= 4,
    'the forwarded Markdown Library article',
  )
  const after = await invoke(sessionId, 'single_instance_status')
  const durable = await invoke(sessionId, 'library_list_articles')
  if (durable?.status !== 'fulfilled' || !durable.value.some((article) => article.title === 'forwarded-request' && article.markdown === externalMarkdown)) throw new Error(`Forwarded file was not imported into Library: ${JSON.stringify(durable)}`)
  console.log(JSON.stringify({ status: 'passed', browserVersion: session?.capabilities?.browserVersion ?? 'unknown', before: before?.value, forwarded, nativeForwarded: nativeForwarded?.value, imported, after: after?.value, durableArticleCount: durable.value.length, externalUnchanged: readFileSync(externalPath, 'utf8') === externalMarkdown }, null, 2))
} finally {
  if (secondProcess !== null) secondProcess.kill()
  if (sessionId !== null) await request(`/session/${sessionId}`, 'DELETE').catch(() => {})
  driverProcess.kill()
}
