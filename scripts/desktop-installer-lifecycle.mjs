import { createHash } from 'node:crypto'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, parse, resolve } from 'node:path'

import { desktopArtifactPaths, readReleaseVersions } from './release-versions.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const targetRoot = resolve(process.env.W_EDITOR_CARGO_TARGET_DIR ?? join(parse(repositoryRoot).root, 'w-editor-tauri-target'))
const artifactPaths = desktopArtifactPaths(targetRoot, readReleaseVersions(repositoryRoot))
const nsisPackage = artifactPaths.nsis
const msiPackage = artifactPaths.msi
const nativeDriver = resolve(process.env.W_EDITOR_EDGE_DRIVER ?? '.tmp/tauri-webdriver/msedgedriver.exe')
const tauriDriver = resolve(process.env.W_EDITOR_TAURI_DRIVER ?? '.tmp/tauri-driver.exe')
const lifecycleRoot = resolve(process.env.W_EDITOR_INSTALLER_LIFECYCLE_ROOT ?? join(parse(repositoryRoot).root, `w-editor-installer-lifecycle-${Date.now()}`))
const desktopLocatorPath = join(process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming'), 'com.weditor.desktop.spike', 'data-root.json')
const originalLocator = existsSync(desktopLocatorPath) ? readFileSync(desktopLocatorPath) : null
const portSeed = Number(process.env.W_EDITOR_INSTALLER_PORT_SEED ?? process.pid % 1000)
const portBase = 4600 + portSeed * 10
const nativePortBase = 20_000 + portSeed * 10
const installerPorts = Object.freeze({
  nsisFirst: Object.freeze({ port: portBase, nativePort: nativePortBase }),
  nsisDrawio: Object.freeze({ port: portBase + 2, nativePort: nativePortBase + 2 }),
  nsisReopen: Object.freeze({ port: portBase + 1, nativePort: nativePortBase + 1 }),
  msiFirst: Object.freeze({ port: portBase + 3, nativePort: nativePortBase + 3 }),
  msiDrawio: Object.freeze({ port: portBase + 5, nativePort: nativePortBase + 5 }),
  msiReopen: Object.freeze({ port: portBase + 4, nativePort: nativePortBase + 4 }),
})

function normalizedPath(path) {
  return path.replace(/^\\\\\?\\/u, '').replaceAll('\\', '/').toLocaleLowerCase()
}

function restoreOriginalLocator() {
  if (originalLocator !== null) {
    mkdirSync(resolve(desktopLocatorPath, '..'), { recursive: true })
    writeFileSync(desktopLocatorPath, originalLocator)
    return
  }
  if (!existsSync(desktopLocatorPath)) return
  let root = ''
  try {
    root = String(JSON.parse(readFileSync(desktopLocatorPath, 'utf8')).root ?? '')
  } catch {
    return
  }
  const ownedRoots = [normalizedPath(lifecycleRoot), normalizedPath(join(repositoryRoot, '.tmp', 'desktop-drawio-'))]
  if (ownedRoots.some((candidate) => normalizedPath(root).startsWith(candidate))) {
    unlinkSync(desktopLocatorPath)
  }
}

process.on('exit', restoreOriginalLocator)

function requireFile(path, label) {
  if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`)
}

function processIdsForExecutable(executable) {
  const target = psQuote(resolve(executable))
  const command = `@(Get-CimInstance Win32_Process -Filter "Name='w-editor-desktop.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath -ieq ${target} } | Select-Object -ExpandProperty ProcessId) -join ','`
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) return new Set()
  return new Set(result.stdout.split(',').map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value > 0))
}

function stopNewExecutableProcesses(executable, knownProcessIds) {
  const currentProcessIds = processIdsForExecutable(executable)
  for (const processId of currentProcessIds) {
    if (knownProcessIds.has(processId)) continue
    const command = `Stop-Process -Id ${processId} -Force -ErrorAction SilentlyContinue`
    spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { cwd: repositoryRoot, windowsHide: true })
  }
}

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase()
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

