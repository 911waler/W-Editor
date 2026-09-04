import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { chromium } from 'playwright'

import { createAtomicVersionPointer, inspectWebVersion } from './web-version-switching.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const distributionRoot = resolve(repositoryRoot, 'packages/editor-web/dist')
const outputPath = resolve(process.env.W_EDITOR_UPGRADE_ROLLBACK_EVIDENCE_PATH ?? 'artifacts/release-governance/task-9-10-current-verification.json')
const lifecycleEvidencePath = resolve(repositoryRoot, 'artifacts/release-governance/task-9-5-current-installer-lifecycle-rerun-20260829.json')
const nativeDriver = resolve(process.env.W_EDITOR_EDGE_DRIVER ?? '.tmp/tauri-webdriver/msedgedriver.exe')
const tauriDriver = resolve(process.env.W_EDITOR_TAURI_DRIVER ?? '.tmp/tauri-driver.exe')
const temporaryRoot = mkdtempSync(resolve(repositoryRoot, '.tmp/release-upgrade-rollback-'))
const desktopLocatorPath = resolve(
  process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming'),
  'com.weditor.desktop.spike',
  'data-root.json',
)
const originalDesktopLocator = existsSync(desktopLocatorPath) ? readFileSync(desktopLocatorPath) : null

function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

function contentType(path) {
  return {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ttf': 'font/ttf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  }[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

function safeVersionFile(directory, resourcePath) {
  const candidate = resolve(directory, resourcePath)
  const candidateRelative = relative(directory, candidate)
  return candidateRelative !== '' && candidateRelative !== '..' && !candidateRelative.startsWith('../') && !candidateRelative.startsWith('..\\')
    ? candidate
    : null
}

function createVersionServer({ pointerPath, versionDirectories, requestLog }) {
  return createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname)
    if (pathname === '/loader.html') {
      response.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'text/html; charset=utf-8' })
      response.end('<!doctype html><html><head><meta charset="utf-8"><title>W-Editor atomic version gate</title></head><body></body></html>')
      return
    }
    if (pathname === '/current.json') {
      requestLog.push({ cacheControl: 'no-store', pathname })
      response.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' })
      response.end(readFileSync(pointerPath))
      return
    }
    const match = /^\/static\/vendor\/w-editor\/([^/]+)\/(.+)$/u.exec(pathname)
    const directory = match === null ? null : versionDirectories.get(match[1])
    const filePath = directory === undefined || directory === null ? null : safeVersionFile(directory, match[2])
    if (filePath === null || !existsSync(filePath) || !statSync(filePath).isFile()) {
      response.writeHead(404, { 'cache-control': 'no-store' })
      response.end('not found')
      return
    }
    requestLog.push({ cacheControl: 'public, max-age=31536000, immutable', pathname, version: match[1] })
    response.writeHead(200, {
      'cache-control': 'public, max-age=31536000, immutable',
      'content-length': statSync(filePath).size,
      'content-type': contentType(filePath),
    })
    response.end(readFileSync(filePath))
  })
}

function listen(server) {
  return new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') rejectPromise(new Error('Version server did not expose a TCP port.'))
      else resolvePromise(address.port)
    })
  })
}

async function closeServer(server) {
  await new Promise((resolvePromise) => server.close(() => resolvePromise()))
}

function staticRequestCount(requestLog, version) {
  return requestLog.filter((entry) => entry.version === version).length
}

async function loadActiveVersion(context, baseUrl) {
  const page = await context.newPage()
  try {
    await page.goto(`${baseUrl}/loader.html`, { waitUntil: 'domcontentloaded' })
    return await page.evaluate(async () => {
      const pointerResponse = await fetch('/current.json', { cache: 'no-store' })
      if (!pointerResponse.ok) throw new Error(`Pointer request failed: ${pointerResponse.status}`)
      const pointer = await pointerResponse.json()
      const prefix = `/static/vendor/w-editor/${pointer.activeVersion}`
      const cssUrl = `${prefix}/w-editor.css`
      const cssResponse = await fetch(cssUrl, { cache: 'force-cache' })
      if (!cssResponse.ok) throw new Error(`CSS request failed: ${cssResponse.status}`)
      const cssBytes = (await cssResponse.arrayBuffer()).byteLength
      const moduleUrl = `${prefix}/editor.es.js`
      const api = await import(moduleUrl)
      const resourceUrls = performance.getEntriesByType('resource').map((entry) => entry.name)
        .filter((url) => url.includes('/static/vendor/w-editor/'))
      return {
        activeVersion: pointer.activeVersion,
        apiExports: Object.keys(api).sort(),
        cssBytes,
        moduleUrl: new URL(moduleUrl, globalThis.location.origin).href,
        resourceUrls,
      }
    })
  } finally {
    await page.close()
  }
}

