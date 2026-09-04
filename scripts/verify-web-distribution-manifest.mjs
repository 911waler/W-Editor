import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { relative, resolve } from 'node:path'

import { readReleaseVersions } from './release-versions.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const versions = readReleaseVersions(repositoryRoot)
const distributionRoot = resolve(repositoryRoot, 'packages/editor-web/dist')
const manifestPath = resolve(distributionRoot, 'manifest.json')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

assert(existsSync(manifestPath), 'Web distribution manifest is missing.')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const files = Array.isArray(manifest.files) ? manifest.files : []
const declared = new Set(files.map((file) => file.path))
assert(manifest.manifestVersion === versions.manifestVersion, 'Web distribution manifest version is invalid.')
assert(manifest.productName === 'w-editor' && manifest.productVersion === versions.productVersion, 'Web distribution product identity is invalid.')
assert(manifest.apiVersion === versions.webApiVersion && manifest.schemaVersion === versions.webSchemaVersion, 'Web distribution API/schema versions are invalid.')
assert(manifest.hostContractsVersion === versions.hostContractsVersion, 'Web distribution host-contract version is invalid.')
assert(manifest.minimumHostAdapterVersion === versions.minimumHostAdapterVersion, 'Web distribution minimum host adapter version is invalid.')
assert(manifest.markdownDialectVersion === versions.markdownDialectVersion, 'Web distribution Markdown dialect version is invalid.')
assert(manifest.databaseSchemaVersion === versions.databaseSchemaVersion, 'Web distribution database schema version is invalid.')
assert(manifest.commit === execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim(), 'Web distribution commit does not match HEAD.')
assert(manifest.testSeam?.status === 'absent', 'Web distribution test seam is present.')
assert(files.length > 190, 'Web distribution file closure is unexpectedly small.')
assert(Array.isArray(manifest.drawio?.files) && manifest.drawio.files.length > 340, 'Web distribution draw.io closure is incomplete.')
assert(manifest.drawio?.lazy === true, 'Web distribution draw.io closure is not marked lazy.')
assert(manifest.drawio?.bridge === 'drawio/bridge.html', 'Web distribution draw.io bridge is missing.')

for (const file of files) {
  assert(typeof file.path === 'string' && !file.path.startsWith('/') && !file.path.includes('\\'), `Invalid manifest path: ${file.path}`)
  const absolutePath = resolve(distributionRoot, file.path)
  const relativePath = relative(distributionRoot, absolutePath)
  assert(relativePath !== '' && !relativePath.startsWith('..') && !relativePath.startsWith(`${resolve('')}`), `Manifest path escapes distribution: ${file.path}`)
  assert(existsSync(absolutePath), `Manifest file is missing: ${file.path}`)
  assert(readFileSync(absolutePath).byteLength === file.size, `Manifest file size mismatch: ${file.path}`)
  assert(digest(absolutePath) === file.sha256, `Manifest file hash mismatch: ${file.path}`)
}

for (const path of [...Object.values(manifest.entries), ...manifest.css, ...manifest.types, ...manifest.drawio.files, ...manifest.licenses]) {
  assert(declared.has(path), `Manifest group is not closed over ${path}`)
}

const css = readFileSync(resolve(distributionRoot, 'w-editor.css'), 'utf8')
const cssUrls = [...css.matchAll(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/giu)].map((match) => match[1] ?? '')
for (const url of cssUrls.filter((value) => !value.startsWith('data:'))) {
  assert(!/^https?:/iu.test(url), `CSS references a network asset: ${url}`)
  const path = url.replace(/^\.\//u, '')
  assert(declared.has(path), `CSS references an undeclared asset: ${path}`)
}

for (const file of files.filter(({ path }) => /\.js$/iu.test(path))) {
  const source = readFileSync(resolve(distributionRoot, file.path), 'utf8')
  assert(!/from\s*['"](?:vue|@w-editor|@tiptap|@codemirror|cherry-markdown|katex|codemirror)['"]/u.test(source), `Built file retains a host runtime import: ${file.path}`)
  assert(!/(?:data-e2e|__W_EDITOR_E2E__|src\/testing\/)/u.test(source), `Built file retains a test seam: ${file.path}`)
}

console.log(`Web distribution manifest passed: ${files.length} files, ${manifest.drawio.files.length} draw.io files, closure and seam checks passed.`)
