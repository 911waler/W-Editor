import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { CommandDescriptor } from '../../src/services/commandRegistry'
import {
  EXCLUDED_TOOLBAR_CONTROL_IDS,
  createToolbarCommandDescriptors,
} from '../../src/services/toolbarCommands'
import { validateToolbarMatrix } from '../../src/services/toolbarMatrixValidation'

const matrix = readFileSync('docs/toolbar-command-matrix.md', 'utf8')
const descriptors = createToolbarCommandDescriptors()

describe('toolbar command matrix registry parity', () => {
  it('maps every registry ID once, supplies automated evidence, and lists every exclusion', () => {
    const result = validateToolbarMatrix(matrix, descriptors, EXCLUDED_TOOLBAR_CONTROL_IDS)

    expect(result.diagnostics).toEqual({
      duplicateMatrixIds: [],
      missingExclusions: [],
      missingRegistryIds: [],
      registeredExclusions: [],
      untestedRegistryIds: [],
      unexpectedMatrixIds: [],
    })
    expect(result.valid).toBe(true)
  })

  it('fails for a missing or duplicate matrix command', () => {
    const boldRow = matrix.match(/^\| `text\.bold` \|.*$/mu)?.[0]
    expect(boldRow).toBeDefined()
    const missing = validateToolbarMatrix(matrix.replace(/^\| `text\.bold` \|.*(?:\r?\n|$)/mu, ''), descriptors, EXCLUDED_TOOLBAR_CONTROL_IDS)
    const duplicate = validateToolbarMatrix(`${boldRow?.replace(/\r$/u, '')}\n${matrix}`, descriptors, EXCLUDED_TOOLBAR_CONTROL_IDS)

    expect(missing.diagnostics.missingRegistryIds).toEqual(['text.bold'])
    expect(duplicate.diagnostics.duplicateMatrixIds).toEqual(['text.bold'])
    expect(missing.valid).toBe(false)
    expect(duplicate.valid).toBe(false)
  })

  it('fails for an untested registry descriptor or an included exclusion', () => {
    const first = descriptors[0]
    expect(first).toBeDefined()
    const untested = Object.freeze({
      ...first,
      verification: Object.freeze({ ...first?.verification, automatedEvidence: Object.freeze([]) }),
    }) as CommandDescriptor
    const excluded = Object.freeze({ ...first, id: EXCLUDED_TOOLBAR_CONTROL_IDS[0] }) as CommandDescriptor
    const untestedResult = validateToolbarMatrix(matrix, [untested, ...descriptors.slice(1)], EXCLUDED_TOOLBAR_CONTROL_IDS)
    const excludedResult = validateToolbarMatrix(matrix, [excluded, ...descriptors], EXCLUDED_TOOLBAR_CONTROL_IDS)

    expect(untestedResult.diagnostics.untestedRegistryIds).toEqual([first?.id])
    expect(excludedResult.diagnostics.registeredExclusions).toEqual([EXCLUDED_TOOLBAR_CONTROL_IDS[0]])
    expect(untestedResult.valid).toBe(false)
    expect(excludedResult.valid).toBe(false)
  })
})
