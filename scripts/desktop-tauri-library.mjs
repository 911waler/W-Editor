import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'

const executable = resolve(process.env.W_EDITOR_DESKTOP_EXE ?? 'apps/desktop/src-tauri/target/debug/w-editor-desktop.exe')
const nativeDriver = resolve(process.env.W_EDITOR_EDGE_DRIVER ?? '.tmp/tauri-webdriver/msedgedriver.exe')
const tauriDriver = resolve(process.env.W_EDITOR_TAURI_DRIVER ?? '.tmp/tauri-driver.exe')
const port = Number(process.env.W_EDITOR_TAURI_LIBRARY_PORT ?? 4449)
const nativePort = Number(process.env.W_EDITOR_NATIVE_LIBRARY_PORT ?? 9520)
const base = `http://127.0.0.1:${port}`
const testParent = mkdtempSync(resolve('.tmp', 'desktop-library-'))
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

async function invoke(sessionId, command, args = []) {
  return request(`/session/${sessionId}/execute/async`, 'POST', {
    args,
    script: `const done = arguments[arguments.length - 1]; const bridge = globalThis.__TAURI_INTERNALS__; if (bridge === undefined || typeof bridge.invoke !== 'function') { done({ status: 'unavailable' }); } else { bridge.invoke(${JSON.stringify(command)}, arguments[0]).then((value) => done({ status: 'fulfilled', value })).catch((error) => done({ status: 'rejected', error: String(error) })); }`,
  })
}

function filesystemPath(value) {
  return typeof value === 'string' ? value.replace(/^\\\\\?\\/u, '') : value
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
  const sessionId = session?.sessionId ?? null
  if (sessionId === null) throw new Error('WebDriver did not return a session id.')
  await request(`/session/${sessionId}/timeouts`, 'POST', { script: 10_000 })
  return sessionId
}

requireFile(executable, 'Desktop debug executable')
requireFile(nativeDriver, 'Edge WebDriver')
requireFile(tauriDriver, 'tauri-driver')

const driverProcess = spawn(tauriDriver, [
  '--port', String(port),
  '--native-port', String(nativePort),
  '--native-driver', nativeDriver,
], { stdio: 'ignore', windowsHide: true })
let sessionId = null
let secondSessionId = null
try {
  await waitForDriver()
  sessionId = await createSession()
  const initial = await invoke(sessionId, 'data_root_status')
  if (initial?.status !== 'fulfilled') throw new Error(`Data Root status is unavailable: ${JSON.stringify(initial)}`)
  const selected = await invoke(sessionId, 'select_data_root', [{ parentPath: testParent }])
  if (selected?.status !== 'fulfilled' || selected.value?.state !== 'ready') throw new Error(`Data Root selection failed: ${JSON.stringify(selected)}`)
  const selectedRoot = filesystemPath(selected.value.root)

  const missing = await invoke(sessionId, 'library_load_markdown', [{ documentId: 'library-red-before-save' }])
  if (missing?.status !== 'rejected') throw new Error(`Expected an empty Library before first save: ${JSON.stringify(missing)}`)
  const documentId = 'spike-document'
  const firstMarkdown = '# SQLite Spike\n\nFirst durable Markdown.'
  const firstSave = await invoke(sessionId, 'library_save_markdown', [{ documentId, title: 'SQLite Spike', markdown: firstMarkdown }])
  if (firstSave?.status !== 'fulfilled' || firstSave.value?.revision !== 1 || firstSave.value?.versionId !== `${documentId}-1`) throw new Error(`Initial Library save failed: ${JSON.stringify(firstSave)}`)
  if (!existsSync(`${selectedRoot}/library.db`)) throw new Error('library.db was not created inside the selected Data Root.')

  const rollbackMarkdown = '# SQLite Spike\n\nThis must roll back.'
  const failedSave = await invoke(sessionId, 'library_save_markdown', [{ documentId, title: 'SQLite Spike', markdown: rollbackMarkdown, requestedRevision: 1 }])
  if (failedSave?.status !== 'rejected' || !String(failedSave.error).includes('rolled back')) throw new Error(`Expected duplicate revision transaction failure: ${JSON.stringify(failedSave)}`)
  const afterRollback = await invoke(sessionId, 'library_load_markdown', [{ documentId }])
  if (afterRollback?.status !== 'fulfilled' || afterRollback.value?.markdown !== firstMarkdown || afterRollback.value?.revision !== 1) throw new Error(`SQLite rollback changed the durable Markdown: ${JSON.stringify(afterRollback)}`)

  const secondMarkdown = '# SQLite Spike\n\nSecond durable Markdown.'
  const secondSave = await invoke(sessionId, 'library_save_markdown', [{ documentId, title: 'SQLite Spike', markdown: secondMarkdown }])
  if (secondSave?.status !== 'fulfilled' || secondSave.value?.revision !== 2 || secondSave.value?.versionId !== `${documentId}-2`) throw new Error(`Second Library save failed: ${JSON.stringify(secondSave)}`)
  const schema = await invoke(sessionId, 'library_schema_status')
  if (schema?.status !== 'fulfilled' || schema.value?.schemaVersion !== 2 || schema.value?.foreignKeys !== true || schema.value?.mode !== 'ready') throw new Error(`Versioned SQLite schema probe failed: ${JSON.stringify(schema)}`)
  await request(`/session/${sessionId}`, 'DELETE')
  sessionId = null

  secondSessionId = await createSession()
  const reopened = await invoke(secondSessionId, 'library_load_markdown', [{ documentId }])
  if (reopened?.status !== 'fulfilled' || reopened.value?.markdown !== secondMarkdown || reopened.value?.revision !== 2) throw new Error(`Reopened Library Markdown did not reconstruct from SQLite: ${JSON.stringify(reopened)}`)
  console.log(JSON.stringify({ status: 'passed', initial, selected: selected.value, firstSave: firstSave.value, failedSave, afterRollback: afterRollback.value, secondSave: secondSave.value, schema: schema.value, reopened: reopened.value, databasePath: `${selectedRoot}/library.db`, testParent }, null, 2))
} finally {
  if (sessionId !== null) await request(`/session/${sessionId}`, 'DELETE').catch(() => {})
  if (secondSessionId !== null) await request(`/session/${secondSessionId}`, 'DELETE').catch(() => {})
  driverProcess.kill()
  await sleep(100)
  if (process.env.W_EDITOR_KEEP_DATA_ROOT !== '1') {
    if (previousLocator === null) {
      if (existsSync(locatorPath)) {
        const { unlinkSync } = await import('node:fs')
        unlinkSync(locatorPath)
      }
    } else {
      const { mkdirSync, writeFileSync } = await import('node:fs')
      mkdirSync(resolve(locatorPath, '..'), { recursive: true })
      writeFileSync(locatorPath, previousLocator)
    }
  }
}
