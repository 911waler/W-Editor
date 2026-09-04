import { DocumentSession } from '@w-editor/editor-core'
import formattingGalleryMarkdown from '../content/articles/formatting-gallery.md?raw'
import productNotesMarkdown from '../content/articles/product-notes.md?raw'
import welcomeMarkdown from '../content/articles/welcome.md?raw'

export interface ArticleDefinition {
  readonly documentId: string
  readonly initialMarkdown: string
  readonly title: string
}

export const FIXED_ARTICLES: readonly ArticleDefinition[] = Object.freeze([
  Object.freeze({
    documentId: 'welcome',
    initialMarkdown: welcomeMarkdown,
    title: 'Welcome to W-Editor',
  }),
  Object.freeze({
    documentId: 'product-notes',
    initialMarkdown: productNotesMarkdown,
    title: 'Product notes',
  }),
  Object.freeze({
    documentId: 'formatting-gallery',
    initialMarkdown: formattingGalleryMarkdown,
    title: 'Formatting gallery',
  }),
])

export class ArticleCatalogAdapter {
  #articles: readonly ArticleDefinition[]
  readonly #byId: Map<string, ArticleDefinition>

  constructor(articles: readonly ArticleDefinition[] = FIXED_ARTICLES) {
    if (articles.length === 0) throw new TypeError('The fixed article catalog cannot be empty.')
    const byId = new Map<string, ArticleDefinition>()
    for (const article of articles) {
      if (byId.has(article.documentId)) throw new TypeError(`Duplicate article ID: ${article.documentId}.`)
      byId.set(article.documentId, Object.freeze({ ...article }))
    }
    this.#articles = Object.freeze([...byId.values()])
    this.#byId = byId
  }

  list(): readonly ArticleDefinition[] {
    return this.#articles
  }

  lookup(documentId: string): ArticleDefinition | null {
    return this.#byId.get(documentId) ?? null
  }

  add(article: ArticleDefinition): ArticleDefinition {
    if (this.#byId.has(article.documentId)) throw new TypeError(`Duplicate article ID: ${article.documentId}.`)
    const normalized = Object.freeze({ ...article })
    this.#byId.set(normalized.documentId, normalized)
    this.#articles = Object.freeze([...this.#articles, normalized])
    return normalized
  }

  initial(): ArticleDefinition {
    return this.#articles[0] as ArticleDefinition
  }
}

export interface OpenArticle {
  readonly definition: ArticleDefinition
  readonly session: DocumentSession
}

export interface ArticleSwitchCoordinatorOptions {
  readonly catalog: ArticleCatalogAdapter
  readonly flushCurrent: (article: OpenArticle) => void | Promise<void>
  readonly initialArticle: OpenArticle
  readonly openArticle: (definition: ArticleDefinition) => OpenArticle | Promise<OpenArticle>
}

export interface ArticleSwitchResult {
  readonly changed: boolean
  readonly from: string
  readonly to: string
}

export type ActiveArticleSubscriber = (article: OpenArticle) => void

export class ArticleSwitchCoordinator {
  readonly #catalog: ArticleCatalogAdapter
  readonly #flushCurrent: ArticleSwitchCoordinatorOptions['flushCurrent']
  readonly #openArticle: ArticleSwitchCoordinatorOptions['openArticle']
  readonly #opened = new Map<string, OpenArticle>()
  readonly #subscribers = new Set<ActiveArticleSubscriber>()
  #active: OpenArticle
  #queue: Promise<void> = Promise.resolve()

  constructor(options: ArticleSwitchCoordinatorOptions) {
    const initial = options.catalog.lookup(options.initialArticle.definition.documentId)
    if (initial === null) throw new TypeError('Initial article is not part of the fixed catalog.')
    this.#catalog = options.catalog
    this.#flushCurrent = options.flushCurrent
    this.#openArticle = options.openArticle
    this.#active = options.initialArticle
    this.#opened.set(initial.documentId, options.initialArticle)
  }

  active(): OpenArticle {
    return this.#active
  }

  subscribe(subscriber: ActiveArticleSubscriber): () => void {
    this.#subscribers.add(subscriber)
    return () => { this.#subscribers.delete(subscriber) }
  }

  request(documentId: string): Promise<ArticleSwitchResult> {
    const request = this.#queue.then(
      () => this.#switch(documentId),
      () => this.#switch(documentId),
    )
    this.#queue = request.then(() => undefined, () => undefined)
    return request
  }

  async #switch(documentId: string): Promise<ArticleSwitchResult> {
    const current = this.#active
    if (current.definition.documentId === documentId) {
      return Object.freeze({ changed: false, from: documentId, to: documentId })
    }
    const definition = this.#catalog.lookup(documentId)
    if (definition === null) throw new RangeError(`Unknown fixed article: ${documentId}.`)
    await this.#flushCurrent(current)
    const target = this.#opened.get(documentId) ?? await this.#openArticle(definition)
    if (target.definition.documentId !== documentId || target.session.snapshot().documentId !== documentId) {
      throw new TypeError('Opened article identity does not match the requested catalog article.')
    }
    this.#opened.set(documentId, target)
    this.#active = target
    for (const subscriber of this.#subscribers) subscriber(target)
    return Object.freeze({ changed: true, from: current.definition.documentId, to: documentId })
  }
}

export function openDefaultArticle(definition: ArticleDefinition): OpenArticle {
  return Object.freeze({
    definition,
    session: new DocumentSession({ documentId: definition.documentId, markdown: definition.initialMarkdown }),
  })
}
