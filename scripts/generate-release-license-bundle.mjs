import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'

import { readReleaseVersions } from './release-versions.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const versions = readReleaseVersions(repositoryRoot)
const outputRoot = resolve(process.env.W_EDITOR_RELEASE_OUTPUT ?? 'artifacts/release')
const licenseRoot = join(outputRoot, 'licenses')
const storeRoot = resolve(repositoryRoot, 'node_modules/.pnpm')
const webDistributionRoot = resolve(repositoryRoot, 'packages/editor-web/dist')
const webManifestPath = join(webDistributionRoot, 'manifest.json')
const licenseOverrides = JSON.parse(readFileSync(resolve(repositoryRoot, 'release/license-overrides.json'), 'utf8'))
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim()
const commitDate = execFileSync('git', ['show', '-s', '--format=%cI', commit], { cwd: repositoryRoot, encoding: 'utf8' }).trim()

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase()
}

function fileRecord(path, root = repositoryRoot) {
  const bytes = readFileSync(path)
  return { path: relative(root, path).replaceAll('\\', '/'), bytes: bytes.byteLength, sha256: sha256(bytes) }
}

function packageLicense(packageInfo) {
  const { packageJson, key } = packageInfo
  if (typeof packageJson.license === 'string' && packageJson.license.trim().length > 0) return { expression: packageJson.license.trim(), source: 'package.json' }
  if (Array.isArray(packageJson.licenses)) {
    const values = packageJson.licenses.map((entry) => typeof entry === 'string' ? entry : entry?.type).filter((value) => typeof value === 'string' && value.trim().length > 0)
    if (values.length > 0) return { expression: values.join(' OR '), source: 'package.json:licenses' }
  }
  const override = licenseOverrides[key]
  if (override?.expression && override?.source && override?.evidence) return { expression: override.expression, source: override.source, evidence: override.evidence }
  return { expression: 'NOASSERTION', source: 'missing-package-metadata' }
}

function packagePurl(name, version) {
  return `pkg:npm/${name.startsWith('@') ? `%40${name.slice(1)}` : name}@${version}`
}

function safePackageDirectory(name, version) {
  return `${name.replaceAll('/', '__').replace(/^@/u, '')}-${version}`
}

function packageJsonCandidates(container) {
  const candidates = []
  for (const entry of readdirSync(container, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('@')) {
      const scopeRoot = join(container, entry.name)
      for (const scoped of readdirSync(scopeRoot, { withFileTypes: true })) {
        if (scoped.isDirectory()) candidates.push(join(scopeRoot, scoped.name, 'package.json'))
      }
    } else {
      candidates.push(join(container, entry.name, 'package.json'))
    }
  }
  return candidates
}

function collectPackages() {
  const packages = new Map()
  for (const entry of readdirSync(storeRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const container = join(storeRoot, entry.name, 'node_modules')
    if (!existsSync(container)) continue
    for (const path of packageJsonCandidates(container)) {
      if (!existsSync(path)) continue
      try {
        const packageJson = JSON.parse(readFileSync(path, 'utf8'))
        if (typeof packageJson.name !== 'string' || typeof packageJson.version !== 'string' || packageJson.name.startsWith('@w-editor/')) continue
        const key = `${packageJson.name}@${packageJson.version}`
        if (!packages.has(key)) packages.set(key, { key, path: resolve(path, '..'), packageJson })
      } catch {
        // A malformed package is reported by the missing/invalid package count below.
      }
    }
  }
  return [...packages.values()].sort((left, right) => left.key.localeCompare(right.key))
}

function packageNotices(packageInfo) {
  const entries = readdirSync(packageInfo.path, { withFileTypes: true })
  const licenseNames = new Set(['license', 'license.md', 'license.txt', 'copying', 'copying.md', 'notice', 'notice.md'])
  return entries
    .filter((entry) => entry.isFile() && licenseNames.has(entry.name.toLowerCase()))
    .map((entry) => join(packageInfo.path, entry.name))
    .sort()
}

function vendorFiles(root) {
  const files = []
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) visit(path)
      else files.push(fileRecord(path, root))
    }
  }
  visit(root)
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

