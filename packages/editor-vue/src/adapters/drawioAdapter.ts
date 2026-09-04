export interface DrawioSavePayload {
  readonly png: string
  readonly xml: string
}

export interface DrawioRequestHandlers {
  readonly onCancel: () => void
  readonly onReady: () => void
  readonly onSave: (payload: DrawioSavePayload) => void
}

export interface DrawioRequest {
  readonly handlers: DrawioRequestHandlers
  readonly iframeWindow: Window
  readonly initialXml: string
  readonly requestId: string
}

export interface DrawioSession {
  readonly cancel: () => boolean
  readonly editorUrl: string
  readonly notifyLoaded: () => boolean
  readonly requestSave: () => boolean
  readonly requestId: string
}

export interface DrawioAdapterPort {
  readonly editorUrl: string
  readonly begin: (request: DrawioRequest) => DrawioSession
}

export interface DrawioAdapterOptions {
  readonly allowedOrigin: string
  readonly editorUrl: string
  readonly messageTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'>
}

type ActiveDrawioRequest = DrawioRequest

export class DrawioAdapterConfigurationError extends Error {
  readonly code = 'DRAWIO_CONFIGURATION_INVALID'

  constructor(message: string) {
    super(message)
    this.name = 'DrawioAdapterConfigurationError'
  }
}

export class DrawioRequestActiveError extends Error {
  readonly code = 'DRAWIO_REQUEST_ACTIVE'

  constructor() {
    super('A draw.io request is already active.')
    this.name = 'DrawioRequestActiveError'
  }
}

function configuredUrl(value: string, field: string): URL {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TypeError()
    if (url.username.length > 0 || url.password.length > 0) throw new TypeError()
    return url
  } catch {
    throw new DrawioAdapterConfigurationError(`${field} must be an absolute HTTP(S) URL without credentials.`)
  }
}

function savePayload(value: unknown): DrawioSavePayload | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record['xml'] !== 'string' || !/^\s*<mxfile(?:\s|>)/u.test(record['xml'])) return null
  if (typeof record['png'] !== 'string'
    || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u.test(record['png'])) return null
  return Object.freeze({ png: record['png'], xml: record['xml'] })
}

export class DrawioAdapter {
  readonly allowedOrigin: string
  readonly editorUrl: string
  readonly #messageTarget: Pick<Window, 'addEventListener' | 'removeEventListener'>
  #active: ActiveDrawioRequest | null = null
  #destroyed = false

  constructor(options: DrawioAdapterOptions) {
    const editorUrl = configuredUrl(options.editorUrl, 'draw.io editor URL')
    const allowedOrigin = configuredUrl(options.allowedOrigin, 'draw.io allowed origin')
    if (editorUrl.origin !== allowedOrigin.origin || allowedOrigin.href !== `${allowedOrigin.origin}/`) {
      throw new DrawioAdapterConfigurationError('draw.io editor URL and exact allowed origin must have the same origin.')
    }
    this.editorUrl = editorUrl.href
    this.allowedOrigin = allowedOrigin.origin
    this.#messageTarget = options.messageTarget ?? window
    this.#messageTarget.addEventListener('message', this.#handleMessage as EventListener)
  }

  begin(request: DrawioRequest): DrawioSession {
    if (this.#destroyed) throw new Error('DrawioAdapter is destroyed.')
    if (this.#active !== null) throw new DrawioRequestActiveError()
    const requestId = request.requestId.trim()
    if (requestId.length === 0) throw new TypeError('draw.io request identity is required.')
    this.#active = Object.freeze({ ...request, requestId })
    return Object.freeze({
      cancel: () => this.#cancel(requestId),
      editorUrl: this.editorUrl,
      notifyLoaded: () => this.#notifyLoaded(requestId),
      requestSave: () => this.#requestSave(requestId),
      requestId,
    })
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    this.#active = null
    this.#messageTarget.removeEventListener('message', this.#handleMessage as EventListener)
  }

  #cancel(requestId: string): boolean {
    const active = this.#active
    if (active === null || active.requestId !== requestId) return false
    this.#active = null
    active.handlers.onCancel()
    return true
  }

  #notifyLoaded(requestId: string): boolean {
    const active = this.#active
    if (active === null || active.requestId !== requestId) return false
    active.iframeWindow.postMessage(Object.freeze({
      requestId,
      type: 'w-editor:drawio:load',
      xml: active.initialXml,
    }), this.allowedOrigin)
    return true
  }

  #requestSave(requestId: string): boolean {
    const active = this.#active
    if (active === null || active.requestId !== requestId) return false
    active.iframeWindow.postMessage(Object.freeze({
      requestId,
      type: 'w-editor:drawio:save-request',
    }), this.allowedOrigin)
    return true
  }

  readonly #handleMessage = (event: MessageEvent<unknown>): void => {
    const active = this.#active
    if (active === null || event.origin !== this.allowedOrigin || event.source !== active.iframeWindow) return
    if (typeof event.data !== 'object' || event.data === null || Array.isArray(event.data)) return
    const data = event.data as Record<string, unknown>
    if (data['requestId'] !== active.requestId || typeof data['type'] !== 'string') return
    if (data['type'] === 'w-editor:drawio:ready') {
      active.handlers.onReady()
      return
    }
    if (data['type'] === 'w-editor:drawio:cancel') {
      this.#active = null
      active.handlers.onCancel()
      return
    }
    if (data['type'] !== 'w-editor:drawio:save') return
    const payload = savePayload(data)
    if (payload === null) return
    this.#active = null
    active.handlers.onSave(payload)
  }
}
