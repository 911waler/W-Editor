import { readFileSync, statSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { mockUploadedAsset } from '../../e2e/fixtures/mockUpload'

describe('deterministic production-app fixtures', () => {
  it('uses LF-only line endings for cross-platform Markdown inputs', () => {
    for (const path of [
      'tests/fixtures/cherry/chart-tables.md',
      'tests/fixtures/cherry/mermaid.md',
      'tests/fixtures/cherry/panels.md',
      'tests/fixtures/cherry/simple-inserts.md',
      'tests/fixtures/cherry/timeline.md',
      'tests/fixtures/parity/w-editor-parity.md',
      'tests/fixtures/parity/w-editor-parity-state.json',
      'apps/playground/src/content/articles/product-notes.md',
    ]) {
      expect(readFileSync(path).includes(Buffer.from([13, 10]))).toBe(false)
    }
  })

  it('provides stable file fixtures for every upload family', () => {
    for (const name of ['sample-image.png', 'sample-audio.wav', 'sample-video.mp4', 'sample.pdf', 'sample.docx', 'sample.txt']) {
      expect(statSync(`e2e/fixtures/files/${name}`).size).toBeGreaterThan(0)
    }
    expect(readFileSync('e2e/fixtures/files/sample-image.png').subarray(1, 4).toString()).toBe('PNG')
  })

  it('provides a representative blocking document and an approximately 1 MB diagnostic document', () => {
    const representative = readFileSync('e2e/fixtures/documents/representative-long.md', 'utf8')
    const diagnosticSize = statSync('e2e/fixtures/documents/approximately-1mb.md').size
    expect(representative).toContain('::: info')
    expect(representative).toContain('```javascript')
    expect(representative.length).toBeGreaterThan(150_000)
    expect(diagnosticSize).toBeGreaterThanOrEqual(1024 * 1024)
    expect(diagnosticSize).toBeLessThan(1_050_000)
  })

  it('returns serializable deterministic upload results and a local official-protocol draw.io editor', () => {
    expect(mockUploadedAsset('image')).toEqual({
      url: 'https://fixtures.w-editor.test/uploads/image/asset-001',
      name: 'sample-image',
      mediaType: 'image/png',
      size: 128,
    })
    const drawio = readFileSync('e2e/fixtures/drawio/fake-drawio.html', 'utf8')
    expect(drawio).toContain("send('ready')")
    expect(drawio).toContain("event.data?.eventName === 'getData'")
    expect(drawio).toContain('event.origin !== location.origin')
    expect(drawio).toContain('event.source !== parent')
  })
})