function keyActions(value) {
  return [...value].flatMap((character) => [{ type: 'keyDown', value: character }, { type: 'keyUp', value: character }])
}

function runProcess(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: repositoryRoot, stdio: 'inherit', windowsHide: true, ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${result.status ?? 'unknown'}.`)
  return result
}

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function windowsCommandLineArgument(value) {
  const text = String(value)
  if (!/[\s"]/u.test(text)) return text
  let quoted = '"'
  let backslashes = 0
  for (const character of text) {
    if (character === '\\') {
      backslashes += 1
      continue
    }
    if (character === '"') {
      quoted += '\\'.repeat(backslashes * 2 + 1)
      quoted += '"'
      backslashes = 0
      continue
    }
    quoted += '\\'.repeat(backslashes)
    quoted += character
    backslashes = 0
  }
  quoted += '\\'.repeat(backslashes * 2)
  return `${quoted}"`
}

function isElevatedProcess() {
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '[Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent() | ForEach-Object { $_.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }',
  ], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true })
  return result.status === 0 && result.stdout.trim().toLocaleLowerCase() === 'true'
}

function runElevatedMsi(args) {
  if (isElevatedProcess()) {
    const result = spawnSync('msiexec.exe', args, { cwd: repositoryRoot, stdio: 'inherit', windowsHide: false })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`MSI command exited with ${result.status ?? 'unknown'}.`)
    return
  }
  // Elevate msiexec directly. Start-Process receives one complete command
  // line, with only arguments containing whitespace quoted; passing an array
  // here makes Windows Installer misparse the space-containing MSI filename
  // and return error 1639.
  const argumentList = args.map(windowsCommandLineArgument).join(' ')
  const encodedArgumentList = Buffer.from(argumentList, 'utf16le').toString('base64')
  const command = `$argumentList = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encodedArgumentList}')); $process = Start-Process -FilePath 'msiexec.exe' -Verb RunAs -Wait -PassThru -ArgumentList $argumentList; exit $process.ExitCode`
  // Keep the elevation request visible so the test operator can approve UAC.
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { cwd: repositoryRoot, stdio: 'inherit', windowsHide: false })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Elevated MSI command exited with ${result.status ?? 'unknown'}; UAC consent may be unavailable.`)
}

async function request(base, path, method = 'GET', body, timeoutMs = 30_000) {
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

async function waitForDriver(base) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      await request(base, '/status')
      return
    } catch {
      await sleep(100)
    }
  }
  throw new Error('tauri-driver did not become ready.')
}

async function execute(context, script, args = []) {
  return request(context.base, `/session/${context.sessionId}/execute/sync`, 'POST', { args, script })
}

async function invoke(context, command, payload = {}) {
  return request(context.base, `/session/${context.sessionId}/execute/async`, 'POST', {
    args: [payload],
    script: `const done = arguments[arguments.length - 1]; const bridge = globalThis.__TAURI_INTERNALS__; if (bridge === undefined || typeof bridge.invoke !== 'function') { done({ status: 'unavailable' }); } else { bridge.invoke(${JSON.stringify(command)}, arguments[0]).then((value) => done({ status: 'fulfilled', value })).catch((error) => done({ status: 'rejected', error: String(error) })); }`,
  })
}

function fulfilled(result, label) {
  if (result?.status !== 'fulfilled') throw new Error(`${label} failed: ${JSON.stringify(result)}`)
  return result.value
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

async function waitFor(context, script, predicate, label, timeout = 15_000) {
  const deadline = Date.now() + timeout
  let lastValue = null
  while (Date.now() < deadline) {
    lastValue = await execute(context, script)
    if (predicate(lastValue)) return lastValue
    await sleep(150)
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(lastValue)}`)
}

async function click(context, selector) {
  const result = await execute(context, `const element = document.querySelector(${JSON.stringify(selector)}); if (!(element instanceof HTMLElement)) return false; element.click(); return true`)
  if (result !== true) throw new Error(`No clickable element was found for ${selector}.`)
}

