import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = resolve('public/vendor/cherry-drawio')

function filesBelow(directory: string): readonly string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry)
    return statSync(path).isDirectory() ? filesBelow(path) : [path]
  })
}

describe('self-hosted Cherry draw.io resource bundle', () => {
  it('ships the pinned editor page, runtime, styles, resources, images, and provenance', () => {
    const required = [
      'drawio_demo.html',
      'assets/scripts/drawio-demo.js',
      'assets/drawio_lib/EditorUi.js',
      'assets/drawio_lib/grapheditor.css',
      'assets/drawio_lib/resources/zh.txt',
      'assets/drawio_lib/theme/default.xml',
      'assets/drawio_lib/image/stencils/basic.xml',
      'assets/mxgraph/mxClient.js',
      'LICENSE',
      'PROVENANCE.md',
    ]
    for (const path of required) expect(existsSync(resolve(ROOT, path)), path).toBe(true)
    expect(filesBelow(ROOT).length).toBeGreaterThan(340)

    const html = readFileSync(resolve(ROOT, 'drawio_demo.html'), 'utf8')
    expect(html).toContain('./assets/drawio_lib/grapheditor.css')
    expect(html).toContain('./assets/mxgraph/mxClient.js')
    expect(html).toContain('./assets/scripts/drawio-demo.js')
    expect(html).not.toMatch(/(?:src|href)=["']https?:\/\//u)

    const bridge = readFileSync(resolve(ROOT, 'assets/scripts/drawio-demo.js'), 'utf8')
    expect(bridge).toContain("eventName: 'ready'")
    expect(bridge).toContain("case 'setData'")
    expect(bridge).toContain("case 'getData'")
    expect(bridge).toContain("eventName: 'getData:success'")
    expect(bridge).toContain("EditorUi.prototype.convertImageToDataUri = function")
    expect(bridge).toContain("this.editor.convertImageToDataUri(source, callback)")

    const provenance = readFileSync(resolve(ROOT, 'PROVENANCE.md'), 'utf8')
    expect(provenance).toContain('9eba3371cce07c8ffcc422ccde1abdb961559f80')
    expect(provenance).toContain('cherry-markdown@0.11.9')
  })
})
