import { existsSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'

const executable = resolve(process.env.W_EDITOR_DESKTOP_EXE ?? 'apps/desktop/src-tauri/target/debug/w-editor-desktop.exe')
const nativeDriver = resolve(process.env.W_EDITOR_EDGE_DRIVER ?? '.tmp/tauri-webdriver/msedgedriver.exe')
const tauriDriver = resolve(process.env.W_EDITOR_TAURI_DRIVER ?? '.tmp/tauri-driver.exe')
const port = Number(process.env.W_EDITOR_DESKTOP_RECOVERY_PORT ?? 4457)
const nativePort = Number(process.env.W_EDITOR_DESKTOP_RECOVERY_NATIVE_PORT ?? 9528)
const base = `http://127.0.0.1:${port}`
const testParent = mkdtempSync(resolve('.tmp', 'desktop-data-root-recovery-'))
const root = join(testParent, 'W-EditorData')
const missingRoot = join(testParent, 'W-EditorData-missing')
const locatorPath = join(process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming'), 'com.weditor.desktop.spike', 'data-root.json')
const previousLocator = existsSync(locatorPath) ? readFileSync(locatorPath) : null

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

async function createSession() {
  const session = await request('/session', 'POST', {
    capabilities: {
      alwaysMatch: {
        browserName: 'webview2',
        'tauri:options': { application: executable, webviewOptions: {} },
      },
    },
  })
  const id = session?.sessionId ?? null
  if (id === null) throw new Error('WebDriver did not return a session id.')
  await request(`/session/${id}/timeouts`, 'POST', { script: 10_000 })
  return id
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

requireFile(executable, 'Desktop debug executable')
requireFile(nativeDriver, 'Edge WebDriver')
requireFile(tauriDriver, 'tauri-driver')
const driverProcess = spawn(tauriDriver, ['--port', String(port), '--native-port', String(nativePort), '--native-driver', nativeDriver], { stdio: 'ignore', windowsHide: true })
let sessionId = null
let recoverySessionId = null
try {
  await waitForDriver()
  sessionId = await createSession()
  const selected = await invoke(sessionId, 'select_data_root', [{ parentPath: testParent }])
  if (selected?.status !== 'fulfilled' || selected.value?.state !== 'ready') throw new Error(`Data Root setup failed: ${JSON.stringify(selected)}`)
  await waitFor(sessionId, `return document.documentElement.dataset.desktopReady === 'true'`, (value) => value === true, 'the ready Desktop workspace')
  const closed = await invoke(sessionId, 'request_window_close')
  if (closed?.status !== 'fulfilled' || closed.value?.state !== 'allowed') throw new Error(`Clean Desktop close failed: ${JSON.stringify(closed)}`)
  await sleep(500)
  await request(`/session/${sessionId}`, 'DELETE').catch(() => {})
  sessionId = null
  renameSync(root, missingRoot)
  recoverySessionId = await createSession()
  const recovery = await waitFor(recoverySessionId,
    `return { state: document.querySelector('[data-data-root-state]')?.getAttribute('data-data-root-state') ?? '', recovery: Boolean(document.querySelector('[data-testid="desktop-data-root-recovery"]')), setup: Boolean(document.querySelector('[data-testid="desktop-data-root-setup"]')), workspace: Boolean(document.querySelector('.workspace-shell')), message: document.querySelector('[data-testid="desktop-data-root-recovery"]')?.textContent?.trim() ?? '' }`,
    (value) => value?.state === 'unavailable' && value.recovery === true && value.setup === true && value.workspace === false,
    'the unavailable Data Root recovery flow',
  )
  console.log(JSON.stringify({ status: 'passed', recovery, locatorPath, missingRoot, noWorkspaceGuess: recovery.workspace === false }, null, 2))
} finally {
  if (sessionId !== null) await request(`/session/${sessionId}`, 'DELETE').catch(() => {})
  if (recoverySessionId !== null) await request(`/session/${recoverySessionId}`, 'DELETE').catch(() => {})
  if (existsSync(missingRoot) && !existsSync(root)) renameSync(missingRoot, root)
  driverProcess.kill()
  if (previousLocator === null) {
    if (existsSync(locatorPath)) {
      const { unlinkSync } = await import('node:fs')
      unlinkSync(locatorPath)
    }
  } else {
    const { mkdirSync } = await import('node:fs')
    mkdirSync(resolve(locatorPath, '..'), { recursive: true })
    writeFileSync(locatorPath, previousLocator)
  }
}
