import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, parse, resolve } from 'node:path'

import { desktopArtifactPaths, readReleaseVersions } from './release-versions.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const versions = readReleaseVersions(repositoryRoot)
const targetRoot = resolve(process.env.W_EDITOR_CARGO_TARGET_DIR ?? join(parse(repositoryRoot).root, 'w-editor-tauri-target'))
const artifactPathMap = desktopArtifactPaths(targetRoot, versions)
const artifactPaths = [
  { kind: 'nsis', path: artifactPathMap.nsis },
  { kind: 'msi', path: artifactPathMap.msi },
]
const manifestPath = resolve(process.env.W_EDITOR_DESKTOP_RELEASE_MANIFEST ?? 'artifacts/desktop/release-manifest.json')

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase()
}

function git(command) {
  return execFileSync('git', command, { cwd: repositoryRoot, encoding: 'utf8' }).trim()
}

function authenticodeStatus(path) {
  if (process.platform !== 'win32') return 'not-checked'
  try {
    execFileSync('signtool.exe', ['verify', '/pa', path], { encoding: 'utf8', stdio: 'pipe' })
    return 'valid'
  } catch (error) {
    const output = error instanceof Error && 'stdout' in error
      ? `${String(error.stdout)} ${String('stderr' in error ? error.stderr : '')}`
      : ''
    return /no signature|not signed|0x800b0100/iu.test(output) ? 'unsigned' : 'unknown'
  }
}

const missingArtifacts = artifactPaths.filter(({ path }) => !existsSync(path)).map(({ path }) => path)
if (missingArtifacts.length > 0) throw new Error(`Desktop release artifacts are missing: ${missingArtifacts.join(', ')}`)
const statuses = artifactPaths.map(({ kind, path }) => ({
  kind,
  path,
  bytes: statSync(path).size,
  sha256: hashFile(path),
  signature: { status: authenticodeStatus(path), provider: process.env.W_EDITOR_CERT_THUMBPRINT ? 'authenticode' : 'none' },
}))
const dirtyFiles = git(['status', '--porcelain']).split(/\r?\n/u).filter(Boolean)
const commit = git(['rev-parse', 'HEAD'])
const signaturesValid = statuses.every(({ signature }) => signature.status === 'valid')
const formalEligible = dirtyFiles.length === 0 && signaturesValid
const manifest = {
  manifestVersion: versions.manifestVersion,
  change: 'dual-target-release',
  productName: 'W-Editor Desktop',
  productVersion: versions.productVersion,
  webApiVersion: versions.webApiVersion,
  webSchemaVersion: versions.webSchemaVersion,
  hostContractsVersion: versions.hostContractsVersion,
  minimumHostAdapterVersion: versions.minimumHostAdapterVersion,
  markdownDialectVersion: versions.markdownDialectVersion,
  databaseSchemaVersion: versions.databaseSchemaVersion,
  dataRootSchemaVersion: versions.dataRootSchemaVersion,
  settingsSchemaVersion: versions.settingsSchemaVersion,
  target: 'windows-x64',
  commit,
  workingTree: { dirty: dirtyFiles.length > 0, files: dirtyFiles },
  artifacts: statuses,
  signaturePolicy: {
    algorithm: 'Authenticode SHA-256',
    certificateConfigured: Boolean(process.env.W_EDITOR_CERT_THUMBPRINT),
    formalRequiresValidAllArtifacts: true,
  },
  releaseStatus: formalEligible ? 'formal' : 'TEST/UNSIGNED',
  formalEligible,
  blockers: [
    ...(dirtyFiles.length > 0 ? ['WORKING_TREE_DIRTY'] : []),
    ...(!signaturesValid ? ['CODE_SIGNING_UNAVAILABLE_OR_INVALID'] : []),
  ],
  notExecuted: ['formal signing when no certificate identity is configured', 'public release'],
}
writeFileSync(resolve(repositoryRoot, manifestPath), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ status: 'passed', manifestPath: resolve(repositoryRoot, manifestPath), releaseStatus: manifest.releaseStatus, formalEligible: manifest.formalEligible, blockers: manifest.blockers }, null, 2))
