import { describe, expect, it } from 'vitest'
import { TiptapTransactionPatchPlanner, TiptapVisualAdapter, serializeOrdinaryTiptapPatch } from '../../src/adapters'
import { projectOrdinaryMarkdown } from '../../src/codecs'
import { DocumentSession, SynchronizationStateStore, type PatchPlan } from '../../src/core'
import { VisualSynchronizationService } from '../../src/services'

function imageHarness(markdown: string, documentId: string): Readonly<{
  adapter: TiptapVisualAdapter
  destroy: () => void
  failures: unknown[]
  host: HTMLElement
  plans: PatchPlan[]
  service: VisualSynchronizationService
  session: DocumentSession
  state: SynchronizationStateStore
}> {
  const host = document.createElement('div')
  document.body.append(host)
  const session = new DocumentSession({ documentId, markdown })
  const state = new SynchronizationStateStore(session.snapshot())
  const failures: unknown[] = []
  const plans: PatchPlan[] = []
  let sequence = 0
  const service = new VisualSynchronizationService({
    onAcknowledgement: ({ snapshot }) => {
      const projection = projectOrdinaryMarkdown(snapshot)
      adapter.acknowledgeSynchronization({ map: projection.map, snapshot })
    },
    session,
    state,
  })
  const adapter = new TiptapVisualAdapter({
    host,
    onTransaction: ({ patchPlan }) => {
      if (patchPlan !== null) {
        plans.push(patchPlan)
        service.request(patchPlan)
      }
    },
    onTransactionFailure: ({ failure }) => failures.push(failure),
    patchPlanner: new TiptapTransactionPatchPlanner({
      createTransactionId: () => `image-regression-${documentId}-${++sequence}`,
      serialize: serializeOrdinaryTiptapPatch,
    }),
    project: projectOrdinaryMarkdown,
    session,
  })
  return Object.freeze({
    adapter,
    destroy: () => {
      service.cancel()
      adapter.destroy()
      host.remove()
    },
    failures,
    host,
    plans,
    service,
    session,
    state,
  })
}


describe('inline image editing and source preservation', () => {
  it('inserts two separate images, deletes just the selected one, and saves its undo', async () => {
    const h = imageHarness('', 'two-insert-delete')
    try {
      h.adapter.applySemanticBlock({ kind: 'media', mediaKind: 'image', source: '![A](/a.png)', name: 'A', url: '/a.png' })
      await h.service.flush()
      const afterFirst = h.adapter.selection().head
      h.adapter.setSelection({ anchor: afterFirst, head: afterFirst })
      h.adapter.insertText(' '); await h.service.flush()
      h.adapter.applySemanticBlock({ kind: 'media', mediaKind: 'image', source: '![B](/b.png)', name: 'B', url: '/b.png' })
      await h.service.flush()
      expect(h.session.snapshot().markdown).toBe('![A](/a.png) ![B](/b.png)')
      expect(h.host.querySelectorAll('img[src]')).toHaveLength(2)
      h.host.querySelector<HTMLElement>('[data-inline-image]')?.click()
      h.host.querySelector('.ProseMirror')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))
      await h.service.flush()
      expect(h.session.snapshot().markdown).toBe(' ![B](/b.png)')
      h.adapter.undo(); await h.service.flush()
      expect(h.session.snapshot().markdown).toBe('![A](/a.png) ![B](/b.png)')
      expect(h.failures).toEqual([])
    } finally { h.destroy() }
  })

  it('aligns a selected image paragraph as a group and preserves images after undo', async () => {
    const original = '![A](/a.png){width=240 height=120} ![B](/b.png)'
    const h = imageHarness(original, 'align-images')
    try {
      h.host.querySelector<HTMLElement>('[data-inline-image]')?.click()
      expect(h.adapter.canApplyAlignment()).toBe(true)
      expect(h.adapter.applyAlignment('align.center').changed).toBe(true)
      await h.service.flush()
      expect(h.failures).toEqual([])
      expect(h.session.snapshot().markdown).toBe('::: center\n' + original + '\n:::')
      expect(h.host.querySelectorAll('img[src]')).toHaveLength(2)
      h.host.querySelector<HTMLElement>('[data-inline-image]')?.click()
      expect(h.adapter.applyAlignment('align.right').changed).toBe(true)
      await h.service.flush()
      expect(h.session.snapshot().markdown).toBe('::: right\n' + original + '\n:::')
      h.adapter.undo(); await h.service.flush()
      expect(h.session.snapshot().markdown).toBe('::: center\n' + original + '\n:::')
    } finally { h.destroy() }
  })

  it('disables image alignment in a nested list instead of corrupting its source', () => {
    const h = imageHarness('- ![A](/a.png)', 'nested-images')
    try {
      h.host.querySelector<HTMLElement>('[data-inline-image]')?.click()
      expect(h.adapter.canApplyAlignment()).toBe(false)
      expect(h.adapter.applyAlignment('align.center').changed).toBe(false)
      expect(h.session.snapshot().markdown).toBe('- ![A](/a.png)')
    } finally { h.destroy() }
  })

  it('keeps image tokens intact when editing adjacent text', async () => {
    const original = 'Before ![Photo](/legacy/png-4 "A title"){width=320 height=180} after\n\nUntouched  text'
    const h = imageHarness(original, 'adjacent')
    try {
      expect(h.host.querySelectorAll('img[src]')).toHaveLength(1)
      h.adapter.setSelection({ anchor: 1, head: 1 })
      h.adapter.insertText('New ')
      await h.service.flush()
      expect(h.failures).toEqual([])
      expect(h.session.snapshot().markdown).toBe('New ' + original)
      expect(h.adapter.undo()).toBe(true)
      await h.service.flush()
      expect(h.session.snapshot().markdown).toBe(original)
    } finally { h.destroy() }
  })

  it('inserts at the text cursor and edits only the selected image without losing dimensions', async () => {
    const h = imageHarness('Left Right', 'insert')
    try {
      h.adapter.setSelection({ anchor: 6, head: 6 })
      h.adapter.applySemanticBlock({ kind: 'media', mediaKind: 'image', name: 'First',
        url: '/a.png', source: '![First](/a.png){width=240 height=120}' })
      await h.service.flush()
      expect(h.failures).toEqual([])
      expect(h.session.snapshot().markdown).toBe('Left ![First](/a.png){width=240 height=120}Right')
      expect(h.adapter.selectedSemanticBlock()).toMatchObject({ kind: 'media', mediaKind: 'image', name: 'First' })
      h.adapter.applySemanticBlock({ kind: 'media', mediaKind: 'image', name: 'Updated',
        url: '/b.png', source: '![Updated](/b.png)' })
      await h.service.flush()
      expect(h.host.querySelectorAll('img[src]')).toHaveLength(1)
      expect(h.session.snapshot().markdown).toBe('Left ![Updated](/b.png){width=240 height=120}Right')
    } finally { h.destroy() }
  })

  it('keeps inline code literal and images in list/table cells visible', () => {
    const h = imageHarness('`![literal](/code.png)`\n\n- ![List](/list.png)\n\n| A |\n| --- |\n| ![Cell](/cell.png) |', 'contexts')
    try {
      expect([...h.host.querySelectorAll('img[src]')].map(img => img.getAttribute('src'))).toEqual(['/list.png', '/cell.png'])
      expect(h.host.querySelector('code')?.textContent).toBe('![literal](/code.png)')
    } finally { h.destroy() }
  })
})
