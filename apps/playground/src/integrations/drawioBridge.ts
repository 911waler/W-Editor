export interface DrawioBridgeWindow {
  readonly postMessage: (message: unknown, targetOrigin: string) => void
}

export interface DrawioBridgeOptions {
  readonly editorOrigin: string
  readonly editorWindow: DrawioBridgeWindow
  readonly messageTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'>
  readonly parentOrigin: string
  readonly parentWindow: DrawioBridgeWindow
}

interface ActiveBridgeRequest {
  readonly requestId: string
  readonly xml: string
}

export const LOCAL_DRAWIO_EDITOR_PATH = '/vendor/cherry-drawio/drawio_demo.html'

export class DrawioBridgeConfigurationError extends Error {
  readonly code = 'DRAWIO_BRIDGE_CONFIGURATION_INVALID'

  constructor(message: string) {
    super(message)
    this.name = 'DrawioBridgeConfigurationError'
  }
}

function exactOrigin(value: string, field: string): string {
  try {
    const url = new URL(value)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:')
      || url.username.length > 0
      || url.password.length > 0
      || url.href !== `${url.origin}/`) throw new TypeError()
    return url.origin
  } catch {
    throw new DrawioBridgeConfigurationError(`${field} must be an exact HTTP(S) origin.`)
  }
}

function httpUrl(value: string, base?: string): URL {
  const url = base === undefined ? new URL(value) : new URL(value, base)
  if ((url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.username.length > 0
    || url.password.length > 0) throw new TypeError()
  return url
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function validRequestId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function validGraphXml(value: unknown): value is string {
  return typeof value === 'string' && /^\s*<mxGraphModel(?:\s|>)/u.test(value)
}

function validPng(value: unknown): value is string {
  return typeof value === 'string'
    && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u.test(value)
}

function mxfileFromGraphXml(graphXml: string): string {
  return `<mxfile host="W-Editor"><diagram id="page-1" name="Page-1">${graphXml}</diagram></mxfile>`
}

export function configuredDrawioEditorUrl(
  value: string,
  baseHref: string,
): Readonly<{ origin: string; url: string }> {
  try {
    const base = httpUrl(baseHref)
    const url = httpUrl(value.trim().length > 0 ? value : LOCAL_DRAWIO_EDITOR_PATH, base.href)
    if (url.origin !== base.origin) throw new TypeError()
    return Object.freeze({ origin: url.origin, url: url.href })
  } catch {
    throw new DrawioBridgeConfigurationError('draw.io editor URL must be a same-origin HTTP(S) URL without credentials.')
  }
}

export class DrawioBridgeController {
  readonly editorOrigin: string
  readonly parentOrigin: string
  readonly #editorWindow: DrawioBridgeWindow
  readonly #messageTarget: Pick<Window, 'addEventListener' | 'removeEventListener'>
  readonly #parentWindow: DrawioBridgeWindow
  #active: ActiveBridgeRequest | null = null
  #destroyed = false
  #editorInitialized = false
  #loadAcknowledgedForRequest: string | null = null
  #loadSentForRequest: string | null = null
  #savePendingForRequest: string | null = null

  constructor(options: DrawioBridgeOptions) {
    this.editorOrigin = exactOrigin(options.editorOrigin, 'draw.io editor origin')
    this.parentOrigin = exactOrigin(options.parentOrigin, 'W-Editor parent origin')
    this.#editorWindow = options.editorWindow
    this.#parentWindow = options.parentWindow
    this.#messageTarget = options.messageTarget ?? window
    this.#messageTarget.addEventListener('message', this.#handleMessage as EventListener)
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    this.#active = null
    this.#savePendingForRequest = null
    this.#messageTarget.removeEventListener('message', this.#handleMessage as EventListener)
  }

  readonly #handleMessage = (event: MessageEvent<unknown>): void => {
    if (this.#destroyed) return
    if (event.source === this.#parentWindow && event.origin === this.parentOrigin) {
      this.#handleParentMessage(event.data)
      return
    }
    if (event.source === this.#editorWindow && event.origin === this.editorOrigin) {
      this.#handleEditorMessage(event.data)
    }
  }

  #handleParentMessage(value: unknown): void {
    const data = record(value)
    if (data === null || !validRequestId(data['requestId'])) return
    const requestId = data['requestId'].trim()
    if (data['type'] === 'w-editor:drawio:load') {
      if (typeof data['xml'] !== 'string') return
      if (this.#active !== null && this.#active.requestId !== requestId) return
      this.#active = Object.freeze({ requestId, xml: data['xml'] })
      this.#sendLoadIfReady()
      return
    }
    const active = this.#active
    if (data['type'] !== 'w-editor:drawio:save-request'
      || active === null
      || active.requestId !== requestId
      || this.#loadAcknowledgedForRequest !== requestId
      || this.#savePendingForRequest !== null) return
    this.#savePendingForRequest = requestId
    this.#editorWindow.postMessage(Object.freeze({
      eventName: 'getData',
      value: '',
    }), this.editorOrigin)
  }

  #handleEditorMessage(value: unknown): void {
    const data = record(value)
    if (data === null || typeof data['eventName'] !== 'string') return
    if (data['eventName'] === 'ready') {
      this.#editorInitialized = true
      this.#sendLoadIfReady()
      return
    }
    const active = this.#active
    if (active === null) return
    if (data['eventName'] === 'setData:success') {
      if (this.#loadSentForRequest !== active.requestId) return
      this.#loadAcknowledgedForRequest = active.requestId
      this.#postParent({ requestId: active.requestId, type: 'w-editor:drawio:ready' })
      return
    }
    if (data['eventName'] !== 'getData:success'
      || this.#savePendingForRequest !== active.requestId) return
    const payload = record(data['value'])
    if (payload === null || !validGraphXml(payload['xmlData']) || !validPng(payload['base64'])) return
    const xml = mxfileFromGraphXml(payload['xmlData'])
    const png = payload['base64']
    this.#active = null
    this.#savePendingForRequest = null
    this.#postParent({
      png,
      requestId: active.requestId,
      type: 'w-editor:drawio:save',
      xml,
    })
  }

  #sendLoadIfReady(): void {
    const active = this.#active
    if (!this.#editorInitialized || active === null || this.#loadSentForRequest === active.requestId) return
    this.#loadSentForRequest = active.requestId
    this.#editorWindow.postMessage(Object.freeze({
      eventName: 'setData',
      value: active.xml,
    }), this.editorOrigin)
  }

  #postParent(message: unknown): void {
    this.#parentWindow.postMessage(Object.freeze(message), this.parentOrigin)
  }
}
