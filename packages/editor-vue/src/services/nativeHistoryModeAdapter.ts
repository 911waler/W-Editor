import type { DocumentSnapshot } from '@w-editor/editor-core'
import type { EditorMode, ModeAdapter, PreparedModeActivation } from '@w-editor/editor-core'

export interface NativeHistorySurface {
  readonly destroy: () => void
  readonly redo: () => boolean
  readonly undo: () => boolean
}

export interface NativeHistoryModeAdapterOptions<Surface extends NativeHistorySurface> {
  readonly activateSurface: (surface: Surface) => void
  readonly createSurface: (snapshot: DocumentSnapshot) => Surface | Promise<Surface>
  readonly deactivateSurface: (surface: Surface) => void
  readonly mode: Extract<EditorMode, 'source' | 'visual'>
}

export class NativeHistoryModeAdapter<Surface extends NativeHistorySurface> implements ModeAdapter {
  readonly mode: Extract<EditorMode, 'source' | 'visual'>
  readonly #activateSurface: (surface: Surface) => void
  readonly #createSurface: (snapshot: DocumentSnapshot) => Surface | Promise<Surface>
  readonly #deactivateSurface: (surface: Surface) => void
  #active: Surface | null = null
  #segment = 0

  constructor(options: NativeHistoryModeAdapterOptions<Surface>) {
    this.mode = options.mode
    this.#activateSurface = options.activateSurface
    this.#createSurface = options.createSurface
    this.#deactivateSurface = options.deactivateSurface
  }

  current(): Surface | null {
    return this.#active
  }

  segment(): number {
    return this.#segment
  }

  async prepare(snapshot: DocumentSnapshot): Promise<PreparedModeActivation> {
    const surface = await this.#createSurface(snapshot)
    let disposition: 'activated' | 'discarded' | 'prepared' = 'prepared'
    return Object.freeze({
      activate: () => {
        if (disposition !== 'prepared') throw new Error(`Prepared ${this.mode} history segment is already ${disposition}.`)
        if (this.#active !== null) throw new Error(`${this.mode} already has an active native history segment.`)
        disposition = 'activated'
        this.#active = surface
        this.#segment += 1
        this.#activateSurface(surface)
      },
      discard: () => {
        if (disposition !== 'prepared') return
        disposition = 'discarded'
        surface.destroy()
      },
      mode: this.mode,
      revision: snapshot.revision,
    })
  }

  deactivate = (): void => {
    const surface = this.#active
    if (surface === null) return
    this.#active = null
    this.#deactivateSurface(surface)
    surface.destroy()
  }

  undo(): boolean {
    return this.#active?.undo() ?? false
  }

  redo(): boolean {
    return this.#active?.redo() ?? false
  }
}
