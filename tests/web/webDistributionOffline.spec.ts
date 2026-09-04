import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { WEB_BUNDLED_RUNTIME_DEPENDENCIES } from '../../packages/editor-web/src/publicEntry'

const distributionRoot = resolve(process.cwd(), 'packages/editor-web/dist')

function readJavaScriptClosure(entry: string): readonly string[] {
  const sources = new Map<string, string>()
  const pending = [entry]
  while (pending.length > 0) {
    const current = pending.pop()!
    if (sources.has(current)) continue
    const source = readFileSync(resolve(distributionRoot, current), 'utf8')
    sources.set(current, source)
    for (const match of source.matchAll(/(?:from|import\()\s*["'](\.[^"']+)["']/gu)) {
      const relativePath = match[1]
      if (relativePath === undefined) continue
      const normalized = resolve(distributionRoot, current, '..', relativePath)
      const relative = normalized.slice(distributionRoot.length + 1).replaceAll('\\', '/')
      pending.push(relative)
    }
  }
  return Object.freeze([...sources.values()])
}

describe('offline Web distribution dependencies', () => {
  it('reports the locked runtime versions and browser probes in the built entrypoints', () => {
    expect(WEB_BUNDLED_RUNTIME_DEPENDENCIES).toMatchObject({
      cherryMarkdown: '0.11.9',
      codeMirror: '6.0.2',
      katex: '0.16.47',
      tiptap: '3.30.2',
      vue: '3.5.41',
    })
    expect(WEB_BUNDLED_RUNTIME_DEPENDENCIES.probes).toEqual({
      codeMirrorBasicSetup: true,
      codeMirrorState: true,
      codeMirrorView: true,
      tiptapEditor: true,
      vueRuntime: true,
    })

    for (const file of ['editor.es.js', 'renderer.es.js', 'w-editor.global.js']) {
      const sources = readJavaScriptClosure(file)
      expect(sources.join('\n')).toContain('0.11.9')
      for (const source of sources) {
        expect(source).not.toMatch(/from ['"](?:vue|@w-editor\/editor-(?:core|vue)|@tiptap|@codemirror|cherry-markdown|katex|codemirror)['"]/u)
      }
    }
  })
})
