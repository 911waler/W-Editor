import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  EXPECTED_COMPONENT_IDS,
  EXPECTED_UA_IDS,
  validateAgentHandsOnTrialReport,
  validateAcceptanceChecklist,
  validateReferenceBaselineManifest,
  validateSystemBrowserSmokeReport,
  validateToolbarComponentParityMatrix,
  validateUserAcceptanceMatrix,
} from '../../src/services/releaseDocumentationValidation'

const read = (path: string): string => readFileSync(path, 'utf8')

const uaMatrix = read('docs/user-acceptance-remediation-matrix.md')
const parityMatrix = read('docs/toolbar-component-parity-matrix.md')
const acceptanceChecklist = read('docs/acceptance-checklist.md')
const featureManifest = JSON.parse(read('tests/fixtures/manifests/feature-manifest.json')) as {
  readonly acceptanceRequirements: { readonly items: readonly { readonly title: string }[] }
  readonly commands: { readonly ids: readonly string[] }
  readonly requirementFamilies: { readonly ids: readonly string[] }
}
const referenceManifest = JSON.parse(
  read('tests/fixtures/parity/reference-baseline-manifest.json'),
) as unknown
const systemBrowserSmokeReport = JSON.parse(read('tests/fixtures/acceptance/system-browser-smoke.json')) as unknown
const agentHandsOnTrialReport = JSON.parse(read('tests/fixtures/acceptance/agent-hands-on-trial.json')) as unknown

const archivedCommands = (JSON.parse(read('tests/fixtures/manifests/archived-acceptance-commands.json')) as { commands: { ids: readonly string[] } }).commands.ids
const commandIds = [...featureManifest.commands.ids]
const requirementTitles = featureManifest.acceptanceRequirements.items.map(({ title }) => title)
const requirementFamilyIds = [...featureManifest.requirementFamilies.ids]

function removeRow(source: string, id: string): string {
  return source
    .split('\n')
    .filter((line) => !line.startsWith(`| \`${id}\` |`))
    .join('\n')
}

describe('release documentation mutation validation', () => {
  it('accepts the complete frozen documentation set', () => {
    expect(validateUserAcceptanceMatrix(uaMatrix)).toEqual([])
    expect(validateToolbarComponentParityMatrix(parityMatrix, commandIds)).toEqual([])
    expect(validateReferenceBaselineManifest(referenceManifest)).toEqual([])
    expect(validateSystemBrowserSmokeReport(systemBrowserSmokeReport)).toEqual([])
    expect(
      validateAgentHandsOnTrialReport(agentHandsOnTrialReport, requirementFamilyIds, archivedCommands),
    ).toEqual([])
    expect(
      validateAcceptanceChecklist(acceptanceChecklist, requirementTitles, commandIds),
    ).toEqual([])
  })

  it('rejects a missing or duplicate UA row', () => {
    expect(validateUserAcceptanceMatrix(removeRow(uaMatrix, 'UA-007'))).toContain(
      'UA rows must be exactly UA-001 through UA-020 in order',
    )

    const ua007 = uaMatrix.split('\n').find((line) => line.startsWith('| `UA-007` |')) ?? ''
    expect(validateUserAcceptanceMatrix(`${uaMatrix}\n${ua007}`)).toContain(
      'UA rows must be exactly UA-001 through UA-020 in order',
    )
  })

  it('rejects a missing command or component parity row', () => {
    expect(validateToolbarComponentParityMatrix(removeRow(parityMatrix, 'text.italic'), commandIds)).toContain(
      'Command parity rows must exactly match the 80-command inventory in order',
    )
    expect(
      validateToolbarComponentParityMatrix(
        removeRow(parityMatrix, 'component.inline-code'),
        commandIds,
      ),
    ).toContain('Component parity rows must exactly match the frozen component inventory in order')
  })

  it('rejects an undocumented parity exception', () => {
    const mutated = parityMatrix.replace(
      '| `text.bold` | Cherry toolbar and Final; Tiptap Visual |',
      '| `text.bold` | Cherry toolbar and Final; Tiptap Visual |',
    ).replace(/\| None \|/u, '| Intentional divergence |')

    expect(validateToolbarComponentParityMatrix(mutated, commandIds)).toContain(
      'Every parity exception must be None or start with Approved:',
    )
  })

  it('rejects incomplete frozen baseline metadata', () => {
    const mutated = structuredClone(referenceManifest) as {
      assets: Array<Record<string, unknown>>
    }
    delete mutated.assets[0]?.['browserVersion']

    expect(validateReferenceBaselineManifest(mutated)).toContain(
      'Reference asset cherry-toolbar-main-right is missing browserVersion',
    )
  })

  it('rejects requirement, command, component, UA, or cross-cutting checklist omissions', () => {
    const mutations = [
      acceptanceChecklist.replace(`| ${requirementTitles[0]} |`, '| Removed requirement |'),
      removeRow(acceptanceChecklist, 'CMD-001'),
      removeRow(acceptanceChecklist, EXPECTED_COMPONENT_IDS[0] ?? ''),
      removeRow(acceptanceChecklist, EXPECTED_UA_IDS[0] ?? ''),
      removeRow(acceptanceChecklist, 'X-01'),
    ]

    for (const mutated of mutations) {
      expect(validateAcceptanceChecklist(mutated, requirementTitles, commandIds).length).toBeGreaterThan(0)
    }
  })
})
