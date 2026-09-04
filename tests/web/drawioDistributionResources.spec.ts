import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createWebResourceLocator } from '../../packages/editor-web/src/index'

const distributionRoot = resolve(process.cwd(), 'packages/editor-web/dist')

describe('Web distribution draw.io resources', () => {
  it('ships the complete vendor closure and an exact-origin bridge locator', () => {
    const manifest = JSON.parse(readFileSync(resolve(distributionRoot, 'manifest.json'), 'utf8')) as {
      readonly drawio: Readonly<{ bridge: string; files: readonly string[]; lazy: boolean }>
    }
    expect(manifest.drawio.lazy).toBe(true)
    expect(manifest.drawio.bridge).toBe('drawio/bridge.html')
    expect(manifest.drawio.files.length).toBeGreaterThan(350)
    for (const file of ['drawio/bridge.html', 'drawio/bridge.js', 'drawio/drawio_demo.html', 'drawio/LICENSE', 'drawio/PROVENANCE.md']) {
      expect(existsSync(resolve(distributionRoot, file))).toBe(true)
      expect(manifest.drawio.files).toContain(file)
    }

    const bridge = readFileSync(resolve(distributionRoot, 'drawio/bridge.html'), 'utf8')
    expect(bridge).toContain('./bridge.js')
    expect(bridge).toContain('./drawio_demo.html')
    expect(bridge).not.toMatch(/(?:src|href)=['"]\//u)

    const locator = createWebResourceLocator({
      assetBaseUrl: '/static/vendor/w-editor/1.0.0/',
      baseUrl: 'https://host.example.test/blog/edit',
    })
    expect(locator.resolve('drawio/bridge.html')).toBe('https://host.example.test/static/vendor/w-editor/1.0.0/drawio/bridge.html')
    expect(locator.resolve('drawio/drawio_demo.html')).toBe('https://host.example.test/static/vendor/w-editor/1.0.0/drawio/drawio_demo.html')
  })
})
