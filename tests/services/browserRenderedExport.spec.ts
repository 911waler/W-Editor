import { describe, expect, it, vi } from 'vitest'
import { inflateSync } from 'node:zlib'

import {
  BrowserRenderedExportAdapter,
  assertLongScreenshotSize,
  createTiptapRenderedExportDocument,
  planPdfPageSlices,
  settleRenderedAssets,
  type SafeRenderedExportDocument,
} from '../../src/services'

const rendered = Object.freeze({
  bodyHtml: '<h1>Safe export</h1><p>Rendered revision.</p>',
  documentId: 'welcome',
  revision: 7,
}) satisfies SafeRenderedExportDocument

const PNG_BYTES = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
))

function inflatePdfStreams(source: string): string {
  return Array.from(source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/gu), (match) => {
    const stream = match[1]
    if (stream === undefined) return ''
    try {
      return inflateSync(Buffer.from(stream, 'latin1')).toString('latin1')
    } catch {
      return ''
    }
  }).join('\n')
}

describe('browser rendered export adapter', () => {
  it('uses nearby safe block boundaries instead of splitting PDF pages at the hard height limit', () => {
    expect(planPdfPageSlices(3_000, 1_000, [900, 1_800, 2_700])).toEqual([
      { height: 900, start: 0 },
      { height: 900, start: 900 },
      { height: 900, start: 1_800 },
      { height: 300, start: 2_700 },
    ])
  })

  it('captures the safe rendered document as a downloadable multi-page PDF artifact without opening a window', async () => {
    const capture = vi.fn(async () => new Blob([PNG_BYTES], { type: 'image/png' }))
    const assetSettler = vi.fn(async () => undefined)
    const adapter = new BrowserRenderedExportAdapter({
      assetSettler,
      capture,
      document,
      fetcher: vi.fn(),
      measure: () => ({ height: 2400, width: 900 }),
      window,
    })

    const artifact = await adapter.capturePdf(rendered)
    const bytes = Buffer.from(await artifact.blob.arrayBuffer())
    const source = bytes.toString('latin1')
    const contentStreams = inflatePdfStreams(source)

    expect(artifact).toMatchObject({ filename: 'welcome.pdf', mediaType: 'application/pdf', revision: 7 })
    expect(artifact.omittedRemoteImageCount).toBe(0)
    expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-')
    expect(source.trimEnd().endsWith('%%EOF')).toBe(true)
    expect(source.match(/\/Type \/Page\b/gu)).toHaveLength(2)
    expect(contentStreams).toMatch(/\sre\nW\nn\n/)
    expect(contentStreams).not.toMatch(/\sre\nS\nW\nn\n/)
    expect(assetSettler).toHaveBeenCalledOnce()
    expect(capture).toHaveBeenCalledOnce()
    expect(document.querySelector('[data-document-id="welcome"]')).toBeNull()
  })

  it('reports PDF encoding failures and always removes the capture host', async () => {
    const adapter = new BrowserRenderedExportAdapter({
      assetSettler: async () => undefined,
      capture: async () => new Blob(['not a PNG'], { type: 'image/png' }),
      document,
      measure: () => ({ height: 600, width: 900 }),
      window,
    })

    await expect(adapter.capturePdf(rendered)).rejects.toMatchObject({ code: 'PDF_FAILED' })
    expect(document.querySelector('[data-document-id="welcome"]')).toBeNull()
  })

  it('captures the complete settled rendered surface as one PNG artifact and always removes its host', async () => {
    const capture = vi.fn(async (node: HTMLElement, options: Record<string, unknown>) => {
      expect(document.body.contains(node)).toBe(true)
      expect(node.innerHTML).toContain('<h1>Safe export</h1>')
      expect(node.classList).toContain('rendered-document-content')
      expect(node.parentElement?.classList).toContain('rendered-document-theme')
      expect(node.parentElement?.classList).toContain('theme__abyss')
      expect(node.closest<HTMLElement>('.w-editor-instance')?.style.getPropertyValue('--w-editor-line-height')).toBe('2')
      expect(node.style.width).toBe('960px')
      expect(node.parentElement?.style.width).toBe('960px')
      expect(options).toMatchObject({ canvasHeight: 2400, canvasWidth: 900, height: 2400, pixelRatio: 1, width: 900 })
      return new Blob(['png'], { type: 'image/png' })
    })
    const assetSettler = vi.fn(async () => undefined)
    const adapter = new BrowserRenderedExportAdapter({
      assetSettler,
      capture,
      document,
      fetcher: vi.fn(),
      measure: () => ({ height: 2400, width: 900 }),
      window,
    })

    const artifact = await adapter.captureLongScreenshot({ ...rendered, lineHeight: 2, theme: 'abyss' })

    expect(artifact).toMatchObject({ filename: 'welcome.png', mediaType: 'image/png', revision: 7 })
    expect(artifact.omittedRemoteImageCount).toBe(0)
    expect(assetSettler).toHaveBeenCalledOnce()
    expect(capture).toHaveBeenCalledOnce()
    expect(document.querySelector('[data-document-id="welcome"][data-revision="7"]')).toBeNull()
  })

  it('captures a Tiptap presentation without re-running Cherry hydration', async () => {
    const hydrateRenderedContent = vi.fn(() => vi.fn())
    const capture = vi.fn(async (node: HTMLElement) => {
      expect(node.classList).toContain('ProseMirror')
      expect(node.dataset['presentationEngine']).toBe('tiptap')
      expect(node.querySelector('.formula-node--inline .katex')).not.toBeNull()
      return new Blob(['png'], { type: 'image/png' })
    })
    const adapter = new BrowserRenderedExportAdapter({
      assetSettler: async () => undefined,
      capture,
      document,
      hydrateRenderedContent,
      measure: () => ({ height: 600, width: 900 }),
      window,
    })

    await adapter.captureLongScreenshot({
      ...rendered,
      bodyHtml: '<span class="formula-node formula-node--inline"><span class="katex">E=mc²</span></span>',
      presentationEngine: 'tiptap',
    })

    expect(hydrateRenderedContent).not.toHaveBeenCalled()
    expect(capture).toHaveBeenCalledOnce()
  })

  it('mounts and settles the canonical live Tiptap presentation before PDF capture', async () => {
    const dispose = vi.fn()
    const mountPresentation = vi.fn(async (container: HTMLElement) => {
      const surface = document.createElement('article')
      surface.dataset['tiptapPresentation'] = ''
      const root = document.createElement('div')
      root.className = 'tiptap ProseMirror'
      root.dataset['presentationEngine'] = 'tiptap'
      root.textContent = 'Live canonical presentation'
      surface.append(root)
      container.append(surface)
      return Object.freeze({ dispose, root })
    })
    const capture = vi.fn(async (node: HTMLElement) => {
      expect(node.classList).toContain('ProseMirror')
      expect(node.textContent).toBe('Live canonical presentation')
      return new Blob([PNG_BYTES], { type: 'image/png' })
    })
    const adapter = new BrowserRenderedExportAdapter({
      assetSettler: async () => undefined,
      capture,
      document,
      measure: () => ({ height: 600, width: 900 }),
      window,
    })
    const live = Object.freeze({
      ...rendered,
      bodyHtml: '',
      mountPresentation,
      presentationEngine: 'tiptap' as const,
    }) as SafeRenderedExportDocument & Readonly<{ mountPresentation: typeof mountPresentation }>

    await adapter.capturePdf(live)

    expect(mountPresentation).toHaveBeenCalledOnce()
    expect(capture).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('captures the real canonical Tiptap factory with formula hydration and one raw fallback', async () => {
    const snapshot = Object.freeze({
      documentId: 'canonical-live',
      markdown: '# Canonical\n\nInline $E=mc^2$.\n\n::: mystery\nFallback body\n:::',
      revision: 4,
    })
    const capture = vi.fn(async (node: HTMLElement) => {
      expect(node.classList).toContain('ProseMirror')
      expect(node.dataset['presentationEngine']).toBe('tiptap')
      expect(node.querySelector('h1')?.textContent).toBe('Canonical')
      expect(node.querySelector('.formula-node--inline .katex')).not.toBeNull()
      expect(node.querySelectorAll('[data-w-editor-presentation-fallback="cherry-raw"]')).toHaveLength(1)
      expect(node.querySelector('[data-w-editor-node="raw-block"]')).toBeNull()
      return new Blob([PNG_BYTES], { type: 'image/png' })
    })
    const adapter = new BrowserRenderedExportAdapter({
      assetSettler: async () => undefined,
      capture,
      document,
      measure: () => ({ height: 600, width: 900 }),
      window,
    })

    await adapter.capturePdf(createTiptapRenderedExportDocument(snapshot, {
      lineHeight: 1.75,
      locale: 'zh',
      theme: 'gray',
    }))

    expect(capture).toHaveBeenCalledOnce()
    expect(document.querySelector('[data-tiptap-presentation]')).toBeNull()
  }, 30_000)

  it('rejects dimensions beyond the browser-safe canvas boundary before capture', async () => {
    expect(() => assertLongScreenshotSize(900, 100_000)).toThrow(expect.objectContaining({ code: 'CAPTURE_OVERSIZE' }))
    const capture = vi.fn()
    const adapter = new BrowserRenderedExportAdapter({
      assetSettler: async () => undefined,
      capture,
      document,
      measure: () => ({ height: 100_000, width: 900 }),
      window,
    })
    await expect(adapter.captureLongScreenshot(rendered)).rejects.toMatchObject({ code: 'CAPTURE_OVERSIZE' })
    expect(capture).not.toHaveBeenCalled()
    expect(document.querySelector('[data-document-id="welcome"]')).toBeNull()
  })

  it('replaces an uncapturable cross-origin image visibly and reports the omission on the artifact', async () => {
    const withRemoteImage = { ...rendered, bodyHtml: '<img src="https://cdn.example.test/image.png" alt="remote">' }
    const capture = vi.fn(async (node: HTMLElement) => {
      expect(node.querySelector('img')).toBeNull()
      expect(node.querySelector('[data-export-omitted-image="remote"]')?.textContent).toContain('remote')
      expect(node.querySelector('[data-export-omitted-image="remote"]')?.textContent).toContain('cdn.example.test')
      return new Blob(['png'], { type: 'image/png' })
    })
    const adapter = new BrowserRenderedExportAdapter({
      assetSettler: async () => undefined,
      capture,
      document,
      fetcher: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
      measure: () => ({ height: 600, width: 900 }),
      window,
    })
    const artifact = await adapter.captureLongScreenshot(withRemoteImage)

    expect(artifact.omittedRemoteImageCount).toBe(1)
    expect(capture).toHaveBeenCalledOnce()
    expect(document.querySelector('[data-document-id="welcome"]')).toBeNull()
  })

  it('embeds a CORS-readable remote image instead of reporting an omission', async () => {
    const withRemoteImage = { ...rendered, bodyHtml: '<img src="https://cdn.example.test/image.png" alt="remote">' }
    const readAsDataUrl = vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
      Object.defineProperty(this, 'result', {
        configurable: true,
        value: 'data:image/png;base64,iVBORw0KGgo=',
      })
      this.dispatchEvent(new Event('load'))
    })
    const fetcher = vi.fn(async () => ({
      blob: async () => new Blob([PNG_BYTES], { type: 'image/png' }),
      ok: true,
    }) as Response)
    const capture = vi.fn(async (node: HTMLElement) => {
      expect(node.querySelector('img')?.src).toMatch(/^data:image\/png;base64,/u)
      expect(node.querySelector('[data-export-omitted-image]')).toBeNull()
      return new Blob(['png'], { type: 'image/png' })
    })
    const adapter = new BrowserRenderedExportAdapter({
      assetSettler: async () => undefined,
      capture,
      document,
      fetcher,
      measure: () => ({ height: 600, width: 900 }),
      window,
    })

    try {
      const artifact = await adapter.captureLongScreenshot(withRemoteImage)

      expect(fetcher).toHaveBeenCalledOnce()
      expect(artifact.omittedRemoteImageCount).toBe(0)
      expect(capture).toHaveBeenCalledOnce()
    } finally {
      readAsDataUrl.mockRestore()
    }
  })

  it('still reports a genuine tainted-canvas failure explicitly', async () => {
    const tainted = new BrowserRenderedExportAdapter({
      assetSettler: async () => undefined,
      capture: vi.fn().mockRejectedValue(new DOMException('The canvas has been tainted.', 'SecurityError')),
      document,
      measure: () => ({ height: 600, width: 900 }),
      window,
    })
    await expect(tainted.captureLongScreenshot(rendered)).rejects.toMatchObject({ code: 'CROSS_ORIGIN_TAINT' })
    expect(document.querySelector('[data-document-id="welcome"]')).toBeNull()
  })

  it('waits for image load and exposes broken assets instead of capturing incomplete output', async () => {
    const root = document.createElement('div')
    const pending = document.createElement('img')
    pending.src = '/pending.png'
    Object.defineProperty(pending, 'complete', { configurable: true, get: () => false })
    root.append(pending)
    const settled = settleRenderedAssets(root, 100)
    pending.dispatchEvent(new Event('load'))
    await expect(settled).resolves.toBeUndefined()

    const broken = document.createElement('img')
    broken.src = '/broken.png'
    Object.defineProperty(broken, 'complete', { configurable: true, get: () => true })
    Object.defineProperty(broken, 'naturalWidth', { configurable: true, get: () => 0 })
    root.replaceChildren(broken)
    await expect(settleRenderedAssets(root, 100)).rejects.toMatchObject({ code: 'ASSET_SETTLING_FAILED' })
  })
})