async function createSession(base, executable) {
  let lastError = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await request(base, '/session', 'POST', {
        capabilities: {
          alwaysMatch: {
            browserName: 'webview2',
            'tauri:options': { application: executable, webviewOptions: {} },
          },
        },
      }, 12_000)
    } catch (error) {
      lastError = error
      const message = errorMessage(error)
      const retryable = message.includes('DevToolsActivePort')
        || message.toLocaleLowerCase().includes('timeout')
        || message.toLocaleLowerCase().includes('aborted')
      if (!retryable || attempt === 3) throw error
      await sleep(attempt * 750)
    }
  }
  throw lastError ?? new Error('WebDriver session creation failed.')
}

async function startContext(executable, profilePath, port, nativePort) {
  const env = { ...process.env, APPDATA: profilePath, LOCALAPPDATA: profilePath }
  const knownProcessIds = processIdsForExecutable(executable)
  mkdirSync(profilePath, { recursive: true })
  const base = `http://127.0.0.1:${port}`
  const driverProcess = spawn(tauriDriver, ['--port', String(port), '--native-port', String(nativePort), '--native-driver', nativeDriver], { env, stdio: 'ignore', windowsHide: true })
  await waitForDriver(base)
  try {
    const session = await createSession(base, executable)
    const sessionId = session?.sessionId ?? null
    if (sessionId === null) throw new Error('WebDriver did not return a session id.')
    await request(base, `/session/${sessionId}/timeouts`, 'POST', { script: 20_000 })
    return { base, browserVersion: session?.capabilities?.browserVersion ?? 'unknown', driverProcess, env, executable, knownProcessIds, sessionId }
  } catch (error) {
    driverProcess.kill()
    await sleep(250)
    stopNewExecutableProcesses(executable, knownProcessIds)
    throw error
  }
}

async function closeContext(context) {
  if (context === null) return
  await request(context.base, `/session/${context.sessionId}`, 'DELETE').catch(() => {})
  context.driverProcess.kill()
  await sleep(150)
  stopNewExecutableProcesses(context.executable, context.knownProcessIds)
}

async function prepareWorkspace(context, dataParent) {
  await waitFor(context, 'return typeof globalThis.__TAURI_INTERNALS__?.invoke === "function"', (value) => value === true, 'the Tauri invoke bridge')
  const selected = fulfilled(await invoke(context, 'select_data_root', { parentPath: dataParent }), 'Data Root selection')
  if (selected.state !== 'ready') throw new Error(`Selected Data Root is not ready: ${JSON.stringify(selected)}`)
  await waitFor(context, `return document.documentElement.dataset.desktopReady === 'true' && Boolean(document.querySelector('.workspace-shell'))`, (value) => value === true, 'the installed Desktop workspace')
  return selected
}

