import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = resolve(repositoryRoot, 'tests/fixtures/manifests/feature-manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const errors = []
const requireReports = process.argv.includes('--require-reports')

function requireValue(condition, message) {
  if (!condition) errors.push(message)
}

function collectFiles(directory, extension) {
  if (!statSync(directory, { throwIfNoEntry: false })) return []
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...collectFiles(path, extension))
    else if (extension === undefined || entry.name.endsWith(extension)) files.push(path)
  }
  return files
}

function markdownIds(path, filter = () => true) {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/u)
    .flatMap((line) => {
      const cell = line.split('|')[1]?.trim() ?? ''
      if (!cell.startsWith('`') || !cell.endsWith('`')) return []
      const id = cell.slice(1, -1)
      return filter(id) ? [id] : []
    })
}

requireValue(manifest.manifestType === 'w-editor-feature-inventory', 'Unexpected feature manifest type.')
requireValue(manifest.change === 'dual-target-release', 'Feature manifest is not owned by dual-target-release.')
requireValue(manifest.schemaVersion === 1, 'Unsupported feature manifest schema.')
requireValue(manifest.productBaselineCommit === '39dddc311f0afb23339b4bba6d816fcfb285ef91', 'Feature manifest baseline commit changed.')
requireValue(manifest.commands?.count === 80, 'Feature manifest must contain 80 commands.')
requireValue(manifest.commands?.ids?.length === 80 && new Set(manifest.commands.ids).size === 80, 'Feature manifest command IDs are incomplete or duplicated.')
requireValue(manifest.commands?.ids?.join('\n') === markdownIds(resolve(repositoryRoot, 'docs/toolbar-command-matrix.md')).join('\n'), 'Feature manifest command inventory differs from the command matrix.')
requireValue(manifest.components?.count === 41, 'Feature manifest must contain 41 components.')
requireValue(manifest.components?.ids?.length === 41 && new Set(manifest.components.ids).size === 41, 'Feature manifest component IDs are incomplete or duplicated.')
requireValue(manifest.menus?.count === 11 && manifest.menus.ids?.length === 11, 'Feature manifest menu inventory is incomplete.')
requireValue(manifest.modes?.map(({ id }) => id).join(',') === 'source,visual,preview', 'Feature manifest mode inventory changed.')
requireValue(manifest.locales?.map(({ id }) => id).join(',') === 'en,zh,ru', 'Feature manifest locale inventory changed.')
requireValue(manifest.themes?.length === 8 && manifest.themes.filter(({ default: isDefault }) => isDefault === true).length === 1, 'Feature manifest theme inventory is incomplete.')
requireValue(manifest.lineSpacing?.length === 4, 'Feature manifest line-spacing inventory is incomplete.')
requireValue(manifest.exports?.length === 5, 'Feature manifest export inventory is incomplete.')
requireValue(manifest.drawio?.vendorFileCount === 352, 'Feature manifest draw.io vendor inventory changed.')
requireValue(manifest.history?.editableModes?.join(',') === 'source,visual', 'Feature manifest history boundary changed.')

const canonicalFiles = [
  'packages/editor-core/src/core/documentSession.ts',
  'packages/editor-core/src/core/operationState.ts',
  'packages/editor-core/src/core/boundedScheduler.ts',
  'packages/editor-core/src/core/projectionRevisionGate.ts',
  'packages/editor-core/src/codecs/index.ts',
  'packages/editor-core/src/codecs/codecRegistry.ts',
  'packages/editor-core/src/codecs/rawProjection.ts',
  'packages/editor-core/src/codecs/projectionMap.ts',
  'packages/editor-core/src/commands/index.ts',
  'packages/editor-core/src/commands/commandRegistry.ts',
  'packages/editor-core/src/commands/toolbarCommands.ts',
  'packages/editor-core/src/commands/documentStatistics.ts',
  'packages/editor-vue/src/adapters/cherryRenderAdapter.ts',
  'packages/editor-vue/src/adapters/cherrySourceAdapter.ts',
  'packages/editor-vue/src/adapters/tiptapVisualAdapter.ts',
  'packages/editor-vue/src/ui/SourceEditorSurface.vue',
  'packages/editor-vue/src/ui/VisualEditorSurface.vue',
  'packages/editor-vue/src/ui/SafePreviewHtml.vue',
  'packages/editor-vue/src/ui/styles.css',
  'apps/playground/src/PlaygroundApp.vue',
  'apps/playground/src/services/articleCatalog.ts',
  'apps/playground/src/services/localDocumentRepository.ts',
  'apps/playground/src/services/browserCompatibilityAdapter.ts',
  'packages/editor-web/src/index.ts',
  'apps/desktop/src/index.ts',
  'examples/nwu-host/src/index.ts',
]
for (const file of canonicalFiles) requireValue(existsSync(resolve(repositoryRoot, file)), `Missing canonical feature source: ${file}.`)

const sharedFixtures = collectFiles(resolve(repositoryRoot, 'tests/fixtures/cherry'), '.md')
requireValue(sharedFixtures.length >= 10, 'Shared Cherry fixture inventory is unexpectedly small.')
for (const fixture of manifest.contentCapabilities.flatMap(({ sourceFiles }) => sourceFiles)) {
  if (fixture.startsWith('tests/fixtures/') || fixture.startsWith('docs/')) {
    requireValue(existsSync(resolve(repositoryRoot, fixture)), `Manifest fixture/source is missing: ${fixture}.`)
  }
}

const journeys = manifest.productionJourneys
requireValue(journeys?.systemBrowserSmoke?.ids?.length >= 17, 'System-browser production journey inventory is incomplete.')
requireValue(journeys?.productionAgentTrial?.coverage?.length >= 11, 'Production-agent journey coverage inventory is incomplete.')
requireValue(journeys?.manualAcceptance?.stableFindingIds?.length >= 30, 'Manual acceptance finding inventory is incomplete.')
for (const source of [journeys?.systemBrowserSmoke?.source, journeys?.productionAgentTrial?.source, 'docs/acceptance-checklist.md']) {
  if (source !== undefined) requireValue(existsSync(resolve(repositoryRoot, source)), `Production journey source is missing: ${source}.`)
}

if (requireReports) {
  const reports = [journeys.systemBrowserSmoke.report, journeys.productionAgentTrial.report]
  for (const reportPath of reports) {
    const path = resolve(repositoryRoot, reportPath)
    requireValue(existsSync(path), `Required production journey report is missing: ${reportPath}.`)
    if (existsSync(path)) {
      const report = JSON.parse(readFileSync(path, 'utf8'))
      requireValue(report.status === 'passed', `Production journey report is not passed: ${reportPath}.`)
    }
  }
}

if (errors.length > 0) {
  console.error('Workspace feature manifest failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exitCode = 1
} else {
  console.log(`Workspace feature manifest passed: ${manifest.commands.count} commands, ${manifest.components.count} components, ${sharedFixtures.length} shared fixtures.`)
}