async function runWebExercise() {
  const webRoot = join(temporaryRoot, 'web')
  const oldDirectory = join(webRoot, '1.0.0')
  const newDirectory = join(webRoot, '1.1.0')
  const failedDirectory = join(webRoot, '1.2.0')
  cpSync(distributionRoot, oldDirectory, { recursive: true })
  cpSync(distributionRoot, newDirectory, { recursive: true })
  cpSync(distributionRoot, failedDirectory, { recursive: true })
  const oldInspection = inspectWebVersion({ directory: oldDirectory, hostAdapterVersion: '1.0.0', version: '1.0.0' })
  const newInspection = inspectWebVersion({ directory: newDirectory, hostAdapterVersion: '1.0.0', version: '1.1.0' })
  requireCondition(oldInspection.status === 'compatible' && newInspection.status === 'compatible', 'Both coexisting Web versions must pass closure and compatibility inspection.')

  const pointerPath = join(webRoot, 'current.json')
  const pointer = createAtomicVersionPointer(pointerPath, '1.0.0')
  const versionDirectories = new Map([
    ['1.0.0', oldDirectory],
    ['1.1.0', newDirectory],
    ['1.2.0', failedDirectory],
  ])
  const requestLog = []
  const server = createVersionServer({ pointerPath, requestLog, versionDirectories })
  const port = await listen(server)
  const baseUrl = `http://127.0.0.1:${port}`
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext()
    try {
      const oldLoad = await loadActiveVersion(context, baseUrl)
      const oldInitialRequests = staticRequestCount(requestLog, '1.0.0')
      const oldInitialPaths = requestLog.filter((entry) => entry.version === '1.0.0').map((entry) => entry.pathname)
      const oldCachedLoad = await loadActiveVersion(context, baseUrl)
      const oldRepeatRequests = staticRequestCount(requestLog, '1.0.0') - oldInitialRequests
      const oldRepeatPaths = requestLog.filter((entry) => entry.version === '1.0.0').slice(oldInitialRequests).map((entry) => entry.pathname)
      const switched = await pointer.switchTo({ directory: newDirectory, version: '1.1.0' }, async (candidate) => {
        const verification = inspectWebVersion({ directory: candidate.directory, hostAdapterVersion: '1.0.0', version: candidate.version })
        return { ok: verification.status === 'compatible', reason: verification.reason, verification }
      })
      const newLoad = await loadActiveVersion(context, baseUrl)

      const failedEntry = join(failedDirectory, 'editor.es.js')
      writeFileSync(failedEntry, `${readFileSync(failedEntry, 'utf8')}\n// corrupted candidate\n`, 'utf8')
      const failedInspection = inspectWebVersion({ directory: failedDirectory, hostAdapterVersion: '1.0.0', version: '1.2.0' })
      const rolledBack = await pointer.switchTo({ directory: failedDirectory, version: '1.2.0' }, async () => ({
        ok: failedInspection.status === 'compatible',
        reason: failedInspection.reason,
        verification: failedInspection,
      }))
      const afterFailureLoad = await loadActiveVersion(context, baseUrl)

      const oldResourcesIsolated = oldLoad.resourceUrls.length > 0 && oldLoad.resourceUrls.every((url) => url.includes('/1.0.0/'))
      const newResourcesIsolated = newLoad.resourceUrls.length > 0 && newLoad.resourceUrls.every((url) => url.includes('/1.1.0/'))
      requireCondition(oldLoad.activeVersion === '1.0.0' && oldCachedLoad.activeVersion === '1.0.0', 'The initial Web version did not remain active for the repeat cache load.')
      requireCondition(oldRepeatRequests < oldInitialRequests, `The immutable old-version cache did not reduce origin requests (${oldRepeatRequests} repeat versus ${oldInitialRequests} initial).`)
      requireCondition(switched.status === 'switched' && newLoad.activeVersion === '1.1.0', 'The verified Web candidate was not atomically activated.')
      requireCondition(oldResourcesIsolated && newResourcesIsolated, 'A browser load mixed Web resources across version namespaces.')
      requireCondition(existsSync(oldDirectory) && existsSync(newDirectory), 'Atomic switching removed a coexisting Web version directory.')
      requireCondition(failedInspection.status === 'incompatible' && rolledBack.status === 'rolled-back', 'The corrupt Web candidate was not rejected.')
      requireCondition(afterFailureLoad.activeVersion === '1.1.0' && (await pointer.read()).activeVersion === '1.1.0', 'Failed Web activation did not preserve the prior active pointer.')
      requireCondition(requestLog.filter((entry) => entry.version === '1.2.0').length === 0, 'The rejected Web candidate was served to a browser.')

      return {
        status: 'passed',
        browser: 'Playwright bundled Chromium',
        browserVersion: browser.version(),
        coexistence: { oldDirectory, newDirectory, bothPresent: true },
        atomicSwitch: { before: oldLoad.activeVersion, result: switched, after: newLoad.activeVersion },
        cacheIsolation: {
          immutableCacheHeaders: requestLog.filter((entry) => entry.version !== undefined).every((entry) => entry.cacheControl.includes('immutable')),
          oldInitialRequests,
          oldInitialPaths,
          oldRepeatRequests,
          oldRepeatPaths,
          oldResources: oldLoad.resourceUrls,
          newResources: newLoad.resourceUrls,
          oldResourcesIsolated,
          newResourcesIsolated,
        },
        failedActivation: { inspection: failedInspection, result: rolledBack, activeAfterFailure: afterFailureLoad.activeVersion },
      }
    } finally {
      await context.close()
    }
  } finally {
    await browser.close()
    await closeServer(server)
  }
}

