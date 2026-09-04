import type { OpenArticle } from './articleCatalog'

export type ArticleSwitchFlushStage = 'composition' | 'synchronization' | 'conversion' | 'persistence'

export interface ArticleSwitchFlushGuardOptions {
  readonly flushComposition: (article: OpenArticle) => void | Promise<void>
  readonly flushConversion: (article: OpenArticle) => void | Promise<void>
  readonly flushPersistence: (article: OpenArticle) => void | Promise<void>
  readonly flushSynchronization: (article: OpenArticle) => void | Promise<void>
  readonly onFailure?: (stage: ArticleSwitchFlushStage, failure: unknown) => void
}

export class ArticleSwitchFlushGuard {
  readonly #options: ArticleSwitchFlushGuardOptions

  constructor(options: ArticleSwitchFlushGuardOptions) {
    this.#options = options
  }

  async flush(article: OpenArticle): Promise<void> {
    const stages = [
      ['composition', this.#options.flushComposition],
      ['synchronization', this.#options.flushSynchronization],
      ['conversion', this.#options.flushConversion],
      ['persistence', this.#options.flushPersistence],
    ] as const
    for (const [stage, flush] of stages) {
      try {
        await flush(article)
      } catch (failure) {
        this.#options.onFailure?.(stage, failure)
        throw failure
      }
    }
  }
}

export class CompositionBarrier {
  #active = 0
  #release: (() => void) | null = null
  #waiting: Promise<void> | null = null

  begin(): void {
    this.#active += 1
  }

  end(): void {
    if (this.#active === 0) return
    this.#active -= 1
    if (this.#active === 0) {
      this.#release?.()
      this.#release = null
      this.#waiting = null
    }
  }

  active(): boolean {
    return this.#active > 0
  }

  wait(): Promise<void> {
    if (!this.active()) return Promise.resolve()
    if (this.#waiting === null) {
      this.#waiting = new Promise<void>((resolve) => {
        this.#release = resolve
      })
    }
    return this.#waiting
  }
}
