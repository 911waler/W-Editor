import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'

const executable = resolve(process.env.W_EDITOR_DESKTOP_EXE ?? 'apps/desktop/src-tauri/target/debug/w-editor-desktop.exe')
const nativeDriver = resolve(process.env.W_EDITOR_EDGE_DRIVER ?? '.tmp/tauri-webdriver/msedgedriver.exe')
const tauriDriver = resolve(process.env.W_EDITOR_TAURI_DRIVER ?? '.tmp/tauri-driver.exe')
const port = Number(process.env.W_EDITOR_TAURI_SHELL_PORT ?? 4453)
const nativePort = Number(process.env.W_EDITOR_NATIVE_SHELL_PORT ?? 9524)
const base = `http://127.0.0.1:${port}`
const testParent = mkdtempSync(resolve('.tmp', 'desktop-shell-'))
const externalPath = join(testParent, 'desktop-shell-import.md')
const externalMarkdown = '# Imported from Desktop\n\nThe source file remains untouched.'
writeFileSync(externalPath, externalMarkdown)

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

async function click(sessionId, selector) {
  const clicked = await execute(sessionId, `const element = document.querySelector(${JSON.stringify(selector)}); if (!(element instanceof HTMLElement)) return false; element.click(); return true`)
  if (clicked !== true) throw new Error(`No clickable element was found for ${selector}.`)
}

async function setFile(sessionId, selector, path) {
  const result = await request(`/session/${sessionId}/element`, 'POST', { using: 'css selector', value: selector })
  const id = result?.['element-6066-11e4-a52e-4f735466cecf']
  if (typeof id !== 'string') throw new Error(`No file input was found for ${selector}.`)
  await request(`/session/${sessionId}/element/${id}/value`, 'POST', { text: path, value: [...path] })
}