async function installedFirstSmoke(executable, profilePath, dataParent, ports, label) {
  let context = await startContext(executable, profilePath, ports.port, ports.nativePort)
  try {
    const selected = await prepareWorkspace(context, dataParent)
    await click(context, '[data-testid="desktop-new-article"]')
    await waitFor(context, `return Boolean(document.querySelector('[data-testid="new-article-dialog"]'))`, (value) => value === true, `${label} new article dialog`)
    await execute(context, `const input = document.querySelector('[data-testid="new-article-title"]'); if (!(input instanceof HTMLInputElement)) throw new Error('New article input is unavailable.'); input.value = ${JSON.stringify(`Installed ${label} Library Article`)}; input.dispatchEvent(new Event('input', { bubbles: true })); return true`)
    await click(context, '[data-testid="new-article-create"]')
    const created = await waitFor(context, `return { id: document.querySelector('.workspace-shell')?.getAttribute('data-document-id') ?? '', title: document.querySelector('.workspace-controls__meta span')?.textContent ?? '' }`, (value) => value?.title === `Installed ${label} Library Article` && value.id.length > 0, `${label} Library article creation`)
    await execute(context, `const editor = document.querySelector('.ProseMirror'); if (!(editor instanceof HTMLElement)) throw new Error('Installed Visual editor is unavailable.'); const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false); const selection = getSelection(); if (selection === null) throw new Error('Selection is unavailable.'); selection.removeAllRanges(); selection.addRange(range); editor.focus(); return true`)
    await request(context.base, `/session/${context.sessionId}/actions`, 'POST', { actions: [{ type: 'key', id: 'keyboard', actions: keyActions(` ${label} durable`) }] })
    const edited = await waitFor(context, `return { dirty: document.querySelector('.workspace-shell')?.getAttribute('data-dirty') ?? '', text: document.querySelector('.ProseMirror')?.textContent ?? '' }`, (value) => value?.dirty === 'true' && value.text.includes(`${label} durable`), `${label} installed edit`)
    await click(context, '[data-command-id="document.manual-save"]')
    const saved = await waitFor(context, `return { dirty: document.querySelector('.workspace-shell')?.getAttribute('data-dirty') ?? '', title: document.title }`, (value) => value?.dirty === 'false' && !value.title.startsWith('* '), `${label} installed Library save`)
    const articles = fulfilled(await invoke(context, 'library_list_articles'), `${label} Library listing`)
    const article = articles.find((candidate) => candidate.documentId === created.id && candidate.revision >= 2 && candidate.markdown.includes(`${label} durable`))
    if (article === undefined) throw new Error(`${label} installed edit was not durable: ${JSON.stringify(articles)}`)
    await sleep(400)
    await fulfilled(await invoke(context, 'set_window_dirty', { dirty: false }), `${label} clear close guard`)
    await fulfilled(await invoke(context, 'request_window_close'), `${label} clean close`)
    const browserVersion = context.browserVersion
    await closeContext(context)
    context = null
    return { browserVersion, dataRoot: selected.root, documentId: created.id, markdown: article.markdown, edited: edited.text, saved }
  } finally {
    await closeContext(context)
  }
}

async function installedReopenSmoke(executable, profilePath, dataParent, ports, documentId, expectedMarkdown, label) {
  let context = await startContext(executable, profilePath, ports.port, ports.nativePort)
  try {
    const status = fulfilled(await invoke(context, 'data_root_status'), `${label} Data Root reopen status`)
    if (status.state !== 'ready') throw new Error(`${label} Data Root was not ready after reinstall: ${JSON.stringify(status)}`)
    if (typeof status.root !== 'string' || !status.root.replaceAll('\\', '/').toLocaleLowerCase().includes(dataParent.replaceAll('\\', '/').toLocaleLowerCase())) throw new Error(`${label} Data Root pointed somewhere other than the lifecycle root: ${JSON.stringify({ status, dataParent })}`)
    await waitFor(context, `return document.documentElement.dataset.desktopReady === 'true' && Boolean(document.querySelector('.workspace-shell'))`, (value) => value === true, `${label} reinstalled workspace`)
    const listed = fulfilled(await invoke(context, 'library_list_articles'), `${label} reopened Library listing`)
    let article
    try {
      article = fulfilled(await invoke(context, 'library_load_markdown', { documentId }), `${label} reopened Library article`)
    } catch (error) {
      throw new Error(`${label} reopened Library article failed: ${errorMessage(error)}; status=${JSON.stringify(status)}; listed=${JSON.stringify(listed.map((candidate) => ({ documentId: candidate.documentId, title: candidate.title, revision: candidate.revision, markdownLength: candidate.markdown.length })))}`, { cause: error })
    }
    if (article.markdown !== expectedMarkdown) throw new Error(`${label} reinstall did not preserve Markdown.`)
    await fulfilled(await invoke(context, 'set_window_dirty', { dirty: false }), `${label} reopened clear close guard`)
    await fulfilled(await invoke(context, 'request_window_close'), `${label} reopened clean close`)
    return { browserVersion: context.browserVersion, documentId: article.documentId, markdown: article.markdown, dataRoot: status.root, dataParent }
  } finally {
    await closeContext(context)
  }
}

