import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { evaluateFormalRelease } from './release-formal-policy.mjs'
import { readReleaseVersions } from './release-versions.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const manifestPath = resolve(process.env.W_EDITOR_RELEASE_MANIFEST ?? 'artifacts/desktop/release-manifest.json')
const evidenceArgument = process.argv.find((argument) => argument.startsWith('--evidence='))
const evidencePath = evidenceArgument === undefined ? null : resolve(repositoryRoot, evidenceArgument.slice('--evidence='.length))
const versions = readReleaseVersions(repositoryRoot)

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase()
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

function verifyFile(record, label) {
  const path = resolve(repositoryRoot, record.path)
  requireCondition(existsSync(path) && statSync(path).isFile(), `${label} is missing: ${record.path}`)
  requireCondition(statSync(path).size === record.bytes, `${label} byte count changed.`)
  requireCondition(digest(path) === record.sha256, `${label} hash changed.`)
  return path
}

function readEvidence(path) {
  const absolutePath = resolve(repositoryRoot, path)
  if (!existsSync(absolutePath)) return { path, status: 'missing' }
  const value = JSON.parse(readFileSync(absolutePath, 'utf8'))
  return { path, status: value.status ?? 'unknown', sha256: digest(absolutePath) }
}

const checks = []
try {
  requireCondition(existsSync(manifestPath), `Release manifest is missing: ${manifestPath}`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim()
  requireCondition(manifest.change === 'dual-target-release', 'Release manifest change identity is invalid.')
  requireCondition(manifest.manifestVersion === versions.manifestVersion, 'Release manifest schema version is invalid.')
  requireCondition(manifest.commit === head, 'Release manifest commit does not match HEAD.')
  requireCondition(manifest.productVersion === versions.productVersion, 'Release manifest product version is invalid.')
  requireCondition(manifest.webApiVersion === versions.webApiVersion, 'Release manifest Web API version is invalid.')
  requireCondition(manifest.webSchemaVersion === versions.webSchemaVersion, 'Release manifest Web schema version is invalid.')
  requireCondition(manifest.markdownDialectVersion === versions.markdownDialectVersion, 'Release manifest Markdown dialect version is invalid.')
  requireCondition(manifest.databaseSchemaVersion === versions.databaseSchemaVersion, 'Release manifest database schema version is invalid.')
  requireCondition(manifest.minimumHostAdapterVersion === versions.minimumHostAdapterVersion, 'Release manifest minimum adapter version is invalid.')
  checks.push({ name: 'identity-and-version-matrix', status: 'passed' })

  requireCondition(Array.isArray(manifest.lockfiles) && manifest.lockfiles.length >= 2, 'Release manifest lockfile records are incomplete.')
  for (const lockfile of manifest.lockfiles) verifyFile(lockfile, `Lockfile ${lockfile.path}`)
  checks.push({ name: 'lockfiles', status: 'passed', count: manifest.lockfiles.length })

  const webZipPath = verifyFile(manifest.artifacts?.webZip, 'Web ZIP')
  verifyFile(manifest.artifacts?.nsis, 'NSIS artifact')
  verifyFile(manifest.artifacts?.msi, 'MSI artifact')
  requireCondition(manifest.artifacts.webZip.sha256 === digest(webZipPath), 'Web ZIP hash does not match the manifest.')
  checks.push({ name: 'web-zip-nsis-msi', status: 'passed' })

  requireCondition(manifest.webDistribution?.manifest?.commit === head, 'Web distribution manifest commit does not match HEAD.')
  requireCondition(typeof manifest.toolchain === 'object' && manifest.toolchain !== null, 'Toolchain provenance is missing.')
  requireCondition(typeof manifest.licenses === 'object' && manifest.licenses !== null, 'License records are missing.')
  requireCondition(typeof manifest.provenance === 'object' && manifest.provenance !== null, 'Provenance records are missing.')
  requireCondition(Array.isArray(manifest.limits) && manifest.limits.length > 0, 'Release limits are missing.')
  requireCondition(Array.isArray(manifest.notExecuted), 'Release notExecuted records are missing.')
  checks.push({ name: 'toolchain-license-provenance-limits', status: 'passed' })

  requireCondition(manifest.releaseStatus === 'TEST/UNSIGNED' || manifest.releaseStatus === 'PREVIEW' || manifest.releaseStatus === 'formal', `Unknown release status: ${manifest.releaseStatus}`)
  const formalDecision = evaluateFormalRelease(manifest.formalGate?.inputs)
  requireCondition(formalDecision.formalEligible === manifest.formalEligible, 'Release manifest formal eligibility diverges from the fail-closed policy.')
  requireCondition(JSON.stringify(formalDecision.blockers) === JSON.stringify(manifest.formalGate?.blockers), 'Release manifest formal blockers diverge from the fail-closed policy.')
  if (manifest.releaseStatus === 'formal') {
    requireCondition(manifest.formalEligible === true, 'Formal release status must have formalEligible=true.')
    requireCondition(manifest.blockers.length === 0, 'Formal release cannot retain blockers.')
  } else {
    requireCondition(manifest.formalEligible === false, 'Non-formal release status must fail closed.')
  }
  checks.push({ name: 'formal-status-fail-closed', status: 'passed', releaseStatus: manifest.releaseStatus })
  const recordedEvidence = [
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
    'artifacts/desktop-data-root-library/task-7-current-verification.json',
  ].map(readEvidence)

  const result = {
    schemaVersion: 1,
    change: 'dual-target-release',
    task: '9.3',
    status: 'passed',
    manifestPath: 'artifacts/desktop/release-manifest.json',
    manifestSha256: digest(manifestPath),
    commit: head,
    releaseStatus: manifest.releaseStatus,
    formalEligible: manifest.formalEligible,
    checks,
    evidence: recordedEvidence,
    artifacts: manifest.artifacts,
    versions: {
      productVersion: manifest.productVersion,
      webApiVersion: manifest.webApiVersion,
      webSchemaVersion: manifest.webSchemaVersion,
      markdownDialectVersion: manifest.markdownDialectVersion,
      databaseSchemaVersion: manifest.databaseSchemaVersion,
      manifestVersion: manifest.manifestVersion,
    },
    notExecuted: manifest.notExecuted,
  }
  if (evidencePath !== null) writeFileSync(evidencePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  const result = {
    schemaVersion: 1,
    change: 'dual-target-release',
    task: '9.3',
    status: 'failed',
    manifestPath: 'artifacts/desktop/release-manifest.json',
    checks,
    error: error instanceof Error ? error.message : String(error),
  }
  if (evidencePath !== null) writeFileSync(evidencePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.error(JSON.stringify(result, null, 2))
  process.exitCode = 1
}