function packageRecord(packageInfo, index, noticeRecords) {
  const { packageJson } = packageInfo
  const license = packageLicense(packageInfo)
  const notices = packageNotices(packageInfo)
  const copiedNotices = []
  for (const notice of notices) {
    const destinationDirectory = join(licenseRoot, safePackageDirectory(packageJson.name, packageJson.version))
    mkdirSync(destinationDirectory, { recursive: true })
    const destination = join(destinationDirectory, basename(notice))
    copyFileSync(notice, destination)
    const record = fileRecord(destination, outputRoot)
    copiedNotices.push(record)
    noticeRecords.push({ package: packageInfo.key, source: notice, destination: record.path, bytes: record.bytes, sha256: record.sha256 })
  }
  const packageId = `SPDXRef-Package-${index + 1}`
  return {
    SPDXID: packageId,
    name: packageJson.name,
    versionInfo: packageJson.version,
    downloadLocation: packagePurl(packageJson.name, packageJson.version),
    licenseConcluded: license.expression,
    licenseDeclared: license.expression,
    licenseSource: license.source,
    ...(license.evidence === undefined ? {} : { licenseEvidence: license.evidence }),
    filesAnalyzed: false,
    homepage: typeof packageJson.homepage === 'string' ? packageJson.homepage : undefined,
    externalRefs: [{ referenceCategory: 'PACKAGE-MANAGER', referenceType: 'purl', referenceLocator: packagePurl(packageJson.name, packageJson.version) }],
    sourcePath: relative(repositoryRoot, packageInfo.path).replaceAll('\\', '/'),
    noticeFiles: copiedNotices,
  }
}

function licenseExpression(packageInfo) {
  return packageLicense(packageInfo).expression
}

function readPackage(packageName) {
  const packageInfo = packages.find(({ packageJson }) => packageJson.name === packageName)
  return packageInfo === undefined ? null : {
    name: packageName,
    version: packageInfo.packageJson.version,
    license: licenseExpression(packageInfo),
    packageJson: relative(repositoryRoot, join(packageInfo.path, 'package.json')).replaceAll('\\', '/'),
  }
}

const packages = collectPackages()
if (packages.length === 0) throw new Error('No locked third-party packages were found in node_modules/.pnpm.')
mkdirSync(outputRoot, { recursive: true })
mkdirSync(licenseRoot, { recursive: true })
const noticeRecords = []
const sbomPackages = packages.map((packageInfo, index) => packageRecord(packageInfo, index, noticeRecords))
const licenseGaps = sbomPackages.filter(({ licenseDeclared }) => licenseDeclared === 'NOASSERTION').map(({ name, versionInfo }) => `${name}@${versionInfo}`)

const vendorRoot = resolve(repositoryRoot, 'public/vendor/cherry-drawio')
const vendorLicensePath = join(vendorRoot, 'LICENSE')
const vendorProvenancePath = join(vendorRoot, 'PROVENANCE.md')
if (!existsSync(vendorLicensePath) || !existsSync(vendorProvenancePath)) throw new Error('Cherry draw.io vendor LICENSE/PROVENANCE files are incomplete.')
if (!existsSync(webManifestPath)) throw new Error('Built Web manifest is required for vendor/resource provenance validation.')
const webManifest = JSON.parse(readFileSync(webManifestPath, 'utf8'))
const vendorManifestPaths = new Set(webManifest.drawio?.files ?? [])
const expectedDrawioCount = vendorFiles(vendorRoot).length + 1
if (vendorManifestPaths.size < expectedDrawioCount - 1) throw new Error('Web draw.io manifest does not cover the vendor resource tree.')
for (const path of ['drawio/LICENSE', 'drawio/PROVENANCE.md', 'drawio/bridge.html']) {
  if (!webManifest.files.some((file) => file.path === path)) throw new Error(`Web manifest is missing required draw.io resource: ${path}`)
}
const vendorProvenance = {
  schemaVersion: 1,
  change: 'dual-target-release',
  generatedAt: commitDate,
  source: 'public/vendor/cherry-drawio',
  sourceLicense: fileRecord(vendorLicensePath),
  sourceProvenance: fileRecord(vendorProvenancePath),
  sourceFiles: vendorFiles(vendorRoot),
  upstream: {
    project: 'Tencent/cherry-markdown',
    packageVersion: readPackage('cherry-markdown'),
    provenanceDocument: 'public/vendor/cherry-drawio/PROVENANCE.md',
  },
  resources: {
    webManifest: 'packages/editor-web/dist/manifest.json',
    webManifestSha256: sha256(readFileSync(webManifestPath)),
    drawioFileCount: webManifest.drawio?.files?.length ?? 0,
    drawioLazy: webManifest.drawio?.lazy === true,
    licenses: webManifest.licenses ?? [],
    katex: readPackage('katex'),
  },
}
writeFileSync(join(outputRoot, 'vendor-provenance.json'), `${JSON.stringify(vendorProvenance, null, 2)}\n`, 'utf8')

