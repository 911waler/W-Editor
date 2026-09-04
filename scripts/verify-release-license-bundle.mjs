import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '..')
const outputRoot = resolve(repositoryRoot, process.env.W_EDITOR_RELEASE_OUTPUT ?? 'artifacts/release')
const evidencePath = resolve(repositoryRoot, 'artifacts/release-governance/task-9-4-current-verification.json')
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim()

function readJson(path) {
  return JSON.parse(readFileSync(resolve(repositoryRoot, path), 'utf8'))
}

function hash(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase()
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

function outputRecord(path) {
  const absolute = resolve(repositoryRoot, path)
  requireCondition(existsSync(absolute), `Release license output is missing: ${path}`)
  return { path, bytes: readFileSync(absolute).byteLength, sha256: hash(absolute) }
}

const checks = []
try {
  const inventory = readJson('artifacts/release/task-9-4-current-verification.json')
  const sbom = readJson('artifacts/release/sbom.spdx.json')
  const vendor = readJson('artifacts/release/vendor-provenance.json')
  const web = readJson('packages/editor-web/dist/manifest.json')
  const notices = readFileSync(resolve(outputRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8')
  requireCondition(inventory.status === 'passed' && inventory.commit === commit, 'License inventory is not from the current HEAD.')
  requireCondition(sbom.spdxVersion === 'SPDX-2.3' && sbom.workspace?.sourceCommit === commit, 'SBOM identity or source commit is invalid.')
  requireCondition(Array.isArray(sbom.packages) && sbom.packages.length === inventory.packageCount, 'SBOM package count does not match the inventory.')
  requireCondition(new Set(sbom.packages.map(({ SPDXID }) => SPDXID)).size === sbom.packages.length, 'SBOM contains duplicate SPDX IDs.')
  checks.push({ name: 'spdx-inventory', status: 'passed', packageCount: sbom.packages.length })

  const packageByName = new Map(sbom.packages.map((pkg) => [pkg.name, pkg]))
  for (const [name, version] of [['cherry-markdown', '0.11.9'], ['katex', '0.16.47']]) {
    requireCondition(packageByName.get(name)?.versionInfo === version, `${name} version is missing or changed in the SBOM.`)
  }
  requireCondition(notices.includes(`Packages: ${inventory.packageCount};`), 'Third-party notices do not describe the inventory count.')
  for (const pkg of sbom.packages) requireCondition(notices.includes(`| \`${pkg.name}\` |`), `Third-party notices omit ${pkg.name}.`)
  checks.push({ name: 'license-notices', status: 'passed', packageCount: sbom.packages.length, noticeFileCount: inventory.noticeFileCount })

  requireCondition(vendor.change === 'dual-target-release' && vendor.source === 'public/vendor/cherry-drawio', 'Vendor provenance identity is invalid.')
  requireCondition(vendor.resources.webManifestSha256 === hash(resolve(repositoryRoot, 'packages/editor-web/dist/manifest.json')), 'Vendor provenance Web manifest hash is stale.')
  const webPaths = new Set(web.files.map(({ path }) => path))
  for (const sourceFile of vendor.sourceFiles) {
    const sourcePath = resolve(repositoryRoot, 'public/vendor/cherry-drawio', sourceFile.path)
    requireCondition(existsSync(sourcePath) && hash(sourcePath) === sourceFile.sha256, `Vendor source changed: ${sourceFile.path}`)
    requireCondition(webPaths.has(`drawio/${sourceFile.path}`), `Web draw.io closure omits ${sourceFile.path}.`)
  }
  requireCondition(web.drawio.lazy === true && web.drawio.files.length === vendor.resources.drawioFileCount, 'Web draw.io manifest is not aligned with vendor provenance.')
  for (const path of ['drawio/LICENSE', 'drawio/PROVENANCE.md', 'drawio/bridge.html']) requireCondition(webPaths.has(path) && web.drawio.files.includes(path), `Web manifest omits required resource ${path}.`)
  checks.push({ name: 'vendor-resource-closure', status: 'passed', sourceFileCount: vendor.sourceFiles.length, webDrawioFileCount: web.drawio.files.length })

  const lockfiles = inventory.lockfiles.map(({ path, sha256 }) => {
    const absolute = resolve(repositoryRoot, path)
    requireCondition(existsSync(absolute) && hash(absolute) === sha256, `Lockfile changed: ${path}`)
    return { path, sha256 }
  })
  checks.push({ name: 'lockfile-hashes', status: 'passed', lockfiles })
  const outputs = [
    outputRecord('artifacts/release/THIRD_PARTY_NOTICES.md'),
    outputRecord('artifacts/release/vendor-provenance.json'),
    outputRecord('artifacts/release/sbom.spdx.json'),
  ]
  const result = {
    schemaVersion: 1,
    change: 'dual-target-release',
    task: '9.4',
    status: 'passed',
    commit,
    packageCount: inventory.packageCount,
    licenseMetadataCount: inventory.licenseMetadataCount,
    licenseGaps: inventory.licenseGaps,
    checks,
    outputs,
    formalBlockers: inventory.formalBlockers,
    notExecuted: inventory.notExecuted,
  }
  writeFileSync(evidencePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  const result = {
    schemaVersion: 1,
    change: 'dual-target-release',
    task: '9.4',
    status: 'failed',
    checks,
    error: error instanceof Error ? error.message : String(error),
  }
  writeFileSync(evidencePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.error(JSON.stringify(result, null, 2))
  process.exitCode = 1
}
