import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '..')
const executable = resolve(process.env.W_EDITOR_DESKTOP_EXE ?? 'apps/desktop/src-tauri/target/debug/w-editor-desktop.exe')
const nativeDriver = resolve(process.env.W_EDITOR_EDGE_DRIVER ?? '.tmp/tauri-webdriver/msedgedriver.exe')
const tauriDriver = resolve(process.env.W_EDITOR_TAURI_DRIVER ?? '.tmp/tauri-driver.exe')
const port = Number(process.env.W_EDITOR_TAURI_DRIVER_PORT ?? 4446)
const nativePort = Number(process.env.W_EDITOR_NATIVE_DRIVER_PORT ?? 9517)
const webdriverBase = `http://127.0.0.1:${port}`
const elementKey = 'element-6066-11e4-a52e-4f735466cecf'

function requireFile(path, label) {
  if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`)
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

async function request(path, method = 'GET', body) {
  const response = await fetch(`${webdriverBase}${path}`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { 'content-type': 'application/json' },
    method,
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message = payload?.value?.message ?? payload?.value?.error ?? `HTTP ${response.status}`
    throw new Error(`WebDriver ${method} ${path} failed: ${message}`)
  }
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
  throw new Error('tauri-driver did not become ready within 10 seconds.')
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

async function waitFor(sessionId, script, expected, label, timeout = 10_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const actual = await execute(sessionId, script)
    if (expected(actual)) return actual
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${label}.`)
}

