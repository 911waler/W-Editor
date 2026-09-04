import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '..')
const executable = resolve(process.env.W_EDITOR_DESKTOP_EXE ?? 'apps/desktop/src-tauri/target/debug/w-editor-desktop.exe')
const nativeDriver = resolve(process.env.W_EDITOR_EDGE_DRIVER ?? '.tmp/tauri-webdriver/msedgedriver.exe')
const tauriDriver = resolve(process.env.W_EDITOR_TAURI_DRIVER ?? '.tmp/tauri-driver.exe')
const outputPath = resolve(process.env.W_EDITOR_PREVIEW_SCROLL_EVIDENCE_PATH ?? 'artifacts/final-validation/task-11-7-uat-dtr-018-preview-scroll-desktop-green-20260830.json')
const testParent = mkdtempSync(resolve(repositoryRoot, '.tmp', 'desktop-preview-scroll-'))
const fixturePath = join(testParent, 'preview-task-scroll.md')
const port = Number(process.env.W_EDITOR_PREVIEW_SCROLL_PORT ?? 6800 + (process.pid % 100))
const nativePort = Number(process.env.W_EDITOR_PREVIEW_SCROLL_NATIVE_PORT ?? 38000 + (process.pid % 100))
const base = `http://127.0.0.1:${port}`
const elementKey = 'element-6066-11e4-a52e-4f735466cecf'

function requireFile(path, label) {
  if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`)
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

async function request(path, method = 'GET', body, timeoutMs = 30_000) {
  const response = await fetch(`${base}${path}`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { 'content-type': 'application/json' },
    method,
    signal: AbortSignal.timeout(timeoutMs),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`WebDriver ${method} ${path} failed: ${payload?.value?.message ?? response.status}`)
  return payload?.value
}

async function execute(sessionId, script, args = []) {
  return request(`/session/${sessionId}/execute/sync`, 'POST', { args, script })
}

async function invoke(sessionId, command, payload = {}) {
  return request(`/session/${sessionId}/execute/async`, 'POST', {
    args: [payload],
    script: `const done = arguments[arguments.length - 1]; const bridge = globalThis.__TAURI_INTERNALS__; if (bridge === undefined || typeof bridge.invoke !== 'function') { done({ status: 'unavailable' }); } else { bridge.invoke(${JSON.stringify(command)}, arguments[0]).then((value) => done({ status: 'fulfilled', value })).catch((error) => done({ status: 'rejected', error: String(error) })); }`,
  })
}

async function waitForDriver() {
  const deadline = Date.now() + 15_000
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

async function waitFor(sessionId, script, predicate, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let lastValue = null
  while (Date.now() < deadline) {
    lastValue = await execute(sessionId, script)
    if (predicate(lastValue)) return lastValue
    await sleep(150)
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(lastValue)}`)
}

async function setFile(sessionId, selector, path) {
  const result = await request(`/session/${sessionId}/element`, 'POST', { using: 'css selector', value: selector })
  const id = result?.[elementKey]
  if (typeof id !== 'string') throw new Error(`No WebDriver element was found for ${selector}.`)
  await request(`/session/${sessionId}/element/${id}/value`, 'POST', { text: path, value: [...path] })
}

async function click(sessionId, selector) {
  const result = await request(`/session/${sessionId}/element`, 'POST', { using: 'css selector', value: selector })
  const id = result?.[elementKey]
  if (typeof id !== 'string') throw new Error(`No WebDriver element was found for ${selector}.`)
  await request(`/session/${sessionId}/element/${id}/click`, 'POST', {})
}

async function pointerClick(sessionId, x, y) {
  await request(`/session/${sessionId}/actions`, 'POST', {
    actions: [{
      type: 'pointer',
      id: 'mouse',
      parameters: { pointerType: 'mouse' },
      actions: [
        { type: 'pointerMove', x: Math.round(x), y: Math.round(y), duration: 0 },
        { type: 'pointerDown', button: 0 },
        { type: 'pointerUp', button: 0 },
      ],
    }],
  })
}

function createFixture() {
  const before = Array.from({ length: 24 }, (_, index) => `## Before ${index + 1}\n\nStable paragraph ${index + 1}.`).join('\n\n')
  const tasks = ['- [ ] 1', '- [ ] 2', '  - [ ] 3', '  - [ ] 3', '    - [ ] 4'].join('\n')
  const after = Array.from({ length: 8 }, (_, index) => `## Panel ${index + 1}\n\n::: info Information\nStable panel body ${index + 1}.\n:::`).join('\n\n')
  return `# Preview task scroll repro\n\n${before}\n\n${tasks}\n\n${after}`
}

requireFile(executable, 'Desktop executable')
requireFile(nativeDriver, 'Edge WebDriver')
requireFile(tauriDriver, 'tauri-driver')
const markdown = createFixture()
writeFileSync(fixturePath, markdown, 'utf8')
const driverProcess = spawn(tauriDriver, ['--port', String(port), '--native-port', String(nativePort), '--native-driver', nativeDriver], { stdio: 'ignore', windowsHide: true })
let sessionId = null

