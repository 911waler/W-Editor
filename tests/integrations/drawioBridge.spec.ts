import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  configuredDrawioEditorUrl,
  DrawioBridgeConfigurationError,
  DrawioBridgeController,
  LOCAL_DRAWIO_EDITOR_PATH,
  type DrawioBridgeWindow,
} from '../../src/integrations/drawioBridge'

const controllers: DrawioBridgeController[] = []

afterEach(() => {
  while (controllers.length > 0) controllers.pop()?.destroy()
})

function bridgeWindow() {
  return { postMessage: vi.fn<DrawioBridgeWindow['postMessage']>() }
}

function message(source: DrawioBridgeWindow, origin: string, data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', {
    data,
    origin,
    source: source as unknown as MessageEventSource,
  }))
}

function setup() {
  const editor = bridgeWindow()
  const parent = bridgeWindow()
  const controller = new DrawioBridgeController({
    editorOrigin: 'https://app.example.test',
    editorWindow: editor,
    parentOrigin: 'https://app.example.test',
    parentWindow: parent,
  })
  controllers.push(controller)
  return { controller, editor, parent }
}

describe('DrawioBridgeController', () => {
  it('defaults to the pinned same-origin Cherry editor and rejects remote or credentialed URLs', () => {
    expect(configuredDrawioEditorUrl('', 'https://app.example.test/drawio-bridge.html')).toEqual({
      origin: 'https://app.example.test',
      url: `https://app.example.test${LOCAL_DRAWIO_EDITOR_PATH}`,
    })
    expect(configuredDrawioEditorUrl('/e2e/fixtures/drawio/fake-drawio.html', 'https://app.example.test/drawio-bridge.html')).toEqual({
      origin: 'https://app.example.test',
      url: 'https://app.example.test/e2e/fixtures/drawio/fake-drawio.html',
    })
    expect(() => configuredDrawioEditorUrl('https://embed.diagrams.net/', 'https://app.example.test/drawio-bridge.html')).toThrow(DrawioBridgeConfigurationError)
    expect(() => configuredDrawioEditorUrl('https://user:secret@app.example.test/', 'https://app.example.test/drawio-bridge.html')).toThrow(DrawioBridgeConfigurationError)
  })

  it('correlates one outer request across Cherry ready, setData, explicit getData, and PNG save', () => {
    const { editor, parent } = setup()
    const existingXml = '<mxfile><diagram><mxGraphModel><root/></mxGraphModel></diagram></mxfile>'
    message(parent, 'https://app.example.test', {
      requestId: 'request-001',
      type: 'w-editor:drawio:load',
      xml: existingXml,
    })
    expect(editor.postMessage).not.toHaveBeenCalled()

    message(editor, 'https://app.example.test', { eventName: 'ready', value: '' })
    expect(editor.postMessage).toHaveBeenCalledWith({
      eventName: 'setData',
      value: existingXml,
    }, 'https://app.example.test')
    message(editor, 'https://app.example.test', { eventName: 'setData:success', value: '' })
    expect(parent.postMessage).toHaveBeenCalledWith({
      requestId: 'request-001',
      type: 'w-editor:drawio:ready',
    }, 'https://app.example.test')

    message(parent, 'https://app.example.test', {
      requestId: 'request-001',
      type: 'w-editor:drawio:save-request',
    })
    expect(editor.postMessage).toHaveBeenLastCalledWith({
      eventName: 'getData',
      value: '',
    }, 'https://app.example.test')

    const graphXml = '<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>'
    message(editor, 'https://app.example.test', {
      eventName: 'getData:success',
      value: {
        base64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
        xmlData: graphXml,
      },
    })
    expect(parent.postMessage).toHaveBeenLastCalledWith({
      png: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
      requestId: 'request-001',
      type: 'w-editor:drawio:save',
      xml: `<mxfile host="W-Editor"><diagram id="page-1" name="Page-1">${graphXml}</diagram></mxfile>`,
    }, 'https://app.example.test')
  })

  it('ignores save requests before the active diagram is ready and duplicate requests while saving', () => {
    const { editor, parent } = setup()
    message(parent, 'https://app.example.test', {
      requestId: 'request-001',
      type: 'w-editor:drawio:load',
      xml: '<mxfile><diagram><mxGraphModel><root/></mxGraphModel></diagram></mxfile>',
    })
    message(parent, 'https://app.example.test', {
      requestId: 'request-001',
      type: 'w-editor:drawio:save-request',
    })
    expect(editor.postMessage).not.toHaveBeenCalled()
    message(editor, 'https://app.example.test', { eventName: 'ready', value: '' })
    message(editor, 'https://app.example.test', { eventName: 'setData:success', value: '' })
    message(parent, 'https://app.example.test', { requestId: 'request-001', type: 'w-editor:drawio:save-request' })
    message(parent, 'https://app.example.test', { requestId: 'request-001', type: 'w-editor:drawio:save-request' })
    expect(editor.postMessage).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['hostile parent origin', 'parent', 'https://hostile.test', { requestId: 'request-001', type: 'w-editor:drawio:load', xml: '' }],
    ['wrong parent source', 'other', 'https://app.example.test', { requestId: 'request-001', type: 'w-editor:drawio:load', xml: '' }],
    ['hostile editor origin', 'editor', 'https://hostile.test', { eventName: 'ready' }],
    ['wrong editor source', 'other', 'https://app.example.test', { eventName: 'ready' }],
  ] as const)('ignores %s', (_case, sourceKind, origin, data) => {
    const { editor, parent } = setup()
    const source = sourceKind === 'parent' ? parent : sourceKind === 'editor' ? editor : bridgeWindow()
    message(source, origin, data)
    expect(editor.postMessage).not.toHaveBeenCalled()
    expect(parent.postMessage).not.toHaveBeenCalled()
  })
})