function drawioSmoke(executable, profilePath, label, ports) {
  const env = { ...process.env, APPDATA: profilePath, LOCALAPPDATA: profilePath, W_EDITOR_DESKTOP_EXE: executable, W_EDITOR_REAL_LOCATOR_PATH: desktopLocatorPath, W_EDITOR_TAURI_DRAWIO_PORT: String(ports.port), W_EDITOR_NATIVE_DRAWIO_PORT: String(ports.nativePort) }
  const output = execFileSync(process.execPath, [resolve(repositoryRoot, 'scripts/desktop-tauri-drawio.mjs')], { cwd: repositoryRoot, env, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
  const jsonStart = output.lastIndexOf('{\n  "status": "passed"')
  if (jsonStart < 0) throw new Error(`${label} draw.io smoke produced no JSON result.`)
  return JSON.parse(output.slice(jsonStart))
}

function installNsis(packagePath, installPath) {
  runProcess(packagePath, ['/S', `/D=${installPath}`])
  requireFile(join(installPath, 'w-editor-desktop.exe'), 'NSIS installed executable')
  requireFile(join(installPath, 'uninstall.exe'), 'NSIS uninstaller')
}

async function waitForPathAbsent(path, label, timeout = 15_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (!existsSync(path)) return
    await sleep(200)
  }
  throw new Error(`${label} remained after ${timeout}ms: ${path}`)
}

async function uninstallNsis(installPath) {
  runProcess(join(installPath, 'uninstall.exe'), ['/S'])
  await waitForPathAbsent(installPath, 'NSIS installation directory')
}

function installMsi(packagePath, installPath, logPath) {
  runElevatedMsi(['/i', packagePath, '/qn', '/norestart', `INSTALLDIR=${installPath}`, '/L*V', logPath])
  requireFile(join(installPath, 'w-editor-desktop.exe'), 'MSI installed executable')
}

function uninstallMsi(packagePath, installPath, logPath) {
  runElevatedMsi(['/x', packagePath, '/qn', '/norestart', '/L*V', logPath])
  if (existsSync(join(installPath, 'w-editor-desktop.exe'))) throw new Error('MSI uninstall left the application executable in place.')
}

function captureMsiEvents(startTime, outputPath) {
  const command = `$events = @(Get-WinEvent -FilterHashtable @{ LogName = 'Application'; ProviderName = 'MsiInstaller'; StartTime = [datetime]::Parse(${psQuote(startTime)}) } -ErrorAction SilentlyContinue | Select-Object TimeCreated, Id, LevelDisplayName, Message); if ($events.Count -eq 0) { '[]' } else { $events | ConvertTo-Json -Depth 4 }`
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`MsiInstaller event capture exited with ${result.status}.`)
  writeFileSync(outputPath, result.stdout || '[]', 'utf8')
}

function verifyMsiLogs(paths) {
  runProcess(process.execPath, [resolve(repositoryRoot, 'scripts/verify-msi-install-events.mjs'), ...paths])
}

requireFile(nsisPackage, 'NSIS package')
requireFile(msiPackage, 'MSI package')
requireFile(nativeDriver, 'Edge WebDriver')
requireFile(tauriDriver, 'tauri-driver')
mkdirSync(lifecycleRoot, { recursive: true })
const result = {
  status: 'passed',
  browser: 'Microsoft Edge WebView2',
  lifecycleRoot,
  packages: {
    nsis: { path: nsisPackage, bytes: statSync(nsisPackage).size, sha256: hashFile(nsisPackage) },
    msi: { path: msiPackage, bytes: statSync(msiPackage).size, sha256: hashFile(msiPackage) },
  },
  installers: {},
}

