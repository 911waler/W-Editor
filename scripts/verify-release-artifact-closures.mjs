import { createHash } from 'node:crypto'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { inflateRawSync } from 'node:zlib'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join, parse, resolve } from 'node:path'

import { readReleaseVersions } from './release-versions.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
readReleaseVersions(repositoryRoot)
const releaseManifestPath = resolve(repositoryRoot, process.env.W_EDITOR_RELEASE_MANIFEST ?? 'artifacts/desktop/release-manifest.json')
const targetRoot = resolve(process.env.W_EDITOR_CARGO_TARGET_DIR ?? join(parse(repositoryRoot).root, 'w-editor-tauri-target'))
const webDistributionRoot = resolve(repositoryRoot, 'packages/editor-web/dist')
const webManifestPath = join(webDistributionRoot, 'manifest.json')
const nativeDriver = resolve(process.env.W_EDITOR_EDGE_DRIVER ?? '.tmp/tauri-webdriver/msedgedriver.exe')
const tauriDriver = resolve(process.env.W_EDITOR_TAURI_DRIVER ?? '.tmp/tauri-driver.exe')
const evidencePath = resolve(repositoryRoot, 'artifacts/release-governance/task-9-5-current-verification.json')
const lifecycleEvidencePath = resolve(repositoryRoot, 'artifacts/release-governance/task-9-5-current-installer-lifecycle-rerun-20260829.json')
const closureRoot = mkdtempSync(resolve(repositoryRoot, '.tmp/release-artifact-closure-'))
const desktopLocatorPath = join(
  process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming'),
  'com.weditor.desktop.spike',
  'data-root.json',
)
const originalDesktopLocator = existsSync(desktopLocatorPath) ? readFileSync(desktopLocatorPath) : null

function restoreDesktopLocator() {
  if (originalDesktopLocator !== null) {
    mkdirSync(resolve(desktopLocatorPath, '..'), { recursive: true })
    writeFileSync(desktopLocatorPath, originalDesktopLocator)
    return
  }
  if (!existsSync(desktopLocatorPath)) return
  let root
  try {
    root = String(JSON.parse(readFileSync(desktopLocatorPath, 'utf8')).root ?? '')
  } catch {
    return
  }
  if (root.replace(/^\\\\\?\\/u, '').toLocaleLowerCase().startsWith(closureRoot.toLocaleLowerCase())) unlinkSync(desktopLocatorPath)
}

function cleanupTemporaryNsisRegistration() {
  const uninstaller = join(closureRoot, 'nsis', 'uninstall.exe')
  if (existsSync(uninstaller)) spawnSync(uninstaller, ['/S'], { stdio: 'ignore', windowsHide: true })
}

process.on('exit', () => {
  cleanupTemporaryNsisRegistration()
  restoreDesktopLocator()
})

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase()
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

function fileHash(path) {
  return hash(readFileSync(path))
}

