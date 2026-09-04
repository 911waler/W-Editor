import type { Locator, Page } from '@playwright/test'

import { panelSource, serializeFormula } from '../src/codecs'
import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

const PARAGRAPH = '啊'.repeat(72)
const MARKDOWN = [
  '# 一级标题',
  '## 二级标题',
  '### 三级标题',
  '#### 四级标题',
  `!32 啊!!24 啊!啊啊 [链接](https://example.com) 与行内公式 ${serializeFormula('inline', String.raw`E = mc^2`)}`,
  '!!#0066cc 啊!!!!#e6730d 啊!!啊啊',
  ...Array.from({ length: 8 }, () => PARAGRAPH),
  serializeFormula('block', String.raw`\lim_{\Delta x \to 0} \frac{f(x + \Delta x) - f(x)}{\Delta x}`),
  panelSource({ body: 'Add helpful guidance here.', title: 'Tips', variant: 'info' }),
].join('\n\n')

interface HeadingGeometry {
  readonly fontSize: string
  readonly lineHeight: string
  readonly marginBottom: string
  readonly marginTop: string
}

async function headingGeometry(locator: Locator): Promise<HeadingGeometry[]> {
  return locator.evaluateAll((headings) => headings.map((heading) => {
    const style = getComputedStyle(heading)
    return {
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      marginBottom: style.marginBottom,
      marginTop: style.marginTop,
    }
  }))
}

async function authorityMarkdown(page: Page): Promise<string | undefined> {
  return page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().markdown)
}

test('Final Preview keeps the representative Tiptap document in the same Visual document flow', async ({ page }) => {
  await page.setViewportSize({ height: 1000, width: 1440 })
  await openReadyApp(page)
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('.cm-content[contenteditable="true"]').fill(MARKDOWN)
  await expect.poll(() => authorityMarkdown(page)).toBe(MARKDOWN)

  await page.locator('[data-command-id="mode.visual"]').click()
  const visualHeadings = page.locator('.visual-surface .ProseMirror > :is(h1, h2, h3, h4)')
  await expect(visualHeadings).toHaveCount(4)
  const visualHeadingGeometry = await headingGeometry(visualHeadings)

  await page.locator('[data-command-id="mode.preview"]').click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'preview')
  const content = page.locator('.preview-rendered-content')
  await expect(content).toBeVisible()
  await expect(content).toHaveClass(/\bProseMirror\b/u)
  await expect(content).toHaveAttribute('data-presentation-engine', 'tiptap')
  await expect.poll(() => content.evaluate((element) => getComputedStyle(element).display)).toBe('block')

  const finalHeadings = content.locator(':scope > :is(h1, h2, h3, h4)')
  await expect(finalHeadings).toHaveCount(4)
  expect(await headingGeometry(finalHeadings)).toEqual(visualHeadingGeometry)

  await expect(content.locator('[style*="font-size: 32px"]')).toBeVisible()
  await expect(content.locator('[style*="font-size: 24px"]')).toBeVisible()
  await expect(content.locator('[style*="color: rgb(0, 102, 204)"]')).toBeVisible()
  await expect(content.locator('[style*="color: rgb(230, 115, 13)"]')).toBeVisible()
  await expect(content.locator('.formula-node--inline')).toBeVisible()
  await expect(content.locator('.formula-node--block')).toBeVisible()
  await expect(content.locator('[data-semantic-kind="panel"][data-semantic-variant="info"]')).toContainText('Tips')
  await expect(content.locator('[data-semantic-kind="panel"][data-semantic-variant="info"]')).toContainText('Add helpful guidance here.')

  const blocks = await content.locator(':scope > *').evaluateAll((elements) => elements
    .map((element) => {
      const rect = element.getBoundingClientRect()
      return {
        bottom: rect.bottom,
        tag: element.tagName.toLowerCase(),
        text: (element.textContent ?? '').trim().slice(0, 24),
        top: rect.top,
      }
    })
    .filter(({ bottom, top }) => bottom > top))
  expect(blocks.length).toBeGreaterThanOrEqual(15)
  for (let index = 1; index < blocks.length; index += 1) {
    expect.soft(blocks[index]?.top, `${blocks[index - 1]?.tag} -> ${blocks[index]?.tag}: ${blocks[index]?.text}`)
      .toBeGreaterThanOrEqual((blocks[index - 1]?.bottom ?? 0) - 0.5)
  }
})
