import type { DocumentSnapshot } from '@w-editor/editor-core'
import type { PreviewRenderer } from '@w-editor/editor-core'

export function createTestingPreviewRenderer(): PreviewRenderer | undefined {
  const failure = new URLSearchParams(window.location.search).get('modeFailure')
  if (failure !== 'preview') return undefined
  return Object.freeze({
    render: (snapshot: DocumentSnapshot) => {
      void snapshot
      throw Object.assign(new Error('Injected preview conversion failure.'), {
        code: 'CHERRY_RENDER_FAILED',
      })
    },
  })
}
