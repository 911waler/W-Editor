import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { relative, resolve } from 'node:path'

import { readReleaseVersions } from './release-versions.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const versions = readReleaseVersions(repositoryRoot)
const distributionRoot = resolve(repositoryRoot, 'packages/editor-web/dist')
const drawioSourceRoot = resolve(repositoryRoot, 'public/vendor/cherry-drawio')
const drawioDistributionRoot = resolve(distributionRoot, 'drawio')

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function listFiles(root, current = root) {
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(current, entry.name)
    return entry.isDirectory() ? listFiles(root, path) : [path]
  }).sort()
}

mkdirSync(drawioDistributionRoot, { recursive: true })
for (const entry of readdirSync(drawioSourceRoot, { withFileTypes: true })) {
  cpSync(resolve(drawioSourceRoot, entry.name), resolve(drawioDistributionRoot, entry.name), { force: true, recursive: true })
}
writeFileSync(resolve(drawioDistributionRoot, 'bridge.html'), `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="w-editor-drawio-editor" content="./drawio_demo.html">
    <title>W-Editor draw.io bridge</title>
  </head>
  <body>
    <p data-drawio-bridge-status>Loading diagram editor…</p>
    <iframe id="drawio-editor" allow="clipboard-read; clipboard-write" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-downloads" title="diagrams.net editor"></iframe>
    <script src="./bridge.js"></script>
  </body>
</html>
`, 'utf8')

const files = listFiles(distributionRoot)
  .map((path) => {
    const relativePath = relative(distributionRoot, path).replaceAll('\\', '/')
    const bytes = readFileSync(path)
    return Object.freeze({ path: relativePath, sha256: digest(bytes), size: statSync(path).size })
  })
  .filter(({ path }) => path !== 'manifest.json')
const filePaths = new Set(files.map(({ path }) => path))
const css = ['w-editor.css']
const types = files.filter(({ path }) => path.startsWith('types/')).map(({ path }) => path)
const chunks = files.filter(({ path }) => path.startsWith('chunks/')).map(({ path }) => path)
const drawioFiles = files.filter(({ path }) => path.startsWith('drawio/')).map(({ path }) => path)
const fontFiles = files.filter(({ path }) => /\.(?:eot|ttf|woff2?)$/iu.test(path)).map(({ path }) => path)
const currentCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim()
const fingerprint = Buffer.from(files.map(({ path, sha256, size }) => `${path}\0${size}\0${sha256}`).join('\n'), 'utf8')
const cssSource = readFileSync(resolve(distributionRoot, 'w-editor.css'), 'utf8')

const manifest = Object.freeze({
  apiVersion: versions.webApiVersion,
  chunks: Object.freeze(chunks),
  commit: currentCommit,
  contentSha256: digest(fingerprint),
  css: Object.freeze(css),
  drawio: Object.freeze({
    bridge: 'drawio/bridge.html',
    entry: 'drawio/drawio_demo.html',
    files: Object.freeze(drawioFiles),
    lazy: true,
    source: 'public/vendor/cherry-drawio',
  }),
  entries: Object.freeze({
    editor: 'editor.es.js',
    iife: 'w-editor.global.js',
    renderer: 'renderer.es.js',
  }),
  files: Object.freeze(files),
  fonts: Object.freeze({
    embedded: /url\(\s*['"]?data:/iu.test(cssSource),
    files: Object.freeze(fontFiles),
  }),
  generatedAt: new Date().toISOString(),
  hostContractsVersion: versions.hostContractsVersion,
  licenses: Object.freeze(['drawio/LICENSE', 'drawio/PROVENANCE.md']),
  manifestVersion: versions.manifestVersion,
  markdownDialectVersion: versions.markdownDialectVersion,
  minimumHostAdapterVersion: versions.minimumHostAdapterVersion,
  productName: 'w-editor',
  productVersion: versions.productVersion,
  schemaVersion: versions.webSchemaVersion,
  databaseSchemaVersion: versions.databaseSchemaVersion,
  testSeam: Object.freeze({ status: 'absent' }),
  types: Object.freeze(types),
})

for (const path of [...Object.values(manifest.entries), ...manifest.css, ...manifest.types, ...manifest.drawio.files, ...manifest.licenses]) {
  if (!filePaths.has(path)) throw new Error(`Web distribution manifest references a missing file: ${path}`)
}

writeFileSync(resolve(distributionRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(`Web distribution manifest generated: ${files.length} files, ${drawioFiles.length} draw.io files.`)
