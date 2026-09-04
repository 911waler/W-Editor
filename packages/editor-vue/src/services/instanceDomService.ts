import { createRandomId } from './randomId'

export const INSTANCE_DOM_SERVICE_VERSION = '1.0.0' as const

export interface InstanceDomServiceOptions {
  readonly instanceId?: string
}

type OwnedEventTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>

function normalizeIdPart(value: string): string {
  const normalized = value.toLocaleLowerCase().replace(/[^a-z\d]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return normalized.length > 0 ? normalized : 'instance'
}

function generatedInstanceId(): string {
  const random = createRandomId().slice(0, 12)
  return `instance-${normalizeIdPart(random)}`
}

export class InstanceDomService {
  readonly instanceId: string
  readonly root: HTMLElement
  readonly overlayRoot: HTMLDivElement
  readonly #disposers = new Set<() => void>()
  #destroyed = false

  constructor(root: HTMLElement, options: InstanceDomServiceOptions = {}) {
    this.root = root
    this.instanceId = normalizeIdPart(options.instanceId ?? generatedInstanceId())
    this.root.dataset['wEditorInstance'] = this.instanceId
    this.root.setAttribute('data-w-editor-instance', this.instanceId)
    this.overlayRoot = root.ownerDocument.createElement('div')
    this.overlayRoot.id = this.createId('overlay')
    this.overlayRoot.className = 'w-editor-instance-overlay'
    this.overlayRoot.dataset['wEditorOverlay'] = this.instanceId
    this.overlayRoot.setAttribute('aria-hidden', 'true')
    this.root.append(this.overlayRoot)
  }

  createId(suffix: string): string {
    return `w-editor-${this.instanceId}-${normalizeIdPart(suffix)}`
  }

  query<T extends Element = HTMLElement>(selector: string): T | null {
    return this.root.querySelector<T>(selector)
  }

  queryAll<T extends Element = HTMLElement>(selector: string): readonly T[] {
    return Object.freeze([...this.root.querySelectorAll<T>(selector)])
  }

  listen(
    target: OwnedEventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ): () => void {
    if (this.#destroyed) throw new Error('InstanceDomService has been destroyed.')
    target.addEventListener(type, listener, options)
    const dispose = (): void => {
      target.removeEventListener(type, listener, options)
      this.#disposers.delete(dispose)
    }
    this.#disposers.add(dispose)
    return dispose
  }

  observe(
    observer: { readonly disconnect: () => void; readonly observe: (target: Node, options: MutationObserverInit) => void },
    target: Node,
    options: MutationObserverInit,
  ): () => void {
    if (this.#destroyed) throw new Error('InstanceDomService has been destroyed.')
    observer.observe(target, options)
    const dispose = (): void => {
      observer.disconnect()
      this.#disposers.delete(dispose)
    }
    this.#disposers.add(dispose)
    return dispose
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    for (const dispose of [...this.#disposers]) dispose()
    this.#disposers.clear()
    this.overlayRoot.remove()
    if (this.root.dataset['wEditorInstance'] === this.instanceId) {
      delete this.root.dataset['wEditorInstance']
      this.root.removeAttribute('data-w-editor-instance')
    }
  }
}

export function createInstanceDomService(root: HTMLElement, options: InstanceDomServiceOptions = {}): InstanceDomService {
  return new InstanceDomService(root, options)
}
