import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  TiptapTransactionPatchPlanner,
  TiptapVisualAdapter,
  serializeOrdinaryTiptapPatch,
  type MermaidPreviewRendererContract,
} from '../../src/adapters'
import { mermaidSource, mermaidStarterSource, projectOrdinaryMarkdown } from '../../src/codecs'
import { DocumentSession, type PatchPlan } from '../../src/core'

const adapters: TiptapVisualAdapter[] = []

afterEach(() => {
  while (adapters.length > 0) adapters.pop()?.destroy()
  document.body.replaceChildren()
})

function renderer(): MermaidPreviewRendererContract & { readonly render: ReturnType<typeof vi.fn> } {
  return {
    render: vi.fn(async (source: string) => {
      if (source.startsWith('not valid')) throw new Error('UnknownDiagramError')
      return `<svg data-rendered-source="${source.split('\n')[0]}"></svg>`
    }),
  }
}

describe('Mermaid preview and source editing', () => {
  it('replaces the empty visual placeholder with one exact Mermaid block', () => {
    const source = mermaidStarterSource('mermaid.flowchart')
    const parsedCode = 'flowchart LR\n  Start([Start]) --> Finish([Finish])'
    const host = document.createElement('div')
    document.body.append(host)
    const plans: PatchPlan[] = []
    const session = new DocumentSession({ documentId: 'mermaid-empty-insert', markdown: '' })
    const adapter = new TiptapVisualAdapter({
      host,
      mermaidRenderer: renderer(),
      onTransaction: ({ patchPlan }) => {
        if (patchPlan !== null) plans.push(patchPlan)
      },
      patchPlanner: new TiptapTransactionPatchPlanner({
        createTransactionId: () => 'mermaid-empty-insert:1',
        serialize: serializeOrdinaryTiptapPatch,
      }),
      project: projectOrdinaryMarkdown,
      session,
    })
    adapters.push(adapter)

    expect(adapter.applySemanticBlock({
      body: parsedCode,
      code: parsedCode,
      diagramType: 'flowchart',
      editorId: 'mermaid-editor',
      identity: 'Flowchart Mermaid',
      kind: 'mermaid',
      source,
    })).toEqual({ active: true, changed: true })
    expect(plans).toHaveLength(1)
    expect(plans[0]?.patches[0]).toMatchObject({ from: 0, replacement: source, to: 0 })
  })

  it('renders a valid diagram and emits its exact typed source through the common edit control', async () => {
    const source = mermaidStarterSource('mermaid.flowchart')
    const host = document.createElement('div')
    document.body.append(host)
    const previewRenderer = renderer()
    const onSemanticEdit = vi.fn()
    const session = new DocumentSession({ documentId: 'mermaid-preview', markdown: source })
    const adapter = new TiptapVisualAdapter({
      host,
      mermaidRenderer: previewRenderer,
      onSemanticEdit,
      project: projectOrdinaryMarkdown,
      session,
    })
    adapters.push(adapter)

    await vi.waitFor(() => {
      expect(host.querySelector('[data-semantic-kind="mermaid"]')?.getAttribute('data-preview-state')).toBe('ready')
      expect(host.querySelector('.semantic-preview__mermaid-rendered svg')).not.toBeNull()
    })
    expect(previewRenderer.render).toHaveBeenCalledWith('flowchart LR\n  Start([Start]) --> Finish([Finish])')

    host.querySelector<HTMLButtonElement>('[data-semantic-edit="mermaid-editor"]')?.click()
    expect(onSemanticEdit).toHaveBeenCalledWith({
      code: 'flowchart LR\n  Start([Start]) --> Finish([Finish])',
      diagramType: 'flowchart',
      editorId: 'mermaid-editor',
      kind: 'mermaid',
      layoutKind: null,
      source,
    })
    expect(session.snapshot().revision).toBe(0)
  })

  it('applies one exact source patch and refreshes the rendered preview', async () => {
    const original = mermaidStarterSource('mermaid.sequence')
    const replacementCode = 'sequenceDiagram\n  Alice->>Bob: Updated'
    const replacement = mermaidSource(replacementCode)
    const host = document.createElement('div')
    document.body.append(host)
    const previewRenderer = renderer()
    const plans: PatchPlan[] = []
    const session = new DocumentSession({ documentId: 'mermaid-apply', markdown: original })
    const adapter = new TiptapVisualAdapter({
      host,
      mermaidRenderer: previewRenderer,
      onTransaction: ({ patchPlan }) => {
        if (patchPlan !== null) plans.push(patchPlan)
      },
      patchPlanner: new TiptapTransactionPatchPlanner({
        createTransactionId: () => `mermaid-apply:${plans.length + 1}`,
        serialize: serializeOrdinaryTiptapPatch,
      }),
      project: projectOrdinaryMarkdown,
      session,
    })
    adapters.push(adapter)
    host.querySelector<HTMLButtonElement>('[data-semantic-edit="mermaid-editor"]')?.click()

    expect(adapter.applySemanticBlock({
      body: replacementCode,
      code: replacementCode,
      diagramType: 'sequence',
      editorId: 'mermaid-editor',
      identity: 'Sequence diagram Mermaid',
      kind: 'mermaid',
      source: replacement,
    })).toEqual({ active: true, changed: true })
    expect(plans).toHaveLength(1)
    expect(plans[0]?.patches).toEqual([{
      codecId: 'mermaid-sequence',
      expected: original,
      from: 0,
      replacement,
      to: original.length,
    }])
    await vi.waitFor(() => {
      expect(previewRenderer.render).toHaveBeenCalledWith(replacementCode)
      expect(host.querySelector('.semantic-preview__mermaid-rendered svg')?.getAttribute('data-rendered-source')).toBe('sequenceDiagram')
    })
  })

  it('retains invalid imported source with a local preview error', async () => {
    const invalid = mermaidSource('not valid\n  still exact')
    const markdown = `Before\n\n${invalid}\n\nAfter`
    const host = document.createElement('div')
    document.body.append(host)
    const previewRenderer = renderer()
    const session = new DocumentSession({ documentId: 'mermaid-invalid', markdown })
    const adapter = new TiptapVisualAdapter({
      host,
      mermaidRenderer: previewRenderer,
      project: projectOrdinaryMarkdown,
      session,
    })
    adapters.push(adapter)

    expect(adapter.documentJSON().content?.map((node) => node.type)).toEqual([
      'paragraph',
      'semanticBlock',
      'paragraph',
    ])
    expect(adapter.documentJSON().content?.[1]).toMatchObject({
      attrs: { code: 'not valid\n  still exact', diagramType: null, kind: 'mermaid', source: invalid },
      type: 'semanticBlock',
    })
    await vi.waitFor(() => {
      expect(host.querySelector('[data-semantic-kind="mermaid"]')?.getAttribute('data-preview-state')).toBe('error')
      expect(host.querySelector('[data-semantic-kind="mermaid"] [role="alert"]')?.textContent)
        .toBe('Mermaid preview failed: UnknownDiagramError')
    })
    expect(host.querySelector('[data-semantic-edit="mermaid-editor"]')).not.toBeNull()
    expect(session.snapshot()).toEqual({ documentId: 'mermaid-invalid', markdown, revision: 0 })
    expect(adapter.undo()).toBe(false)
  })

  it('applies invalid source exactly, contains the failure locally, and reloads it as editable Mermaid', async () => {
    const original = mermaidStarterSource('mermaid.flowchart')
    const invalidCode = 'not valid\n  preserved verbatim'
    const invalid = mermaidSource(invalidCode)
    const host = document.createElement('div')
    document.body.append(host)
    const previewRenderer = renderer()
    const plans: PatchPlan[] = []
    const session = new DocumentSession({ documentId: 'mermaid-invalid-apply', markdown: original })
    const adapter = new TiptapVisualAdapter({
      host,
      mermaidRenderer: previewRenderer,
      onTransaction: ({ patchPlan }) => {
        if (patchPlan !== null) plans.push(patchPlan)
      },
      patchPlanner: new TiptapTransactionPatchPlanner({
        createTransactionId: () => `mermaid-invalid:${plans.length + 1}`,
        serialize: serializeOrdinaryTiptapPatch,
      }),
      project: projectOrdinaryMarkdown,
      session,
    })
    adapters.push(adapter)
    host.querySelector<HTMLButtonElement>('[data-semantic-edit="mermaid-editor"]')?.click()

    expect(adapter.applySemanticBlock({
      body: invalidCode,
      code: invalidCode,
      diagramType: 'flowchart',
      editorId: 'mermaid-editor',
      identity: 'Flowchart Mermaid',
      kind: 'mermaid',
      source: invalid,
    })).toEqual({ active: true, changed: true })
    expect(plans).toHaveLength(1)
    expect(plans[0]?.patches[0]?.replacement).toBe(invalid)
    await vi.waitFor(() => {
      expect(host.querySelector('[data-semantic-kind="mermaid"] [role="alert"]')?.textContent)
        .toBe('Mermaid preview failed: UnknownDiagramError')
    })

    session.commitPatchPlan(plans[0]!)
    const snapshot = session.snapshot()
    adapter.acknowledgeSynchronization({ map: projectOrdinaryMarkdown(snapshot).map, snapshot })
    expect(snapshot.markdown).toBe(invalid)
    const reloadHost = document.createElement('div')
    document.body.append(reloadHost)
    const reloaded = new TiptapVisualAdapter({
      host: reloadHost,
      mermaidRenderer: previewRenderer,
      project: projectOrdinaryMarkdown,
      session,
    })
    adapters.push(reloaded)
    expect(reloaded.documentJSON().content?.[0]).toMatchObject({
      attrs: { code: invalidCode, diagramType: null, kind: 'mermaid', source: invalid },
      type: 'semanticBlock',
    })
    expect(reloadHost.querySelector('[data-semantic-edit="mermaid-editor"]')).not.toBeNull()
  })
})
