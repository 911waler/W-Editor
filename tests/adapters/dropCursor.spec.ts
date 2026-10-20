import { EditorView as SourceEditorView } from '@codemirror/view'
import type { EditorState } from '@codemirror/state'
import { setTimeout as settleCherryInitialization } from 'node:timers/promises'
import { EditorView as VisualEditorView } from '@tiptap/pm/view'
import { describe, expect, it, vi } from 'vitest'

import { CherrySourceAdapter } from '../../src/adapters/cherrySourceAdapter'
import { TiptapTransactionPatchPlanner, TiptapVisualAdapter, serializeOrdinaryTiptapPatch } from '../../src/adapters'
import { projectOrdinaryMarkdown } from '../../src/codecs'
import { DocumentSession, type PatchPlan } from '../../src/core'

function visual(markdown = 'AlphaBravo') {
  const host = document.createElement('div')
  document.body.append(host)
  const session = new DocumentSession({ documentId: 'image-drop', markdown })
  const plans: PatchPlan[] = []
  const adapter = new TiptapVisualAdapter({
    host, session, project: projectOrdinaryMarkdown,
    patchPlanner: new TiptapTransactionPatchPlanner({
      createTransactionId: () => `image-drop:${plans.length + 1}`,
      serialize: serializeOrdinaryTiptapPatch,
    }),
    onTransaction: ({ patchPlan }) => { if (patchPlan !== null) plans.push(patchPlan) },
  })
  const commit = () => {
    const plan = plans.at(-1)
    if (plan === undefined) throw new Error('Expected image drop patch plan.')
    session.commitPatchPlan(plan)
    adapter.acknowledgeSynchronization({ map: projectOrdinaryMarkdown(session.snapshot()).map, snapshot: session.snapshot() })
  }
  const destroy = () => { adapter.destroy(); host.remove() }
  return { adapter, host, session, plans, commit, destroy }
}

async function source(markdown = 'Alpha\r\nBravo') {
  const host = document.createElement('div')
  document.body.append(host)
  const session = new DocumentSession({ documentId: 'source-image-drop', markdown })
  const adapter = new CherrySourceAdapter({ host, session })
  const view = SourceEditorView.findFromDOM(host.querySelector('.cm-editor')!)!
  // Cherry captures native setTimeout when its module loads; finish its queued
  // layout initialization before a test can destroy the editor.
  await settleCherryInitialization(0)
  const destroy = () => { adapter.destroy(); host.remove(); vi.clearAllTimers() }
  return { adapter, session, view, destroy }
}

describe('drop selection', () => {
  it('collapses visual selection at drop coordinates without changing source or history', () => {
    const { adapter, session, plans, destroy } = visual()
    try {
      adapter.setSelection({ anchor: 1, head: 11 })
      vi.spyOn(VisualEditorView.prototype, 'posAtCoords').mockReturnValue({ pos: 6, inside: 0 })
      expect(adapter.setDropSelection(20, 40)).toBe(true)
      expect(adapter.selection()).toEqual({ anchor: 6, head: 6, kind: 'text' })
      expect(adapter.text()).toBe('AlphaBravo')
      expect(session.snapshot().revision).toBe(0)
      expect(plans).toHaveLength(0)
      expect(adapter.undo()).toBe(false)
    } finally { destroy() }
  })

  it('rejects a drop outside the visual document and preserves selection', () => {
    const { adapter, destroy } = visual()
    try {
      adapter.setSelection({ anchor: 2, head: 4 })
      vi.spyOn(VisualEditorView.prototype, 'posAtCoords').mockReturnValue(null)
      expect(adapter.setDropSelection(20, 40)).toBe(false)
      expect(adapter.selection()).toEqual({ anchor: 2, head: 4, kind: 'text' })
    } finally { destroy() }
  })

  it('rejects visual selection and image insertion while reading', () => {
    const { adapter, plans, session, destroy } = visual()
    try {
      adapter.setPresentationMode(true, 'reader')
      expect(adapter.setDropSelection(20, 40)).toBe(false)
      expect(adapter.insertImages(['![new](/new.png)'])).toEqual({ active: false, changed: false })
      expect(session.snapshot().revision).toBe(0)
      expect(plans).toHaveLength(0)
    } finally { destroy() }
  })

  it('collapses source selection at coordinates and retains CRLF offsets', async () => {
    const { adapter, view, session, destroy } = await source()
    try {
      adapter.setSelection({ anchor: 0, head: 12 })
      vi.spyOn(view, 'posAtCoords').mockReturnValue(6)
      expect(adapter.setDropSelection(20, 40)).toBe(true)
      expect(adapter.selection()).toEqual({ anchor: 7, head: 7 })
      expect(adapter.value()).toBe('Alpha\r\nBravo')
      expect(session.snapshot().revision).toBe(0)
      expect(adapter.undo()).toBe(false)
    } finally { destroy() }
  })

  it('rejects a drop outside the source document without moving selection', async () => {
    const { adapter, view, destroy } = await source()
    try {
      adapter.setSelection({ anchor: 1, head: 4 })
      vi.spyOn(view, 'posAtCoords').mockReturnValue(null)
      expect(adapter.setDropSelection(20, 40)).toBe(false)
      expect(adapter.selection()).toEqual({ anchor: 1, head: 4 })
    } finally { destroy() }
  })

  it('rejects a read-only source document', async () => {
    const { adapter, view, session, destroy } = await source()
    try {
      // Use Cherry's bundled CodeMirror runtime, whose facets have separate identities.
      const runtime = view.state.constructor as typeof EditorState
      view.setState(runtime.create({ doc: view.state.doc, extensions: [runtime.readOnly.of(true)] }))
      expect(view.state.readOnly).toBe(true)
      vi.spyOn(view, 'posAtCoords').mockReturnValue(3)
      expect(adapter.setDropSelection(20, 40)).toBe(false)
      expect(session.snapshot().revision).toBe(0)
    } finally { destroy() }
  })
})

