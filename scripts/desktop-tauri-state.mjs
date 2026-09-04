import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const executable = resolve(process.env.W_EDITOR_DESKTOP_EXE ?? 'apps/desktop/src-tauri/target/debug/w-editor-desktop.exe')
const nativeDriver = resolve(process.env.W_EDITOR_EDGE_DRIVER ?? '.tmp/tauri-webdriver/msedgedriver.exe')
const tauriDriver = resolve(process.env.W_EDITOR_TAURI_DRIVER ?? '.tmp/tauri-driver.exe')
const port = Number(process.env.W_EDITOR_TAURI_STATE_PORT ?? 4454)
const nativePort = Number(process.env.W_EDITOR_NATIVE_STATE_PORT ?? 9525)
const base = `http://127.0.0.1:${port}`
const testParent = mkdtempSync(resolve('.tmp', 'desktop-state-'))
const readyScreenshotPath = resolve('artifacts/final-validation/uat-dtr-023-desktop-article-groups.png')
const settingsScreenshotPath = resolve('artifacts/final-validation/uat-dtr-022-desktop-settings-modal.png')

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

function keyActions(value) {
  return [...value].flatMap((character) => [{ type: 'keyDown', value: character }, { type: 'keyUp', value: character }])
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
  const state = await waitFor(sessionId,
    `const primary = document.querySelector('[data-testid="desktop-primary-bar"]'); const library = document.querySelector('[data-testid="desktop-library-sidebar"]'); const toolbar = document.querySelector('.toolbar-region'); const workspace = document.querySelector('.workspace-shell'); const status = document.querySelector('[data-testid="desktop-document-status"]'); const rows = [...(library?.querySelectorAll('[data-testid="desktop-library-article"]') ?? [])]; return { ready: document.documentElement.dataset.desktopReady === 'true', title: document.title, primary: Boolean(primary), rootStatus: Boolean(primary?.querySelector('[data-testid="desktop-library-status"]')), readerEntry: Boolean(primary?.querySelector('[data-testid="desktop-reader-entry"]')), settingsEntry: Boolean(toolbar?.querySelector('[data-testid="desktop-settings-entry"]')), settingsInLibrary: Boolean(library?.querySelector('[data-testid="desktop-settings-entry"]')), dailyRecoveryButtons: library?.querySelectorAll('[data-testid="clear-document"], [data-testid="reset-document"], [data-testid="restore-pre-mode-switch"], [data-testid="restore-pre-destructive-replace"]').length ?? 0, save: Boolean(status?.querySelector('[data-testid="desktop-save-state"]')), draft: Boolean(status?.querySelector('[data-testid="desktop-draft-state"]')), error: Boolean(status?.querySelector('[data-testid="desktop-error-state"]')), recent: Boolean(library?.querySelector('[data-testid="desktop-recent-activity"]')), groups: library?.querySelectorAll('[data-testid="article-date-group"]').length ?? 0, compactRows: rows.length > 0 && rows.every((row) => row.querySelector('.article-card__title') && row.querySelector('time') && !row.querySelector('.article-card__meta')), statusAfterWorkspace: Boolean(workspace && status && (workspace.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING)) }`,
    (value) => value?.ready === true && value.primary === true && value.rootStatus === true && value.readerEntry === true && value.settingsEntry === true && value.settingsInLibrary === false && value.dailyRecoveryButtons === 0 && value.save === true && value.draft === true && value.error === true && value.recent === false && value.groups > 0 && value.compactRows === true && value.statusAfterWorkspace === true && value.title !== 'W-Editor Desktop',
    'the Desktop title and persisted-state surface',
  )
  writeFileSync(readyScreenshotPath, Buffer.from(await request(`/session/${sessionId}/screenshot`), 'base64'))
  await execute(sessionId, `document.querySelector('[data-testid="desktop-reader-entry"]')?.click(); return true`)
  const reader = await waitFor(sessionId,
    `const overlay = document.querySelector('[data-testid="desktop-reader-parity"]'); const presentation = overlay?.querySelector('[data-presentation-engine="tiptap"] .ProseMirror'); return { overlay: Boolean(overlay), tiptap: Boolean(presentation), readonly: presentation?.getAttribute('contenteditable') === 'false', editControls: overlay?.querySelectorAll('[data-semantic-edit], [data-raw-edit]').length ?? -1, heading: presentation?.querySelector('h1')?.textContent?.trim() ?? '' }`,
    (value) => value?.overlay === true && value.tiptap === true && value.readonly === true && value.editControls === 0 && value.heading.length > 0,
    'the read-only Desktop Tiptap Reader presentation',
  )
  await execute(sessionId, `document.querySelector('[data-testid="desktop-reader-preview-close"]')?.click(); return true`)
  await waitFor(sessionId, `return Boolean(document.querySelector('[data-testid="desktop-reader-parity"]'))`, (value) => value === false, 'the closed Desktop Reader')
  await execute(sessionId, `document.querySelector('[data-testid="desktop-settings-entry"]')?.click(); return true`)
  const panels = await waitFor(sessionId,
    `const dialog = document.querySelector('[data-testid="desktop-settings-destination"]'); return { backdrop: Boolean(document.querySelector('[data-testid="desktop-settings-backdrop"]')), destination: Boolean(dialog), role: dialog?.getAttribute('role') ?? '', modal: dialog?.getAttribute('aria-modal') ?? '', focus: document.activeElement?.getAttribute('data-testid') ?? '', browseMigration: Boolean(document.querySelector('[data-testid="desktop-browse-migration-parent"]')), migration: document.querySelector('[data-testid="desktop-settings-migration"]')?.textContent?.trim() ?? '', updates: document.querySelector('[data-testid="desktop-settings-updates"]')?.textContent?.trim() ?? '', data: Boolean(document.querySelector('[data-testid="desktop-settings-data"]')), preferences: Boolean(document.querySelector('[data-testid="desktop-settings-preferences"]')), uninstall: Boolean(document.querySelector('[data-testid="desktop-uninstall-preview"]')) }`,
    (value) => value?.backdrop === true && value.destination === true && value.role === 'dialog' && value.modal === 'true' && value.focus === 'desktop-settings-close' && value.browseMigration === true && value.migration.includes('数据迁移') && value.updates.includes('版本') && value.data === false && value.preferences === false && value.uninstall === false,
    'the accessible Desktop Settings modal',
  )
  await execute(sessionId, `const settings = document.querySelector('[data-testid="desktop-settings-destination"]'); if (!(settings instanceof HTMLElement)) throw new Error('Desktop Settings is unavailable.'); settings.dataset.localeProbe = 'same-destination'; return true`)
  await execute(sessionId, `document.querySelector('[data-command-id="language.en"]')?.click(); return true`)
  const english = await waitFor(sessionId,
    `return { settings: document.querySelector('#desktop-settings-title')?.textContent?.trim() ?? '', migration: document.querySelector('#desktop-settings-migration-title')?.textContent?.trim() ?? '', reader: document.querySelector('[data-testid="desktop-reader-entry"]')?.textContent?.trim() ?? '', identity: document.querySelector('[data-testid="desktop-settings-destination"]')?.getAttribute('data-locale-probe') ?? '' }`,
    (value) => value?.settings === 'Settings' && value.migration === 'Data migration' && value.reader === 'Reader' && value.identity === 'same-destination',
    'the English Desktop shell locale',
  )
  await execute(sessionId, `document.querySelector('[data-command-id="language.ru"]')?.click(); return true`)
  const russian = await waitFor(sessionId,
    `return { settings: document.querySelector('#desktop-settings-title')?.textContent?.trim() ?? '', migration: document.querySelector('#desktop-settings-migration-title')?.textContent?.trim() ?? '', reader: document.querySelector('[data-testid="desktop-reader-entry"]')?.textContent?.trim() ?? '', identity: document.querySelector('[data-testid="desktop-settings-destination"]')?.getAttribute('data-locale-probe') ?? '' }`,
    (value) => value?.settings === 'Настройки' && value.migration === 'Перенос данных' && value.reader === 'Чтение' && value.identity === 'same-destination',
    'the Russian Desktop shell locale',
  )
  await execute(sessionId, `document.querySelector('[data-command-id="language.zh"]')?.click(); return true`)
  const chinese = await waitFor(sessionId,
    `return { settings: document.querySelector('#desktop-settings-title')?.textContent?.trim() ?? '', migration: document.querySelector('#desktop-settings-migration-title')?.textContent?.trim() ?? '', reader: document.querySelector('[data-testid="desktop-reader-entry"]')?.textContent?.trim() ?? '', identity: document.querySelector('[data-testid="desktop-settings-destination"]')?.getAttribute('data-locale-probe') ?? '' }`,
    (value) => value?.settings === '设置' && value.migration === '数据迁移' && value.reader === '阅读' && value.identity === 'same-destination',
    'the restored Chinese Desktop shell locale',
  )
  writeFileSync(settingsScreenshotPath, Buffer.from(await request(`/session/${sessionId}/screenshot`), 'base64'))
  await execute(sessionId, `document.querySelector('[data-testid="desktop-settings-close"]')?.click(); return true`)
  await waitFor(sessionId, `return Boolean(document.querySelector('[data-testid="desktop-settings-destination"]'))`, (value) => value === false, 'the closed Desktop Settings destination')
  await execute(sessionId, `const editor = document.querySelector('.ProseMirror'); if (!(editor instanceof HTMLElement)) throw new Error('Visual editor is unavailable.'); const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false); const selection = getSelection(); if (selection === null) throw new Error('Selection is unavailable.'); selection.removeAllRanges(); selection.addRange(range); editor.focus(); return true`)
  await request(`/session/${sessionId}/actions`, 'POST', { actions: [{ type: 'key', id: 'keyboard', actions: keyActions(' state') }] })
  const dirty = await waitFor(sessionId,
    `return { dirty: document.querySelector('.workspace-shell')?.getAttribute('data-dirty') ?? '', title: document.title, save: document.querySelector('[data-testid="desktop-save-state"]')?.textContent?.trim() ?? '', draft: document.querySelector('[data-testid="desktop-draft-state"]')?.textContent?.trim() ?? '' }`,
    (value) => value?.dirty === 'true' && value.title.startsWith('* ') && value.save.includes('有未保存更改') && value.draft.includes('待保存'),
    'the dirty and autosave-pending state',
  )
  const documentId = await execute(sessionId, `return document.querySelector('.workspace-shell')?.getAttribute('data-document-id') ?? ''`)
  await waitFor(sessionId, `return document.querySelector('[data-testid="desktop-draft-state"]')?.textContent?.trim() ?? ''`, (value) => value.includes('已保存'), 'the persisted recovery-draft state', 15_000)
  const draft = await invoke(sessionId, 'recovery_load_draft', [{ documentId }])
  if (draft?.status !== 'fulfilled' || draft.value === null) throw new Error(`Dirty edit did not create a Library recovery draft: ${JSON.stringify(draft)}`)
  const fault = await invoke(sessionId, 'fault_injection_set', [{ kind: 'disk-full', enabled: true }])
  if (fault?.status !== 'fulfilled') throw new Error(`Could not enable disk-full fault: ${JSON.stringify(fault)}`)
  await request(`/session/${sessionId}/actions`, 'POST', { actions: [{ type: 'key', id: 'keyboard', actions: keyActions(' error') }] })
  const error = await waitFor(sessionId,
    `return { code: document.querySelector('[data-testid="desktop-error-state"]')?.getAttribute('data-error-code') ?? '', text: document.querySelector('[data-testid="desktop-error-state"]')?.textContent?.trim() ?? '' }`,
    (value) => value?.code.length > 0,
    'the visible autosave error state',
    15_000,
  )
  await invoke(sessionId, 'fault_injection_clear')
  await execute(sessionId, `const retry = document.querySelector('.workspace-error button'); if (!(retry instanceof HTMLElement)) throw new Error('Autosave retry action is unavailable.'); retry.click(); return true`)
  await waitFor(sessionId, `return document.querySelector('[data-testid="desktop-draft-state"]')?.textContent?.trim() ?? ''`, (value) => value.includes('已保存'), 'the recovered autosave state', 15_000)
  await execute(sessionId, `document.querySelector('[data-command-id="document.manual-save"]')?.click(); return true`)
  const clean = await waitFor(sessionId,
    `return { dirty: document.querySelector('.workspace-shell')?.getAttribute('data-dirty') ?? '', title: document.title, save: document.querySelector('[data-testid="desktop-save-state"]')?.textContent?.trim() ?? '', draft: document.querySelector('[data-testid="desktop-draft-state"]')?.textContent?.trim() ?? '', error: document.querySelector('[data-testid="desktop-error-state"]')?.textContent?.trim() ?? '', feedback: document.querySelector('.status-region__command')?.textContent?.trim() ?? '', buttonDisabled: document.querySelector('[data-command-id="document.manual-save"]')?.hasAttribute('disabled') ?? false, appError: document.documentElement.dataset.desktopError ?? '' }`,
    (value) => value?.dirty === 'false' && !value.title.startsWith('* ') && value.save.includes('干净'),
    'the clean saved state',
    15_000,
  )
  console.log(JSON.stringify({ status: 'passed', state, reader, panels, localeCycle: { english, russian, chinese }, dirty, draft: draft.value, error, clean, browserVersion: session?.capabilities?.browserVersion ?? 'unknown', screenshots: { ready: readyScreenshotPath, settings: settingsScreenshotPath } }, null, 2))
} finally {
  if (sessionId !== null) await request(`/session/${sessionId}`, 'DELETE').catch(() => {})
  driverProcess.kill()
}