function zipEntries(path) {
  const archive = readFileSync(path)
  const endSignature = Buffer.from([0x50, 0x4B, 0x05, 0x06])
  const endOffset = archive.lastIndexOf(endSignature)
  requireCondition(endOffset >= 0, 'Web ZIP end-of-central-directory record is missing.')
  const count = archive.readUInt16LE(endOffset + 10)
  const centralSize = archive.readUInt32LE(endOffset + 12)
  const centralOffset = archive.readUInt32LE(endOffset + 16)
  requireCondition(centralOffset + centralSize <= archive.length, 'Web ZIP central directory is outside the archive.')
  const entries = []
  let offset = centralOffset
  for (let index = 0; index < count; index += 1) {
    requireCondition(archive.readUInt32LE(offset) === 0x02014B50, 'Web ZIP central directory entry is invalid.')
    const compression = archive.readUInt16LE(offset + 10)
    const compressedSize = archive.readUInt32LE(offset + 20)
    const uncompressedSize = archive.readUInt32LE(offset + 24)
    const nameLength = archive.readUInt16LE(offset + 28)
    const extraLength = archive.readUInt16LE(offset + 30)
    const commentLength = archive.readUInt16LE(offset + 32)
    const localOffset = archive.readUInt32LE(offset + 42)
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    requireCondition(!name.startsWith('/') && !name.split('/').includes('..') && !name.includes('\\'), `Web ZIP path escapes its root: ${name}`)
    requireCondition(archive.readUInt32LE(localOffset) === 0x04034B50, `Web ZIP local entry is invalid: ${name}`)
    const localNameLength = archive.readUInt16LE(localOffset + 26)
    const localExtraLength = archive.readUInt16LE(localOffset + 28)
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength
    const compressed = archive.subarray(dataOffset, dataOffset + compressedSize)
    const content = compression === 0 ? compressed : compression === 8 ? inflateRawSync(compressed) : null
    requireCondition(content !== null, `Unsupported Web ZIP compression method for ${name}.`)
    requireCondition(content.byteLength === uncompressedSize, `Web ZIP size mismatch: ${name}`)
    entries.push({ name, compression, bytes: content, sha256: hash(content) })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function extractNsis(installerPath) {
  const destination = join(closureRoot, 'nsis')
  const result = spawnSync(installerPath, ['/S', `/D=${destination}`], { stdio: 'ignore', windowsHide: true })
  requireCondition(result.error === undefined && result.status === 0, `NSIS extraction failed with exit code ${String(result.status)}.`)
  const executable = join(destination, 'w-editor-desktop.exe')
  requireCondition(existsSync(executable), 'NSIS extraction did not produce w-editor-desktop.exe.')
  return { destination, executable }
}

function extractMsi(installerPath) {
  const destination = join(closureRoot, 'msi')
  const output = execFileSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    resolve(repositoryRoot, 'scripts/extract-msi-artifact.ps1'),
    '-MsiPath',
    installerPath,
    '-Destination',
    destination,
  ], { cwd: repositoryRoot, encoding: 'utf8' })
  const lines = output.trim().split(/\r?\n/u).filter(Boolean)
  const result = JSON.parse(lines.at(-1) ?? '{}')
  requireCondition(result.status === 'passed' && typeof result.payloadPath === 'string', 'MSI extraction did not return a payload.')
  const payload = resolve(repositoryRoot, result.payloadPath)
  requireCondition(existsSync(payload), `MSI extracted payload is missing: ${payload}`)
  return { destination, executable: payload, extraction: result }
}

function request(base, path, method = 'GET', body) {
  return fetch(`${base}${path}`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { 'content-type': 'application/json' },
    method,
    signal: AbortSignal.timeout(15_000),
  }).then(async (response) => {
    const payload = await response.json().catch(() => null)
    if (!response.ok) throw new Error(`WebDriver ${method} ${path} failed: ${payload?.value?.message ?? response.status}`)
    return payload?.value
  })
}

