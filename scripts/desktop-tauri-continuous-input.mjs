import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const executable = resolve(process.env.W_EDITOR_DESKTOP_EXE ?? 'apps/desktop/src-tauri/target/debug/w-editor-desktop.exe')
const nativeDriver = resolve(process.env.W_EDITOR_EDGE_DRIVER ?? '.tmp/tauri-webdriver/msedgedriver.exe')
const tauriDriver = resolve(process.env.W_EDITOR_TAURI_DRIVER ?? '.tmp/tauri-driver.exe')
const port = Number(process.env.W_EDITOR_TAURI_INPUT_PORT ?? 4456)
const nativePort = Number(process.env.W_EDITOR_NATIVE_INPUT_PORT ?? 9527)
const base = `http://127.0.0.1:${port}`
const dataRootParent = process.env.W_EDITOR_DATA_ROOT_PARENT ?? null

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

async function execute(sessionId, script) {
  return request(`/session/${sessionId}/execute/sync`, 'POST', { args: [], script })
}

async function invoke(sessionId, command, payload = {}) {
  return request(`/session/${sessionId}/execute/async`, 'POST', {
    args: [payload],
    script: `const done = arguments[arguments.length - 1]; const bridge = globalThis.__TAURI_INTERNALS__; if (bridge === undefined || typeof bridge.invoke !== 'function') { done({ status: 'unavailable' }); } else { bridge.invoke(${JSON.stringify(command)}, arguments[0]).then((value) => done({ status: 'fulfilled', value })).catch((error) => done({ status: 'rejected', error: String(error) })); }`,
  })
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

async function waitFor(sessionId, script, expected, label) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const value = await execute(sessionId, script)
    if (expected(value)) return value
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${label}.`)
}

function keyActions(text) {
  return [...text].flatMap((value) => [{ type: 'keyDown', value }, { type: 'keyUp', value }])
}

function selectDocumentEndScript() {
  return `const editor = document.querySelector('.ProseMirror'); if (!(editor instanceof HTMLElement)) throw new Error('The Visual editor is unavailable.'); const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false); const selection = getSelection(); if (selection === null) throw new Error('Selection is unavailable.'); selection.removeAllRanges(); selection.addRange(range); editor.focus(); return true`
}

requireFile(executable, 'Desktop debug executable')
requireFile(nativeDriver, 'Edge WebDriver')
requireFile(tauriDriver, 'tauri-driver')

const chinese = Array.from({ length: 500 }, (_, index) => '中文输入测试'[index % 6]).join('')
const english = Array.from({ length: 500 }, (_, index) => String.fromCharCode(97 + (index % 26))).join('')
const driverProcess = spawn(tauriDriver, [
  '--port', String(port),
  '--native-port', String(nativePort),
  '--native-driver', nativeDriver,
], { stdio: 'ignore', windowsHide: true })
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
  if (dataRootParent !== null) {
    await waitFor(sessionId, 'return typeof globalThis.__TAURI_INTERNALS__?.invoke === "function"', (value) => value === true, 'Tauri invoke bridge')
    const selected = await invoke(sessionId, 'select_data_root', { parentPath: dataRootParent })
    if (selected?.status !== 'fulfilled' || selected.value?.state !== 'ready') throw new Error(`Data Root setup failed: ${JSON.stringify(selected)}`)
  }
  await waitFor(sessionId,
    `return { ready: document.documentElement.dataset.desktopReady, mode: document.querySelector('[data-testid="editor-surface"]')?.dataset.mode, proseMirror: Boolean(document.querySelector('.ProseMirror')) }`,
    (value) => value?.ready === 'true' && value.mode === 'visual' && value.proseMirror === true,
    'the Desktop Visual surface',
  )
  await execute(sessionId, selectDocumentEndScript())
  await request(`/session/${sessionId}/actions`, 'POST', { actions: [{ type: 'key', id: 'keyboard', actions: keyActions(chinese) }] })
  const afterChinese = await waitFor(sessionId,
    `return document.querySelector('.ProseMirror')?.textContent ?? ''`,
    (value) => typeof value === 'string' && value.endsWith(chinese),
    '500 Chinese characters in Desktop WebView2',
  )
  await execute(sessionId, selectDocumentEndScript())
  await request(`/session/${sessionId}/actions`, 'POST', { actions: [{ type: 'key', id: 'keyboard', actions: keyActions(english) }] })
  const afterEnglish = await waitFor(sessionId,
    `return document.querySelector('.ProseMirror')?.textContent ?? ''`,
    (value) => typeof value === 'string' && value.endsWith(english),
    '500 English characters in Desktop WebView2',
  )
  const errors = await execute(sessionId, `return [...document.querySelectorAll('.workspace-error')].map((node) => node.textContent?.trim() ?? '').filter(Boolean)`)
  if (errors.length > 0) throw new Error(`Desktop continuous input produced workspace errors: ${JSON.stringify(errors)}`)
  console.log(JSON.stringify({
    status: 'passed',
    browser: 'Microsoft Edge WebView2',
    chineseLength: chinese.length,
    chineseTail: afterChinese.slice(-12),
    englishLength: english.length,
    englishTail: afterEnglish.slice(-12),
    errors,
    executable,
  }, null, 2))
} finally {
  if (sessionId !== null) await request(`/session/${sessionId}`, 'DELETE').catch(() => {})
  driverProcess.kill()
}
