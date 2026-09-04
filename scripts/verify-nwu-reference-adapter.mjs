import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const projectRoot = resolve(import.meta.dirname, '..')
const patchPath = resolve(projectRoot, 'tests/fixtures/nwu-reference/reference-adapter.patch')
const adapterPath = resolve(projectRoot, 'tests/fixtures/nwu-reference/nwu-reference-adapter.js')
const sourceArgument = process.argv.find((argument) => argument.startsWith('--source='))?.slice('--source='.length)
if (sourceArgument === undefined || sourceArgument.length === 0) throw new Error('Pass --source=<lagging NWU copy>.')
const sourceRoot = resolve(sourceArgument)
if (!isAbsolute(sourceRoot) || !statSync(sourceRoot).isDirectory()) throw new Error('The lagging NWU source must be an existing absolute directory.')

const templateNames = ['blog_edit.html', 'blog_view.html']
const sourceTemplates = templateNames.map((name) => resolve(sourceRoot, 'templates', name))
for (const template of sourceTemplates) {
  if (!statSync(template).isFile()) throw new Error(`Missing safe template input: ${basename(template)}`)
}

const requiredSourceAnchors = new Map([
  ['blog_edit.html', ['id="blog-editor-form"', 'id="blog-content-input"', "credentials: 'same-origin'", "'X-Requested-With': 'XMLHttpRequest'"]],
  ['blog_view.html', ['{{ content_html|safe }}', "url_for('edit_blog'", "querySelector('.blog-content')"]],
])
for (const template of sourceTemplates) {
  const source = readFileSync(template, 'utf8')
  for (const anchor of requiredSourceAnchors.get(basename(template)) ?? []) {
    if (!source.includes(anchor)) throw new Error(`Lagging-copy template fact changed: ${basename(template)} lacks ${anchor}`)
  }
}

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const hashesBefore = Object.fromEntries(sourceTemplates.map((path) => [basename(path), sha256(path)]))
const isolatedRoot = mkdtempSync(join(tmpdir(), 'w-editor-nwu-reference-'))
const normalizedTemp = resolve(tmpdir()).toLocaleLowerCase()
const normalizedIsolated = resolve(isolatedRoot).toLocaleLowerCase()
if (!normalizedIsolated.startsWith(`${normalizedTemp}\\`) && !normalizedIsolated.startsWith(`${normalizedTemp}/`)) {
  throw new Error('The isolation directory is outside the system temp root.')
}
try {
  const isolatedTemplates = join(isolatedRoot, 'templates')
  mkdirSync(isolatedTemplates, { recursive: true })
  for (const source of sourceTemplates) copyFileSync(source, join(isolatedTemplates, basename(source)))

  for (const mode of ['--check', '--apply']) {
    const args = mode === '--check'
      ? ['apply', '--check', '--whitespace=error-all', patchPath]
      : ['apply', '--whitespace=error-all', patchPath]
    const result = spawnSync('git', args, { cwd: isolatedRoot, encoding: 'utf8' })
    if (result.status !== 0) throw new Error(`git apply ${mode} failed: ${result.stderr || result.stdout}`)
  }

  const syntax = spawnSync(process.execPath, ['--check', adapterPath], { encoding: 'utf8' })
  if (syntax.status !== 0) throw new Error(`Reference adapter syntax check failed: ${syntax.stderr || syntax.stdout}`)

  const patchedEdit = readFileSync(join(isolatedTemplates, 'blog_edit.html'), 'utf8')
  const patchedView = readFileSync(join(isolatedTemplates, 'blog_view.html'), 'utf8')
  for (const marker of ['data-nwu-w-editor-reference', 'w-editor.global.js', 'nwu-w-editor-reference-adapter.js']) {
    if (!patchedEdit.includes(marker)) throw new Error(`Patched edit template lacks ${marker}`)
  }
  for (const marker of ['data-nwu-w-renderer-reference', 'data-nwu-w-renderer-markdown', 'w-editor.global.js']) {
    if (!patchedView.includes(marker)) throw new Error(`Patched view template lacks ${marker}`)
  }

  const hashesAfter = Object.fromEntries(sourceTemplates.map((path) => [basename(path), sha256(path)]))
  if (JSON.stringify(hashesAfter) !== JSON.stringify(hashesBefore)) throw new Error('The original lagging-copy templates changed during isolated verification.')

  process.stdout.write(`${JSON.stringify({
    adapter: 'tests/fixtures/nwu-reference/nwu-reference-adapter.js',
    isolated: true,
    originalSourceModified: false,
    patch: 'tests/fixtures/nwu-reference/reference-adapter.patch',
    sourceKind: 'lagging-non-git-copy',
    templates: templateNames,
    validation: ['source-anchor-facts', 'git-apply-check', 'git-apply-isolated', 'adapter-node-syntax', 'patched-markers', 'source-hash-unchanged'],
  }, null, 2)}\n`)
} finally {
  rmSync(isolatedRoot, { force: true, recursive: true })
}
