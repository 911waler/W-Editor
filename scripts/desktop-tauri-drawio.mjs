import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'

const executable = resolve(process.env.W_EDITOR_DESKTOP_EXE ?? 'apps/desktop/src-tauri/target/debug/w-editor-desktop.exe')
const nativeDriver = resolve(process.env.W_EDITOR_EDGE_DRIVER ?? '.tmp/tauri-webdriver/msedgedriver.exe')
const tauriDriver = resolve(process.env.W_EDITOR_TAURI_DRIVER ?? '.tmp/tauri-driver.exe')
const port = Number(process.env.W_EDITOR_TAURI_DRAWIO_PORT ?? 4452)
const nativePort = Number(process.env.W_EDITOR_NATIVE_DRAWIO_PORT ?? 9523)
const base = `http://127.0.0.1:${port}`
const testParent = mkdtempSync(resolve('.tmp', 'desktop-drawio-'))
const locatorPath = process.env.W_EDITOR_REAL_LOCATOR_PATH ?? join(process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming'), 'com.weditor.desktop.spike', 'data-root.json')
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

async function waitFor(sessionId, script, predicate, label, timeout = 30_000) {
  const deadline = Date.now() + timeout
  let lastValue = null
  while (Date.now() < deadline) {
    const value = await execute(sessionId, script)
    lastValue = value
    if (predicate(value)) return value
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(lastValue)}`)
}

async function waitForDraft(sessionId, documentId, predicate, label, timeout = 30_000) {
  const deadline = Date.now() + timeout
  let lastValue = null
  while (Date.now() < deadline) {
    lastValue = await invoke(sessionId, 'recovery_load_draft', [{ documentId }])
    if (lastValue?.status === 'fulfilled' && predicate(lastValue.value)) return lastValue.value
    await sleep(150)
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(lastValue)}`)
}

async function find(sessionId, selector) {
  const value = await request(`/session/${sessionId}/element`, 'POST', { using: 'css selector', value: selector })
  const id = value?.['element-6066-11e4-a52e-4f735466cecf']
  if (typeof id !== 'string') throw new Error(`No WebDriver element for ${selector}.`)
  return id
}

async function click(sessionId, selector) {
  const id = await find(sessionId, selector)
  await request(`/session/${sessionId}/element/${id}/click`, 'POST', {})
}

