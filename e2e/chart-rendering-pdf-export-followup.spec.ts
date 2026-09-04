import { readFile } from 'node:fs/promises'

import type { Locator, Page } from '@playwright/test'

import { chartTableStarterSource } from '../src/codecs'
import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

const RADAR_LABELS = Object.freeze([
  '用户A',
  '用户B',
  '用户C',
  '技能1',
  '技能2',
  '技能3',
  '技能4',
  '技能5',
])

interface SvgTextSample {
  readonly display: string
  readonly fill: string
  readonly inside: boolean
  readonly opacity: number
  readonly visibility: string
}

async function authorityMarkdown(page: Page): Promise<string | undefined> {
  return page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().markdown)
}

async function selectEnglish(page: Page): Promise<void> {
  await page.locator('[data-toolbar-menu="language"] .toolbar-menu__trigger').click()
  await page.locator('[data-command-id="language.en"]').click()
}

async function setSource(page: Page, markdown: string): Promise<void> {
  await page.locator('[data-command-id="mode.source"]').click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'source')
  await page.locator('.cm-content[contenteditable="true"]').fill(markdown)
  await expect.poll(() => authorityMarkdown(page)).toBe(markdown)
}

async function chartTextSamples(chart: Locator): Promise<Record<string, SvgTextSample>> {
  return chart.evaluate((root, labels) => {
    const rootRect = root.getBoundingClientRect()
    const samples: Record<string, SvgTextSample> = {}
    for (const label of labels) {
      const text = [...root.querySelectorAll<SVGTextElement>('svg text')]
        .find((candidate) => candidate.textContent?.trim() === label)
      if (text === undefined) continue
      const style = getComputedStyle(text)
      const rect = text.getBoundingClientRect()
      samples[label] = {
        display: style.display,
        fill: style.fill,
        inside: rect.left >= rootRect.left - 1
          && rect.right <= rootRect.right + 1
          && rect.top >= rootRect.top - 1
          && rect.bottom <= rootRect.bottom + 1,
        opacity: Number(style.opacity),
        visibility: style.visibility,
      }
    }
    return samples
  }, RADAR_LABELS)
}