describe('image batch insertion', () => {
  it.each([
    { sources: ['![one](/one.png)'], expected: 'Alpha![one](/one.png)Bravo', caret: 7 },
    { sources: ['![one](/one.png)', '![two](/two.png)'], expected: 'Alpha![one](/one.png)![two](/two.png)Bravo', caret: 8 },
  ])('inserts $sources in order and preserves surrounding text in one undo step', ({ sources, expected, caret }) => {
    const { adapter, session, plans, commit, destroy } = visual()
    try {
      adapter.setSelection({ anchor: 6, head: 6 })
      expect(adapter.insertImages(sources)).toEqual({ active: true, changed: true })
      expect(adapter.selection()).toEqual({ anchor: caret, head: caret, kind: 'text' })
      expect(plans).toHaveLength(1)
      commit()
      expect(session.snapshot().markdown).toBe(expected)
      expect(adapter.undo()).toBe(true)
      commit()
      expect(session.snapshot().markdown).toBe('AlphaBravo')
      expect(adapter.undo()).toBe(false)
      expect(adapter.redo()).toBe(true)
      commit()
      expect(session.snapshot().markdown).toBe(expected)
    } finally { destroy() }
  })

  it('preserves an existing image when a drop collapses its selection', () => {
    const { adapter, host, session, commit, destroy } = visual('Alpha![old](/old.png)Bravo')
    try {
      host.querySelector<HTMLElement>('.inline-image')?.click()
      expect(adapter.selection().kind).toBe('node')
      vi.spyOn(VisualEditorView.prototype, 'posAtCoords').mockReturnValue({ pos: 7, inside: 0 })
      expect(adapter.setDropSelection(20, 40)).toBe(true)
      expect(adapter.insertImages(['![new](/new.png)']).changed).toBe(true)
      commit()
      expect(session.snapshot().markdown).toBe('Alpha![old](/old.png)![new](/new.png)Bravo')
    } finally { destroy() }
  })

  it.each([{ sources: [] }, { sources: ['![one](/one.png)', 'not an image'] }, { sources: ['![one](/one.png) trailing'] }])('rejects an invalid batch atomically: $sources', ({ sources }) => {
    const { adapter, plans, session, destroy } = visual()
    try {
      adapter.setSelection({ anchor: 6, head: 6 })
      expect(adapter.insertImages(sources)).toEqual({ active: false, changed: false })
      expect(adapter.text()).toBe('AlphaBravo')
      expect(plans).toHaveLength(0)
      expect(session.snapshot().revision).toBe(0)
      expect(adapter.undo()).toBe(false)
    } finally { destroy() }
  })
})
