export type FullscreenStatus = 'active' | 'entering' | 'exiting' | 'failed' | 'idle'

export interface FullscreenState {
  readonly active: boolean
  readonly failure: FullscreenOperationError | null
  readonly status: FullscreenStatus
}

export interface FullscreenDocumentPort {
  readonly fullscreenElement: Element | null
  readonly addEventListener: (type: 'fullscreenchange' | 'fullscreenerror', listener: EventListener) => void
  readonly exitFullscreen: () => Promise<void>
  readonly removeEventListener: (type: 'fullscreenchange' | 'fullscreenerror', listener: EventListener) => void
}

export interface FullscreenTargetPort extends Element {
  readonly requestFullscreen: () => Promise<void>
}

export class FullscreenOperationError extends Error {
  readonly code = 'FULLSCREEN_OPERATION_FAILED'

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'FullscreenOperationError'
  }
}

export class FullscreenController {
  readonly #document: FullscreenDocumentPort
  readonly #subscribers = new Set<(state: FullscreenState) => void>()
  readonly #target: FullscreenTargetPort
  #destroyed = false
  #state: FullscreenState = Object.freeze({ active: false, failure: null, status: 'idle' })

  constructor(options: { readonly document: FullscreenDocumentPort; readonly target: FullscreenTargetPort }) {
    this.#document = options.document
    this.#target = options.target
    this.#document.addEventListener('fullscreenchange', this.#handleChange)
    this.#document.addEventListener('fullscreenerror', this.#handleError)
    this.#synchronize()
  }

  snapshot(): FullscreenState {
    return this.#state
  }

  subscribe(subscriber: (state: FullscreenState) => void): () => void {
    this.#subscribers.add(subscriber)
    subscriber(this.#state)
    return () => this.#subscribers.delete(subscriber)
  }

  async toggle(): Promise<FullscreenState> {
    this.#assertAlive()
    if (this.#state.status === 'entering' || this.#state.status === 'exiting') return this.#state
    const exiting = this.#document.fullscreenElement === this.#target
    this.#replace({ active: exiting, failure: null, status: exiting ? 'exiting' : 'entering' })
    try {
      if (exiting) await this.#document.exitFullscreen()
      else await this.#target.requestFullscreen()
      const active = this.#document.fullscreenElement === this.#target
      if (active === exiting) {
        throw new Error(exiting
          ? 'The document remained fullscreen after the exit request.'
          : 'The application did not become the fullscreen element.')
      }
      this.#replace({ active, failure: null, status: active ? 'active' : 'idle' })
      return this.#state
    } catch (cause) {
      const failure = new FullscreenOperationError(
        cause instanceof Error ? cause.message : 'The browser rejected the fullscreen request.',
        { cause },
      )
      this.#replace({ active: this.#document.fullscreenElement === this.#target, failure, status: 'failed' })
      throw failure
    }
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    this.#document.removeEventListener('fullscreenchange', this.#handleChange)
    this.#document.removeEventListener('fullscreenerror', this.#handleError)
    this.#subscribers.clear()
    if (this.#document.fullscreenElement === this.#target) void this.#document.exitFullscreen().catch(() => undefined)
  }

  readonly #handleChange: EventListener = () => this.#synchronize()

  readonly #handleError: EventListener = () => {
    const failure = new FullscreenOperationError('The browser reported a fullscreen error.')
    this.#replace({ active: this.#document.fullscreenElement === this.#target, failure, status: 'failed' })
  }

  #synchronize(): void {
    const active = this.#document.fullscreenElement === this.#target
    this.#replace({ active, failure: null, status: active ? 'active' : 'idle' })
  }

  #replace(state: FullscreenState): void {
    this.#state = Object.freeze({ ...state })
    for (const subscriber of this.#subscribers) subscriber(this.#state)
  }

  #assertAlive(): void {
    if (this.#destroyed) throw new Error('The fullscreen controller has been destroyed.')
  }
}