const nsisRoot = join(lifecycleRoot, 'nsis')
const nsisInstall = join(nsisRoot, 'install')
const nsisProfile = join(nsisRoot, 'profile')
const nsisData = join(nsisRoot, 'data')
mkdirSync(nsisRoot, { recursive: true })
console.log(`INSTALLER_LIFECYCLE NSIS ports=${installerPorts.nsisFirst.port}/${installerPorts.nsisFirst.nativePort}`)
installNsis(nsisPackage, nsisInstall)
const nsisFirst = await installedFirstSmoke(join(nsisInstall, 'w-editor-desktop.exe'), nsisProfile, nsisData, installerPorts.nsisFirst, 'NSIS')
const nsisDrawio = drawioSmoke(join(nsisInstall, 'w-editor-desktop.exe'), nsisProfile, 'NSIS', installerPorts.nsisDrawio)
await uninstallNsis(nsisInstall)
if (!existsSync(join(nsisData, 'W-EditorData', 'library.db'))) throw new Error('NSIS uninstall did not retain the Data Root database.')
installNsis(nsisPackage, nsisInstall)
const nsisReopen = await installedReopenSmoke(join(nsisInstall, 'w-editor-desktop.exe'), nsisProfile, nsisData, installerPorts.nsisReopen, nsisFirst.documentId, nsisFirst.markdown, 'NSIS')
result.installers.nsis = { installDir: nsisInstall, dataRootParent: nsisData, first: nsisFirst, drawio: nsisDrawio, uninstalledExecutable: true, reinstall: nsisReopen }

const msiRoot = join(lifecycleRoot, 'msi')
const msiInstall = join(msiRoot, 'install')
const msiProfile = join(msiRoot, 'profile')
const msiData = join(msiRoot, 'data')
const msiInstallLog = join(msiRoot, 'install.log')
const msiUninstallLog = join(msiRoot, 'uninstall.log')
const msiEventDump = join(msiRoot, 'msi-events.json')
mkdirSync(msiRoot, { recursive: true })
const msiStartTime = new Date().toISOString()
console.log(`INSTALLER_LIFECYCLE MSI ports=${installerPorts.msiFirst.port}/${installerPorts.msiFirst.nativePort}`)
installMsi(msiPackage, msiInstall, msiInstallLog)
const msiFirst = await installedFirstSmoke(join(msiInstall, 'w-editor-desktop.exe'), msiProfile, msiData, installerPorts.msiFirst, 'MSI')
const msiDrawio = drawioSmoke(join(msiInstall, 'w-editor-desktop.exe'), msiProfile, 'MSI', installerPorts.msiDrawio)
uninstallMsi(msiPackage, msiInstall, msiUninstallLog)
captureMsiEvents(msiStartTime, msiEventDump)
verifyMsiLogs([msiInstallLog, msiUninstallLog, msiEventDump])
if (!existsSync(join(msiData, 'W-EditorData', 'library.db'))) throw new Error('MSI uninstall did not retain the Data Root database.')
installMsi(msiPackage, msiInstall, join(msiRoot, 'reinstall.log'))
const msiReopen = await installedReopenSmoke(join(msiInstall, 'w-editor-desktop.exe'), msiProfile, msiData, installerPorts.msiReopen, msiFirst.documentId, msiFirst.markdown, 'MSI')
result.installers.msi = { installDir: msiInstall, dataRootParent: msiData, first: msiFirst, drawio: msiDrawio, uninstalledExecutable: true, reinstall: msiReopen, eventDump: msiEventDump, logs: [msiInstallLog, msiUninstallLog] }

restoreOriginalLocator()
const serializedResult = JSON.stringify(result, null, 2)
if (process.env.W_EDITOR_LIFECYCLE_EVIDENCE_PATH) {
  const evidencePath = resolve(process.env.W_EDITOR_LIFECYCLE_EVIDENCE_PATH)
  mkdirSync(resolve(evidencePath, '..'), { recursive: true })
  writeFileSync(evidencePath, `${serializedResult}\n`, 'utf8')
}
console.log(serializedResult)
