import { existsSync, mkdtempSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

import { readReleaseVersions } from './release-versions.mjs'

const executable = resolve(process.env.W_EDITOR_DESKTOP_EXE ?? 'apps/desktop/src-tauri/target/debug/w-editor-desktop.exe')
const versions = readReleaseVersions(resolve(import.meta.dirname, '..'))
const nativeDriver = resolve(process.env.W_EDITOR_EDGE_DRIVER ?? '.tmp/tauri-webdriver/msedgedriver.exe')
const tauriDriver = resolve(process.env.W_EDITOR_TAURI_DRIVER ?? '.tmp/tauri-driver.exe')
const port = Number(process.env.W_EDITOR_DESKTOP_UPDATE_PORT ?? 4459)
const nativePort = Number(process.env.W_EDITOR_DESKTOP_UPDATE_NATIVE_PORT ?? 9530)
const base = `http://127.0.0.1:${port}`
const testParent = mkdtempSync(resolve('.tmp', 'desktop-update-info-'))

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
  const update = await waitFor(sessionId,
    `return { panel: Boolean(document.querySelector('[data-testid="desktop-settings-updates"]')), version: document.querySelector('[data-testid="desktop-update-version"]')?.textContent?.trim() ?? '', manual: document.querySelector('[data-testid="desktop-update-manual"]')?.textContent?.trim() ?? '', automatic: document.querySelector('[data-testid="desktop-update-automatic"]')?.textContent?.trim() ?? '' }`,
    (value) => value?.panel === true && value.version.includes('0.1.0') && value.manual.includes('手动') && value.automatic.includes('禁用'),
    'the manual update information in Desktop Settings',
  )
  const releaseInfo = await invoke(sessionId, 'desktop_release_info')
  if (releaseInfo?.status !== 'fulfilled' || releaseInfo.value?.automaticUpdate !== false || releaseInfo.value?.version !== versions.productVersion) throw new Error(`Release info does not enforce manual updates: ${JSON.stringify(releaseInfo)}`)
  console.log(JSON.stringify({ status: 'passed', update, releaseInfo: releaseInfo.value, browserVersion: session?.capabilities?.browserVersion ?? 'unknown' }, null, 2))
} finally {
  if (sessionId !== null) await request(`/session/${sessionId}`, 'DELETE').catch(() => {})
  driverProcess.kill()
}
