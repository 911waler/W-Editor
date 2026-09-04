import { existsSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'

const executable = resolve(process.env.W_EDITOR_DESKTOP_EXE ?? 'apps/desktop/src-tauri/target/debug/w-editor-desktop.exe')
const nativeDriver = resolve(process.env.W_EDITOR_EDGE_DRIVER ?? '.tmp/tauri-webdriver/msedgedriver.exe')
const tauriDriver = resolve(process.env.W_EDITOR_TAURI_DRIVER ?? '.tmp/tauri-driver.exe')
const port = Number(process.env.W_EDITOR_TAURI_REOPEN_PORT ?? 4453)
const nativePort = Number(process.env.W_EDITOR_NATIVE_REOPEN_PORT ?? 9524)
const base = `http://127.0.0.1:${port}`
const locatorPath = join(process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming'), 'com.weditor.desktop.spike', 'data-root.json')
const expectedDocumentId = process.env.W_EDITOR_EXPECTED_DOCUMENT_ID ?? 'spike-document'
const expectedMarkdown = process.env.W_EDITOR_EXPECTED_MARKDOWN ?? '# SQLite Spike\n\nSecond durable Markdown.'

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

async function invoke(sessionId, command, args = []) {
  return request(`/session/${sessionId}/execute/async`, 'POST', {
    args,
    script: `const done = arguments[arguments.length - 1]; const bridge = globalThis.__TAURI_INTERNALS__; if (bridge === undefined || typeof bridge.invoke !== 'function') { done({ status: 'unavailable' }); } else { bridge.invoke(${JSON.stringify(command)}, arguments[0]).then((value) => done({ status: 'fulfilled', value })).catch((error) => done({ status: 'rejected', error: String(error) })); }`,
  })
}

requireFile(executable, 'Desktop executable')
requireFile(nativeDriver, 'Edge WebDriver')
requireFile(tauriDriver, 'tauri-driver')
const driverProcess = spawn(tauriDriver, ['--port', String(port), '--native-port', String(nativePort), '--native-driver', nativeDriver], { stdio: 'ignore', windowsHide: true })
let sessionId = null
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
  const status = await invoke(sessionId, 'data_root_status')
  if (status?.status !== 'fulfilled' || status.value?.state !== 'ready' || status.value?.markerValid !== true || status.value?.writeProbe !== true) throw new Error(`Reinstalled app did not discover a ready Data Root: ${JSON.stringify(status)}`)
  const loaded = await invoke(sessionId, 'library_load_markdown', [{ documentId: expectedDocumentId }])
  if (loaded?.status !== 'fulfilled' || loaded.value?.markdown !== expectedMarkdown || loaded.value?.revision !== 2) throw new Error(`Reinstalled app did not discover the preserved Library Markdown: ${JSON.stringify(loaded)}`)
  const locator = JSON.parse(readFileSync(locatorPath, 'utf8'))
  console.log(JSON.stringify({ status: 'passed', executable, locator, dataRoot: status.value, loaded: loaded.value }, null, 2))
} finally {
  if (sessionId !== null) await request(`/session/${sessionId}`, 'DELETE').catch(() => {})
  driverProcess.kill()
}
