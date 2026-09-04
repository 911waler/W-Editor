import { describe, expect, it, vi } from 'vitest'

import { TiptapTransactionPatchPlanner, TiptapVisualAdapter, serializeOrdinaryTiptapPatch } from '../../src/adapters'
import { projectOrdinaryMarkdown } from '../../src/codecs'
import { DocumentSession, type PatchPlan } from '../../src/core'
import { formulaSource } from '../../src/services'

describe('visual formula route', () => {
  it('projects inline and block formulas with intact KaTeX layout and double-click editing', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const inlineSource = '$E=mc^2$'
    const blockContent = String.raw`\lim_{\Delta x \to 0} \frac{f(x+\Delta x)-f(x)}{\Delta x}`
    const blockSource = `$$\n${blockContent}\n$$`
    const markdown = `${inlineSource}\n\n${blockSource}`
    const onSemanticEdit = vi.fn()
    const session = new DocumentSession({ documentId: 'formula-layout', markdown })
    const adapter = new TiptapVisualAdapter({
      host,
      onSemanticEdit,
      project: projectOrdinaryMarkdown,
      session,
    })
    try {
      const inline = host.querySelector<HTMLElement>('[data-formula-mode="inline"]')
      expect(inline).not.toBeNull()
      expect(inline?.querySelector('.katex .msupsub .vlist')).not.toBeNull()
      expect(inline?.innerHTML).toMatch(/(?:vertical-align|top|height):/u)
      expect(inline?.querySelector('button')).toBeNull()

      const block = host.querySelector<HTMLElement>('[data-formula-mode="block"]')
      expect(block).not.toBeNull()
      expect(block?.querySelector('.katex .mfrac .frac-line')).not.toBeNull()
      expect(block?.innerHTML).toMatch(/(?:top|height):/u)
      expect(block?.querySelector('button')).toBeNull()

      inline?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
      expect(onSemanticEdit).toHaveBeenNthCalledWith(1, {
        editorId: 'formula-editor',
        formulaContent: 'E=mc^2',
        formulaMode: 'inline',
        kind: 'formula',
        layoutKind: null,
        source: inlineSource,
      })

      block?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
      expect(onSemanticEdit).toHaveBeenNthCalledWith(2, {
        editorId: 'formula-editor',
        formulaContent: blockContent,
        formulaMode: 'block',
        kind: 'formula',
        layoutKind: null,
        source: blockSource,
      })
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it('inserts a block formula as one dedicated-node transaction with exact source', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: 'formula', markdown: 'Alpha' })
    const plans: PatchPlan[] = []
    const adapter = new TiptapVisualAdapter({
      host,
      onTransaction: ({ patchPlan }) => {
        if (patchPlan !== null) plans.push(patchPlan)
      },
      patchPlanner: new TiptapTransactionPatchPlanner({
        createTransactionId: () => 'formula:visual',
        serialize: serializeOrdinaryTiptapPatch,
      }),
      project: projectOrdinaryMarkdown,
      session,
    })
    try {
      adapter.setSelection({ anchor: 6, head: 6 })
      expect(adapter.applyFormula(formulaSource('E = mc^2'))).toEqual({ active: true, changed: true })
      expect(plans.at(-1)?.patches[0]?.replacement).toBe('Alpha\n\n$$\nE = mc^2\n$$')
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it('exposes the content and mode for an existing dedicated block formula node', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const source = formulaSource('E = mc^2')
    const session = new DocumentSession({ documentId: 'formula-edit', markdown: source })
    const adapter = new TiptapVisualAdapter({ host, project: projectOrdinaryMarkdown, session })
    try {
      expect(adapter.selectedFormulaSource()).toBe(source)
      expect(adapter.selectedFormula()).toEqual({ content: 'E = mc^2', mode: 'block', source })
      expect(adapter.applyFormula(formulaSource('x + y'))).toEqual({ active: true, changed: true })
      expect(adapter.documentJSON().content?.[0]).toMatchObject({
        attrs: { content: 'x + y', formulaMode: 'block' },
        type: 'formulaBlock',
      })
    } finally {
      adapter.destroy()
      host.remove()
    }
  })
})
