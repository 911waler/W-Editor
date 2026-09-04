import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const projectRoot = realpathSync(process.cwd())
const packageJsonPath = join(projectRoot, 'package.json')
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
const expectedPackageManager = 'pnpm@11.19.0'
const lockfileNames = new Set([
  'bun.lock',
  'bun.lockb',
  'npm-shrinkwrap.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
])
const ignoredDirectories = new Set([
  '.git',
  '.vite',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
])

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function isInsideProject(path) {
  const projectRelativePath = relative(projectRoot, path)
  return projectRelativePath === ''
    || (!projectRelativePath.startsWith(`..${sep}`) && projectRelativePath !== '..' && !isAbsolute(projectRelativePath))
}

function walkFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue
    }

    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath))
    } else if (entry.isFile()) {
      files.push(entryPath)
    }
  }
  return files
}

function packageRoot(specifier) {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

function collectModuleSpecifiers(source) {
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^'"\n]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  return patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1]))
}

assert(packageJson.packageManager === expectedPackageManager, `Expected packageManager ${expectedPackageManager}.`)
assert(Number.parseInt(process.versions.node.split('.')[0], 10) >= 24, 'Node.js 24 or newer is required.')

const packageManagerUserAgent = process.env.npm_config_user_agent ?? ''
assert(
  packageManagerUserAgent.startsWith('pnpm/11.19.0 '),
  'Run this audit through the declared pnpm@11.19.0 package manager.',
)

const repositoryFiles = walkFiles(projectRoot)
const lockfiles = repositoryFiles
  .filter((path) => lockfileNames.has(path.slice(path.lastIndexOf(sep) + 1)))
  .map((path) => relative(projectRoot, path).replaceAll(sep, '/'))
  .sort()
assert(
  lockfiles.length === 1 && lockfiles[0] === 'pnpm-lock.yaml',
  `Expected pnpm-lock.yaml as the single lockfile; found: ${lockfiles.join(', ') || 'none'}.`,
)

const allDependencies = {
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
}
const localDependencyProtocol = /^(?:file|link|workspace):/
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const resolvedDependencies = {}

for (const [packageName, declaredVersion] of Object.entries(allDependencies).sort(([left], [right]) => left.localeCompare(right))) {
  assert(!localDependencyProtocol.test(declaredVersion), `${packageName} uses a local dependency protocol.`)
  assert(exactVersion.test(declaredVersion), `${packageName} must use an exact version; found ${declaredVersion}.`)

  const installedManifestPath = join(projectRoot, 'node_modules', ...packageName.split('/'), 'package.json')
  assert(existsSync(installedManifestPath), `${packageName} is not installed.`)
  assert(isInsideProject(realpathSync(installedManifestPath)), `${packageName} resolves outside this repository.`)

  const installedManifest = JSON.parse(readFileSync(installedManifestPath, 'utf8'))
  assert(installedManifest.name === packageName, `${packageName} resolved to ${installedManifest.name}.`)
  assert(
    installedManifest.version === declaredVersion,
    `${packageName} resolved to ${installedManifest.version}, expected ${declaredVersion}.`,
  )
  resolvedDependencies[packageName] = installedManifest.version
}

assert(resolvedDependencies['cherry-markdown'] === '0.11.9', 'Cherry Markdown must resolve to 0.11.9.')
for (const [packageName, version] of Object.entries(resolvedDependencies)) {
  if (packageName.startsWith('@tiptap/')) {
    assert(version === '3.30.2', `${packageName} must resolve to the aligned Tiptap 3.30.2 release.`)
  }
}

const lockfile = readFileSync(join(projectRoot, 'pnpm-lock.yaml'), 'utf8')
const localLockfileLines = lockfile.split(/\r?\n/u).filter((line) => /(?:file|link|workspace):/u.test(line))
for (const line of localLockfileLines) {
  assert(!/\bfile:/u.test(line), `pnpm-lock.yaml contains an external file dependency: ${line.trim()}`)
  if (/\bworkspace:/u.test(line)) {
    assert(/\bworkspace:\*/u.test(line), `pnpm-lock.yaml contains an invalid workspace protocol: ${line.trim()}`)
  }
  if (/\blink:/u.test(line)) {
    assert(/\blink:(?:(?:\.\.\/)+(?:packages|apps|examples)\/|(?:\.\.\/)+)?(?:editor-core|editor-vue|editor-web|playground|desktop|nwu-host)\b/u.test(line), `pnpm-lock.yaml contains an external link dependency: ${line.trim()}`)
  }
}

const packageImportTargets = Object.values(packageJson.imports ?? {})
for (const target of packageImportTargets) {
  assert(typeof target === 'string' && target.startsWith('./'), `Package import target escapes the repository: ${target}`)
  assert(isInsideProject(resolve(projectRoot, target)), `Package import target escapes the repository: ${target}`)
}

const productionSourceFiles = [
  join(projectRoot, 'vite.config.ts'),
  ...walkFiles(join(projectRoot, 'src')).filter((path) => /\.(?:css|ts|vue)$/.test(path)),
]
const runtimeDependencies = new Set(Object.keys(packageJson.dependencies ?? {}))
const runtimeImports = []

for (const sourcePath of productionSourceFiles) {
  const source = readFileSync(sourcePath, 'utf8')
  for (const specifier of collectModuleSpecifiers(source)) {
    const sourceFile = relative(projectRoot, sourcePath).replaceAll(sep, '/')
    runtimeImports.push({ sourceFile, specifier })

    if (specifier.startsWith('.')) {
      assert(
        isInsideProject(resolve(dirname(sourcePath), specifier)),
        `${sourceFile} imports outside this repository: ${specifier}`,
      )
      continue
    }
    assert(!isAbsolute(specifier), `${sourceFile} uses an absolute import: ${specifier}`)

    if (specifier.startsWith('#')) {
      assert(packageJson.imports?.[specifier], `${sourceFile} uses an undeclared package import: ${specifier}`)
      continue
    }
    if (specifier.startsWith('node:') && sourcePath === join(projectRoot, 'vite.config.ts')) {
      continue
    }

    const dependencyName = packageRoot(specifier)
    const permittedDependencies = sourcePath === join(projectRoot, 'vite.config.ts')
      ? allDependencies
      : Object.fromEntries([...runtimeDependencies].map((name) => [name, true]))
    assert(permittedDependencies[dependencyName], `${sourceFile} imports undeclared package ${dependencyName}.`)
  }
}

runtimeImports.sort((left, right) => (
  left.sourceFile.localeCompare(right.sourceFile) || left.specifier.localeCompare(right.specifier)
))

const report = {
  status: 'passed',
  nodeVersion: process.versions.node,
  packageManager: expectedPackageManager,
  lockfiles,
  directDependencyCount: Object.keys(resolvedDependencies).length,
  resolvedDependencies,
  runtimeImportCount: runtimeImports.length,
  runtimeImports,
  siblingRepositoryImports: [],
}
const reportPath = join(projectRoot, 'artifacts', 'clean-install-verification.json')
mkdirSync(dirname(reportPath), { recursive: true })
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(`Dependency audit passed; report written to ${relative(projectRoot, reportPath)}.`)