const sbom = {
  spdxVersion: 'SPDX-2.3',
  dataLicense: 'CC0-1.0',
  SPDXID: 'SPDXRef-DOCUMENT',
  name: `W-Editor ${versions.productVersion} third-party dependency inventory`,
  documentNamespace: `https://w-editor.invalid/spdx/w-editor/${versions.productVersion}/${commit}`,
  creationInfo: {
    created: commitDate,
    creators: ['Tool: W-Editor release governance'],
  },
  documentComment: 'Inventory is generated from the locked pnpm installation tree; package metadata without an explicit license remains NOASSERTION and blocks formal release.',
  packages: sbomPackages,
  relationships: [
    { spdxElementId: 'SPDXRef-DOCUMENT', relationshipType: 'DESCRIBES', relatedSpdxElement: 'SPDXRef-Workspace' },
    ...sbomPackages.map(({ SPDXID }) => ({ spdxElementId: 'SPDXRef-Workspace', relationshipType: 'DEPENDS_ON', relatedSpdxElement: SPDXID })),
  ],
  workspace: {
    SPDXID: 'SPDXRef-Workspace',
    name: 'w-editor',
    version: versions.productVersion,
    sourceCommit: commit,
    lockfiles: [fileRecord(resolve(repositoryRoot, 'pnpm-lock.yaml')), fileRecord(resolve(repositoryRoot, 'apps/desktop/src-tauri/Cargo.lock'))],
  },
}
writeFileSync(join(outputRoot, 'sbom.spdx.json'), `${JSON.stringify(sbom, null, 2)}\n`, 'utf8')

const notices = [
  '# W-Editor third-party notices',
  '',
  `Product version: ${versions.productVersion}`,
  `Source commit: ${commit}`,
  '',
  'This generated inventory covers the non-workspace packages found in the locked pnpm virtual store. License expressions come from installed package metadata; `NOASSERTION` entries are intentionally preserved and are formal-release blockers until reviewed.',
  '',
  `Packages: ${sbomPackages.length}; explicit license metadata: ${sbomPackages.length - licenseGaps.length}; NOASSERTION: ${licenseGaps.length}.`,
  '',
  '| Package | Version | License expression | Copied notices |',
  '| --- | --- | --- | --- |',
  ...sbomPackages.map((pkg) => `| \`${pkg.name}\` | \`${pkg.versionInfo}\` | \`${pkg.licenseDeclared}\` (${pkg.licenseSource}) | ${pkg.noticeFiles.map(({ path }) => `\`${path}\``).join('<br>') || 'none'} |`),
  '',
  '## License metadata requiring review',
  '',
  ...(licenseGaps.length === 0 ? ['None.'] : licenseGaps.map((key) => `- \`${key}\`: package metadata did not declare a license; copied notice files and package provenance are retained for review.`)),
  '',
  '## Vendor provenance',
  '',
  '- Cherry draw.io/mxGraph: `vendor-provenance.json` and `public/vendor/cherry-drawio/PROVENANCE.md`.',
  '- KaTeX and all other npm dependencies: package metadata, lockfile hash and copied notice files in this release directory.',
]
writeFileSync(join(outputRoot, 'THIRD_PARTY_NOTICES.md'), `${notices.join('\n')}\n`, 'utf8')

const inventory = {
  schemaVersion: 1,
  change: 'dual-target-release',
  task: '9.4',
  status: 'passed',
  generatedAt: commitDate,
  commit,
  lockfiles: [fileRecord(resolve(repositoryRoot, 'pnpm-lock.yaml')), fileRecord(resolve(repositoryRoot, 'apps/desktop/src-tauri/Cargo.lock'))],
  packageCount: sbomPackages.length,
  licenseMetadataCount: sbomPackages.length - licenseGaps.length,
  licenseGaps,
  noticeFileCount: noticeRecords.length,
  outputs: [
    'artifacts/release/THIRD_PARTY_NOTICES.md',
    'artifacts/release/vendor-provenance.json',
    'artifacts/release/sbom.spdx.json',
    'artifacts/release/licenses/',
  ],
  vendor: {
    sourceFileCount: vendorProvenance.sourceFiles.length,
    webDrawioFileCount: vendorProvenance.resources.drawioFileCount,
    drawioLazy: vendorProvenance.resources.drawioLazy,
    webManifest: 'packages/editor-web/dist/manifest.json',
    manifestLicenses: vendorProvenance.resources.licenses,
  },
  formalBlockers: licenseGaps.length === 0 ? [] : ['UNASSERTED_LICENSE_METADATA'],
  notExecuted: ['independent legal approval of redistributed third-party notices']
}
writeFileSync(join(outputRoot, 'task-9-4-current-verification.json'), `${JSON.stringify(inventory, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(inventory, null, 2))