function relativeLuminance(channel: number): number {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function contrastOnWhite(fill: string): number {
  const channels = /^rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/u.exec(fill)
  if (channels === null) return 0
  const luminance = 0.2126 * relativeLuminance(Number(channels[1]))
    + 0.7152 * relativeLuminance(Number(channels[2]))
    + 0.0722 * relativeLuminance(Number(channels[3]))
  return 1.05 / (luminance + 0.05)
}

for (const viewport of [
  { height: 900, name: 'desktop', width: 1280 },
  { height: 900, name: 'narrow', width: 720 },
] as const) {
  test(`Visual radar chart keeps every legend/axis label readable and unclipped at ${viewport.name} width`, async ({ page }) => {
    const markdown = chartTableStarterSource('chart.radar')
    await page.setViewportSize({ height: viewport.height, width: viewport.width })
    await openReadyApp(page)
    await selectEnglish(page)
    await setSource(page, markdown)

    await page.locator('[data-command-id="mode.visual"]').click()
    const visualChart = page.locator('.semantic-preview--chart-table .cherry-echarts-wrapper')
    await expect(visualChart.locator('svg')).toHaveCount(1)
    const visualSamples = await chartTextSamples(visualChart)

    await page.locator('[data-command-id="mode.preview"]').click()
    const finalChart = page.locator('.preview-rendered-content .cherry-echarts-wrapper[data-chart-type="radar"]')
    await expect(finalChart.locator('svg')).toHaveCount(1)
    const finalSamples = await chartTextSamples(finalChart)

    expect(Object.keys(visualSamples).sort()).toEqual([...RADAR_LABELS].sort())
    expect(Object.keys(finalSamples).sort()).toEqual([...RADAR_LABELS].sort())
    for (const label of RADAR_LABELS) {
      const visual = visualSamples[label]!
      const final = finalSamples[label]!
      expect(visual.fill, `${label} should use the same text color in Visual and Final`).toBe(final.fill)
      expect(contrastOnWhite(visual.fill), `${label} should remain readable on white`).toBeGreaterThanOrEqual(4.5)
      expect(visual.display).not.toBe('none')
      expect(visual).toMatchObject({ inside: true, opacity: 1, visibility: 'visible' })
    }
  })
}

test('Export PDF preserves the read-only Tiptap layout and formula geometry without opening a transient window', async ({ page }) => {
  const markdown = [
    '# Final and PDF parity',
    '',
    'This deliberately long paragraph verifies that Final Preview and the PDF capture surface use the same content width, typography, line height, and wrapping instead of drifting at export time. '.repeat(3).trim(),
    '',
    '!!#e6730d A!!!!!#00ff00 !!#0066cc B!!!!! with inline formula $E=mc^2$.',
    '',
    '$$',
    String.raw`\lim_{\Delta x \to 0} \frac{f(x+\Delta x)-f(x)}{\Delta x}`,
    '$$',
  ].join('\n')
  await openReadyApp(page)
  await page.setViewportSize({ height: 1000, width: 1440 })
  await selectEnglish(page)
  await setSource(page, markdown)
  await page.locator('[data-command-id="mode.preview"]').click()
  const preview = page.locator('.preview-rendered-content')
  await expect(preview.locator('.formula-node--inline .katex')).toHaveCount(1)
  await expect(preview.locator('.formula-node--block .katex-display')).toHaveCount(1)
  const previewMetrics = await preview.evaluate((content) => {
    const surface = content.closest<HTMLElement>('.preview-surface')
    const paragraph = content.querySelector<HTMLElement>('p')
    const inlineFormula = content.querySelector<HTMLElement>('.formula-node--inline')
    if (surface === null || paragraph === null || inlineFormula === null) throw new Error('Expected the complete Final layout fixture.')
    const surfaceStyle = getComputedStyle(surface)
    const paragraphStyle = getComputedStyle(paragraph)
    return {
      inlineFormulaHeight: inlineFormula.getBoundingClientRect().height,
      paragraphHeight: paragraph.getBoundingClientRect().height,
      paragraphLineHeight: paragraphStyle.lineHeight,
      paragraphWidth: paragraph.getBoundingClientRect().width,
      surfacePaddingInline: surfaceStyle.paddingInlineStart,
      surfaceWidth: surface.getBoundingClientRect().width,
    }
  })
  expect(previewMetrics.surfaceWidth).toBeCloseTo(960, 0)

  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      const host = document.querySelector<HTMLElement>('[data-presentation-engine="tiptap"].w-editor-export')
      if (host === null) return
      const paragraph = host.querySelector<HTMLElement>('p')
      const inlineFormula = host.querySelector<HTMLElement>('.formula-node--inline')
      if (paragraph === null || inlineFormula === null) return
      const hostStyle = getComputedStyle(host)
      const paragraphStyle = getComputedStyle(paragraph)
      document.documentElement.dataset['renderedExportProbe'] = JSON.stringify({
        formulaGeometryStyles: host.querySelectorAll('.katex [style]').length,
        hostClasses: [...host.classList],
        hostPaddingInline: hostStyle.paddingInlineStart,
        hostWidth: host.getBoundingClientRect().width,
        inlineFormulaHeight: inlineFormula.getBoundingClientRect().height,
        inlineFormulaCount: host.querySelectorAll('.formula-node--inline .katex').length,
        paragraphHeight: paragraph.getBoundingClientRect().height,
        paragraphLineHeight: paragraphStyle.lineHeight,
        paragraphWidth: paragraph.getBoundingClientRect().width,
        themeClasses: [...(host.closest('.rendered-document-theme')?.classList ?? [])],
      })
      observer.disconnect()
    })
    observer.observe(document.body, { attributes: true, childList: true, subtree: true })
  })

  let popupCount = 0
  page.on('popup', () => { popupCount += 1 })
  await page.locator('[data-toolbar-menu="export"] .toolbar-menu__trigger').click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-command-id="export.pdf"]').click(),
  ])
  const path = await download.path()
  if (path === null) throw new Error('PDF download did not produce a local file.')
  const bytes = await readFile(path)

  expect(popupCount).toBe(0)
  expect(download.suggestedFilename()).toBe('welcome.pdf')
  expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-')
  expect(bytes.toString('latin1').trimEnd().endsWith('%%EOF')).toBe(true)
  expect(bytes.byteLength).toBeGreaterThan(1_000)
  await expect.poll(() => page.evaluate(() => {
    const serialized = document.documentElement.dataset['renderedExportProbe']
    return serialized === undefined ? null : JSON.parse(serialized) as Record<string, unknown>
  })).not.toBeNull()
  const captured = await page.evaluate(() => JSON.parse(
    document.documentElement.dataset['renderedExportProbe'] ?? '{}',
  ) as {
    formulaGeometryStyles: number
    hostClasses: string[]
    hostPaddingInline: string
    hostWidth: number
    inlineFormulaCount: number
    inlineFormulaHeight: number
    paragraphHeight: number
    paragraphLineHeight: string
    paragraphWidth: number
    themeClasses: string[]
  })
  expect(captured.hostClasses).toEqual(expect.arrayContaining(['rendered-document-content', 'w-editor-export']))
  expect(captured.hostClasses).toEqual(expect.arrayContaining(['ProseMirror']))
  expect(captured.themeClasses).toEqual(expect.arrayContaining(['rendered-document-theme', 'w-editor-export-theme']))
  expect(captured.hostWidth).toBeCloseTo(previewMetrics.surfaceWidth, 0)
  expect(captured.hostPaddingInline).toBe(previewMetrics.surfacePaddingInline)
  expect(captured.paragraphLineHeight).toBe(previewMetrics.paragraphLineHeight)
  expect(captured.paragraphWidth).toBeCloseTo(previewMetrics.paragraphWidth, 0)
  expect(captured.paragraphHeight).toBeCloseTo(previewMetrics.paragraphHeight, 0)
  expect(captured.inlineFormulaHeight).toBeCloseTo(previewMetrics.inlineFormulaHeight, 0)
  expect(captured.inlineFormulaCount).toBe(1)
  expect(captured.formulaGeometryStyles).toBeGreaterThan(0)
  await expect(page.getByRole('status')).toContainText('PDF revision')
  await expect.poll(() => authorityMarkdown(page)).toBe(markdown)
})