async function probeDesktopExecutable(executable, label, index) {
  requireCondition(existsSync(nativeDriver), 'Edge WebDriver is missing for Desktop closure runtime proof.')
  requireCondition(existsSync(tauriDriver), 'tauri-driver is missing for Desktop closure runtime proof.')
  const port = 6100 + (process.pid % 300) * 10 + index * 2
  const nativePort = 25_000 + (process.pid % 300) * 10 + index * 2
  const base = `http://127.0.0.1:${port}`
  const profileRoot = join(closureRoot, `${label.toLowerCase()}-profile`)
  const dataRootParent = join(closureRoot, `${label.toLowerCase()}-data`)
  const driver = spawn(tauriDriver, ['--port', String(port), '--native-port', String(nativePort), '--native-driver', nativeDriver], { env: { ...process.env, APPDATA: profileRoot, LOCALAPPDATA: profileRoot }, stdio: 'ignore', windowsHide: true })
  let sessionId = null
  const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
  const execute = (script) => request(base, `/session/${sessionId}/execute/sync`, 'POST', { args: [], script })
  const invoke = (command, payload = {}) => request(base, `/session/${sessionId}/execute/async`, 'POST', {
    args: [payload],
    script: `const done = arguments[arguments.length - 1]; const bridge = globalThis.__TAURI_INTERNALS__; if (bridge === undefined || typeof bridge.invoke !== 'function') { done({ status: 'unavailable' }); } else { bridge.invoke(${JSON.stringify(command)}, arguments[0]).then((value) => done({ status: 'fulfilled', value })).catch((error) => done({ status: 'rejected', error: String(error) })); }`,
  })
  try {
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      try {
        await request(base, '/status')
        break
      } catch {
        await sleep(100)
      }
    }
    const session = await request(base, '/session', 'POST', {
      capabilities: {
        alwaysMatch: {
          browserName: 'webview2',
          'tauri:options': { application: executable, webviewOptions: {} },
        },
      },
    })
    sessionId = session?.sessionId ?? null
    requireCondition(sessionId !== null, `${label} WebView2 session was not created.`)
    const invokeReadyDeadline = Date.now() + 15_000
    while (Date.now() < invokeReadyDeadline) {
      const bridgeReady = await execute('return typeof globalThis.__TAURI_INTERNALS__?.invoke === "function"')
      if (bridgeReady === true) break
      await sleep(100)
    }
    const selected = await invoke('select_data_root', { parentPath: dataRootParent })
    requireCondition(selected?.status === 'fulfilled' && selected.value?.state === 'ready', `${label} extracted Desktop payload could not select an isolated Data Root: ${JSON.stringify(selected)}`)
    const readyDeadline = Date.now() + 20_000
    let identity = null
    while (Date.now() < readyDeadline) {
      identity = await execute(`return { ready: document.documentElement.dataset.desktopReady === 'true', workspace: Boolean(document.querySelector('.workspace-shell')), setup: Boolean(document.querySelector('[data-testid="desktop-data-root-setup"]')), recovery: Boolean(document.querySelector('[data-testid="desktop-data-root-recovery"]')), error: document.querySelector('.desktop-app-error')?.textContent?.trim() ?? '', dataRoot: document.querySelector('[data-testid="desktop-library-status"] .desktop-app-header__status-path')?.textContent?.trim() ?? '', rootDataset: { ...document.documentElement.dataset }, shellState: document.querySelector('[data-testid="desktop-library-shell"]')?.getAttribute('data-data-root-state') ?? '', articlePanel: Boolean(document.querySelector('.article-panel')), editorSurface: Boolean(document.querySelector('[data-testid="editor-surface"]')), scripts: [...document.scripts].map((node) => node.src).filter(Boolean), styles: [...document.querySelectorAll('link[rel="stylesheet"]')].map((node) => node.href).filter(Boolean), resources: performance.getEntriesByType('resource').map((entry) => entry.name), tiptap: Boolean(document.querySelector('.ProseMirror')), katex: document.querySelectorAll('.katex').length, fontStatus: document.fonts.status, katexFont: document.fonts.check('12px KaTeX_Main'), title: document.title }`)
      if (identity?.ready === true && identity.workspace === true) break
      await sleep(100)
    }
    requireCondition(identity?.ready === true && identity.workspace === true, `${label} extracted Desktop payload did not reach ready workspace: ${JSON.stringify({ ready: identity?.ready, workspace: identity?.workspace, title: identity?.title, setup: identity?.setup, recovery: identity?.recovery, error: identity?.error, dataRoot: identity?.dataRoot, rootDataset: identity?.rootDataset, shellState: identity?.shellState, articlePanel: identity?.articlePanel, editorSurface: identity?.editorSurface })}`)
    await execute(`document.querySelector('[data-command-id="mode.preview"]')?.click(); return true`)
    const previewDeadline = Date.now() + 15_000
    while (Date.now() < previewDeadline) {
      identity = await execute(`return { ready: document.documentElement.dataset.wEditorReady === 'true', tiptap: Boolean(document.querySelector('[data-mode="preview"] .preview-rendered-content.ProseMirror[data-presentation-engine="tiptap"]')), katex: document.querySelectorAll('.katex').length, fontStatus: document.fonts.status, katexFont: document.fonts.check('12px KaTeX_Main'), scripts: [...document.scripts].map((node) => node.src).filter(Boolean), styles: [...document.querySelectorAll('link[rel="stylesheet"]')].map((node) => node.href).filter(Boolean), resources: performance.getEntriesByType('resource').map((entry) => entry.name) }`)
      if (identity?.tiptap === true) break
      await sleep(100)
    }
    requireCondition(identity?.tiptap === true, `${label} extracted Desktop payload did not render the Tiptap presentation.`)
    const externalResources = (identity.resources ?? []).filter((name) => /^https?:/iu.test(name) && !/^https?:\/\/(?:tauri|ipc)\.localhost\//iu.test(name))
    requireCondition(externalResources.length === 0, `${label} extracted Desktop payload loaded external resources: ${JSON.stringify(externalResources)}`)
    const localResources = [...(identity.resources ?? []), ...(identity.scripts ?? []), ...(identity.styles ?? [])]
    requireCondition(localResources.some((name) => /\.js(?:\?|$)/iu.test(name)), `${label} runtime did not expose a JS resource.`)
    requireCondition(localResources.some((name) => /\.css(?:\?|$)/iu.test(name)), `${label} runtime did not expose a CSS resource.`)
    requireCondition(identity.fontStatus === 'loaded' || identity.katexFont === true, `${label} runtime did not prove KaTeX font readiness.`)
    return { label, browser: session?.capabilities?.browserName ?? 'webview2', browserVersion: session?.capabilities?.browserVersion ?? 'unknown', dataRootParent, resources: identity.resources ?? [], scripts: identity.scripts ?? [], styles: identity.styles ?? [], presentationEngine: 'tiptap', katex: identity.katex, katexFont: identity.katexFont, externalResources }
  } finally {
    if (sessionId !== null) await request(base, `/session/${sessionId}`, 'DELETE').catch(() => {})
    driver.kill()
  }
}

