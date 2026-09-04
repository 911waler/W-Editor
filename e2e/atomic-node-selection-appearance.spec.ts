import type { Locator, Page } from '@playwright/test'

import {
  disclosureSource,
  mediaSource,
  panelSource,
  serializeFormula,
  timelineStarterSource,
} from '../src/codecs'
import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

const MARKDOWN = [
  panelSource({ body: 'Add helpful guidance here.', title: 'Tips', variant: 'info' }),
  mediaSource('image', 'Sample image', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),
  serializeFormula('block', String.raw`x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`),
  '| :map:{"title": "Map Table"} | Value |\n| :-: | :-: |\n| Beijing | 120 |\n| Shanghai | 280 |',
  timelineStarterSource(),
  disclosureSource('accordion', [{ body: 'Expandable content', label: 'Details' }]),
  'Ordinary selectable paragraph',
].join('\n\n')

async function authorityMarkdown(page: Page): Promise<string | undefined> {
  return page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().markdown)
}

async function openVisualMarkdown(page: Page): Promise<void> {
  await openReadyApp(page)
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('.cm-content[contenteditable="true"]').fill(MARKDOWN)
  await expect.poll(() => authorityMarkdown(page)).toBe(MARKDOWN)
  await page.locator('[data-command-id="mode.visual"]').click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'visual')
}

async function selectAtomicNode(node: Locator): Promise<void> {
  const box = await node.boundingBox()
  expect(box).not.toBeNull()
  await node.click({ position: { x: 4, y: Math.min(4, (box?.height ?? 8) / 2) } })
  await expect(node).toHaveAttribute('data-selected', 'true')
}

test('atomic visual nodes use edge emphasis without painting their descendant text as selected', async ({ page }) => {
  await page.setViewportSize({ height: 1100, width: 1440 })
  await openVisualMarkdown(page)

  const nodes = [
    page.locator('.ProseMirror [data-semantic-kind="panel"]'),
    page.locator('.ProseMirror [data-semantic-kind="media"]'),
    page.locator('.ProseMirror .formula-node--block'),
    page.locator('.ProseMirror [data-semantic-kind="chart-table"]'),
    page.locator('.ProseMirror [data-semantic-kind="timeline"]'),
    page.locator('.ProseMirror [data-semantic-kind="disclosure"]'),
  ]

  for (const node of nodes) {
    await expect(node).toBeVisible()
    await selectAtomicNode(node)
    const appearance = await node.evaluate((element) => {
      const root = element as HTMLElement
      const descendant = [...root.querySelectorAll<HTMLElement>('*')]
        .find((candidate) => (candidate.textContent ?? '').trim().length > 0)
      const style = getComputedStyle(root)
      return {
        boxShadow: style.boxShadow,
        descendantUserSelect: descendant === undefined ? null : getComputedStyle(descendant).userSelect,
        outlineColor: style.outlineColor,
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        rootUserSelect: style.userSelect,
      }
    })

    expect(appearance).toMatchObject({
      descendantUserSelect: 'none',
      outlineColor: 'rgb(47, 118, 89)',
      outlineStyle: 'solid',
      outlineWidth: '2px',
      rootUserSelect: 'none',
    })
    expect(appearance.boxShadow).toContain('rgba(47, 118, 89')
  }

  const paragraph = page.locator('.ProseMirror > p', { hasText: 'Ordinary selectable paragraph' })
  await paragraph.click()
  await expect.poll(() => paragraph.evaluate((element) => getComputedStyle(element).userSelect)).not.toBe('none')
})