function keyActions(text) {
  return [...text].flatMap((value) => [{ type: 'keyDown', value }, { type: 'keyUp', value }])
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
try {
  await waitForDriver()
  const launchStartedAt = performance.now()
  const session = await request('/session', 'POST', {
    capabilities: {
      alwaysMatch: {
        browserName: 'webview2',
        'tauri:options': {
          application: executable,
          webviewOptions: {},
        },
      },
    },
  })
  sessionId = session?.sessionId ?? null
  const sessionCapabilities = session?.capabilities ?? null
  if (sessionId === null) throw new Error('WebDriver did not return a session id.')

  const identity = await waitFor(sessionId,
    `return { title: document.title, ready: document.documentElement.dataset.desktopReady, workspace: Boolean(document.querySelector('.workspace-shell')), articlePanel: Boolean(document.querySelector('.article-panel')), toolbar: Boolean(document.querySelector('[role="toolbar"]')), proseMirror: Boolean(document.querySelector('.ProseMirror')), commandCount: document.querySelectorAll('[data-command-id]').length, mode: document.querySelector('[data-testid="editor-surface"]')?.dataset.mode }`,
    (value) => value?.ready === 'true' && value.workspace === true && value.articlePanel === true && value.toolbar === true && value.proseMirror === true && value.commandCount === 80 && value.mode === 'visual',
    'the real shared workspace to be ready',
  )

  await click(sessionId, '[data-command-id="mode.source"]')
  const source = await waitFor(sessionId,
    `return { mode: document.querySelector('[data-testid="editor-surface"]')?.dataset.mode, codeMirror: Boolean(document.querySelector('.cm-editor')), sourceText: document.querySelector('.cm-content')?.textContent ?? '' }`,
    (value) => value?.mode === 'source' && value.codeMirror === true,
    'Source mode with CodeMirror',
  )

  await click(sessionId, '[data-command-id="mode.visual"]')
  await waitFor(sessionId,
    `return { mode: document.querySelector('[data-testid="editor-surface"]')?.dataset.mode, proseMirror: Boolean(document.querySelector('.ProseMirror')) }`,
    (value) => value?.mode === 'visual' && value.proseMirror === true,
    'Visual mode with Tiptap',
  )

  const visualId = await find(sessionId, '.ProseMirror')
  await request(`/session/${sessionId}/element/${visualId}/click`, 'POST', {})
  const beforeEdit = await execute(sessionId, `return document.querySelector('.ProseMirror')?.textContent ?? ''`)
  await execute(sessionId, `const element = document.querySelector('.ProseMirror'); const range = document.createRange(); range.selectNodeContents(element); range.collapse(false); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); element.focus(); return true`)
  await request(`/session/${sessionId}/actions`, 'POST', { actions: [{ type: 'key', id: 'keyboard', actions: keyActions(' Tauri spike') }] })
  const afterEdit = await waitFor(sessionId,
    `return document.querySelector('.ProseMirror')?.textContent ?? ''`,
    (value) => typeof value === 'string' && value.endsWith(' Tauri spike'),
    'a real Visual edit',
  )
  await click(sessionId, '[data-command-id="history.undo"]')
  const afterUndo = await waitFor(sessionId,
    `return document.querySelector('.ProseMirror')?.textContent ?? ''`,
    (value) => value === beforeEdit,
    'undo to restore the original Markdown projection',
  )

  await execute(sessionId, `const element = document.querySelector('.ProseMirror'); const textNode = [...element.querySelectorAll('p')].find((node) => (node.textContent ?? '').trim().length > 0)?.firstChild; if (!(textNode instanceof Text)) throw new Error('No selectable Visual text node was found.'); const range = document.createRange(); range.selectNodeContents(textNode); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); element.focus(); return true`)
  await click(sessionId, '[data-command-id="text.bold"]')
  const bold = await waitFor(sessionId,
    `return { strong: Boolean(document.querySelector('.ProseMirror strong')), text: document.querySelector('.ProseMirror')?.textContent ?? '' }`,
    (value) => value?.strong === true,
    'the shared bold command to update Visual semantics',
  )
  await click(sessionId, '[data-command-id="mode.source"]')
  const boldSource = await waitFor(sessionId,
    `return document.querySelector('.cm-content')?.textContent ?? ''`,
    (value) => typeof value === 'string' && value.includes('**'),
    'the bold Markdown authority to round-trip into Source',
  )
  await click(sessionId, '[data-command-id="mode.visual"]')
  await waitFor(sessionId,
    `return Boolean(document.querySelector('.ProseMirror strong'))`,
    (value) => value === true,
    'the bold semantic mark to return to Visual',
  )

  await click(sessionId, '[data-toolbar-menu="theme"] .toolbar-menu__trigger')
  await click(sessionId, '[data-theme-option="dark"]')
  const theme = await waitFor(sessionId,
    `return document.querySelector('.workspace-shell')?.dataset.theme`,
    (value) => value === 'dark',
    'a shared theme update',
  )

  await click(sessionId, '[data-command-id="mode.preview"]')
  const preview = await waitFor(sessionId,
    `return { mode: document.querySelector('[data-testid="editor-surface"]')?.dataset.mode, cherry: Boolean(document.querySelector('.cherry-markdown')), heading: document.querySelector('h1')?.textContent ?? '', strong: Boolean(document.querySelector('.cherry-markdown strong')), code: document.querySelectorAll('.cherry-markdown pre').length, diagrams: document.querySelectorAll('.cherry-markdown svg').length }`,
    (value) => value?.mode === 'preview' && value.cherry === true && value.strong === true,
    'Final Preview with Cherry rendering',
  )
  const screenshot = await request(`/session/${sessionId}/screenshot`)
  const screenshotPath = resolve(repositoryRoot, 'artifacts/desktop-spike/tauri-6-2-final-preview.png')
  mkdirSync(resolve(repositoryRoot, 'artifacts/desktop-spike'), { recursive: true })
  writeFileSync(screenshotPath, Buffer.from(screenshot, 'base64'))

  console.log(JSON.stringify({
    status: 'passed',
    browser: 'Microsoft Edge WebView2',
    browserVersion: sessionCapabilities?.browserVersion ?? 'unknown',
    identity,
    source: { mode: source.mode, codeMirror: source.codeMirror, sourceLength: source.sourceText.length },
    visualEdit: { changed: afterEdit !== beforeEdit, undoRestored: afterUndo === beforeEdit },
    representativeCommand: { boldVisual: bold.strong, markdownRoundTrip: boldSource.includes('**'), boldText: bold.text.slice(0, 80) },
    theme,
    preview,
    screenshotPath: 'artifacts/desktop-spike/tauri-6-2-final-preview.png',
    launch: { sessionReadyMs: Math.round(performance.now() - launchStartedAt) },
  }, null, 2))
} finally {
  if (sessionId !== null) {
    await request(`/session/${sessionId}`, 'DELETE').catch(() => {})
  }
  driverProcess.kill()
}
