import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DrawioAdapter,
  DrawioAdapterConfigurationError,
  DrawioRequestActiveError,
} from '../../src/adapters'

const adapters: DrawioAdapter[] = []

afterEach(() => {
  while (adapters.length > 0) adapters.pop()?.destroy()
})

function iframeWindow(): Window & { postMessage: ReturnType<typeof vi.fn> } {
  return { postMessage: vi.fn() } as unknown as Window & { postMessage: ReturnType<typeof vi.fn> }
}

function message(source: Window, origin: string, data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { data, origin, source }))
}

function setup() {
  const frame = iframeWindow()
  const handlers = {
    onCancel: vi.fn(),
    onReady: vi.fn(),
    onSave: vi.fn(),
  }
  const adapter = new DrawioAdapter({
    allowedOrigin: 'https://embed.diagrams.example.test',
    editorUrl: 'https://embed.diagrams.example.test/editor?embed=1',
  })
  adapters.push(adapter)
  const session = adapter.begin({
    handlers,
    iframeWindow: frame,
    initialXml: '<mxfile><diagram>existing</diagram></mxfile>',
    requestId: 'request-001',
  })
  return { adapter, frame, handlers, session }
}

describe('DrawioAdapter controlled message protocol', () => {
  it('posts the load message only to the configured exact origin and active iframe', () => {
    const { frame, session } = setup()
    expect(session.editorUrl).toBe('https://embed.diagrams.example.test/editor?embed=1')
    expect(session.notifyLoaded()).toBe(true)
    expect(frame.postMessage).toHaveBeenCalledWith({
      requestId: 'request-001',
      type: 'w-editor:drawio:load',
      xml: '<mxfile><diagram>existing</diagram></mxfile>',
    }, 'https://embed.diagrams.example.test')
    expect(session.requestSave()).toBe(true)
    expect(frame.postMessage).toHaveBeenLastCalledWith({
      requestId: 'request-001',
      type: 'w-editor:drawio:save-request',
    }, 'https://embed.diagrams.example.test')
  })

  it('accepts ready and one valid PNG/XML save payload for the active request', () => {
    const { frame, handlers } = setup()
    message(frame, 'https://embed.diagrams.example.test', {
      requestId: 'request-001',
      type: 'w-editor:drawio:ready',
    })
    expect(handlers.onReady).toHaveBeenCalledOnce()

    const payload = {
      png: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
      xml: '<mxfile><diagram id="fixture">fixture</diagram></mxfile>',
    }
    message(frame, 'https://embed.diagrams.example.test', {
      ...payload,
      requestId: 'request-001',
      type: 'w-editor:drawio:save',
    })
    expect(handlers.onSave).toHaveBeenCalledWith(payload)
    message(frame, 'https://embed.diagrams.example.test', {
      ...payload,
      requestId: 'request-001',
      type: 'w-editor:drawio:save',
    })
    expect(handlers.onSave).toHaveBeenCalledOnce()
  })

  it.each([
    ['wrong origin', 'https://hostile.example.test', 'active', 'w-editor:drawio:save', '<mxfile/>', 'data:image/png;base64,AAAA'],
    ['wrong source', 'https://embed.diagrams.example.test', 'other', 'w-editor:drawio:save', '<mxfile/>', 'data:image/png;base64,AAAA'],
    ['wrong request', 'https://embed.diagrams.example.test', 'active', 'w-editor:drawio:save', '<mxfile/>', 'data:image/png;base64,AAAA'],
    ['unknown event', 'https://embed.diagrams.example.test', 'active', 'hostile:event', '<mxfile/>', 'data:image/png;base64,AAAA'],
    ['invalid XML', 'https://embed.diagrams.example.test', 'active', 'w-editor:drawio:save', '<svg/>', 'data:image/png;base64,AAAA'],
    ['invalid PNG', 'https://embed.diagrams.example.test', 'active', 'w-editor:drawio:save', '<mxfile/>', 'data:image/svg+xml;base64,AAAA'],
  ] as const)('rejects %s without applying or cancelling', (_case, origin, sourceKind, type, xml, png) => {
    const { frame, handlers } = setup()
    const source = sourceKind === 'active' ? frame : iframeWindow()
    message(source, origin, {
      png,
      requestId: _case === 'wrong request' ? 'request-hostile' : 'request-001',
      type,
      xml,
    })
    expect(handlers.onSave).not.toHaveBeenCalled()
    expect(handlers.onCancel).not.toHaveBeenCalled()
  })

  it('handles iframe and application cancellation once and enforces one active request', () => {
    const first = setup()
    expect(() => first.adapter.begin({
      handlers: first.handlers,
      iframeWindow: first.frame,
      initialXml: '',
      requestId: 'request-002',
    })).toThrow(DrawioRequestActiveError)

    message(first.frame, 'https://embed.diagrams.example.test', {
      requestId: 'request-001',
      type: 'w-editor:drawio:cancel',
    })
    expect(first.handlers.onCancel).toHaveBeenCalledOnce()
    expect(first.session.cancel()).toBe(false)

    const second = setup()
    expect(second.session.cancel()).toBe(true)
    expect(second.handlers.onCancel).toHaveBeenCalledOnce()
    expect(second.session.notifyLoaded()).toBe(false)
    expect(second.session.requestSave()).toBe(false)
  })

  it('rejects unsafe or mismatched configuration before registering a request', () => {
    expect(() => new DrawioAdapter({
      allowedOrigin: 'https://embed.diagrams.example.test',
      editorUrl: 'https://other.example.test/editor',
    })).toThrow(DrawioAdapterConfigurationError)
    expect(() => new DrawioAdapter({
      allowedOrigin: 'https://embed.diagrams.example.test/path',
      editorUrl: 'https://embed.diagrams.example.test/editor',
    })).toThrow(DrawioAdapterConfigurationError)
    expect(() => new DrawioAdapter({
      allowedOrigin: 'javascript:alert(1)',
      editorUrl: 'https://embed.diagrams.example.test/editor',
    })).toThrow(DrawioAdapterConfigurationError)
  })
})
