import type { EditorMode } from '@w-editor/editor-core'

export interface NativeHistoryCommands {
  readonly redo: () => boolean
  readonly undo: () => boolean
}

export interface ActiveModeHistoryOptions {
  readonly activeMode: () => EditorMode
  readonly source: NativeHistoryCommands
  readonly visual: NativeHistoryCommands
}

export class ActiveModeHistory {
  readonly #activeMode: () => EditorMode
  readonly #source: NativeHistoryCommands
  readonly #visual: NativeHistoryCommands

  constructor(options: ActiveModeHistoryOptions) {
    this.#activeMode = options.activeMode
    this.#source = options.source
    this.#visual = options.visual
  }

  undo(): boolean {
    return this.#forActiveMode()?.undo() ?? false
  }

  redo(): boolean {
    return this.#forActiveMode()?.redo() ?? false
  }

  #forActiveMode(): NativeHistoryCommands | null {
    const mode = this.#activeMode()
    if (mode === 'source') return this.#source
    if (mode === 'visual') return this.#visual
    return null
  }
}