function keyActions(value) {
  return [...value].flatMap((character) => [{ type: 'keyDown', value: character }, { type: 'keyUp', value: character }])
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

  const selected = await invoke(sessionId, 'select_data_root', [{ parentPath: testParent }])
  if (selected?.status !== 'fulfilled' || selected.value?.state !== 'ready') {
    throw new Error(`Data Root setup failed: ${JSON.stringify(selected)}`)
  }
  const seedCatalog = await invoke(sessionId, 'library_seed_catalog')
  if (seedCatalog?.status !== 'fulfilled' || !Array.isArray(seedCatalog.value)) {
    throw new Error(`Seed catalog IPC failed: ${JSON.stringify(seedCatalog)}`)
  }

  const shell = await waitFor(sessionId,
    `return { desktop: Boolean(document.querySelector('[data-testid="desktop-library-shell"]')), library: Boolean(document.querySelector('[data-testid="desktop-library-sidebar"]')), ready: document.documentElement.dataset.desktopReady === 'true', cards: document.querySelectorAll('[data-testid="desktop-library-article"]').length, commands: document.querySelectorAll('[data-command-id]').length, mode: document.querySelector('[data-testid="editor-surface"]')?.getAttribute('data-mode') ?? '', status: document.querySelector('[data-data-root-state]')?.getAttribute('data-data-root-state') ?? '', setupText: document.querySelector('[data-testid="desktop-data-root-setup"]')?.textContent?.slice(-500) ?? '' }`,
    (value) => value?.desktop === true && value.library === true && value.ready === true && value.cards >= seedCatalog.value.length && value.commands === 80 && value.mode === 'visual',
    'the Library-backed Desktop shell',
  )
  await execute(sessionId, `window.__desktopShellErrors__ = []; window.addEventListener('error', (event) => window.__desktopShellErrors__.push(String(event.error ?? event.message)), true); window.addEventListener('unhandledrejection', (event) => window.__desktopShellErrors__.push(String(event.reason)), true); return true`)
  await click(sessionId, '[data-testid="desktop-new-article"]')
  await waitFor(sessionId,
    `return Boolean(document.querySelector('[data-testid="new-article-dialog"]'))`,
    (value) => value === true,
    'the new article dialog',
  )
  await execute(sessionId, `const input = document.querySelector('[data-testid="new-article-title"]'); if (!(input instanceof HTMLInputElement)) throw new Error('New article title input is unavailable.'); input.value = 'Desktop Library Article'; input.dispatchEvent(new Event('input', { bubbles: true })); return input.value`)
  await click(sessionId, '[data-testid="new-article-create"]')
  const articleList = await waitFor(sessionId,
    `return { cards: document.querySelectorAll('[data-testid="desktop-library-article"]').length, title: document.querySelector('.workspace-controls__meta span')?.textContent ?? '', dialog: Boolean(document.querySelector('[data-testid="new-article-dialog"]')), error: document.querySelector('[data-testid="new-article-dialog"] .field-error')?.textContent?.trim() ?? '', lifecycle: document.querySelector('[data-testid="document-lifecycle-error"]')?.textContent?.trim() ?? '', body: document.body.innerText.slice(-800), html: document.body.innerHTML.slice(-2000), root: document.querySelector('[data-testid="desktop-library-shell"]')?.getAttribute('data-data-root-state') ?? '', ready: document.documentElement.dataset.desktopReady ?? '', appError: document.documentElement.dataset.desktopError ?? '', errors: window.__desktopShellErrors__ ?? [] }`,
    (value) => value?.cards === seedCatalog.value.length + 1 && value.title === 'Desktop Library Article',
    'the newly created Library article',
  )
  const nativeArticles = await invoke(sessionId, 'library_list_articles')
  if (nativeArticles?.status !== 'fulfilled' || !nativeArticles.value.some((article) => article.title === 'Desktop Library Article')) {
    throw new Error(`New article was not durable in Library: ${JSON.stringify(nativeArticles)}`)
  }
  await execute(sessionId, `const editor = document.querySelector('.ProseMirror'); if (!(editor instanceof HTMLElement)) throw new Error('Visual editor is unavailable.'); const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false); const selection = getSelection(); if (selection === null) throw new Error('Selection is unavailable.'); selection.removeAllRanges(); selection.addRange(range); editor.focus(); return true`)
  await execute(sessionId, `const editor = document.querySelector('.ProseMirror'); if (!(editor instanceof HTMLElement)) throw new Error('Visual editor is unavailable.'); const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false); const selection = getSelection(); if (selection === null) throw new Error('Selection is unavailable.'); selection.removeAllRanges(); selection.addRange(range); editor.focus(); return true`)
  await request(`/session/${sessionId}/actions`, 'POST', { actions: [{ type: 'key', id: 'keyboard', actions: keyActions(' durable') }] })
  await waitFor(sessionId, `return document.querySelector('.ProseMirror')?.textContent ?? ''`, (value) => typeof value === 'string' && value.includes('durable'), 'a real edit in the new Library article')
  await click(sessionId, '[data-command-id="document.manual-save"]')
  const saved = await waitFor(sessionId,
    `return { status: document.querySelector('.status-region')?.textContent ?? '', errors: [...document.querySelectorAll('.workspace-error')].map((node) => node.textContent?.trim() ?? '').filter(Boolean), buttonDisabled: document.querySelector('[data-command-id="document.manual-save"]')?.hasAttribute('disabled') ?? false, feedback: document.querySelector('.status-region__command')?.textContent?.trim() ?? '', appError: document.documentElement.dataset.desktopError ?? '' }`,
    (value) => value?.status.includes('干净') === true,
    'the manual Library save state',
  )
  const savedArticles = await invoke(sessionId, 'library_list_articles')
  if (savedArticles?.status !== 'fulfilled' || !savedArticles.value.some((article) => article.title === 'Desktop Library Article' && article.revision >= 2)) {
    throw new Error(`Manual edit was not durable in Library: ${JSON.stringify(savedArticles)}`)
  }
  await execute(sessionId, `document.querySelector('[data-article-panel-tab="outline"]')?.click(); return true`)
  const outline = await waitFor(sessionId, `return document.querySelectorAll('[data-outline-anchor]').length`, (value) => value > 0, 'the shared article outline')
  await execute(sessionId, `document.querySelector('[data-article-panel-tab="articles"]')?.click(); return true`)
  await setFile(sessionId, '[data-testid="import-markdown-input"]', externalPath)
  await waitFor(sessionId, `return document.querySelector('[data-testid="import-markdown-input"]')?.files?.length ?? 0`, (value) => value === 1, 'the Markdown file selection')
  await execute(sessionId, `document.querySelector('[data-testid="import-markdown-input"]')?.dispatchEvent(new Event('change', { bubbles: true })); return true`)
  const imported = await waitFor(sessionId,
    `return { cards: document.querySelectorAll('[data-testid="desktop-library-article"]').length, title: document.querySelector('.workspace-controls__meta span')?.textContent ?? '' }`,
    (value) => value?.cards === seedCatalog.value.length + 2 && value.title === 'desktop-shell-import',
    'the imported Library article',
  )
  const importedArticles = await invoke(sessionId, 'library_list_articles')
  if (importedArticles?.status !== 'fulfilled' || !importedArticles.value.some((article) => article.title === 'desktop-shell-import')) {
    throw new Error(`Imported article was not durable in Library: ${JSON.stringify(importedArticles)}`)
  }
  if (readFileSync(externalPath, 'utf8') !== externalMarkdown) throw new Error('Desktop import modified the source file.')
  console.log(JSON.stringify({ status: 'passed', shell, articleList, outline, imported, nativeArticleCount: nativeArticles.value.length, saved, savedArticleCount: savedArticles.value.length, importedArticleCount: importedArticles.value.length, sourceUnchanged: true, seedCount: seedCatalog.value.length }, null, 2))
} finally {
  if (sessionId !== null) await request(`/session/${sessionId}`, 'DELETE').catch(() => {})
  driverProcess.kill()
}
