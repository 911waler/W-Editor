import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { deflateRawSync } from 'node:zlib'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, parse, relative, resolve } from 'node:path'

import { evaluateFormalRelease } from './release-formal-policy.mjs'
import { desktopArtifactPaths, readReleaseVersions } from './release-versions.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const versions = readReleaseVersions(repositoryRoot)
const targetRoot = resolve(process.env.W_EDITOR_CARGO_TARGET_DIR ?? join(parse(repositoryRoot).root, 'w-editor-tauri-target'))
const desktopPaths = desktopArtifactPaths(targetRoot, versions)
const webDistributionRoot = resolve(repositoryRoot, 'packages/editor-web/dist')
const webManifestPath = resolve(webDistributionRoot, 'manifest.json')
const webZipPath = resolve(process.env.W_EDITOR_WEB_ZIP ?? `artifacts/release/w-editor-web-${versions.productVersion}.zip`)
const manifestPath = resolve(process.env.W_EDITOR_RELEASE_MANIFEST ?? 'artifacts/desktop/release-manifest.json')

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase()
}

function fileRecord(path) {
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Required release file is missing: ${path}`)
  const bytes = readFileSync(path)
  return { path, bytes: bytes.byteLength, sha256: sha256(bytes) }
}

function repositoryPath(path) {
  return relative(repositoryRoot, path).replaceAll('\\', '/')
}

function listFiles(root, current = root) {
  return readdirSync(current, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(current, entry.name)
      return entry.isDirectory() ? listFiles(root, path) : [path]
    })
    .sort((left, right) => left.localeCompare(right))
}

function crc32(bytes) {
  let crc = 0xFFFFFFFF
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1))
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function zipDirectory(sourceRoot, destination) {
  const localRecords = []
  const centralRecords = []
  let offset = 0
  for (const path of listFiles(sourceRoot)) {
    const name = repositoryPath(path).replace(/^packages\/editor-web\/dist\//u, '')
    const nameBytes = Buffer.from(name, 'utf8')
    const content = readFileSync(path)
    const compressed = deflateRawSync(content, { level: 9 })
    const checksum = crc32(content)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034B50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x800, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0x21, 12)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(compressed.byteLength, 18)
    local.writeUInt32LE(content.byteLength, 22)
    local.writeUInt16LE(nameBytes.byteLength, 26)
    local.writeUInt16LE(0, 28)
    localRecords.push(Buffer.concat([local, nameBytes, compressed]))

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014B50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0x21, 14)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(compressed.byteLength, 20)
    central.writeUInt32LE(content.byteLength, 24)
    central.writeUInt16LE(nameBytes.byteLength, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centralRecords.push(Buffer.concat([central, nameBytes]))
    offset += localRecords.at(-1).byteLength
  }
  const centralDirectory = Buffer.concat(centralRecords)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054B50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(centralRecords.length, 8)
  end.writeUInt16LE(centralRecords.length, 10)
  end.writeUInt32LE(centralDirectory.byteLength, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  mkdirSync(resolve(destination, '..'), { recursive: true })
  writeFileSync(destination, Buffer.concat([...localRecords, centralDirectory, end]))
}

function git(args) {
  return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim()
}

function commandVersion(executable, args) {
  try {
    const command = process.platform === 'win32' && executable === 'corepack' ? 'corepack.cmd' : executable
    return { status: 'available', value: execFileSync(command, args, { cwd: repositoryRoot, encoding: 'utf8' }).trim() }
  } catch (error) {
    return { status: 'unavailable', error: error instanceof Error ? error.message : String(error) }
  }
}

function signatureStatus(path) {
  if (process.platform !== 'win32') return { status: 'not-checked', provider: 'signtool' }
  try {
    execFileSync('signtool.exe', ['verify', '/pa', path], { cwd: repositoryRoot, stdio: 'pipe' })
    return { status: 'valid', provider: 'authenticode' }
  } catch (error) {
    const output = error instanceof Error && 'stdout' in error
      ? `${String(error.stdout)} ${String('stderr' in error ? error.stderr : '')}`
      : ''
    return {
      status: /no signature|not signed|0x800b0100/iu.test(output) ? 'unsigned' : 'unknown',
      provider: 'authenticode',
    }
  }
}

function evidence(path) {
  const absolutePath = resolve(repositoryRoot, path)
  if (!existsSync(absolutePath)) return { path, status: 'missing' }
  try {
    const value = JSON.parse(readFileSync(absolutePath, 'utf8'))
    return { path, status: value.status ?? 'unknown', sha256: sha256(readFileSync(absolutePath)) }
  } catch (error) {
    return { path, status: 'invalid', error: error instanceof Error ? error.message : String(error) }
  }
}

function generatedOutput(path) {
  const absolutePath = resolve(repositoryRoot, path)
  const record = fileRecord(absolutePath)
  return { path: repositoryPath(absolutePath), status: 'present', bytes: record.bytes, sha256: record.sha256 }
}

function evidenceDetails(path) {
  const absolutePath = resolve(repositoryRoot, path)
  if (!existsSync(absolutePath)) return { record: { path, status: 'missing' }, value: null }
  try {
    return { record: evidence(path), value: JSON.parse(readFileSync(absolutePath, 'utf8')) }
  } catch {
    return { record: evidence(path), value: null }
  }
}

function lockfile(path) {
  const record = fileRecord(resolve(repositoryRoot, path))
  return { ...record, path }
}

function sourceDirtyFiles() {
  return git(['status', '--porcelain=v1']).split(/\r?\n/u).filter(Boolean)
}

if (!existsSync(webDistributionRoot) || !existsSync(webManifestPath)) throw new Error('A current Web distribution and manifest are required before release manifest finalization.')
zipDirectory(webDistributionRoot, webZipPath)

const webManifest = JSON.parse(readFileSync(webManifestPath, 'utf8'))
const webZip = fileRecord(webZipPath)
const desktopArtifacts = Object.entries(desktopPaths).map(([kind, path]) => ({
  kind,
  ...fileRecord(path),
  signature: signatureStatus(path),
}))
const dirtyFiles = sourceDirtyFiles()
const signaturesValid = desktopArtifacts.every(({ signature }) => signature.status === 'valid')
const gateEvidence = [
  'artifacts/release-governance/task-9-1-current-verification.json',
  'artifacts/release-governance/task-9-2-current-verification.json',
  'artifacts/release-governance/task-9-4-current-verification.json',
  'artifacts/release-governance/task-9-5-current-verification.json',
  'artifacts/release-governance/task-9-5-current-installer-lifecycle-rerun-20260829.json',
  'artifacts/release-governance/task-9-5-current-feature-matrix-rerun-20260829.json',
  'artifacts/release-governance/task-9-6-current-verification.json',
  'artifacts/release-governance/task-9-7-current-verification.json',
  'artifacts/release-governance/task-9-8-current-verification.json',
  'artifacts/release-governance/task-9-9-current-verification.json',
  'artifacts/release-governance/task-9-10-current-verification.json',
  'artifacts/desktop/task-8-10-current-verification.json',
  'artifacts/desktop/task-8-11-current-verification.json',
  'artifacts/desktop/task-8-9-current-unsigned-manifest-verification.json',
  'artifacts/desktop-data-root-library/task-7-current-verification.json',
].map(evidence)
const closureEvidence = evidenceDetails('artifacts/release-governance/task-9-5-current-verification.json')
const pipelineEvidence = evidenceDetails('artifacts/release-governance/task-9-2-current-verification.json')
const licenseEvidence = evidenceDetails('artifacts/release-governance/task-9-4-current-verification.json')
const parityEvidence = evidenceDetails('artifacts/release-governance/task-9-6-current-verification.json')
const browserEvidence = evidenceDetails('artifacts/release-governance/task-9-7-current-verification.json')
const accessibilityEvidence = evidenceDetails('artifacts/release-governance/task-9-8-current-verification.json')
const performanceEvidence = evidenceDetails('artifacts/release-governance/task-9-9-current-verification.json')
const recoveryEvidence = evidenceDetails('artifacts/release-governance/task-9-10-current-verification.json')
const dataRootEvidence = evidenceDetails('artifacts/desktop-data-root-library/task-7-current-verification.json')
const lifecycleEvidence = evidenceDetails('artifacts/release-governance/task-9-5-current-installer-lifecycle-rerun-20260829.json')
const featureMatrixEvidence = evidenceDetails('artifacts/release-governance/task-9-5-current-feature-matrix-rerun-20260829.json')
const installerLifecycleBlocked = closureEvidence.value?.installerLifecycle?.status === 'blocked-separately'
const missingEvidence = gateEvidence.filter((item) => item.status === 'missing' || item.status === 'failed' || item.status === 'invalid')
const formalInputs = Object.freeze({
  requiredArtifacts: desktopArtifacts.length === 2
    && lifecycleEvidence.record.status === 'passed'
    && featureMatrixEvidence.record.status === 'passed'
    && !installerLifecycleBlocked,
  artifactHashes: closureEvidence.record.status === 'passed' && performanceEvidence.record.status === 'passed',
  signatures: signaturesValid,
  sharedTests: pipelineEvidence.record.status === 'passed'
    && parityEvidence.record.status === 'passed'
    && parityEvidence.value?.parity?.commandIdsEqual === true,
  hostContract: closureEvidence.record.status === 'passed'
    && parityEvidence.record.status === 'passed'
    && parityEvidence.value?.targets?.webEsm?.status === 'passed'
    && parityEvidence.value?.targets?.webIife?.status === 'passed',
  rendererParity: parityEvidence.record.status === 'passed'
    && parityEvidence.value?.parity?.contentSemanticEqual === true,
  resourceClosure: closureEvidence.record.status === 'passed',
  browserWebView2: browserEvidence.record.status === 'passed',
  accessibility: accessibilityEvidence.record.status === 'passed',
  performance: performanceEvidence.record.status === 'passed',
  dataRecovery: recoveryEvidence.record.status === 'passed' && dataRootEvidence.record.status === 'passed',
  licensesAndProvenance: licenseEvidence.record.status === 'passed',
  cleanSource: dirtyFiles.length === 0,
})
const formalDecision = evaluateFormalRelease(formalInputs)
const releaseStatus = formalDecision.formalEligible
  ? 'formal'
  : signaturesValid && dirtyFiles.length === 0 && missingEvidence.length === 0 ? 'PREVIEW' : 'TEST/UNSIGNED'
const blockers = [...new Set([
  ...formalDecision.blockers.map(({ code }) => code),
  ...(installerLifecycleBlocked ? ['CURRENT_INSTALLER_LIFECYCLE_INCOMPLETE'] : []),
])]

const manifest = {
  manifestVersion: versions.manifestVersion,
  change: 'dual-target-release',
  product: { name: 'W-Editor', desktopName: 'W-Editor Desktop', version: versions.productVersion, target: 'windows-x64' },
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
  commit: git(['rev-parse', 'HEAD']),
  workingTree: { dirty: dirtyFiles.length > 0, files: dirtyFiles },
  lockfiles: [lockfile('pnpm-lock.yaml'), lockfile('apps/desktop/src-tauri/Cargo.lock')],
  toolchain: {
    node: process.version,
    packageManager: readJsonPackageManager(),
    pnpm: commandVersion('corepack', ['pnpm', '--version']),
    rustc: commandVersion('rustc', ['--version']),
    cargo: commandVersion('cargo', ['--version']),
    tauriCli: readJson('apps/desktop/package.json').devDependencies?.['@tauri-apps/cli'] ?? 'not-recorded',
    webView2: evidence('artifacts/release-governance/task-9-7-current-verification.json'),
    windowsSdk: process.env.WindowsSdkDir ?? process.env.WindowsSDKVersion ?? 'not-recorded',
  },
  artifacts: {
    webZip: { kind: 'web-zip', ...webZip, path: repositoryPath(webZipPath), sourceDirectory: repositoryPath(webDistributionRoot), manifest: repositoryPath(webManifestPath) },
    nsis: desktopArtifacts.find(({ kind }) => kind === 'nsis'),
    msi: desktopArtifacts.find(({ kind }) => kind === 'msi'),
  },
  webDistribution: {
    manifest: { path: repositoryPath(webManifestPath), sha256: sha256(readFileSync(webManifestPath)), commit: webManifest.commit, contentSha256: webManifest.contentSha256 },
    entries: webManifest.entries,
    fileCount: webManifest.files?.length ?? 0,
  },
  signaturePolicy: {
    algorithm: 'Authenticode SHA-256',
    certificateConfigured: Boolean(process.env.W_EDITOR_CERT_THUMBPRINT?.trim()),
    formalRequiresValidAllArtifacts: true,
  },
  licenses: {
    status: evidence('artifacts/release-governance/task-9-4-current-verification.json').status === 'passed' ? 'passed' : 'missing-or-failed',
    sbom: generatedOutput('artifacts/release/sbom.spdx.json'),
    notices: generatedOutput('artifacts/release/THIRD_PARTY_NOTICES.md'),
    vendorProvenance: generatedOutput('artifacts/release/vendor-provenance.json'),
    files: [
      'docs/web-distribution-licenses.md',
      'public/vendor/cherry-drawio/LICENSE',
      'public/vendor/cherry-drawio/PROVENANCE.md',
      'artifacts/release/THIRD_PARTY_NOTICES.md',
      'artifacts/release/vendor-provenance.json',
    ].map((path) => ({ path, present: existsSync(resolve(repositoryRoot, path)) })),
  },
  provenance: {
    sourceVersionFile: { path: 'release/versions.json', sha256: sha256(readFileSync(resolve(repositoryRoot, 'release/versions.json'))) },
    webManifest: repositoryPath(webManifestPath),
    vendorSource: 'public/vendor/cherry-drawio',
    generatedVendorProvenance: generatedOutput('artifacts/release/vendor-provenance.json'),
    generatedBy: 'scripts/finalize-release-manifest.mjs',
  },
  tests: gateEvidence,
  formalGate: {
    policy: 'all required inputs must equal true; any missing, failed or false input blocks formal status',
    inputs: formalInputs,
    blockers: formalDecision.blockers,
  },
  invalidations: [
    evidence('artifacts/release-governance/task-9-input-invalidation-axe-20260829.json'),
    evidence('artifacts/release-governance/task-9-input-invalidation-a11y-default-theme-20260829.json'),
    evidence('artifacts/release-governance/task-9-input-invalidation-a11y-nvda-journey-20260829.json'),
    evidence('artifacts/release-governance/task-9-input-invalidation-performance-drawio-readiness-20260829.json'),
    evidence('artifacts/release-governance/task-9-input-invalidation-shared-parser-20260829.json'),
    evidence('artifacts/release-governance/task-9-input-invalidation-shared-parser-compaction-20260829.json'),
    evidence('artifacts/release-governance/task-9-input-invalidation-drawio-reopen-keyboard-20260829.json'),
    evidence('artifacts/release-governance/task-9-9-package-size-approval-20260829.json'),
    evidence('artifacts/release-governance/task-11-package-size-approval-20260829.json'),
    evidence('artifacts/release-governance/task-11-7-package-size-approval-20260830.json'),
    evidence('artifacts/release-governance/task-11-7-uat-dtr-014-package-approval-20260830.json'),
  ],
  browserMatrix: evidence('artifacts/release-governance/task-9-7-current-verification.json'),
  limits: [
    'Formal public release requires a clean source commit and valid Authenticode signatures for NSIS and MSI.',
    'Firefox, WebKit/Safari, iOS and Android are not covered by this Windows/WebView2 release gate.',
    'Real NWU-911 production integration and deployment are not covered; examples/nwu-host is reference-only.',
    'Web external article URLs remain dependent on their origin; the distribution itself is offline/self-contained.',
  ],
  performance: evidence('artifacts/release-governance/task-9-9-current-verification.json'),
  accessibility: evidence('artifacts/release-governance/task-9-8-current-verification.json'),
  notExecuted: [
    ...(!signaturesValid ? ['formal signing without a valid certificate identity'] : []),
    ...(installerLifecycleBlocked ? ['current-package MSI install/uninstall/reinstall with UAC approval'] : []),
    ...(missingEvidence.length > 0 ? ['current formal gate remains blocked by failed or missing required evidence'] : []),
    'public release, upload, deployment and external NWU integration',
  ],
  releaseStatus,
  formalEligible: formalDecision.formalEligible,
  blockers,
}

function readJsonPackageManager() {
  const packageJson = readJson('package.json')
  return packageJson.packageManager ?? 'not-recorded'
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(repositoryRoot, path), 'utf8'))
}

mkdirSync(resolve(manifestPath, '..'), { recursive: true })
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ status: 'passed', manifestPath: repositoryPath(manifestPath), releaseStatus, formalEligible: formalDecision.formalEligible, blockers, webZip, desktopArtifacts }, null, 2))