function createLegacyDatabase(databasePath) {
  rmSync(databasePath, { force: true })
  rmSync(`${databasePath}-shm`, { force: true })
  rmSync(`${databasePath}-wal`, { force: true })
  const database = new DatabaseSync(databasePath)
  try {
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE schema_meta(key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
      INSERT INTO schema_meta(key, value) VALUES ('schemaVersion', '1');
      CREATE TABLE articles(id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, markdown TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE article_versions(id TEXT PRIMARY KEY NOT NULL, article_id TEXT NOT NULL REFERENCES articles(id), revision INTEGER NOT NULL, markdown TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(article_id, revision));
      CREATE TABLE recovery_drafts(article_id TEXT PRIMARY KEY NOT NULL, base_revision INTEGER NOT NULL, markdown TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO articles(id, title, markdown, revision, created_at, updated_at) VALUES ('rollback-fixture', 'Rollback fixture', '# Preserved through migration', 1, '2026-08-29T00:00:00Z', '2026-08-29T00:00:00Z');
      INSERT INTO article_versions(id, article_id, revision, markdown, kind, created_at) VALUES ('rollback-fixture-1', 'rollback-fixture', 1, '# Preserved through migration', 'manual-save', '2026-08-29T00:00:00Z');
      PRAGMA user_version = 1;
    `)
  } finally {
    database.close()
  }
}

function markFutureSchema(databasePath) {
  const database = new DatabaseSync(databasePath)
  try {
    database.exec("UPDATE schema_meta SET value = '99' WHERE key = 'schemaVersion'; PRAGMA user_version = 99;")
  } finally {
    database.close()
  }
}

async function runDesktopExercise() {
  requireCondition(existsSync(lifecycleEvidencePath), `Current installer lifecycle evidence is missing: ${lifecycleEvidencePath}`)
  const lifecycle = JSON.parse(readFileSync(lifecycleEvidencePath, 'utf8'))
  requireCondition(lifecycle.status === 'passed', 'Current installer lifecycle evidence is not passed.')
  const executable = resolve(process.env.W_EDITOR_DESKTOP_EXE ?? join(lifecycle.lifecycleRoot, 'msi', 'install', 'w-editor-desktop.exe'))
  requireCondition(existsSync(executable), `Current installed Desktop executable is missing: ${executable}`)
  requireCondition(existsSync(nativeDriver), `Edge WebDriver is missing: ${nativeDriver}`)
  requireCondition(existsSync(tauriDriver), `tauri-driver is missing: ${tauriDriver}`)

  const desktopRoot = join(temporaryRoot, 'desktop')
  const dataRootParent = join(desktopRoot, 'data-root-parent')
  const isolatedAppData = join(desktopRoot, 'appdata')
  mkdirSync(dataRootParent, { recursive: true })
  mkdirSync(isolatedAppData, { recursive: true })
  const port = Number(process.env.W_EDITOR_UPGRADE_ROLLBACK_PORT ?? 4700 + (process.pid % 150))
  const nativePort = Number(process.env.W_EDITOR_UPGRADE_ROLLBACK_NATIVE_PORT ?? 5700 + (process.pid % 150))
  const base = `http://127.0.0.1:${port}`

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
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      try {
        await request('/status')
        return
      } catch {
        await sleep(100)
      }
    }
    throw new Error('tauri-driver did not become ready for the upgrade/rollback exercise.')
  }

  async function createSession() {
    const session = await request('/session', 'POST', {
      capabilities: { alwaysMatch: { browserName: 'webview2', 'tauri:options': { application: executable, webviewOptions: {} } } },
    })
    const sessionId = session?.sessionId ?? null
    requireCondition(sessionId !== null, 'WebDriver did not return a Desktop session id.')
    await request(`/session/${sessionId}/timeouts`, 'POST', { script: 20_000 })
    await sleep(750)
    return sessionId
  }

  async function invoke(sessionId, command, args = []) {
    return request(`/session/${sessionId}/execute/async`, 'POST', {
      args,
      script: `const done = arguments[arguments.length - 1]; const bridge = globalThis.__TAURI_INTERNALS__; if (bridge === undefined || typeof bridge.invoke !== 'function') { done({ status: 'unavailable' }); } else { bridge.invoke(${JSON.stringify(command)}, arguments[0]).then((value) => done({ status: 'fulfilled', value })).catch((error) => done({ status: 'rejected', error: String(error) })); }`,
    })
  }

  async function execute(sessionId, script) {
    return request(`/session/${sessionId}/execute/sync`, 'POST', { args: [], script })
  }

  function fulfilled(result, label) {
    if (result?.status !== 'fulfilled') throw new Error(`${label} failed: ${JSON.stringify(result)}`)
    return result.value
  }

  const driver = spawn(tauriDriver, ['--port', String(port), '--native-port', String(nativePort), '--native-driver', nativeDriver], {
    env: { ...process.env, APPDATA: isolatedAppData },
    stdio: 'ignore',
    windowsHide: true,
  })
  let sessionId = null
  try {
    await waitForDriver()
    sessionId = await createSession()
    const selected = fulfilled(await invoke(sessionId, 'select_data_root', [{ parentPath: dataRootParent }]), 'isolated Data Root selection')
    requireCondition(selected.state === 'ready', `Isolated Data Root was not ready: ${JSON.stringify(selected)}`)
    const dataRoot = String(selected.root).replace(/^\\\\\?\\/u, '')
    const databasePath = join(dataRoot, 'library.db')
    await request(`/session/${sessionId}`, 'DELETE').catch(() => {})
    sessionId = null
    await sleep(750)

    createLegacyDatabase(databasePath)
    const v1Hash = sha256(databasePath)
    sessionId = await createSession()
    const migratedArticle = fulfilled(await invoke(sessionId, 'library_load_markdown', [{ documentId: 'rollback-fixture' }]), 'schema-v1 article load and forward migration')
    const migratedStatus = fulfilled(await invoke(sessionId, 'library_schema_status'), 'migrated schema status')
    const backups = fulfilled(await invoke(sessionId, 'backup_list'), 'migration backup list')
    const migrationBackup = backups.find((backup) => backup.kind === 'migration' && backup.protected === true && backup.librarySchemaVersion === 1)
    requireCondition(migrationBackup !== undefined, `A protected schema-v1 migration backup was not created: ${JSON.stringify(backups)}`)
    const backupVerification = fulfilled(await invoke(sessionId, 'backup_verify', [{ backupId: migrationBackup.backupId }]), 'migration backup verification')
    requireCondition(migratedStatus.schemaVersion === 2 && migratedStatus.mode === 'ready', `Schema-v1 did not migrate to ready schema-v2: ${JSON.stringify(migratedStatus)}`)
    requireCondition(migratedArticle.markdown === '# Preserved through migration', 'The authoritative Markdown changed during migration.')
    requireCondition(backupVerification.valid === true && backupVerification.snapshotVerified === true && backupVerification.databaseIntegrity === true, `Migration backup verification failed: ${JSON.stringify(backupVerification)}`)
    const v2Hash = sha256(databasePath)

    await request(`/session/${sessionId}`, 'DELETE').catch(() => {})
    sessionId = null
    await sleep(750)
    markFutureSchema(databasePath)
    const futureHashBefore = sha256(databasePath)
    sessionId = await createSession()
    const futureUiSamples = []
    for (let index = 0; index < 30; index += 1) {
      futureUiSamples.push(await execute(sessionId, `return { error: document.querySelector('[data-testid="desktop-data-root-setup"] .desktop-app-error')?.textContent?.trim() ?? '', setup: Boolean(document.querySelector('[data-testid="desktop-data-root-setup"]')), state: document.querySelector('[data-data-root-state]')?.getAttribute('data-data-root-state') ?? '', workspace: Boolean(document.querySelector('.workspace-shell')) }`))
      await sleep(100)
    }
    const futureUiStates = [...new Map(futureUiSamples.map((sample) => [JSON.stringify(sample), sample])).values()]
    requireCondition(
      futureUiStates.length === 1
        && futureUiStates[0]?.error.includes('LIBRARY_FUTURE_SCHEMA') === true
        && futureUiStates[0]?.setup === true
        && futureUiStates[0]?.workspace === false,
      `Future-schema recovery UI flashed or lost its actionable error: ${JSON.stringify(futureUiStates)}`,
    )
    const futureStatus = fulfilled(await invoke(sessionId, 'library_schema_status'), 'future schema status')
    const recoveryStatus = fulfilled(await invoke(sessionId, 'library_recovery_status'), 'future schema recovery status')
    const rejectedWrite = await invoke(sessionId, 'library_create_article', [{ title: 'Must not write', markdown: '# Must not write' }])
    requireCondition(futureStatus.schemaVersion === 99 && futureStatus.mode === 'read_only_recovery' && futureStatus.readOnly === true, `Future schema was not isolated for rollback recovery: ${JSON.stringify(futureStatus)}`)
    requireCondition(recoveryStatus.schemaVersion === 99 && recoveryStatus.mode === 'read_only_recovery' && recoveryStatus.canReadOnlyExport === true && recoveryStatus.canMigrate === false, `Future schema recovery contract failed: ${JSON.stringify(recoveryStatus)}`)
    requireCondition(rejectedWrite.status === 'rejected' && String(rejectedWrite.error).includes('LIBRARY_FUTURE_SCHEMA'), `Rollback write was not explicitly refused: ${JSON.stringify(rejectedWrite)}`)
    await request(`/session/${sessionId}`, 'DELETE').catch(() => {})
    sessionId = null
    await sleep(500)
    const futureHashAfter = sha256(databasePath)
    requireCondition(futureHashAfter === futureHashBefore, 'Rollback compatibility probing mutated the future-schema database.')

    return {
      status: 'passed',
      executable,
      webView2Version: lifecycle.webView2Version ?? 'captured by current lifecycle evidence',
      isolatedAppData,
      dataRoot,
      forwardMigration: {
        fromSchemaVersion: 1,
        toSchemaVersion: migratedStatus.schemaVersion,
        databaseSha256Before: v1Hash,
        databaseSha256After: v2Hash,
        authoritativeMarkdownPreserved: true,
        migrationBackup,
        backupVerification,
      },
      rollbackCompatibility: {
        simulatedRollbackAppSupportedSchemaVersion: futureStatus.currentSchemaVersion,
        databaseSchemaVersion: futureStatus.schemaVersion,
        mode: futureStatus.mode,
        writeResult: rejectedWrite,
        readOnlyExportAvailable: recoveryStatus.canReadOnlyExport,
        automaticDowngradeAllowed: recoveryStatus.canMigrate,
        databaseSha256Before: futureHashBefore,
        databaseSha256After: futureHashAfter,
        databaseUnchanged: true,
        uiStability: {
          intervalMs: 100,
          samples: futureUiSamples.length,
          stable: true,
          states: futureUiStates,
        },
      },
    }
  } finally {
    if (sessionId !== null) await request(`/session/${sessionId}`, 'DELETE').catch(() => {})
    driver.kill()
    await sleep(250)
    if (originalDesktopLocator === null) rmSync(desktopLocatorPath, { force: true })
    else {
      mkdirSync(dirname(desktopLocatorPath), { recursive: true })
      writeFileSync(desktopLocatorPath, originalDesktopLocator)
    }
  }
}

const checks = []
try {
  const web = await runWebExercise()
  checks.push({ name: 'web-version-coexistence-atomic-switch-cache-isolation-failed-rollback', ...web })
  const desktop = await runDesktopExercise()
  checks.push({ name: 'desktop-schema-migration-backup-and-app-rollback-compatibility', ...desktop })
  const result = {
    schemaVersion: 1,
    change: 'dual-target-release',
    task: '9.10',
    status: checks.every((check) => check.status === 'passed') ? 'passed' : 'failed',
    checks,
    temporaryRoot,
    notExecuted: [],
  }
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(result, null, 2))
  if (result.status !== 'passed') process.exitCode = 1
} catch (error) {
  const result = {
    schemaVersion: 1,
    change: 'dual-target-release',
    task: '9.10',
    status: 'failed',
    checks,
    error: error instanceof Error ? error.message : String(error),
    temporaryRoot,
    notExecuted: ['remaining 9.10 checks after the first failed prerequisite', '9.11'],
  }
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.error(JSON.stringify(result, null, 2))
  process.exitCode = 1
}
