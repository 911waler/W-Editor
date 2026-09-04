import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'

const executable = resolve(process.env.W_EDITOR_DESKTOP_EXE ?? 'apps/desktop/src-tauri/target/debug/w-editor-desktop.exe')
const nativeDriver = resolve(process.env.W_EDITOR_EDGE_DRIVER ?? '.tmp/tauri-webdriver/msedgedriver.exe')
const tauriDriver = resolve(process.env.W_EDITOR_TAURI_DRIVER ?? '.tmp/tauri-driver.exe')
const port = Number(process.env.W_EDITOR_TAURI_DATA_ROOT_PORT ?? 4448)
const nativePort = Number(process.env.W_EDITOR_NATIVE_DATA_ROOT_PORT ?? 9519)
const base = `http://127.0.0.1:${port}`
const testParent = mkdtempSync(resolve('.tmp', 'desktop-data-root-'))
const locatorPath = join(process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming'), 'com.weditor.desktop.spike', 'data-root.json')
const previousLocator = existsSync(locatorPath) ? readFileSync(locatorPath) : null
const firstUseScreenshotPath = resolve('artifacts/final-validation/uat-dtr-019-020-desktop-first-use.png')

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

async function execute(sessionId, script, args = []) {
  return request(`/session/${sessionId}/execute/sync`, 'POST', { args, script })
}

function filesystemPath(value) {
  return typeof value === 'string' ? value.replace(/^\\\\\?\\/u, '') : value
}

requireFile(executable, 'Desktop debug executable')
requireFile(nativeDriver, 'Edge WebDriver')
requireFile(tauriDriver, 'tauri-driver')
if (existsSync(locatorPath)) unlinkSync(locatorPath)

const driverProcess = spawn(tauriDriver, [
  '--port', String(port),
  '--native-port', String(nativePort),
  '--native-driver', nativeDriver,
], { stdio: 'ignore', windowsHide: true })
let sessionId = null

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

async function closeSession() {
  if (sessionId === null) return
  await invoke(sessionId, 'request_window_close').catch(() => {})
  await sleep(500)
  await request(`/session/${sessionId}`, 'DELETE').catch(() => {})
  await sleep(500)
  sessionId = null
}

try {
  await waitForDriver()
  sessionId = await createSession()
  const initialResult = await invoke(sessionId, 'data_root_status')
  if (initialResult?.status !== 'fulfilled') throw new Error(`Data Root status IPC is not implemented: ${JSON.stringify(initialResult)}`)
  if (initialResult.value?.state !== 'unconfigured') throw new Error(`Fresh Desktop did not start unconfigured: ${JSON.stringify(initialResult.value)}`)
  const firstUse = await execute(sessionId, `return { title: document.querySelector('[data-testid="desktop-data-root-setup"] h2')?.textContent?.trim() ?? '', browse: document.querySelector('[data-testid="desktop-browse-data-root"]')?.textContent?.trim() ?? '', manual: Boolean(document.querySelector('[data-testid="desktop-data-root-parent"]')), confirm: document.querySelector('[data-testid="desktop-select-data-root"]')?.textContent?.trim() ?? '' }`)
  if (firstUse?.title !== '选择数据根目录' || firstUse.browse !== '选择文件夹…' || firstUse.manual !== true || firstUse.confirm !== '使用此文件夹') throw new Error(`First-use native folder UI is incomplete: ${JSON.stringify(firstUse)}`)
  writeFileSync(firstUseScreenshotPath, Buffer.from(await request(`/session/${sessionId}/screenshot`), 'base64'))

  const selectedResult = await invoke(sessionId, 'select_data_root', [{ parentPath: testParent }])
  if (selectedResult?.status !== 'fulfilled' || selectedResult.value?.state !== 'ready') throw new Error(`Data Root selection failed: ${JSON.stringify(selectedResult)}`)
  const selected = selectedResult.value
  const root = filesystemPath(selected.root)
  if (typeof root !== 'string' || !root.endsWith('W-EditorData')) throw new Error(`Selected root is not the managed W-EditorData directory: ${root}`)
  if (selected.markerValid !== true || selected.writeProbe !== true || selected.managedDirectories.length !== 5) throw new Error(`Managed Data Root is incomplete: ${JSON.stringify(selected)}`)
  if (!existsSync(root) || !existsSync(`${root}/root.marker`) || !existsSync(`${root}/manifest.json`)) throw new Error('Data Root marker or manifest is missing.')
  const manifest = JSON.parse(readFileSync(`${root}/manifest.json`, 'utf8'))
  if (manifest.rootType !== 'w-editor-data-root' || manifest.schemaVersion !== 1) throw new Error(`Unexpected Data Root manifest: ${JSON.stringify(manifest)}`)
  for (const directory of ['assets', 'backups', 'logs', 'settings', 'tmp/webview']) if (!statSync(`${root}/${directory}`).isDirectory()) throw new Error(`Managed directory is missing: ${directory}`)
  if (typeof selected.locatorPath !== 'string' || !existsSync(selected.locatorPath)) throw new Error('Minimal Data Root locator was not written.')

  const selectedLocator = readFileSync(selected.locatorPath)
  await closeSession()
  const missingRoot = `${root}-missing`
  writeFileSync(selected.locatorPath, JSON.stringify({ schemaVersion: 1, root: missingRoot, health: 'ready' }))
  let unavailable
  try {
    sessionId = await createSession()
    unavailable = await invoke(sessionId, 'data_root_status')
  } finally {
    await closeSession()
    writeFileSync(selected.locatorPath, selectedLocator)
  }
  if (unavailable?.status !== 'fulfilled' || unavailable.value?.state !== 'unavailable' || unavailable.value?.markerValid !== false) throw new Error(`Unavailable Data Root was not reported explicitly: ${JSON.stringify(unavailable)}`)

  sessionId = await createSession()
  const availableAfterMissing = await invoke(sessionId, 'data_root_status')
  if (availableAfterMissing?.status !== 'fulfilled' || availableAfterMissing.value?.state !== 'ready' || availableAfterMissing.value?.writeProbe !== true) throw new Error(`Data Root did not recover after the missing-root fixture was restored: ${JSON.stringify(availableAfterMissing)}`)
  await closeSession()

  const readOnlyRoot = join(testParent, 'read-only-fixture', 'W-EditorData')
  mkdirSync(join(readOnlyRoot, 'tmp'), { recursive: true })
  writeFileSync(join(readOnlyRoot, 'root.marker'), 'w-editor-data-root\nschemaVersion=1\n')
  writeFileSync(join(readOnlyRoot, 'manifest.json'), JSON.stringify({ schemaVersion: 1, rootType: 'w-editor-data-root', managedDirectories: ['assets', 'backups', 'logs', 'settings', 'tmp/webview'] }))
  writeFileSync(join(readOnlyRoot, 'tmp', 'webview'), 'blocked')
  await closeSession()
  writeFileSync(selected.locatorPath, JSON.stringify({ schemaVersion: 1, root: readOnlyRoot, health: 'ready' }))
  let readOnly
  try {
    sessionId = await createSession()
    readOnly = await invoke(sessionId, 'data_root_status')
  } finally {
    await closeSession()
    writeFileSync(selected.locatorPath, selectedLocator)
  }
  if (readOnly?.status !== 'fulfilled' || readOnly.value?.state !== 'read_only' || readOnly.value?.writeProbe !== false || typeof readOnly.value?.message !== 'string') throw new Error(`Read-only Data Root was not reported explicitly: ${JSON.stringify(readOnly)}`)

  sessionId = await createSession()
  const restored = await invoke(sessionId, 'data_root_status')
  if (restored?.status !== 'fulfilled' || restored.value?.state !== 'ready' || restored.value?.writeProbe !== true) throw new Error(`Data Root did not recover after the probe fixture was restored: ${JSON.stringify(restored)}`)
  console.log(JSON.stringify({ status: 'passed', initial: initialResult.value, firstUse, selected, unavailable: unavailable.value, availableAfterMissing: availableAfterMissing.value, readOnly: readOnly.value, restored: restored.value, testParent, firstUseScreenshotPath }, null, 2))
} finally {
  await closeSession()
  driverProcess.kill()
  await sleep(100)
  if (process.env.W_EDITOR_KEEP_DATA_ROOT !== '1') {
    if (previousLocator === null) {
      if (existsSync(locatorPath)) unlinkSync(locatorPath)
    } else {
      mkdirSync(resolve(locatorPath, '..'), { recursive: true })
      writeFileSync(locatorPath, previousLocator)
    }
  }
}
