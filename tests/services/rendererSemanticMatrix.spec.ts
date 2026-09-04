import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

interface SemanticMatrix {
  readonly change: string
  readonly matrixVersion: number
  readonly pipelineId: string
  readonly rows: readonly {
    readonly capabilityId: string
    readonly fixture: string
    readonly finalPreview: string
    readonly reader: string
    readonly source: string
    readonly visual: string
  }[]
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

describe('Renderer visual semantic matrix', () => {
  it('covers every current content capability with explicit mode semantics', () => {
    const matrix = readJson('tests/fixtures/renderer/visual-semantic-matrix.json') as SemanticMatrix
    const manifest = readJson('tests/fixtures/manifests/feature-manifest.json') as {
      readonly contentCapabilities: readonly { readonly id: string }[]
    }
    const ids = new Set(matrix.rows.map((row) => row.capabilityId))

    expect(matrix.change).toBe('dual-target-release')
    expect(matrix.matrixVersion).toBe(1)
    expect(matrix.pipelineId).toBe('w-editor-shared-renderer-v1')
    expect(matrix.rows.length).toBeGreaterThanOrEqual(manifest.contentCapabilities.length)
    expect(new Set(matrix.rows.map((row) => row.capabilityId)).size).toBe(matrix.rows.length)
    for (const capability of manifest.contentCapabilities) expect(ids.has(capability.id)).toBe(true)
    for (const row of matrix.rows) {
      expect(row.source.length).toBeGreaterThan(0)
      expect(readFileSync(row.fixture, 'utf8').length).toBeGreaterThan(0)
      expect(row.visual.length).toBeGreaterThan(0)
      expect(row.finalPreview.length).toBeGreaterThan(0)
      expect(row.reader.length).toBeGreaterThan(0)
    }
  })
})
