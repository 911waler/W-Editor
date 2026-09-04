import { existsSync, mkdtempSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'

const executable = resolve(process.env.W_EDITOR_DESKTOP_EXE ?? 'apps/desktop/src-tauri/target/debug/w-editor-desktop.exe')
const nativeDriver = resolve(process.env.W_EDITOR_EDGE_DRIVER ?? '.tmp/tauri-webdriver/msedgedriver.exe')
const tauriDriver = resolve(process.env.W_EDITOR_TAURI_DRIVER ?? '.tmp/tauri-driver.exe')
const port = Number(process.env.W_EDITOR_DESKTOP_LIFECYCLE_UI_PORT ?? 4455)
const nativePort = Number(process.env.W_EDITOR_DESKTOP_LIFECYCLE_UI_NATIVE_PORT ?? 9526)
const base = `http://127.0.0.1:${port}`
const testParent = mkdtempSync(resolve('.tmp', 'desktop-lifecycle-ui-'))

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

async function waitFor(sessionId, script, predicate, label, timeout = 10_000) {
  const deadline = Date.now() + timeout
  let lastValue = null
  while (Date.now() < deadline) {
    lastValue = await execute(sessionId, script)
    if (predicate(lastValue)) return lastValue
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(lastValue)}`)
}

requireFile(executable, 'Desktop debug executable')
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
  const selected = await invoke(sessionId, 'select_data_root', [{ parentPath: testParent }])
  if (selected?.status !== 'fulfilled' || selected.value?.state !== 'ready') throw new Error(`Data Root setup failed: ${JSON.stringify(selected)}`)
  await waitFor(sessionId, `return { ready: document.documentElement.dataset.desktopReady === 'true', workspace: Boolean(document.querySelector('.workspace-shell')), state: document.querySelector('[data-data-root-state]')?.getAttribute('data-data-root-state') ?? '', setup: document.querySelector('[data-testid="desktop-data-root-setup"]')?.textContent?.slice(-500) ?? '' }`, (value) => value?.ready === true && value.workspace === true, 'the Desktop workspace')
  const dirty = await invoke(sessionId, 'set_window_dirty', [{ dirty: true }])
  const blocked = await invoke(sessionId, 'request_window_close')
  if (dirty?.status !== 'fulfilled' || blocked?.status !== 'fulfilled' || blocked.value?.state !== 'blocked') throw new Error(`Dirty close was not blocked: ${JSON.stringify({ dirty, blocked })}`)
  await waitFor(sessionId,
    `return { dialog: Boolean(document.querySelector('[data-testid="desktop-close-dialog"]')), options: document.querySelectorAll('[data-testid^="desktop-close-"]').length, body: document.body.innerText.slice(-800), state: document.querySelector('[data-testid="desktop-error-state"]')?.textContent?.trim() ?? '' }`,
    (value) => value?.dialog === true && value.options >= 4,
    'the lifecycle close decision dialog',
  )
  await execute(sessionId, `document.querySelector('[data-testid="desktop-close-cancel"]')?.click(); return true`)
  const cancelled = await waitFor(sessionId, `return { dialog: Boolean(document.querySelector('[data-testid="desktop-close-dialog"]')), workspace: Boolean(document.querySelector('.workspace-shell')), focus: document.activeElement?.className ?? '' }`, (value) => value?.dialog === false && value.workspace === true, 'cancel to restore the Desktop workspace')
  await execute(sessionId, `const editor = document.querySelector('.ProseMirror'); if (!(editor instanceof HTMLElement)) throw new Error('Visual editor is unavailable.'); const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false); const selection = getSelection(); if (selection === null) throw new Error('Selection is unavailable.'); selection.removeAllRanges(); selection.addRange(range); editor.focus(); return true`)
  await request(`/session/${sessionId}/actions`, 'POST', { actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value: 'x' }, { type: 'keyUp', value: 'x' }] }] })
  await waitFor(sessionId, `return { dirty: document.querySelector('.workspace-shell')?.getAttribute('data-dirty') ?? '', text: document.querySelector('.ProseMirror')?.textContent ?? '' }`, (value) => value?.dirty === 'true', 'the shared dirty state before article switching')
  const fromDocument = await waitFor(sessionId, `return document.querySelector('.workspace-shell')?.getAttribute('data-document-id') ?? ''`, (value) => value.length > 0, 'the active document identity')
  await execute(sessionId, `window.__desktopDownloads__ = []; const anchorClick = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function() { window.__desktopDownloads__.push({ download: this.download, href: this.href }); }; return true`)
  await execute(sessionId, `const article = document.querySelectorAll('[data-testid="desktop-library-article"]')[1]; if (!(article instanceof HTMLElement)) throw new Error('Second article is unavailable.'); article.click(); return true`)
  await waitFor(sessionId, `return { dialog: Boolean(document.querySelector('[data-testid="article-switch-decision"]')), dirty: document.querySelector('.workspace-shell')?.getAttribute('data-dirty') ?? '', cards: document.querySelectorAll('[data-testid="desktop-library-article"]').length, active: document.querySelector('.workspace-shell')?.getAttribute('data-document-id') ?? '', body: document.body.innerText.slice(-500) }`, (value) => value?.dialog === true, 'the dirty article-switch decision')
  await execute(sessionId, `document.querySelector('[data-testid="article-switch-export"]')?.click(); return true`)
  const switched = await waitFor(sessionId, `return { documentId: document.querySelector('.workspace-shell')?.getAttribute('data-document-id') ?? '', dialog: Boolean(document.querySelector('[data-testid="article-switch-decision"]')), downloads: window.__desktopDownloads__ ?? [] }`, (value) => value?.dialog === false && value.documentId.length > 0 && value.documentId !== fromDocument && value.downloads.length === 1, 'the article switch after exporting')
  if (!String(switched.downloads[0]?.download ?? '').endsWith('.md')) throw new Error(`Lifecycle export did not create a Markdown download: ${JSON.stringify(switched)}`)
  await execute(sessionId, `document.querySelector('[data-testid="desktop-settings-entry"]')?.click(); return true`)
  await waitFor(sessionId, `return Boolean(document.querySelector('[data-testid="desktop-settings-migration"]'))`, (value) => value === true, 'Data migration settings')
  await execute(sessionId, `const input = document.querySelector('[data-testid="desktop-migration-parent"]'); if (!(input instanceof HTMLInputElement)) throw new Error('Data Root migration input is unavailable.'); input.value = ${JSON.stringify(join(testParent, 'migrated'))}; input.dispatchEvent(new Event('input', { bubbles: true })); return true`)
  await execute(sessionId, `document.querySelector('[data-testid="desktop-migrate-data-root"]')?.click(); return true`)
  await waitFor(sessionId, `return Boolean(document.querySelector('[data-testid="desktop-close-dialog"]'))`, (value) => value === true, 'the migration lifecycle decision')
  await execute(sessionId, `document.querySelector('[data-testid="desktop-close-draft"]')?.click(); return true`)
  const migration = await waitFor(sessionId, `return document.querySelector('[data-testid="desktop-library-status"] .desktop-app-header__status-path')?.textContent?.trim() ?? ''`, (value) => value.includes('migrated') && value.includes('W-EditorData'), 'the migrated Data Root')
  const dirtyAgain = await invoke(sessionId, 'set_window_dirty', [{ dirty: true }])
  await sleep(350)
  const blockedAgain = await invoke(sessionId, 'request_window_close')
  if (blockedAgain?.status !== 'fulfilled' || blockedAgain.value?.state !== 'blocked') throw new Error(`Second dirty close was not blocked: ${JSON.stringify(blockedAgain)}`)
  await waitFor(sessionId, `return { dialog: Boolean(document.querySelector('[data-testid="desktop-close-dialog"]')), state: document.querySelector('[data-testid="desktop-error-state"]')?.textContent?.trim() ?? '', body: document.body.innerText.slice(-500) }`, (value) => value?.dialog === true, 'the second close decision dialog')
  await execute(sessionId, `document.querySelector('[data-testid="desktop-close-draft"]')?.click(); return true`)
  await sleep(750)
  let closed = false
  try {
    await execute(sessionId, 'return document.title')
  } catch {
    closed = true
  }
  if (!closed) throw new Error('The Desktop window remained open after keeping the recovery draft.')
  console.log(JSON.stringify({ status: 'passed', browserVersion: session?.capabilities?.browserVersion ?? 'unknown', dirty: dirty.value, blocked: blocked.value, cancelled, switched, migration, dirtyAgain: dirtyAgain.value, closed }, null, 2))
} finally {
  if (sessionId !== null) await request(`/session/${sessionId}`, 'DELETE').catch(() => {})
  driverProcess.kill()
}
