import {
  createInstanceDomService,
  createTiptapPresentation,
  type InstanceDomService,
  type TiptapPresentationInstance,
} from '@w-editor/editor-vue/host'

import {
  createDocumentSnapshot,
  createPublicError,
  WEB_API_VERSION,
  WEB_SCHEMA_VERSION,
  type WDocumentSnapshot,
  type WEditorError,
  type WEditorErrorEvent,
  type WRendererAuthorEvent,
  type WRendererInstance,
  type WRendererMountOptions,
  type WRendererProfile,
  type WRendererReadyEvent,
  type WRendererSnapshot,
  type WDestroyResult,
} from './publicContracts'
import { WEditorContractError } from './editorMount'
import { checkWebHostCompatibility } from './versioning'
import { adaptRendererExtensions } from './extensionAdapter'
import { createWebSettingsController, type WebSettingsController } from './settingsController'

function isHtmlElement(value: unknown): value is HTMLElement {
  if (typeof value !== 'object' || value === null || !('ownerDocument' in value)) return false
  const ownerDocument = value.ownerDocument
  if (typeof ownerDocument !== 'object' || ownerDocument === null || !('defaultView' in ownerDocument)) return false
  const view = ownerDocument.defaultView as (Window & typeof globalThis) | null
  return view !== null && value instanceof view.HTMLElement
}

function normalizeMarkdown(markdown: unknown): string {
  if (typeof markdown !== 'string') {
    throw new WEditorContractError(createPublicError('INVALID_DOCUMENT', 'Renderer Markdown must be a string.'))
  }
  return markdown
}

function normalizeProfile(profile: unknown): WRendererProfile {
  if (profile !== 'reader' && profile !== 'author-preview') {
    throw new WEditorContractError(createPublicError('INVALID_MOUNT', 'Renderer profile must be reader or author-preview.'))
  }
  return profile
}

function rendererSnapshot(document: WDocumentSnapshot, profile: WRendererProfile): WRendererSnapshot {
  return Object.freeze({ ...document, profile })
}

export class WRendererController implements WRendererInstance {
  readonly apiVersion = WEB_API_VERSION
  readonly instanceId: string
  readonly schemaVersion = WEB_SCHEMA_VERSION
  readonly #domService: InstanceDomService
  readonly #onAuthorEvent: ((event: WRendererAuthorEvent) => void) | undefined
  readonly #onError: ((event: WEditorErrorEvent) => void) | undefined
  readonly #onReady: WRendererMountOptions['onReady']
  readonly #locale: 'zh' | 'en' | 'ru'
  readonly #presentation: TiptapPresentationInstance
  readonly #profile: WRendererProfile
  readonly #root: HTMLElement
  readonly #settings: WebSettingsController
  #destroyPromise: Promise<WDestroyResult> | null = null
  #destroyed = false
  #document: WDocumentSnapshot

