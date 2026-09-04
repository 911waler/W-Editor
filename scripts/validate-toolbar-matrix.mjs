import { readFileSync } from 'node:fs'

const matrix = readFileSync(new URL('../docs/toolbar-command-matrix.md', import.meta.url), 'utf8')
const registrySource = readFileSync(new URL('../packages/editor-core/src/commands/toolbarCommands.ts', import.meta.url), 'utf8')
const generatedDescriptorSources = [
  ['PANEL_DESCRIPTORS', readFileSync(new URL('../packages/editor-core/src/codecs/panels.ts', import.meta.url), 'utf8')],
  ['MERMAID_DESCRIPTORS', readFileSync(new URL('../packages/editor-core/src/codecs/mermaid.ts', import.meta.url), 'utf8')],
  ['CHART_TABLE_DESCRIPTORS', readFileSync(new URL('../packages/editor-core/src/codecs/chartTables.ts', import.meta.url), 'utf8')],
]
const publicMatrix = matrix.split(/^## Explicit exclusions$/mu, 1)[0] ?? matrix
const exclusionMatrix = matrix.split(/^## Explicit exclusions$/mu)[1] ?? ''
const matrixIds = [...publicMatrix.matchAll(/^\| `([a-z][a-z0-9.-]+)` \|/gmu)].map((match) => match[1])
const literalSeedIds = [...registrySource.matchAll(/^\s*seed\('([a-z][a-z0-9.-]+)'/gmu)].map((match) => match[1])
const generatedSeedIds = generatedDescriptorSources.flatMap(([declaration, source]) => {
  const start = source.indexOf(`export const ${declaration}`)
  if (start === -1) throw new Error(`Missing generated command descriptor declaration: ${declaration}`)
  const end = source.indexOf('\n])', start)
  if (end === -1) throw new Error(`Unterminated generated command descriptor declaration: ${declaration}`)
  return [...source.slice(start, end).matchAll(/commandId:\s*'([a-z][a-z0-9.-]+)'/gu)].map((match) => match[1])
})
const registryIds = [...literalSeedIds, ...generatedSeedIds]
const exclusionDeclaration = registrySource.match(/EXCLUDED_TOOLBAR_CONTROL_IDS = Object\.freeze\(\[([\s\S]*?)\]\s+as const\)/u)?.[1] ?? ''
const exclusions = [...exclusionDeclaration.matchAll(/'([^']+)'/gu)].map((match) => match[1])

const duplicates = (values) => [...new Set(values.filter((value, index) => values.indexOf(value) !== index))].sort()
const diagnostics = {
  duplicateMatrixIds: duplicates(matrixIds),
  duplicateRegistryIds: duplicates(registryIds),
  missingExclusions: exclusions.filter((id) => !exclusionMatrix.includes(`\`${id}\``)).sort(),
  missingRegistryIds: registryIds.filter((id) => !matrixIds.includes(id)).sort(),
  registeredExclusions: exclusions.filter((id) => registryIds.includes(id)).sort(),
  unexpectedMatrixIds: matrixIds.filter((id) => !registryIds.includes(id)).sort(),
}

if (Object.values(diagnostics).some((entries) => entries.length > 0)) {
  throw new Error(JSON.stringify(diagnostics))
}

console.log(`Toolbar matrix valid against registry source: ${matrixIds.length} public commands, ${exclusions.length} explicit exclusions.`)