async function hover(sessionId, selector) {
  const id = await find(sessionId, selector)
  await request(`/session/${sessionId}/actions`, 'POST', {
    actions: [{
      actions: [{ origin: { 'element-6066-11e4-a52e-4f735466cecf': id }, type: 'pointerMove', x: 2, y: 2 }],
      id: 'mouse',
      parameters: { pointerType: 'mouse' },
      type: 'pointer',
    }],
  })
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

function containsDrawioEdit(markdown) {
  if (markdown.includes('Edited in Tauri draw.io') || markdown.includes(encodeURIComponent('Edited in Tauri draw.io'))) return true
  try {
    return decodeURIComponent(markdown).includes('Edited in Tauri draw.io')
  } catch {
    return false
  }
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
  return { id, browserVersion: session?.capabilities?.browserVersion ?? 'unknown' }
}

requireFile(executable, 'Desktop debug executable')
requireFile(nativeDriver, 'Edge WebDriver')
requireFile(tauriDriver, 'tauri-driver')
const driverProcess = spawn(tauriDriver, ['--port', String(port), '--native-port', String(nativePort), '--native-driver', nativeDriver], { stdio: 'ignore', windowsHide: true })
let sessionId = null
try {
  await waitForDriver()
  const createdSession = await createSession()
  sessionId = createdSession.id
  const browserVersion = createdSession.browserVersion
  const selected = await invoke(sessionId, 'select_data_root', [{ parentPath: testParent }])
  if (selected?.status !== 'fulfilled' || selected.value?.state !== 'ready') throw new Error(`Data Root setup failed: ${JSON.stringify(selected)}`)
  await waitFor(sessionId, `return { ready: document.documentElement.dataset.desktopReady === 'true', workspace: Boolean(document.querySelector('.workspace-shell')), command: Boolean(document.querySelector('[data-command-id="insert.drawio"]')) }`, (value) => value?.ready === true && value.workspace === true && value.command === true, 'the installed shared workspace before opening draw.io')

  await click(sessionId, '[data-command-id="insert.drawio"]')
  const drawioReadyTimeout = Number(process.env.W_EDITOR_DRAWIO_TIMEOUT_MS ?? 60_000)
  const frameReady = await waitFor(sessionId,
    `const frame = document.querySelector('[data-testid="drawio-bridge-frame"]'); const bridgeDocument = frame?.contentDocument; const editorFrame = bridgeDocument?.querySelector('#drawio-editor'); const child = editorFrame?.contentWindow; const childDocument = editorFrame?.contentDocument; return { dialog: Boolean(document.querySelector('[data-editor-command="insert.drawio"]')), frameSrc: frame?.src ?? '', bridgeReadyState: bridgeDocument?.readyState ?? 'unavailable', bridgeBody: bridgeDocument?.body?.innerText?.slice(0, 100) ?? '', childUrl: child?.location?.href ?? '', childReadyState: childDocument?.readyState ?? 'unavailable', childTitle: childDocument?.title ?? '', childBody: childDocument?.body?.innerText?.slice(0, 300) ?? '', editorReady: Boolean(child?.editorUIInstance), drawioMenu: Boolean(childDocument?.querySelector('.geMenubarContainer')), childScripts: childDocument?.scripts?.length ?? 0 }`,
    (value) => value?.dialog === true && value.editorReady === true && value.drawioMenu === true,
    'the packaged draw.io runtime to be ready',
    drawioReadyTimeout,
  )
  console.log(`DRAWIO_FRAME_READY ${JSON.stringify(frameReady)}`)
  const drawioSource = await execute(sessionId, `const frame = document.querySelector('[data-testid="drawio-bridge-frame"]'); const editorFrame = frame?.contentDocument?.querySelector('#drawio-editor'); const childWindow = editorFrame?.contentWindow; return { src: frame?.src ?? '', childUrl: childWindow?.location?.href ?? '', bridgeResources: performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => /drawio|mxgraph|bridge/i.test(name)).slice(-20), editorResources: childWindow?.performance?.getEntriesByType('resource').map((entry) => entry.name).filter((name) => /drawio|mxgraph|bridge/i.test(name)).slice(-40) ?? [] }`)

  const editedGraph = await execute(sessionId, `const frame = document.querySelector('[data-testid="drawio-bridge-frame"]'); const editorFrame = frame?.contentDocument?.querySelector('#drawio-editor'); const editor = editorFrame?.contentWindow?.editorUIInstance?.editor; const graph = editor?.graph; if (graph === undefined) throw new Error('Packaged draw.io graph API is unavailable.'); const model = graph.getModel(); model.beginUpdate(); try { graph.insertVertex(graph.getDefaultParent(), 'tauri-spike-edit', 'Edited in Tauri draw.io', 80, 80, 220, 40); } finally { model.endUpdate(); } const xml = editor?.getGraphXml?.(); return { graphContainsEdit: Boolean(model.getCell('tauri-spike-edit')), xml: xml === undefined ? '' : new XMLSerializer().serializeToString(xml) }`)
  if (editedGraph?.graphContainsEdit !== true || !editedGraph.xml.includes('Edited in Tauri draw.io')) throw new Error(`draw.io graph edit did not persist in the editor model: ${JSON.stringify({ graphContainsEdit: editedGraph?.graphContainsEdit, xmlHasEdit: editedGraph?.xml?.includes('Edited in Tauri draw.io') })}`)
  console.log(`DRAWIO_GRAPH_EDIT ${JSON.stringify({ graphContainsEdit: editedGraph.graphContainsEdit, xmlLength: editedGraph.xml.length, xmlHasEdit: editedGraph.xml.includes('Edited in Tauri draw.io') })}`)
  await click(sessionId, '[data-testid="drawio-apply"]')
  await waitFor(sessionId, `return Boolean(document.querySelector('[data-editor-command="insert.drawio"]'))`, (value) => value === false, 'draw.io Apply to close the dialog')
  const postApply = await execute(sessionId, `return { source: document.querySelector('.cm-content')?.textContent ?? '', visual: document.querySelector('.ProseMirror')?.textContent ?? '', feedback: document.querySelector('.status-region__command')?.textContent?.trim() ?? '', errors: [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent?.trim() ?? '').filter(Boolean) }`)
  console.log(`DRAWIO_POST_APPLY ${JSON.stringify({ sourceLength: postApply.source.length, visualTail: postApply.visual.slice(-160), feedback: postApply.feedback, errors: postApply.errors, sourceHasEdit: decodeURIComponent(postApply.source).includes('Edited in Tauri draw.io'), sourceHasPng: postApply.source.includes('data:image/png;base64,') })}`)
  const documentId = await execute(sessionId, `return document.querySelector('.workspace-shell')?.getAttribute('data-document-id') ?? ''`)
  const appliedDraft = await waitForDraft(sessionId, documentId, (draft) => typeof draft?.markdown === 'string' && containsDrawioEdit(draft.markdown) && draft.markdown.includes('data:image/png;base64,'), 'the complete persisted draw.io recovery draft')
  console.log(`DRAWIO_DRAFT ${JSON.stringify({ documentId, revision: appliedDraft.baseRevision, markdownLength: appliedDraft.markdown.length, hasEdit: containsDrawioEdit(appliedDraft.markdown), hasPng: appliedDraft.markdown.includes('data:image/png;base64,') })}`)
  await click(sessionId, '[data-command-id="mode.source"]')
  await waitFor(sessionId, `return Boolean(document.querySelector('.cm-content'))`, (value) => value === true, 'Source mode after draw.io Apply')
  const sourceAfterMode = await execute(sessionId, `return document.querySelector('.cm-content')?.textContent ?? ''`)
  console.log(`DRAWIO_SOURCE_AFTER_MODE ${JSON.stringify({ length: sourceAfterMode.length, tail: sourceAfterMode.slice(-500), visibleHasEdit: containsDrawioEdit(sourceAfterMode), visibleHasPng: sourceAfterMode.includes('data:image/png;base64,'), authorityHasEdit: containsDrawioEdit(appliedDraft.markdown), authorityHasPng: appliedDraft.markdown.includes('data:image/png;base64,') })}`)
  const appliedMarkdown = appliedDraft.markdown
  await click(sessionId, '[data-command-id="mode.visual"]')

  const beforeCancel = appliedMarkdown
  await hover(sessionId, '[data-semantic-kind="drawio"]')
  const editButtonFocused = await execute(sessionId, `const editButton = document.querySelector('[data-semantic-edit="drawio-editor"]'); editButton?.scrollIntoView({ block: 'center', inline: 'center' }); editButton?.focus(); return document.activeElement === editButton`)
  if (editButtonFocused !== true) throw new Error('draw.io edit control could not receive keyboard focus.')
  await request(`/session/${sessionId}/actions`, 'POST', { actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value: '\uE007' }, { type: 'keyUp', value: '\uE007' }] }] })
  await waitFor(sessionId, `const frame = document.querySelector('[data-testid="drawio-bridge-frame"]'); const editorFrame = frame?.contentDocument?.querySelector('#drawio-editor'); return Boolean(document.querySelector('[data-editor-command="insert.drawio"]')) && Boolean(editorFrame?.contentWindow?.editorUIInstance)`, (value) => value === true, 'draw.io reopen editor')
  const reopenedGraph = await execute(sessionId, `const frame = document.querySelector('[data-testid="drawio-bridge-frame"]'); const editorFrame = frame?.contentDocument?.querySelector('#drawio-editor'); const xml = editorFrame?.contentWindow?.editorUIInstance?.editor?.getGraphXml?.(); return xml === undefined ? '' : new XMLSerializer().serializeToString(xml)`)
  if (!String(reopenedGraph).includes('Edited in Tauri draw.io')) throw new Error('Reopened draw.io graph did not contain the applied edit.')
  await click(sessionId, '[data-editor-command="insert.drawio"] .drawio-dialog__actions button:first-child')
  await waitFor(sessionId, `return Boolean(document.querySelector('[data-editor-command="insert.drawio"]'))`, (value) => value === false, 'draw.io Cancel to close the dialog')
  await click(sessionId, '[data-command-id="mode.source"]')
  const afterCancelDraft = await invoke(sessionId, 'recovery_load_draft', [{ documentId }])
  const afterCancel = afterCancelDraft?.status === 'fulfilled' && afterCancelDraft.value !== null ? afterCancelDraft.value.markdown : ''
  if (afterCancel !== beforeCancel) throw new Error('draw.io Cancel changed the Markdown authority.')

  const resources = await execute(sessionId, `const frame = document.querySelector('[data-testid="drawio-bridge-frame"]'); const editorFrame = frame?.contentDocument?.querySelector('#drawio-editor'); const childWindow = editorFrame?.contentWindow; return [...performance.getEntriesByType('resource').map((entry) => entry.name), ...(childWindow?.performance?.getEntriesByType('resource').map((entry) => entry.name) ?? [])].filter((name) => /drawio|mxgraph|bridge/i.test(name))`)
  const externalResources = resources.filter((name) => !name.startsWith('http://tauri.localhost/') && !name.startsWith('https://tauri.localhost/') && !name.startsWith('asset://'))
  if (externalResources.length > 0) throw new Error(`draw.io loaded external resources: ${JSON.stringify(externalResources)}`)
  console.log(JSON.stringify({ status: 'passed', browser: 'Microsoft Edge WebView2', browserVersion, frameReady, drawioSource, appliedMarkdownLength: appliedMarkdown.length, reopenContainsEdit: true, cancelPreservedMarkdown: afterCancel === beforeCancel, drawioResourceCount: resources.length, externalResources, testParent, dataRoot: filesystemPath(selected.value.root) }, null, 2))
} finally {
  if (sessionId !== null) await request(`/session/${sessionId}`, 'DELETE').catch(() => {})
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