  constructor(root: HTMLElement, options: WRendererMountOptions) {
    this.#profile = normalizeProfile(options.profile)
    this.#document = createDocumentSnapshot({
      documentId: 'renderer',
      markdown: normalizeMarkdown(options.markdown),
    })
    this.#root = root
    this.#root.className = 'w-editor-root w-editor-instance w-editor-renderer'
    this.#root.dataset['wEditorApiVersion'] = WEB_API_VERSION
    this.#root.dataset['wEditorSchemaVersion'] = WEB_SCHEMA_VERSION
    this.#root.dataset['wEditorProfile'] = this.#profile
    this.#domService = createInstanceDomService(this.#root)
    this.instanceId = this.#domService.instanceId
    this.#settings = createWebSettingsController({
      onError: (error) => this.#emitError(error),
      root: this.#root,
      ...(options.settingsStore === undefined ? {} : { settingsStore: options.settingsStore }),
      ...(options.theme === undefined ? {} : { distributionTheme: options.theme }),
    })
    this.#onReady = options.onReady
    this.#onAuthorEvent = options.onAuthorEvent
    this.#onError = options.onError
    this.#locale = options.locale ?? 'zh'
    const content = root.ownerDocument.createElement('div')
    content.className = 'w-editor-renderer-content'
    content.dataset['wEditorRendererContent'] = 'true'
    content.setAttribute('contenteditable', 'false')
    this.#root.append(content)
    this.#presentation = createTiptapPresentation(content, {
      extensions: adaptRendererExtensions(options.rendererExtensions),
      locale: this.#locale,
      ...(this.#profile === 'author-preview' && this.#onAuthorEvent !== undefined
        ? { onCodeEdit: (index: number) => this.#onAuthorEvent?.(Object.freeze({ index, type: 'code-edit' })) }
        : {}),
      onError: (failure) => {
        this.#emitError(createPublicError(
          'ASSET_MISSING',
          failure instanceof Error ? failure.message : 'A Renderer presentation could not be prepared.',
          { actionHints: ['inspect-asset'], retryable: true },
        ))
      },
      onSnapshotChange: (snapshot) => {
        this.#document = Object.freeze({
          ...this.#document,
          markdown: snapshot.markdown,
          revision: snapshot.revision,
        })
      },
      ...(this.#profile === 'author-preview'
        ? { onTaskToggle: ({ checked, index }: Readonly<{ checked: boolean; index: number }>) => {
            this.#onAuthorEvent?.(Object.freeze({
              checked,
              index,
              snapshot: this.snapshot(),
              type: 'task-toggle',
            }))
          } }
        : {}),
      profile: this.#profile,
      resourceOptions: {
        ...(options.assetBaseUrl === undefined ? {} : { assetBaseUrl: options.assetBaseUrl }),
        ...(options.resourceLocator === undefined ? {} : { resourceLocator: options.resourceLocator }),
      },
      snapshot: this.#document,
    })
  }

  initializeSettings(onReady: () => void): void {
    this.#settings.initialize(onReady)
  }

  emitReady(): void {
    const publish = (): void => {
      if (this.#destroyed) return
      this.#onReady?.(Object.freeze({
        apiVersion: WEB_API_VERSION,
        instanceId: this.instanceId,
        schemaVersion: WEB_SCHEMA_VERSION,
        snapshot: this.snapshot(),
        type: 'ready',
      }) satisfies WRendererReadyEvent)
    }
    const pending = this.#presentation.root.querySelector(
      '[aria-busy="true"], [data-preview-state="loading"], img:not([src=""])',
    ) !== null || this.#root.ownerDocument.fonts?.status === 'loading'
    if (!pending) {
      publish()
      return
    }
    void this.#presentation.settle().then(publish).catch((failure: unknown) => {
      this.#emitError(createPublicError(
        'ASSET_MISSING',
        failure instanceof Error ? failure.message : 'The Renderer presentation did not settle.',
        { actionHints: ['inspect-asset'], retryable: true },
      ))
    })
  }

  snapshot(): WRendererSnapshot {
    return rendererSnapshot(this.#document, this.#profile)
  }

  setMarkdown(markdown: string): WRendererSnapshot {
    this.#assertActive()
    const nextMarkdown = normalizeMarkdown(markdown)
    if (nextMarkdown === this.#document.markdown) return this.snapshot()
    this.#document = createDocumentSnapshot({
      documentId: this.#document.documentId,
      markdown: nextMarkdown,
      revision: this.#document.revision + 1,
    })
    this.#presentation.setSnapshot(this.#document)
    return this.snapshot()
  }

  destroy(): Promise<WDestroyResult> {
    if (this.#destroyPromise !== null) return this.#destroyPromise
    if (this.#destroyed) return Promise.resolve({ status: 'destroyed' })
    this.#destroyed = true
    this.#presentation.destroy()
    this.#domService.destroy()
    this.#settings.destroy()
    this.#root.remove()
    this.#destroyPromise = Promise.resolve(Object.freeze({ status: 'destroyed' as const }))
    return this.#destroyPromise
  }

  #emitError(error: WEditorError): void {
    this.#onError?.(Object.freeze({
      apiVersion: WEB_API_VERSION,
      error,
      instanceId: this.instanceId,
      snapshot: this.snapshot(),
      type: 'error',
    }) satisfies WEditorErrorEvent)
  }

  #assertActive(): void {
    if (this.#destroyed) throw new WEditorContractError(createPublicError('DESTROYED', 'This W-Editor instance has been destroyed.'))
  }
}

export function mountWRenderer(container: HTMLElement, options: WRendererMountOptions): WRendererInstance {
  if (!isHtmlElement(container)) {
    throw new WEditorContractError(createPublicError('INVALID_MOUNT', 'mountWRenderer requires an HTMLElement container.'))
  }
  if (typeof options !== 'object' || options === null) {
    throw new WEditorContractError(createPublicError('INVALID_MOUNT', 'mountWRenderer requires mount options.'))
  }
  const compatibility = checkWebHostCompatibility(options)
  if (!compatibility.compatible) throw new WEditorContractError(compatibility.error)
  const root = container.ownerDocument.createElement('div')
  container.append(root)
  try {
    const instance = new WRendererController(root, options)
    instance.initializeSettings(() => instance.emitReady())
    return instance
  } catch (failure) {
    root.remove()
    if (failure instanceof WEditorContractError) throw failure
    throw new WEditorContractError(createPublicError(
      'INVALID_MOUNT',
      failure instanceof Error ? failure.message : 'The Renderer could not be mounted.',
    ))
  }
}
