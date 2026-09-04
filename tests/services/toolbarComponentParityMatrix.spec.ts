import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const inventoryPath = 'docs/toolbar-command-matrix.md'
const parityPath = 'docs/toolbar-component-parity-matrix.md'
const auditHeading = '## Current implementation audit'
const allowedClassifications = [
  'Conforming',
  'Token/CSS-only',
  'Layout/interaction work',
  'Semantic/node/editor work',
] as const
const requiredColumns = [
  'Reference owner',
  'Group / order / location',
  'DOM / geometry',
  'Visual tokens',
  'Selection / caret',
  'Keyboard / focus',
  'Contextual UI',
  'States',
  'Accessibility / responsive',
  'Markdown / Final outcomes',
  'Approved exceptions',
] as const
const requiredComponentIds = [
  'component.toolbar',
  'component.appearance-theme',
  'component.panel',
  'component.ruby-pinyin',
  'component.quote',
  'component.inline-code',
  'component.accordion',
  'component.timeline',
  'component.toc',
  'component.table',
  'component.formula',
  'component.inline-formula',
] as const
const requiredToolbarContractFragments = [
  '## Frozen Cherry top-toolbar contract',
  '`text.bold` → `text.italic` → `menu.text-style` → `text.size`',
  '`insert.formula.alias` → `menu.insert` → `menu.mermaid` → `menu.chart`',
  '`settings.shortcuts` → `search.replace` → `mode.preview.alias` → `document.manual-save`',
  '`document.word-count` → `menu.theme` → `menu.language` → `menu.export` → `application.fullscreen`',
  '`line-spacing` is a W-Editor non-command appearance extension immediately left of Word count',
  '`4px 24px` toolbar padding',
  '`38×38px` controls',
  '`2×21px` separators with `4px` inline margins',
  '`ch-icon` icon-font classes',
] as const

function rowIds(source: string, prefix: string): string[] {
  return source
    .split(/\r?\n/u)
    .map((line) => line.match(/^\| `([^`]+)` \|/u)?.[1])
    .filter((id): id is string => id?.startsWith(prefix) === true)
}

function auditRows(source: string): Array<{
  classification: string
  finding: string
  id: string
  remediation: string
}> {
  const auditSection = source.split(auditHeading)[1] ?? ''
  return auditSection
    .split(/\r?\n/u)
    .map((line) => line.match(/^\| `([^`]+)` \| `([^`]+)` \| ([^|]+) \| ([^|]+) \|$/u))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => ({
      classification: match[2]?.trim() ?? '',
      finding: match[3]?.trim() ?? '',
      id: match[1] ?? '',
      remediation: match[4]?.trim() ?? '',
    }))
}

describe('toolbar command and component parity matrix', () => {
  it('freezes the official Cherry principal topology, icon font, and geometry tokens', () => {
    const parity = readFileSync(parityPath, 'utf8')
    for (const fragment of requiredToolbarContractFragments) expect(parity).toContain(fragment)
  })

  it('maps all 80 commands and every named component to complete parity dimensions', () => {
    expect(existsSync(parityPath), `${parityPath} must exist`).toBe(true)

    const inventory = readFileSync(inventoryPath, 'utf8')
    const parity = readFileSync(parityPath, 'utf8')
    const frozenParity = parity.split(auditHeading)[0] ?? ''
    const inventoryIds = rowIds(inventory, '')
    const commandSection = frozenParity.split('## Associated component parity rows')[0] ?? ''
    const componentSection = frozenParity.split('## Associated component parity rows')[1] ?? ''
    const parityCommandIds = rowIds(commandSection, '')
    const componentIds = rowIds(componentSection, 'component.')
    const headers = frozenParity.split(/\r?\n/u).filter((line) => /^\| (Stable ID|Component ID) \|/u.test(line))

    expect(inventoryIds).toHaveLength(80)
    expect(parityCommandIds).toEqual(inventoryIds)
    expect(new Set(componentIds).size).toBe(componentIds.length)
    expect(componentIds).toEqual(expect.arrayContaining([...requiredComponentIds]))

    for (const header of headers) {
      for (const column of requiredColumns) {
        expect(header, `parity header must include ${column}`).toContain(` ${column} `)
      }
    }

    const parityRows = frozenParity.split(/\r?\n/u).filter((line) => /^\| `(?:component\.)?[a-z][a-z0-9.-]+` \|/u.test(line))
    for (const row of parityRows) {
      const cells = row
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim())
      expect(cells).toHaveLength(requiredColumns.length + 1)
      expect(cells.every((cell) => cell.length > 0 && cell !== 'TBD')).toBe(true)
      expect(cells.at(-1)).toMatch(/^(None|Approved:)/u)
    }
  })

  it('classifies every frozen command and component implementation for targeted remediation', () => {
    const parity = readFileSync(parityPath, 'utf8')
    const frozenParity = parity.split(auditHeading)[0] ?? ''
    const commandSection = frozenParity.split('## Associated component parity rows')[0] ?? ''
    const componentSection = frozenParity.split('## Associated component parity rows')[1] ?? ''
    const expectedIds = [...rowIds(commandSection, ''), ...rowIds(componentSection, 'component.')]
    const rows = auditRows(parity)

    expect(parity).toContain(auditHeading)
    expect(rows.map((row) => row.id)).toEqual(expectedIds)
    expect(new Set(rows.map((row) => row.id)).size).toBe(expectedIds.length)

    for (const row of rows) {
      expect(allowedClassifications).toContain(row.classification)
      expect(row.finding.length).toBeGreaterThan(0)
      expect(row.finding).not.toBe('TBD')
      expect(row.remediation.length).toBeGreaterThan(0)
      expect(row.remediation).not.toBe('TBD')
      if (row.classification === 'Conforming') {
        expect(row.remediation).toBe('None')
      } else {
        expect(row.remediation).toMatch(/^Task /u)
      }
    }
  })
})
