import { describe, expect, it } from 'vitest'

import { MermaidPreviewRenderer, sanitizeMermaidSvg } from '../../src/adapters'

describe('Mermaid SVG sanitation', () => {
  it('keeps an SVG preview while removing executable markup and links', () => {
    const result = sanitizeMermaidSvg(
      '<svg onload="run()"><script>run()</script><foreignObject><div>unsafe</div></foreignObject><a href="javascript:run()"><text>Safe label</text></a></svg>',
    )
    const host = document.createElement('div')
    host.innerHTML = result
    expect(host.querySelector('svg')).not.toBeNull()
    expect(host.querySelector('text')?.textContent).toBe('Safe label')
    expect(host.querySelector('script')).toBeNull()
    expect(host.querySelector('foreignObject')).toBeNull()
    expect(host.querySelector('[onload]')).toBeNull()
    expect(host.querySelector('a')?.getAttribute('href')).toBeNull()
  })

  it('rejects renderer output without an SVG root', () => {
    expect(() => sanitizeMermaidSvg('<p>not an svg</p>')).toThrow('Mermaid did not return an SVG preview.')
  })

  it('renders flowchart labels as safe SVG text instead of forbidden foreignObject content', async () => {
    const originalGetBBox = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getBBox')
    const originalGetComputedTextLength = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getComputedTextLength')
    Object.defineProperty(SVGElement.prototype, 'getBBox', {
      configurable: true,
      value: () => ({ height: 16, width: 100, x: 0, y: 0 }),
    })
    Object.defineProperty(SVGElement.prototype, 'getComputedTextLength', {
      configurable: true,
      value: () => 100,
    })
    try {
      const result = await new MermaidPreviewRenderer().render('flowchart TD\nA[Flow label] --> B[Done]')
      const host = document.createElement('div')
      host.innerHTML = result

      expect(host.querySelector('foreignObject')).toBeNull()
      expect(host.querySelector('svg')?.textContent).toContain('Flow label')
      expect(host.querySelector('svg')?.textContent).toContain('Done')
    } finally {
      if (originalGetBBox === undefined) Reflect.deleteProperty(SVGElement.prototype, 'getBBox')
      else Object.defineProperty(SVGElement.prototype, 'getBBox', originalGetBBox)
      if (originalGetComputedTextLength === undefined) Reflect.deleteProperty(SVGElement.prototype, 'getComputedTextLength')
      else Object.defineProperty(SVGElement.prototype, 'getComputedTextLength', originalGetComputedTextLength)
    }
  })

  it('renders a deterministic Gantt SVG without negative rectangle geometry', async () => {
    const originalGetBBox = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getBBox')
    Object.defineProperty(SVGElement.prototype, 'getBBox', {
      configurable: true,
      value: () => ({ height: 16, width: 100, x: 0, y: 0 }),
    })
    try {
      const result = await new MermaidPreviewRenderer().render([
        'gantt',
        '  title Example plan',
        '  dateFormat YYYY-MM-DD',
        '  section Work',
        '  Draft :2026-01-01, 2d',
      ].join('\n'))
      const host = document.createElement('div')
      host.innerHTML = result
      const svg = host.querySelector('svg')
      expect(svg).not.toBeNull()
      expect(svg?.getAttribute('viewBox')).toMatch(/^0 0 800 /u)
      const widths = [...host.querySelectorAll<SVGRectElement>('rect[width]')]
        .map((rect) => Number.parseFloat(rect.getAttribute('width') ?? 'NaN'))
        .filter(Number.isFinite)
      expect(widths.length).toBeGreaterThan(0)
      expect(widths.every((width) => width >= 0)).toBe(true)
    } finally {
      if (originalGetBBox === undefined) Reflect.deleteProperty(SVGElement.prototype, 'getBBox')
      else Object.defineProperty(SVGElement.prototype, 'getBBox', originalGetBBox)
    }
  })
})