const checks = []
try {
  requireCondition(existsSync(releaseManifestPath), 'Release manifest is missing.')
  const releaseManifest = JSON.parse(readFileSync(releaseManifestPath, 'utf8'))
  const webManifest = JSON.parse(readFileSync(webManifestPath, 'utf8'))
  const webZipPath = resolve(repositoryRoot, releaseManifest.artifacts.webZip.path)
  requireCondition(fileHash(webZipPath) === releaseManifest.artifacts.webZip.sha256, 'Web ZIP hash changed.')
  const zip = zipEntries(webZipPath)
  const zipByName = new Map(zip.map((entry) => [entry.name, entry]))
  requireCondition(zipByName.size === webManifest.files.length + 1, 'Web ZIP file count does not match the Web manifest.')
  for (const file of webManifest.files) {
    const entry = zipByName.get(file.path)
    requireCondition(entry !== undefined && entry.bytes.byteLength === file.size && entry.sha256.toUpperCase() === file.sha256.toUpperCase(), `Web ZIP closure mismatch: ${file.path}`)
  }
  const manifestEntry = zipByName.get('manifest.json')
  requireCondition(manifestEntry !== undefined && manifestEntry.bytes.toString('utf8') === readFileSync(webManifestPath, 'utf8'), 'Web ZIP manifest content differs from the built Web manifest.')
  requireCondition(webManifest.fonts.embedded === true || webManifest.fonts.files.length > 0, 'Web ZIP does not record a font closure.')
  requireCondition(webManifest.testSeam?.status === 'absent', 'Web ZIP source manifest records a test seam.')
  checks.push({ name: 'web-zip', status: 'passed', fileCount: zip.length, bytes: statSync(webZipPath).size, sha256: fileHash(webZipPath), fontsEmbedded: webManifest.fonts.embedded, drawioFiles: webManifest.drawio.files.length })

  const desktopBinary = resolve(targetRoot, 'debug/w-editor-desktop.exe')
  requireCondition(existsSync(desktopBinary), 'Current Desktop payload executable is missing.')
  const extracted = [
    { kind: 'nsis', packagePath: resolve(releaseManifest.artifacts.nsis.path), extraction: extractNsis(resolve(releaseManifest.artifacts.nsis.path)) },
    { kind: 'msi', packagePath: resolve(releaseManifest.artifacts.msi.path), extraction: extractMsi(resolve(releaseManifest.artifacts.msi.path)) },
  ]
  const binaryMarkers = ['__W_EDITOR_E2E__', 'data-e2e', 'src/testing/']
  const resourceProbes = []
  for (let index = 0; index < extracted.length; index += 1) {
    const artifact = extracted[index]
    requireCondition(fileHash(artifact.packagePath) === releaseManifest.artifacts[artifact.kind].sha256, `${artifact.kind.toUpperCase()} package hash changed.`)
    requireCondition(statSync(artifact.extraction.executable).size > 1_000_000, `${artifact.kind.toUpperCase()} embedded Desktop payload is unexpectedly small.`)
    const binaryText = readFileSync(artifact.extraction.executable).toString('latin1')
    requireCondition(binaryText.includes('KaTeX_Main') && binaryText.toLowerCase().includes('cherry') && binaryText.toLowerCase().includes('drawio'), `${artifact.kind.toUpperCase()} payload lacks bundled renderer/font/draw.io markers.`)
    requireCondition(binaryMarkers.every((marker) => !binaryText.includes(marker)), `${artifact.kind.toUpperCase()} payload retains a test seam marker.`)
    resourceProbes.push(await probeDesktopExecutable(artifact.extraction.executable, artifact.kind.toUpperCase(), index))
  }
  checks.push({ name: 'desktop-exe-msi-embedded-payloads', status: 'passed', artifacts: extracted.map(({ kind, extraction }) => ({ kind, executable: extraction.executable, bytes: statSync(extraction.executable).size, sha256: fileHash(extraction.executable), matchesUnbundledBuildPayload: fileHash(extraction.executable) === fileHash(desktopBinary) })), resourceProbes })
  const lifecycleEvidence = existsSync(lifecycleEvidencePath) ? JSON.parse(readFileSync(lifecycleEvidencePath, 'utf8')) : null
  const lifecyclePackagesMatch = ['nsis', 'msi'].every((kind) => {
    const expected = releaseManifest.artifacts[kind]
    const tested = lifecycleEvidence?.packages?.[kind]
    return typeof expected?.sha256 === 'string'
      && typeof tested?.sha256 === 'string'
      && tested.sha256.toLocaleUpperCase() === expected.sha256.toLocaleUpperCase()
      && tested.bytes === expected.bytes
  })
  const lifecyclePassed = lifecycleEvidence?.status === 'passed' && lifecyclePackagesMatch

  const result = {
    schemaVersion: 1,
    change: 'dual-target-release',
    task: '9.5',
    status: 'passed',
    currentHead: releaseManifest.commit,
    checks,
    installerLifecycle: {
      status: lifecyclePassed ? 'passed' : 'blocked-separately',
      evidence: lifecyclePassed ? 'artifacts/release-governance/task-9-5-current-installer-lifecycle-rerun-20260829.json' : 'artifacts/release-governance/task-9-5-current-red-msi-uac.json',
      note: lifecyclePassed
        ? 'Current package lifecycle completed with approved UAC; package closure and installed lifecycle are both current.'
        : lifecycleEvidence?.status === 'passed' && !lifecyclePackagesMatch
          ? 'The last passed installer lifecycle belongs to different package hashes. Extraction/runtime closure passed, but current NSIS/MSI installed lifecycle remains blocked.'
          : 'Package closure was verified by extraction and runtime payload probes; this does not replace an installed MSI lifecycle gate.',
    },
    notExecuted: [...(lifecyclePassed ? [] : ['current-package MSI install/uninstall/reinstall with UAC approval']), '9.6-9.11'],
  }
  writeFileSync(evidencePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  const result = {
    schemaVersion: 1,
    change: 'dual-target-release',
    task: '9.5',
    status: 'failed',
    checks,
    error: error instanceof Error ? error.message : String(error),
    notExecuted: ['remaining 9.5 closure probes', '9.6-9.11'],
  }
  writeFileSync(evidencePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.error(JSON.stringify(result, null, 2))
  process.exitCode = 1
}
