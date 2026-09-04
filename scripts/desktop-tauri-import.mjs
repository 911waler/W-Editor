import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'

const executable = resolve(process.env.W_EDITOR_DESKTOP_EXE ?? 'apps/desktop/src-tauri/target/debug/w-editor-desktop.exe')
const nativeDriver = resolve(process.env.W_EDITOR_EDGE_DRIVER ?? '.tmp/tauri-webdriver/msedgedriver.exe')
const tauriDriver = resolve(process.env.W_EDITOR_TAURI_DRIVER ?? '.tmp/tauri-driver.exe')
const port = Number(process.env.W_EDITOR_TAURI_IMPORT_PORT ?? 4450)
const nativePort = Number(process.env.W_EDITOR_NATIVE_IMPORT_PORT ?? 9521)
const base = `http://127.0.0.1:${port}`
const testParent = mkdtempSync(resolve('.tmp', 'desktop-import-'))
const externalPath = join(testParent, 'external.md')
const externalMarkdown = '# External import\n\nOriginal file remains untouched.'
writeFileSync(externalPath, externalMarkdown)
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
const driverProcess = spawn(tauriDriver, ['--port', String(port), '--native-port', String(nativePort), '--native-driver', nativeDriver], { stdio: 'ignore', windowsHide: true })
let sessionId = null
let secondSessionId = null
try {
  await waitForDriver()
  sessionId = await createSession()
  const selected = await invoke(sessionId, 'select_data_root', [{ parentPath: testParent }])
  if (selected?.status !== 'fulfilled' || selected.value?.state !== 'ready') throw new Error(`Data Root setup failed: ${JSON.stringify(selected)}`)
  const selectedRoot = filesystemPath(selected.value.root)
  const initial = await invoke(sessionId, 'import_markdown_start', [{ path: externalPath }])
  if (initial?.status !== 'fulfilled') throw new Error(`Markdown import IPC is not implemented: ${JSON.stringify(initial)}`)
  const closedUntouched = await invoke(sessionId, 'import_markdown_close', [{ sessionId: initial.value.sessionId }])
  if (closedUntouched?.status !== 'fulfilled' || closedUntouched.value?.closed !== true || closedUntouched.value?.created !== false) throw new Error(`Untouched import close failed: ${JSON.stringify(closedUntouched)}`)
  if (existsSync(`${selectedRoot}/library.db`)) throw new Error('Untouched Markdown import created a Library database.')

  const edited = await invoke(sessionId, 'import_markdown_start', [{ path: externalPath }])
  if (edited?.status !== 'fulfilled') throw new Error(`Second Markdown import failed: ${JSON.stringify(edited)}`)
  const importedMarkdown = `${externalMarkdown}\n\nFirst imported edit.`
  const committed = await invoke(sessionId, 'import_markdown_commit', [{ sessionId: edited.value.sessionId, title: 'Imported article', markdown: importedMarkdown, save: false }])
  if (committed?.status !== 'fulfilled' || committed.value?.created !== true || typeof committed.value?.documentId !== 'string' || typeof committed.value?.versionId !== 'string') throw new Error(`Modified Markdown import did not create a Library article: ${JSON.stringify(committed)}`)
  if (!existsSync(`${selectedRoot}/library.db`)) throw new Error('Modified Markdown import did not create library.db.')
  if (readFileSync(externalPath, 'utf8') !== externalMarkdown) throw new Error('Imported external file was modified or written back.')
  const loaded = await invoke(sessionId, 'library_load_markdown', [{ documentId: committed.value.documentId }])
  if (loaded?.status !== 'fulfilled' || loaded.value?.markdown !== importedMarkdown || loaded.value?.revision !== 1) throw new Error(`Imported Library Markdown cannot be loaded: ${JSON.stringify(loaded)}`)
  await request(`/session/${sessionId}`, 'DELETE')
  sessionId = null

  secondSessionId = await createSession()
  const reopened = await invoke(secondSessionId, 'library_load_markdown', [{ documentId: committed.value.documentId }])
  if (reopened?.status !== 'fulfilled' || reopened.value?.markdown !== importedMarkdown || reopened.value?.revision !== 1) throw new Error(`Imported Library article did not survive a new Desktop session: ${JSON.stringify(reopened)}`)
  console.log(JSON.stringify({ status: 'passed', selected: selected.value, untouchedClose: closedUntouched.value, import: edited.value, committed: committed.value, loaded: loaded.value, reopened: reopened.value, externalPath, externalUnchanged: readFileSync(externalPath, 'utf8') === externalMarkdown, databasePath: `${selectedRoot}/library.db`, testParent }, null, 2))
} finally {
  if (sessionId !== null) await request(`/session/${sessionId}`, 'DELETE').catch(() => {})
  if (secondSessionId !== null) await request(`/session/${secondSessionId}`, 'DELETE').catch(() => {})
  driverProcess.kill()
  await sleep(100)
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
