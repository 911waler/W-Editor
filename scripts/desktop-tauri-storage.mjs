import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'

const executable = resolve(process.env.W_EDITOR_DESKTOP_EXE ?? 'apps/desktop/src-tauri/target/debug/w-editor-desktop.exe')
const nativeDriver = resolve(process.env.W_EDITOR_EDGE_DRIVER ?? '.tmp/tauri-webdriver/msedgedriver.exe')
const tauriDriver = resolve(process.env.W_EDITOR_TAURI_DRIVER ?? '.tmp/tauri-driver.exe')
const port = Number(process.env.W_EDITOR_TAURI_STORAGE_PORT ?? 4455)
const nativePort = Number(process.env.W_EDITOR_NATIVE_STORAGE_PORT ?? 9526)
const base = `http://127.0.0.1:${port}`
const testParent = mkdtempSync(resolve('.tmp', 'desktop-storage-'))
const sourceParent = join(testParent, 'source-parent')
const migrationParent = join(testParent, 'migration-parent')
const exportPath = join(testParent, 'diagnostic.json')
const importedPath = join(testParent, 'external.md')
const importedMarkdown = '# External\n\nThe source file is read-only to the Library.'
writeFileSync(importedPath, importedMarkdown)

const locatorPath = join(process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming'), 'com.weditor.desktop.spike', 'data-root.json')
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

async function invoke(sessionId, command, args = []) {
  return request(`/session/${sessionId}/execute/async`, 'POST', {
    args,
    script: `const done = arguments[arguments.length - 1]; const bridge = globalThis.__TAURI_INTERNALS__; if (bridge === undefined || typeof bridge.invoke !== 'function') { done({ status: 'unavailable' }); } else { bridge.invoke(${JSON.stringify(command)}, arguments[0]).then((value) => done({ status: 'fulfilled', value })).catch((error) => done({ status: 'rejected', error: String(error) })); }`,
  })
}

function filesystemPath(value) {
  return typeof value === 'string' ? value.replace(/^\\\\\?\\/u, '') : value
}

function expectFulfilled(result, label) {
  if (result?.status !== 'fulfilled') throw new Error(`${label} failed: ${JSON.stringify(result)}`)
  return result.value
}

function expectRejected(result, label) {
  if (result?.status !== 'rejected') throw new Error(`${label} unexpectedly succeeded: ${JSON.stringify(result)}`)
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
let secondSessionId = null
let secondProcess = null

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
  await request(`/session/${id}/timeouts`, 'POST', { script: 20_000 })
  await sleep(750)
  return id
}

async function deleteSession(id) {
  if (id === null) return
  await request(`/session/${id}`, 'DELETE').catch(() => {})
}

try {
  await waitForDriver()
  sessionId = await createSession()

  const initial = expectFulfilled(await invoke(sessionId, 'data_root_status'), 'initial Data Root status')
  const selected = expectFulfilled(await invoke(sessionId, 'select_data_root', [{ parentPath: sourceParent }]), 'Data Root selection')
  const sourceRoot = filesystemPath(selected.root)
  if (selected.state !== 'ready' || selected.markerValid !== true || selected.manifestValid !== true || selected.safePathValidation !== true) throw new Error(`Unsafe selected Data Root: ${JSON.stringify(selected)}`)
  const rootManifest = JSON.parse(readFileSync(join(sourceRoot, 'manifest.json'), 'utf8'))
  if (rootManifest.rootType !== 'w-editor-data-root' || rootManifest.schemaVersion !== 1 || !rootManifest.prohibitedLocations.includes('system-temp')) throw new Error('Frozen Data Root manifest is incomplete.')
  if (!statSync(join(sourceRoot, 'tmp', 'lock')).isDirectory()) throw new Error('Data Root lock directory is missing.')

  const article = expectFulfilled(await invoke(sessionId, 'library_create_article', [{ title: 'Storage Article', markdown: '# Original' }]), 'Article create')
  const documentId = article.documentId
  if (!documentId || article.markdown !== '# Original' || article.revision !== 1) throw new Error(`Article create contract failed: ${JSON.stringify(article)}`)
  const updated = expectFulfilled(await invoke(sessionId, 'library_update_article', [{ documentId, title: 'Storage Article', markdown: '# Updated' }]), 'Article update')
  if (updated.revision !== 2 || updated.versionId !== `${documentId}-2`) throw new Error(`Article update contract failed: ${JSON.stringify(updated)}`)
  const deleted = expectFulfilled(await invoke(sessionId, 'library_delete_article', [{ documentId }]), 'Article soft delete')
  if (deleted.deletedAt === null) throw new Error('Article delete did not set deletedAt.')
  expectRejected(await invoke(sessionId, 'library_get_article', [{ documentId }]), 'deleted article hidden')
  const restored = expectFulfilled(await invoke(sessionId, 'library_restore_article', [{ documentId }]), 'Article restore')
  if (restored.deletedAt !== null || restored.markdown !== '# Updated') throw new Error('Article restore changed the Markdown authority.')

  const seeds = expectFulfilled(await invoke(sessionId, 'library_seed_catalog'), 'seed catalog')
  if (seeds.length !== 3) throw new Error(`Expected three resettable seeds, got ${JSON.stringify(seeds)}`)
  const seedOne = expectFulfilled(await invoke(sessionId, 'library_seed_reset', [{ seedKey: 'welcome' }]), 'seed reset one')
  const seedTwo = expectFulfilled(await invoke(sessionId, 'library_seed_reset', [{ seedKey: 'welcome' }]), 'seed reset two')
  if (seedOne.article.documentId === seedTwo.article.documentId || seedOne.article.seedKey !== 'welcome') throw new Error('Seed reset reused user history.')

  const untouched = expectFulfilled(await invoke(sessionId, 'import_markdown_start', [{ path: importedPath }]), 'untouched import start')
  const closed = expectFulfilled(await invoke(sessionId, 'import_markdown_close', [{ sessionId: untouched.sessionId }]), 'untouched import close')
  if (closed.created !== false || existsSync(join(sourceRoot, 'library.db')) === false) throw new Error('Untouched import did not preserve the existing Library state.')
  const changed = expectFulfilled(await invoke(sessionId, 'import_markdown_start', [{ path: importedPath }]), 'changed import start')
  const imported = expectFulfilled(await invoke(sessionId, 'import_markdown_commit', [{ sessionId: changed.sessionId, title: 'Imported', markdown: `${importedMarkdown}\n\nEdited`, save: false }]), 'changed import commit')
  if (!imported.created || imported.documentId === documentId || readFileSync(importedPath, 'utf8') !== importedMarkdown) throw new Error('Import was not one-way or did not receive an independent id.')

  const draft = expectFulfilled(await invoke(sessionId, 'recovery_save_draft', [{ documentId, baseRevision: 2, markdown: '# Recovery draft' }]), 'recovery draft save')
  const loadedDraft = expectFulfilled(await invoke(sessionId, 'recovery_load_draft', [{ documentId }]), 'recovery draft load')
  if (draft.expiresAt === undefined || loadedDraft?.markdown !== '# Recovery draft' || loadedDraft?.newerThanArticle !== true) throw new Error('Recovery draft contract failed.')
  expectFulfilled(await invoke(sessionId, 'library_save_version', [{ documentId, title: 'Storage Article', markdown: '# Saved after draft', kind: 'manual-save' }]), 'manual save after draft')
  if (expectFulfilled(await invoke(sessionId, 'recovery_load_draft', [{ documentId }]), 'merged draft load') !== null) throw new Error('Successful manual save did not clear its merged draft.')

  const workspace = expectFulfilled(await invoke(sessionId, 'workspace_save_state', [{ documentId, mode: 'visual', sourceAnchor: { offset: 999 }, selection: { start: 999, end: 1000 }, scroll: { top: 40 }, sidebar: { open: true } }]), 'workspace save')
  const restoredWorkspace = expectFulfilled(await invoke(sessionId, 'workspace_restore_state', [{ documentId, sourceLength: 5 }]), 'workspace restore')
  if (workspace.mode !== 'visual' || restoredWorkspace.positionFallback !== true || restoredWorkspace.sourceAnchor.offset !== 5) throw new Error('Workspace safe position fallback failed.')
  const siteSettings = expectFulfilled(await invoke(sessionId, 'settings_set_distribution_defaults', [{ value: { theme: 'dark' } }]), 'distribution settings')
  const userSettings = expectFulfilled(await invoke(sessionId, 'settings_set_user_override', [{ key: 'theme', value: 'violet' }]), 'user settings')
  if (siteSettings.resolved.theme !== 'dark' || userSettings.resolved.theme !== 'violet') throw new Error('Settings precedence failed.')
  const resetSettings = expectFulfilled(await invoke(sessionId, 'settings_reset'), 'settings reset')
  if (resetSettings.resolved.theme !== 'dark') throw new Error('Settings reset did not return to distribution default.')

  const asset = expectFulfilled(await invoke(sessionId, 'library_put_asset', [{ input: { mediaType: 'text/plain', dataBase64: 'aGVsbG8=', articleId: documentId, role: 'fixture' } }]), 'asset put')
  const refs = expectFulfilled(await invoke(sessionId, 'library_list_asset_refs', [{ documentId }]), 'asset refs')
  if (!asset.hash || refs.length !== 1 || refs[0].hash !== asset.hash) throw new Error('CAS asset reference contract failed.')

  const backup = expectFulfilled(await invoke(sessionId, 'backup_create', [{ kind: 'manual', label: 'storage-test' }]), 'manual backup')
  const verifiedBackup = expectFulfilled(await invoke(sessionId, 'backup_verify', [{ backupId: backup.manifest.backupId }]), 'backup verify')
  if (!verifiedBackup.valid || backup.manifest.protected !== true || !backup.manifest.snapshotPath.endsWith('.db.gz')) throw new Error(`Backup verification failed: ${JSON.stringify(verifiedBackup)}`)
  expectFulfilled(await invoke(sessionId, 'fault_injection_set', [{ kind: 'interrupt-restore', enabled: true }]), 'restore interruption enable')
  expectRejected(await invoke(sessionId, 'backup_restore', [{ backupId: backup.manifest.backupId }]), 'restore interruption')
  expectFulfilled(await invoke(sessionId, 'fault_injection_clear'), 'restore interruption clear')
  const manifestPath = join(sourceRoot, 'manifest.json')
  const originalManifest = readFileSync(manifestPath)
  writeFileSync(manifestPath, '{ invalid manifest')
  const damagedManifestStatus = expectFulfilled(await invoke(sessionId, 'data_root_status'), 'damaged manifest status')
  const recoveryStatus = expectFulfilled(await invoke(sessionId, 'library_recovery_status'), 'damaged manifest recovery status')
  if (damagedManifestStatus.state !== 'unavailable' || recoveryStatus.canReadOnlyExport !== true) throw new Error('Damaged manifest did not enter recovery-only mode.')
  writeFileSync(manifestPath, originalManifest)
  const walPath = join(sourceRoot, 'library.db-wal')
  const originalWal = existsSync(walPath) ? readFileSync(walPath) : null
  writeFileSync(walPath, Buffer.from('corrupted-wal'))
  const damagedWalStatus = expectFulfilled(await invoke(sessionId, 'library_schema_status'), 'damaged WAL status')
  if (damagedWalStatus.mode === 'ready') throw new Error(`Damaged WAL was not isolated: ${JSON.stringify(damagedWalStatus)}`)
  if (originalWal === null) {
    const { unlinkSync } = await import('node:fs')
    unlinkSync(walPath)
  } else {
    writeFileSync(walPath, originalWal)
  }
  const originalLocator = readFileSync(locatorPath)
  writeFileSync(locatorPath, JSON.stringify({ schemaVersion: 1, root: `${sourceRoot}-lost`, health: 'ready' }))
  const lostRootStatus = expectFulfilled(await invoke(sessionId, 'data_root_status'), 'lost root status')
  if (lostRootStatus.state !== 'unavailable') throw new Error(`Lost Data Root was not reported: ${JSON.stringify(lostRootStatus)}`)
  writeFileSync(locatorPath, originalLocator)
  expectFulfilled(await invoke(sessionId, 'library_save_version', [{ documentId, title: 'Storage Article', markdown: '# Mutated after backup', kind: 'manual-save' }]), 'post-backup mutation')
  const restoredBackup = expectFulfilled(await invoke(sessionId, 'backup_restore', [{ backupId: backup.manifest.backupId }]), 'backup restore')
  const restoredArticle = expectFulfilled(await invoke(sessionId, 'library_load_markdown', [{ documentId }]), 'restored article load')
  if (!restoredBackup.restored || restoredArticle.markdown !== '# Saved after draft') throw new Error('Backup restore did not recover the formal Markdown.')

  const temporary = expectFulfilled(await invoke(sessionId, 'temp_create', [{ tempType: 'update', sessionId: 'active-update', operation: 'storage-test' }]), 'temporary create')
  const locked = expectFulfilled(await invoke(sessionId, 'temp_lock', [{ tempType: 'update', sessionId: 'active-update' }]), 'temporary lock')
  const listed = expectFulfilled(await invoke(sessionId, 'temp_list'), 'temporary list')
  if (!temporary.path.endsWith('active-update') || locked.lockActive !== true || !listed.some((entry) => entry.sessionId === 'active-update')) throw new Error('Temporary marker/lock contract failed.')
  expectFulfilled(await invoke(sessionId, 'temp_unlock', [{ tempType: 'update', sessionId: 'active-update' }]), 'temporary unlock')
  const usage = expectFulfilled(await invoke(sessionId, 'backup_usage'), 'backup usage')
  const preview = expectFulfilled(await invoke(sessionId, 'backup_retention_preview'), 'backup retention preview')
  if (usage.backupCount < 1 || preview.policy.daily !== 7) throw new Error('Backup usage/retention contract failed.')

  const diagnosticPreview = expectFulfilled(await invoke(sessionId, 'diagnostic_preview'), 'diagnostic preview')
  const diagnostic = expectFulfilled(await invoke(sessionId, 'diagnostic_export', [{ destinationPath: exportPath }]), 'diagnostic export')
  const diagnosticPayload = JSON.parse(readFileSync(exportPath, 'utf8'))
  if (!diagnosticPreview.excluded.some((entry) => entry.includes('正文')) || !diagnostic.included.includes('environment.json') || JSON.stringify(diagnosticPayload).includes('# Mutated after backup')) throw new Error('Diagnostic privacy contract failed.')

  expectFulfilled(await invoke(sessionId, 'fault_injection_set', [{ kind: 'disk-full', enabled: true }]), 'disk-full fault enable')
  expectRejected(await invoke(sessionId, 'library_save_markdown', [{ documentId, title: 'Storage Article', markdown: '# Must fail' }]), 'disk-full save')
  expectFulfilled(await invoke(sessionId, 'fault_injection_clear'), 'disk-full fault clear')
  expectFulfilled(await invoke(sessionId, 'fault_injection_set', [{ kind: 'permission', enabled: true }]), 'permission fault enable')
  const readOnly = expectFulfilled(await invoke(sessionId, 'data_root_status'), 'permission status')
  if (readOnly.state !== 'read_only' || readOnly.writeProbe !== false) throw new Error(`Permission fault did not enter read-only state: ${JSON.stringify(readOnly)}`)
  expectFulfilled(await invoke(sessionId, 'fault_injection_clear'), 'permission fault clear')
  for (const fault of ['database', 'write-barrier', 'wal']) {
    expectFulfilled(await invoke(sessionId, 'fault_injection_set', [{ kind: fault, enabled: true }]), `${fault} fault enable`)
    const result = fault === 'wal'
      ? await invoke(sessionId, 'backup_create', [{ kind: 'daily' }])
      : await invoke(sessionId, 'library_save_markdown', [{ documentId, title: 'Storage Article', markdown: `# ${fault} failure` }])
    expectRejected(result, `${fault} fault`)
    expectFulfilled(await invoke(sessionId, 'fault_injection_clear'), `${fault} fault clear`)
  }

  expectFulfilled(await invoke(sessionId, 'fault_injection_set', [{ kind: 'interrupt-migration', enabled: true }]), 'migration interruption enable')
  expectRejected(await invoke(sessionId, 'data_root_migrate', [{ destinationParent: join(testParent, 'interrupted-migration') }]), 'migration interruption')
  expectFulfilled(await invoke(sessionId, 'fault_injection_clear'), 'migration interruption clear')

  secondProcess = spawn(executable, ['--storage-test-second-instance'], { stdio: 'ignore', windowsHide: true })
  await sleep(500)
  const forwarded = expectFulfilled(await invoke(sessionId, 'single_instance_status'), 'second-instance status')
  if (forwarded.forwardedCount < 1) throw new Error(`Second instance was not forwarded: ${JSON.stringify(forwarded)}`)
  if (secondProcess && !secondProcess.killed) secondProcess.kill()
  secondProcess = null

  const migration = expectFulfilled(await invoke(sessionId, 'data_root_migrate', [{ destinationParent: migrationParent }]), 'Data Root migration')
  const migratedStatus = expectFulfilled(await invoke(sessionId, 'data_root_status'), 'migrated Data Root status')
  const migratedRoot = filesystemPath(migratedStatus.root)
  if (!migration.switched || migratedStatus.state !== 'ready' || !existsSync(join(migratedRoot, 'library.db')) || !existsSync(sourceRoot)) throw new Error(`Data Root migration contract failed: ${JSON.stringify(migration)}`)

  console.log(JSON.stringify({
    status: 'passed',
    initial,
    sourceRoot,
    migratedRoot,
    documentId,
    backupId: backup.manifest.backupId,
    backupVerified: verifiedBackup,
    restoredArticle,
    dataRootMigration: migration,
    faultCoverage: ['database', 'disk-full', 'permission', 'root-lost', 'interrupt-migration', 'interrupt-restore', 'corrupt-manifest', 'wal', 'second-instance'],
    diagnostic,
    testParent,
  }, null, 2))
} finally {
  await deleteSession(secondSessionId)
  await deleteSession(sessionId)
  if (secondProcess && !secondProcess.killed) secondProcess.kill()
  driverProcess.kill()
  await sleep(250)
  if (previousLocator === null) {
    if (existsSync(locatorPath)) {
      const { unlinkSync } = await import('node:fs')
      unlinkSync(locatorPath)
    }
  } else {
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(resolve(locatorPath, '..'), { recursive: true })
    writeFileSync(locatorPath, previousLocator)
  }
}
