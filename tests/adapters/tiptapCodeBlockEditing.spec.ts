import { afterEach, describe, expect, it } from 'vitest'

import {
  CherryRenderAdapter,
  TiptapTransactionPatchPlanner,
  TiptapVisualAdapter,
  serializeOrdinaryTiptapPatch,
} from '../../src/adapters'
import { projectOrdinaryMarkdown, serializeFencedCode } from '../../src/codecs'
import { DocumentSession, type PatchPlan } from '../../src/core'

const ORIGINAL = '```javascript\nconst value = 1\n```'
const adapters: TiptapVisualAdapter[] = []

afterEach(() => {
  while (adapters.length > 0) adapters.pop()?.destroy()
  document.body.replaceChildren()
})

describe('code-block apply synchronization', () => {
  it('applies safely, persists/reloads, renders in Cherry, and undoes in one step', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: 'code-edit', markdown: ORIGINAL })
    const plans: PatchPlan[] = []
    let sequence = 0
    const adapter = new TiptapVisualAdapter({
      host,
      onTransaction: ({ patchPlan }) => {
        if (patchPlan !== null) plans.push(patchPlan)
      },
      patchPlanner: new TiptapTransactionPatchPlanner({
        createTransactionId: () => `code-edit:${++sequence}`,
        serialize: serializeOrdinaryTiptapPatch,
      }),
      project: projectOrdinaryMarkdown,
      session,
    })
    adapters.push(adapter)
    host.querySelector<HTMLButtonElement>('[data-semantic-edit="code-block-editor"]')?.click()
    const code = 'const ticks = ````\nconsole.log(ticks)'
    const replacement = serializeFencedCode('typescript', code)

    expect(adapter.applySemanticBlock({
      body: code,
      code,
      editorId: 'code-block-editor',
      identity: 'Code · typescript',
      kind: 'code-block',
      language: 'typescript',
      source: replacement,
    })).toEqual({ active: true, changed: true })
    expect(replacement.startsWith('`````typescript')).toBe(true)
    expect(plans).toHaveLength(1)
    expect(plans[0]?.patches).toEqual([{
      codecId: 'fenced-code',
      expected: ORIGINAL,
      from: 0,
      replacement,
      to: ORIGINAL.length,
    }])
    session.commitPatchPlan(plans[0]!)
    adapter.acknowledgeSynchronization({ map: projectOrdinaryMarkdown(session.snapshot()).map, snapshot: session.snapshot() })
    expect(session.snapshot()).toMatchObject({ markdown: replacement, revision: 1 })

    const reloadHost = document.createElement('div')
    document.body.append(reloadHost)
    const reloaded = new TiptapVisualAdapter({ host: reloadHost, project: projectOrdinaryMarkdown, session })
    adapters.push(reloaded)
    expect(reloaded.documentJSON().content?.[0]).toMatchObject({
      attrs: { language: 'typescript' },
      content: [{ text: code, type: 'text' }],
      type: 'codeBlock',
    })
    const html = new CherryRenderAdapter().render(session.snapshot()).html
    expect(html).toContain('language-typescript')
    expect(html).toContain('>console</span>')
    expect(html).toContain('>log</span>')

    expect(adapter.undo()).toBe(true)
    expect(plans).toHaveLength(2)
    expect(plans[1]?.patches[0]?.replacement).toBe(ORIGINAL)
    session.commitPatchPlan(plans[1]!)
    adapter.acknowledgeSynchronization({ map: projectOrdinaryMarkdown(session.snapshot()).map, snapshot: session.snapshot() })
    expect(session.snapshot().markdown).toBe(ORIGINAL)
  })

  it('keeps preview errors local and outside content history', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: 'code-error', markdown: ORIGINAL })
    const adapter = new TiptapVisualAdapter({ host, project: projectOrdinaryMarkdown, session })
    adapters.push(adapter)
    host.querySelector<HTMLButtonElement>('[data-semantic-edit="code-block-editor"]')?.click()
    expect(adapter.setSelectedSemanticLocalError('Language renderer unavailable.')).toBe(true)
    expect(host.querySelector('[data-w-editor-node="code-block"]')?.getAttribute('data-preview-state')).toBe('error')
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Language renderer unavailable.')
    expect(session.snapshot()).toMatchObject({ markdown: ORIGINAL, revision: 0 })
    expect(adapter.undo()).toBe(false)
  })
})
