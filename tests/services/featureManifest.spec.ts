import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { APPEARANCE_THEME_IDS } from '../../src/services/appearanceTheme'
import { LINE_SPACING_OPTIONS } from '../../src/services/lineSpacing'
import { TOOLBAR_MENU_DESCRIPTORS } from '../../src/services/toolbarCommands'

interface FeatureManifest {
  readonly commands: { readonly count: number; readonly ids: readonly string[] }
  readonly components: { readonly count: number; readonly ids: readonly string[] }
  readonly drawio: { readonly vendorFileCount: number; readonly provenance: readonly string[] }
  readonly exports: readonly { readonly id: string }[]
  readonly history: { readonly editableModes: readonly string[] }
  readonly lineSpacing: readonly { readonly id: string; readonly value: number }[]
  readonly locales: readonly { readonly id: string }[]
  readonly menus: { readonly count: number; readonly ids: readonly string[] }
  readonly modes: readonly { readonly id: string }[]
  readonly platformExceptions: readonly {
    readonly desktop: string
    readonly id: string
    readonly playground: string
    readonly reason: string
    readonly validation: string
    readonly web: string
  }[]
  readonly productionJourneys: {
    readonly productionAgentTrial: { readonly coverage: readonly string[] }
    readonly systemBrowserSmoke: { readonly ids: readonly string[] }
  }
  readonly schemaVersion: number
  readonly sourceInputs: readonly string[]
  readonly themes: readonly { readonly id: string; readonly default?: boolean }[]
}

const manifestPath = 'tests/fixtures/manifests/feature-manifest.json'
const commandIds = [
  'text.bold', 'text.italic', 'text.strike', 'text.underline', 'text.subscript', 'text.superscript', 'text.ruby',
  'block.quote', 'text.size', 'text.color', 'text.background', 'block.h1', 'block.h2', 'block.h3', 'block.h4',
  'block.h5', 'list.ordered', 'list.unordered', 'list.task', 'panel.primary', 'panel.info', 'panel.warning',
  'panel.danger', 'panel.success', 'align.left', 'align.center', 'align.right', 'align.justify', 'layout.two-column',
  'layout.multi-column', 'layout.tabs', 'layout.accordion', 'layout.timeline', 'insert.image', 'insert.audio',
  'insert.video', 'insert.link', 'insert.horizontal-rule', 'insert.hard-break', 'insert.code-block', 'insert.inline-code',
  'insert.formula', 'insert.toc', 'insert.table', 'insert.pdf', 'insert.word', 'insert.file', 'insert.drawio', 'insert.reference',
  'mermaid.flowchart', 'mermaid.sequence', 'mermaid.state', 'mermaid.class', 'mermaid.pie', 'mermaid.gantt',
  'chart.line', 'chart.bar', 'chart.radar', 'chart.map', 'chart.heatmap', 'chart.scatter', 'chart.pie', 'chart.sankey',
  'history.undo', 'history.redo', 'document.manual-save', 'search.replace', 'settings.shortcuts', 'mode.source',
  'mode.visual', 'mode.preview', 'application.fullscreen', 'language.zh', 'language.en', 'language.ru',
  'document.word-count', 'export.markdown', 'export.html', 'export.pdf', 'export.screenshot',
] as const
const componentIds = [
  'component.toolbar', 'component.appearance-theme', 'component.text-marks', 'component.heading', 'component.ruby-pinyin',
  'component.font-size-picker', 'component.color-picker', 'component.list', 'component.task-list', 'component.panel',
  'component.alignment', 'component.columns', 'component.tabs', 'component.accordion', 'component.timeline', 'component.media',
  'component.link', 'component.simple-insert', 'component.code-block', 'component.inline-code', 'component.formula',
  'component.inline-formula', 'component.toc', 'component.table', 'component.attachment', 'component.drawio', 'component.mermaid',
  'component.chart-table', 'component.history', 'component.manual-save', 'component.search-replace', 'component.shortcut-settings',
  'component.mode-controls', 'component.source-surface', 'component.visual-surface', 'component.preview-surface', 'component.quote',
  'component.fullscreen', 'component.locale-picker', 'component.word-count', 'component.export-menu',
] as const

function markdownInventoryIds(path: string, filter: (id: string) => boolean = () => true): readonly string[] {
  const tick = String.fromCharCode(96)
  return readFileSync(path, 'utf8')
    .split(/\r?\n/u)
    .flatMap((line) => {
      const cells = line.split('|').map((cell) => cell.trim())
      const candidate = cells[1] ?? ''
      if (!candidate.startsWith(tick) || !candidate.endsWith(tick)) return []
      const id = candidate.slice(1, -1)
      return filter(id) ? [id] : []
    })
}

describe('dual-target feature manifest', () => {
  it('freezes the baseline inventory and explicit platform exception fields', () => {
    expect(existsSync(manifestPath)).toBe(true)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as FeatureManifest

    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.sourceInputs.every((path) => existsSync(path))).toBe(true)
    expect(manifest.commands.count).toBe(80)
    expect(manifest.commands.ids).toEqual(commandIds)
    expect(manifest.commands.ids).toEqual(markdownInventoryIds('docs/toolbar-command-matrix.md'))
    expect(manifest.components.count).toBe(41)
    expect(manifest.components.ids).toEqual(componentIds)
    expect(manifest.components.ids).toEqual(
      markdownInventoryIds('docs/toolbar-component-parity-matrix.md', (id) => id.startsWith('component.'))
        .filter((id, index, ids) => ids.indexOf(id) === index),
    )
    expect(manifest.menus.count).toBe(11)
    expect(manifest.menus.ids).toEqual(TOOLBAR_MENU_DESCRIPTORS.map(({ id }) => id))
    expect(manifest.modes.map(({ id }) => id)).toEqual(['source', 'visual', 'preview'])
    expect(manifest.locales.map(({ id }) => id)).toEqual(['en', 'zh', 'ru'])
    expect(manifest.themes).toHaveLength(8)
    expect(manifest.themes.map(({ id }) => id)).toEqual([...APPEARANCE_THEME_IDS])
    expect(manifest.themes.filter(({ default: isDefault }) => isDefault === true)).toHaveLength(1)
    expect(manifest.lineSpacing.map(({ id }) => id)).toEqual(['single', 'compact', 'standard', 'double'])
    expect(manifest.lineSpacing.map(({ value }) => value)).toEqual(LINE_SPACING_OPTIONS.map(({ value }) => value))
    expect(manifest.exports.map(({ id }) => id)).toEqual([
      'export.markdown', 'export.html', 'export.pdf', 'export.screenshot',
    ])
    expect(manifest.history.editableModes).toEqual(['source', 'visual'])
    expect(manifest.drawio.vendorFileCount).toBe(352)
    expect(manifest.drawio.provenance).toEqual([
      'public/vendor/cherry-drawio/LICENSE',
      'public/vendor/cherry-drawio/PROVENANCE.md',
    ])
    expect(manifest.productionJourneys.systemBrowserSmoke.ids).toContain('sourceVisualFinalConvergence')
    expect(manifest.productionJourneys.productionAgentTrial.coverage).toContain('failureStates')

    expect(manifest.platformExceptions.length).toBeGreaterThan(0)
    for (const exception of manifest.platformExceptions) {
      expect(exception.id).toBeTruthy()
      expect(exception.playground).toBeTruthy()
      expect(exception.web).toBeTruthy()
      expect(exception.desktop).toBeTruthy()
      expect(exception.reason).toBeTruthy()
      expect(exception.validation).toBeTruthy()
    }
  })
})
