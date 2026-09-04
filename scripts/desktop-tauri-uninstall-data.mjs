import { existsSync, mkdtempSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const executable = resolve(process.env.W_EDITOR_DESKTOP_EXE ?? 'apps/desktop/src-tauri/target/debug/w-editor-desktop.exe')
const nativeDriver = resolve(process.env.W_EDITOR_EDGE_DRIVER ?? '.tmp/tauri-webdriver/msedgedriver.exe')
const tauriDriver = resolve(process.env.W_EDITOR_TAURI_DRIVER ?? '.tmp/tauri-driver.exe')
const port = Number(process.env.W_EDITOR_DESKTOP_UNINSTALL_PORT ?? 4458)
const nativePort = Number(process.env.W_EDITOR_DESKTOP_UNINSTALL_NATIVE_PORT ?? 9529)
const base = `http://127.0.0.1:${port}`
const testParent = mkdtempSync(resolve('.tmp', 'desktop-uninstall-data-'))

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
  await waitFor(sessionId, `return document.documentElement.dataset.desktopReady === 'true'`, (value) => value === true, 'the ready Desktop workspace')
  await execute(sessionId, `document.querySelector('[data-testid="desktop-settings-entry"]')?.click(); return true`)
  const policy = await waitFor(sessionId,
    `return { modal: Boolean(document.querySelector('[data-testid="desktop-settings-destination"][role="dialog"][aria-modal="true"]')), migration: Boolean(document.querySelector('[data-testid="desktop-settings-migration"]')), updates: Boolean(document.querySelector('[data-testid="desktop-settings-updates"]')), options: Boolean(document.querySelector('[data-testid="desktop-uninstall-data-options"]')), preview: Boolean(document.querySelector('[data-testid="desktop-uninstall-preview"]')) }`,
    (value) => value?.modal === true && value.migration === true && value.updates === true && value.options === false && value.preview === false,
    'Settings without uninstall data controls',
  )
  const preview = await invoke(sessionId, 'uninstall_data_preview')
  if (preview?.status !== 'fulfilled' || !preview.value?.confirmationToken || !String(preview.value?.preview?.root ?? '').includes('W-EditorData')) throw new Error(`Backend uninstall preview failed: ${JSON.stringify(preview)}`)
  const kept = await invoke(sessionId, 'uninstall_data_cleanup', [{ scope: 'keep', confirmationToken: preview.value.confirmationToken }])
  if (kept?.status !== 'fulfilled' || kept.value?.scope !== 'keep') throw new Error(`Backend keep-data cleanup failed: ${JSON.stringify(kept)}`)
  const afterKeep = await invoke(sessionId, 'data_root_status')
  if (afterKeep?.status !== 'fulfilled' || afterKeep.value?.state !== 'ready') throw new Error(`Keep-data cleanup changed the Data Root: ${JSON.stringify(afterKeep)}`)
  const tmpPreview = await invoke(sessionId, 'uninstall_data_preview')
  const tmp = await invoke(sessionId, 'uninstall_data_cleanup', [{ scope: 'tmp', confirmationToken: tmpPreview.value?.confirmationToken }])
  if (tmp?.status !== 'fulfilled' || tmp.value?.scope !== 'tmp') throw new Error(`Backend tmp-only cleanup failed: ${JSON.stringify(tmp)}`)
  const afterTmp = await invoke(sessionId, 'data_root_status')
  if (afterTmp?.status !== 'fulfilled' || afterTmp.value?.state !== 'ready') throw new Error(`Tmp-only cleanup changed the Data Root: ${JSON.stringify(afterTmp)}`)
  const durablePreview = await invoke(sessionId, 'uninstall_data_preview')
  const deletedByBackend = await invoke(sessionId, 'uninstall_data_cleanup', [{ scope: 'durable', confirmationToken: durablePreview.value?.confirmationToken }])
  if (deletedByBackend?.status !== 'fulfilled' || deletedByBackend.value?.durableDeleted !== true) throw new Error(`Backend durable cleanup failed: ${JSON.stringify(deletedByBackend)}`)
  const deleted = await waitFor(sessionId, `return { setup: Boolean(document.querySelector('[data-testid="desktop-data-root-setup"]')), state: document.querySelector('[data-data-root-state]')?.getAttribute('data-data-root-state') ?? '', ready: document.documentElement.dataset.desktopReady ?? '' }`, (value) => value?.state === 'unconfigured', 'the durable Data Root backend deletion result')
  if (existsSync(`${testParent}\\W-EditorData`)) throw new Error('Durable Data Root still exists after confirmed deletion.')
  console.log(JSON.stringify({ status: 'passed', browserVersion: session?.capabilities?.browserVersion ?? 'unknown', policy, preview: preview.value.preview, kept: kept.value, tmp: tmp.value, deletedByBackend: deletedByBackend.value, deleted, durableRootDeleted: true }, null, 2))
} finally {
  if (sessionId !== null) await request(`/session/${sessionId}`, 'DELETE').catch(() => {})
  driverProcess.kill()
}