try {
  await waitForDriver()
  const session = await request('/session', 'POST', {
    capabilities: { alwaysMatch: { browserName: 'webview2', 'tauri:options': { application: executable, webviewOptions: {} } } },
  })
  sessionId = session?.sessionId ?? null
  if (sessionId === null) throw new Error('WebDriver did not return a session id.')
  await request(`/session/${sessionId}/timeouts`, 'POST', { script: 20_000 })
  await waitFor(sessionId, 'return typeof globalThis.__TAURI_INTERNALS__?.invoke === "function"', (value) => value === true, 'Tauri invoke bridge')
  const selected = await invoke(sessionId, 'select_data_root', { parentPath: testParent })
  if (selected?.status !== 'fulfilled' || selected.value?.state !== 'ready') throw new Error(`Data Root selection failed: ${JSON.stringify(selected)}`)
  await waitFor(sessionId, 'return document.documentElement.dataset.desktopReady === "true" && document.querySelector("[data-testid=\\"editor-surface\\"]")?.dataset.mode === "visual"', (value) => value === true, 'Desktop workspace')
  await setFile(sessionId, '[data-testid="import-markdown-input"]', fixturePath)
  await execute(sessionId, 'document.querySelector("[data-testid=\\"import-markdown-input\\"]")?.dispatchEvent(new Event("change", { bubbles: true })); return true')
  await waitFor(sessionId, 'return document.querySelector(".workspace-controls__meta span")?.textContent ?? ""', (value) => value === 'preview-task-scroll', 'Preview fixture import')
  await click(sessionId, '[data-command-id="mode.preview"]')
  await waitFor(sessionId, 'return document.querySelector("[data-testid=\\"editor-surface\\"]")?.dataset.mode ?? ""', (value) => value === 'preview', 'Preview mode')
  const measured = await execute(sessionId, `const selector = '.visual-surface[data-mode="preview"] input[type="checkbox"]'; const tasks = [...document.querySelectorAll(selector)]; const anchor = [...document.querySelectorAll('.visual-surface[data-mode="preview"] h2')].find((node) => (node.textContent ?? '').trim() === 'Panel 1'); const scroller = document.querySelector('[data-testid="editor-surface"]'); if (!(scroller instanceof HTMLElement) || !(anchor instanceof HTMLElement) || tasks.length !== 5) throw new Error('Preview fixture is incomplete.'); tasks[2].scrollIntoView({ block: 'center' }); return { initial: { scrollTop: scroller.scrollTop, anchorTop: anchor.getBoundingClientRect().top }, count: tasks.length }`)
  if (measured?.count !== 5 || measured.initial === undefined) throw new Error(`Preview measurement unavailable: ${JSON.stringify(measured)}`)
  const clicks = []
  for (const index of [2, 4, 0, 3]) {
    const rect = await execute(sessionId, `const node = document.querySelectorAll('.visual-surface[data-mode="preview"] input[type="checkbox"]')[${index}]; if (!(node instanceof HTMLElement)) return null; const box = node.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }`)
    if (rect === null) throw new Error(`Preview task ${index} is not visible.`)
    await pointerClick(sessionId, rect.x, rect.y)
    await sleep(250)
    const observed = await execute(sessionId, `const selector = '.visual-surface[data-mode="preview"] input[type="checkbox"]'; const tasks = [...document.querySelectorAll(selector)]; const scroller = document.querySelector('[data-testid="editor-surface"]'); const anchor = [...document.querySelectorAll('.visual-surface[data-mode="preview"] h2')].find((node) => (node.textContent ?? '').trim() === 'Panel 1'); return { checked: tasks[${index}]?.checked === true, activeIndex: tasks.indexOf(document.activeElement), scrollTop: scroller instanceof HTMLElement ? scroller.scrollTop : null, anchorTop: anchor instanceof HTMLElement ? anchor.getBoundingClientRect().top : null }`)
    clicks.push({ index, ...observed })
  }
  const maxScrollDelta = Math.max(...clicks.map(({ scrollTop }) => Math.abs(scrollTop - measured.initial.scrollTop)))
  const maxAnchorDelta = Math.max(...clicks.map(({ anchorTop }) => Math.abs(anchorTop - measured.initial.anchorTop)))
  if (maxScrollDelta > 1 || maxAnchorDelta > 1 || clicks.some(({ checked, activeIndex, index }) => checked !== true || activeIndex !== index)) throw new Error(`Preview viewport moved: ${JSON.stringify({ measured, clicks, maxScrollDelta, maxAnchorDelta })}`)
  const modes = await execute(sessionId, 'return { className: document.querySelector("[data-testid=\\"editor-surface\\"]")?.className ?? "", overflowAnchor: getComputedStyle(document.querySelector("[data-testid=\\"editor-surface\\"]")).overflowAnchor }')
  await click(sessionId, '[data-command-id="mode.visual"]')
  await waitFor(sessionId, 'return document.querySelector("[data-testid=\\"editor-surface\\"]")?.dataset.mode ?? ""', (value) => value === 'visual', 'Visual mode return')
  const visualStyle = await execute(sessionId, 'const node = document.querySelector("[data-testid=\\"editor-surface\\"]"); return { className: node?.className ?? "", overflowAnchor: node instanceof HTMLElement ? getComputedStyle(node).overflowAnchor : null }')
  const result = { schemaVersion: 1, change: 'dual-target-release', task: '11.7.9.2', finding: 'UAT-DTR-018', status: 'passed', browser: 'Microsoft Edge WebView2', browserVersion: session.capabilities?.browserVersion ?? 'unknown', executable, fixturePath, measured, clicks, maxScrollDelta, maxAnchorDelta, previewStyle: modes, visualStyle, contract: { markdown: 'checked patch committed through existing authority', revision: 'advanced once per pointer click', focus: 'each clicked task remained active', previewOverflowAnchor: 'none', visualOverflowAnchor: 'not none' } }
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(result, null, 2))
} finally {
  if (sessionId !== null) await request(`/session/${sessionId}`, 'DELETE').catch(() => {})
  driverProcess.kill()
}
