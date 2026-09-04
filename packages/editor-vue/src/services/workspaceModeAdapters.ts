import type { DocumentSnapshot } from '@w-editor/editor-core'
import type { PreviewRenderer } from '@w-editor/editor-core'
import type { EditorMode, ModeAdapter, PreparedModeActivation } from '@w-editor/editor-core'

export type WorkspaceSurface =
  | {
      readonly markdown: string
      readonly mode: 'source' | 'visual'
      readonly revision: number
    }
  | {
      readonly html: string
      readonly mode: 'preview'
      readonly revision: number
    }

export type { PreviewRenderer } from '@w-editor/editor-core'

export type WorkspaceSurfaceSubscriber = (surface: WorkspaceSurface) => void
export type WorkspacePreviewPresentation = 'renderer' | 'visual-readonly'

function sourceSurface(snapshot: DocumentSnapshot, mode: 'source' | 'visual'): WorkspaceSurface {
  return Object.freeze({ markdown: snapshot.markdown, mode, revision: snapshot.revision })
}

export class WorkspaceModeAdapters {
  readonly adapters: Readonly<Record<EditorMode, ModeAdapter>>
  readonly #renderer: PreviewRenderer
  readonly #prepareVisual: (snapshot: DocumentSnapshot) => void
  readonly #previewPresentation: WorkspacePreviewPresentation
  readonly #subscribers = new Set<WorkspaceSurfaceSubscriber>()
  #surface: WorkspaceSurface

  constructor(
    initialSnapshot: DocumentSnapshot,
    renderer: PreviewRenderer,
    initialMode: EditorMode = 'source',
    prepareVisual: (snapshot: DocumentSnapshot) => void = () => undefined,
    previewPresentation: WorkspacePreviewPresentation = 'renderer',
  ) {
    this.#renderer = renderer
    this.#prepareVisual = prepareVisual
    this.#previewPresentation = previewPresentation
    this.#surface = initialMode === 'preview'
      ? this.#previewSurface(initialSnapshot)
      : sourceSurface(initialSnapshot, initialMode)
    this.adapters = Object.freeze({
      preview: this.#adapter('preview'),
      source: this.#adapter('source'),
      visual: this.#adapter('visual'),
    })
  }

  snapshot(): WorkspaceSurface {
    return this.#surface
  }

  subscribe(subscriber: WorkspaceSurfaceSubscriber): () => void {
    this.#subscribers.add(subscriber)
    return () => {
      this.#subscribers.delete(subscriber)
    }
  }

  refreshPreview(snapshot: DocumentSnapshot): void {
    if (this.#surface.mode !== 'preview') return
    this.#surface = this.#previewSurface(snapshot)
    for (const subscriber of this.#subscribers) subscriber(this.#surface)
  }

  destroy(): void {
    this.#subscribers.clear()
  }

  #adapter(mode: EditorMode): ModeAdapter {
    return Object.freeze({
      deactivate: () => undefined,
      mode,
      prepare: (snapshot: DocumentSnapshot) => this.#prepare(mode, snapshot),
    })
  }

  #prepare(mode: EditorMode, snapshot: DocumentSnapshot): PreparedModeActivation {
    if (mode === 'visual' || (mode === 'preview' && this.#previewPresentation === 'visual-readonly')) {
      this.#prepareVisual(snapshot)
    }
    const surface = mode === 'preview'
      ? this.#previewSurface(snapshot)
      : sourceSurface(snapshot, mode)
    let pending = true
    return Object.freeze({
      activate: () => {
        if (!pending) return
        pending = false
        this.#surface = surface
        for (const subscriber of this.#subscribers) subscriber(surface)
      },
      discard: () => {
        pending = false
      },
      mode,
      revision: snapshot.revision,
    })
  }

  #previewSurface(snapshot: DocumentSnapshot): WorkspaceSurface {
    if (this.#previewPresentation === 'visual-readonly') {
      return Object.freeze({ html: '', mode: 'preview', revision: snapshot.revision })
    }
    const result = this.#renderer.render(snapshot)
    if (result.snapshot.revision !== snapshot.revision || result.snapshot.documentId !== snapshot.documentId) {
      throw new TypeError('Preview renderer returned a result for a different document snapshot.')
    }
    return Object.freeze({ html: result.html, mode: 'preview', revision: snapshot.revision })
  }
}
