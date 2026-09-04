import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'

const executable = resolve(process.env.W_EDITOR_DESKTOP_EXE ?? 'apps/desktop/src-tauri/target/debug/w-editor-desktop.exe')
const nativeDriver = resolve(process.env.W_EDITOR_EDGE_DRIVER ?? '.tmp/tauri-webdriver/msedgedriver.exe')
const tauriDriver = resolve(process.env.W_EDITOR_TAURI_DRIVER ?? '.tmp/tauri-driver.exe')
const port = Number(process.env.W_EDITOR_TAURI_LIFECYCLE_PORT ?? 4451)
const nativePort = Number(process.env.W_EDITOR_NATIVE_LIFECYCLE_PORT ?? 9522)
const base = `http://127.0.0.1:${port}`
const testParent = mkdtempSync(resolve('.tmp', 'desktop-lifecycle-'))
const externalPath = join(testParent, 'forwarded.md')
writeFileSync(externalPath, '# Forwarded file')
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

async function waitForWorkspace(sessionId) {
  const deadline = Date.now() + 15_000
  let lastValue = false
  while (Date.now() < deadline) {
    lastValue = await request(`/session/${sessionId}/execute/sync`, 'POST', {
      script: 'return document.querySelector(".workspace-shell") !== null',
      args: [],
    })
    if (lastValue === true) return
    await sleep(150)
  }
  throw new Error(`Desktop workspace did not become ready: ${JSON.stringify(lastValue)}`)
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
let reopenedSessionId = null
let secondProcess = null
try {
  await waitForDriver()
  sessionId = await createSession()
  const selected = await invoke(sessionId, 'select_data_root', [{ parentPath: testParent }])
  if (selected?.status !== 'fulfilled' || selected.value?.state !== 'ready') throw new Error(`Data Root setup failed: ${JSON.stringify(selected)}`)
  await waitForWorkspace(sessionId)
  const documentId = 'lifecycle-document'
  const formalMarkdown = '# Lifecycle article\n\nFormal Markdown.'
  const draftMarkdown = '# Lifecycle article\n\nRecovery draft.'
  const save = await invoke(sessionId, 'library_save_markdown', [{ documentId, title: 'Lifecycle article', markdown: formalMarkdown }])
  if (save?.status !== 'fulfilled') throw new Error(`Formal Library save failed: ${JSON.stringify(save)}`)
  const draft = await invoke(sessionId, 'recovery_save_draft', [{ documentId, baseRevision: save.value.revision, markdown: draftMarkdown }])
  if (draft?.status !== 'fulfilled' || draft.value?.markdown !== draftMarkdown) throw new Error(`Recovery draft save failed: ${JSON.stringify(draft)}`)
  const loadedDraft = await invoke(sessionId, 'recovery_load_draft', [{ documentId }])
  if (loadedDraft?.status !== 'fulfilled' || loadedDraft.value?.markdown !== draftMarkdown) throw new Error(`Recovery draft load failed: ${JSON.stringify(loadedDraft)}`)
  const dirty = await invoke(sessionId, 'set_window_dirty', [{ dirty: true }])
  const blocked = await invoke(sessionId, 'request_window_close')
  if (dirty?.status !== 'fulfilled' || dirty.value?.dirty !== true || blocked?.status !== 'fulfilled' || blocked.value?.state !== 'blocked') throw new Error(`Dirty close was not blocked: ${JSON.stringify({ dirty, blocked })}`)
  const stillOpen = await request(`/session/${sessionId}/execute/sync`, 'POST', { script: 'return document.querySelector(".workspace-shell") !== null', args: [] })
  if (stillOpen !== true) throw new Error('Window/content was lost after dirty close block.')
  const manual = await invoke(sessionId, 'library_save_markdown', [{ documentId, title: 'Lifecycle article', markdown: draftMarkdown }])
  if (manual?.status !== 'fulfilled' || manual.value?.revision !== 2) throw new Error(`Manual save after draft failed: ${JSON.stringify(manual)}`)
  const cleared = await invoke(sessionId, 'recovery_load_draft', [{ documentId }])
  if (cleared?.status !== 'fulfilled' || cleared.value !== null) throw new Error(`Manual save did not clear the recovery draft: ${JSON.stringify(cleared)}`)
  const instance = await invoke(sessionId, 'single_instance_status')
  secondProcess = spawn(executable, [externalPath], { windowsHide: true, stdio: 'ignore' })
  await sleep(1_200)
  const forwarded = await invoke(sessionId, 'single_instance_status')
  if (forwarded?.status !== 'fulfilled' || forwarded.value?.forwardedCount < 1 || !forwarded.value.lastArgs.includes(externalPath)) throw new Error(`Second-instance request was not forwarded: ${JSON.stringify({ instance, forwarded })}`)
  const secondExited = secondProcess.exitCode !== null
  if (!secondExited) secondProcess.kill()
  secondProcess = null
  const clean = await invoke(sessionId, 'set_window_dirty', [{ dirty: false }])
  const allowed = await invoke(sessionId, 'request_window_close')
  if (clean?.status !== 'fulfilled' || clean.value?.dirty !== false || allowed?.status !== 'fulfilled' || allowed.value?.state !== 'allowed') throw new Error(`Clean close was not allowed: ${JSON.stringify({ clean, allowed })}`)
  await sleep(700)
  await request(`/session/${sessionId}/execute/sync`, 'POST', { script: 'return document.title', args: [] }).then(() => { throw new Error('WebView remained alive after clean close.') }).catch((error) => { if (error.message === 'WebView remained alive after clean close.') throw error })
  await request(`/session/${sessionId}`, 'DELETE').catch(() => {})
  sessionId = null
  reopenedSessionId = await createSession()
  const reopened = await invoke(reopenedSessionId, 'library_load_markdown', [{ documentId }])
  if (reopened?.status !== 'fulfilled' || reopened.value?.markdown !== draftMarkdown || reopened.value?.revision !== 2) throw new Error(`Reopened Library state was not restored: ${JSON.stringify(reopened)}`)
  console.log(JSON.stringify({ status: 'passed', save: save.value, draft: draft.value, loadedDraft: loadedDraft.value, blocked: blocked.value, manual: manual.value, cleared: cleared.value, forwarded: forwarded.value, clean: clean.value, allowed: allowed.value, reopened: reopened.value, secondExited, externalPath, testParent }, null, 2))
} finally {
  if (secondProcess !== null) secondProcess.kill()
  if (sessionId !== null) await request(`/session/${sessionId}`, 'DELETE').catch(() => {})
  if (reopenedSessionId !== null) await request(`/session/${reopenedSessionId}`, 'DELETE').catch(() => {})
  driverProcess.kill()
  await sleep(100)
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
