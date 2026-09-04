import type { CommandDescriptor } from '@w-editor/editor-core'

export interface ToolbarMatrixDiagnostics {
  readonly duplicateMatrixIds: readonly string[]
  readonly missingExclusions: readonly string[]
  readonly missingRegistryIds: readonly string[]
  readonly registeredExclusions: readonly string[]
  readonly untestedRegistryIds: readonly string[]
  readonly unexpectedMatrixIds: readonly string[]
}

export interface ToolbarMatrixValidationResult {
  readonly diagnostics: ToolbarMatrixDiagnostics
  readonly valid: boolean
}

function duplicates(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values.filter((value, index) => values.indexOf(value) !== index))].sort())
}

export function parseToolbarMatrixIds(markdown: string): readonly string[] {
  const publicSection = markdown.split(/^## Explicit exclusions$/mu, 1)[0] ?? markdown
  return Object.freeze([...publicSection.matchAll(/^\| `([a-z][a-z0-9.-]+)` \|/gmu)].map((match) => match[1] ?? ''))
}

export function validateToolbarMatrix(
  markdown: string,
  descriptors: readonly CommandDescriptor[],
  exclusions: readonly string[],
): ToolbarMatrixValidationResult {
  const matrixIds = parseToolbarMatrixIds(markdown)
  const registryIds = descriptors.map((descriptor) => descriptor.id)
  const registrySet = new Set(registryIds)
  const matrixSet = new Set(matrixIds)
  const exclusionSection = markdown.split(/^## Explicit exclusions$/mu)[1] ?? ''
  const diagnostics: ToolbarMatrixDiagnostics = Object.freeze({
    duplicateMatrixIds: duplicates(matrixIds),
    missingExclusions: Object.freeze(exclusions.filter((id) => !exclusionSection.includes(`\`${id}\``)).sort()),
    missingRegistryIds: Object.freeze(registryIds.filter((id) => !matrixSet.has(id)).sort()),
    registeredExclusions: Object.freeze(exclusions.filter((id) => registrySet.has(id)).sort()),
    untestedRegistryIds: Object.freeze(descriptors
      .filter((descriptor) => descriptor.verification.matrixId !== descriptor.id
        || descriptor.verification.automatedEvidence.length === 0
        || descriptor.verification.automatedEvidence.some((evidence) => evidence.trim().length === 0))
      .map((descriptor) => descriptor.id)
      .sort()),
    unexpectedMatrixIds: Object.freeze(matrixIds.filter((id) => !registrySet.has(id)).sort()),
  })
  return Object.freeze({
    diagnostics,
    valid: Object.values(diagnostics).every((entries) => entries.length === 0),
  })
}
