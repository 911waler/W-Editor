import { describe, expect, it, vi } from 'vitest'

import {
  FullscreenController,
  FullscreenOperationError,
  type FullscreenDocumentPort,
  type FullscreenTargetPort,
} from '../../src/services/fullscreenController'

function harness(options: { readonly requestFailure?: Error } = {}) {
  const listeners = new Map<string, Set<EventListener>>()
  const target = document.createElement('main') as FullscreenTargetPort
  let fullscreenElement: Element | null = null
  const emit = (type: string) => {
    for (const listener of listeners.get(type) ?? []) listener(new Event(type))
  }
  const requestFullscreen = vi.fn(async () => {
    if (options.requestFailure !== undefined) throw options.requestFailure
    fullscreenElement = target
    emit('fullscreenchange')
  })
  Object.defineProperty(target, 'requestFullscreen', { configurable: true, value: requestFullscreen })
  const port: FullscreenDocumentPort = {
    addEventListener: (type, listener) => {
      const set = listeners.get(type) ?? new Set<EventListener>()
      set.add(listener)
      listeners.set(type, set)
    },
    exitFullscreen: vi.fn(async () => {
      fullscreenElement = null
      emit('fullscreenchange')
    }),
    get fullscreenElement() { return fullscreenElement },
    removeEventListener: (type, listener) => listeners.get(type)?.delete(listener),
  }
  return { emit, listeners, port, requestFullscreen, target }
}

describe('FullscreenController', () => {
  it('enters, exits, publishes browser state, and cleans listeners and active fullscreen on destroy', async () => {
    const { listeners, port, target } = harness()
    const controller = new FullscreenController({ document: port, target })
    const states = vi.fn()
    controller.subscribe(states)

    await expect(controller.toggle()).resolves.toMatchObject({ active: true, status: 'active' })
    await expect(controller.toggle()).resolves.toMatchObject({ active: false, status: 'idle' })
    await controller.toggle()
    controller.destroy()

    expect(port.exitFullscreen).toHaveBeenCalledTimes(2)
    expect(listeners.get('fullscreenchange')).toHaveLength(0)
    expect(listeners.get('fullscreenerror')).toHaveLength(0)
    expect(states.mock.calls.flat().map((state) => state.status)).toContain('entering')
    expect(states.mock.calls.flat().map((state) => state.status)).toContain('exiting')
  })

  it('retains a visible failure state when the browser rejects entry', async () => {
    const { port, target } = harness({ requestFailure: new Error('Permission denied.') })
    const controller = new FullscreenController({ document: port, target })

    await expect(controller.toggle()).rejects.toMatchObject({
      code: 'FULLSCREEN_OPERATION_FAILED',
      message: 'Permission denied.',
    })
    expect(controller.snapshot()).toEqual({
      active: false,
      failure: expect.any(FullscreenOperationError),
      status: 'failed',
    })
    controller.destroy()
  })
})
