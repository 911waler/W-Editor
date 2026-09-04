import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import representativeMarkdown from '../fixtures/cherry/representative.md?raw'
import { renderWithCherryOracle } from './cherryOracle'

describe('published Cherry 0.11.9 renderer oracle', () => {
  it('resolves the pinned published package rather than a sibling source tree', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies: Record<string, string>
    }
    expect(packageJson.dependencies['cherry-markdown']).toBe('0.11.9')
    expect(JSON.stringify(packageJson)).not.toMatch(/(?:file|link|workspace):/)
  })

  it('renders representative reviewed grammar through the public Cherry instance', () => {
    const result = renderWithCherryOracle(representativeMarkdown)

    expect(result.markdown).toBe(representativeMarkdown)
    expect(result.html).toContain('<h1')
    expect(result.html).toContain('<strong>bold</strong>')
    expect(result.html).toContain('<em>italic</em>')
    expect(result.html).toContain('<del>strike</del>')
    expect(result.html).toContain('<table')
    expect(result.html).toContain('language-javascript')
    expect(result.html).toContain('Oracle panel')
    expect(result.html).toContain('Hidden detail body')
  })
})
