import { describe, expect, it, vi } from 'vitest'

import type { DocumentSnapshot } from '../../src/core'
import { AutosaveCoordinator } from '../../src/services/autosaveCoordinator'

function document(revision: number): DocumentSnapshot {
  return Object.freeze({ documentId: 'welcome', markdown: `revision ${revision}`, revision })
}

describe('AutosaveCoordinator', () => {
  it('coalesces to the latest revision at trailing 1000 ms', async () => {
    const persist = vi.fn()
    const autosave = new AutosaveCoordinator({ persist })
    autosave.request(document(1))
    await vi.advanceTimersByTimeAsync(800)
    autosave.request(document(2))
    await vi.advanceTimersByTimeAsync(999)
    expect(persist).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)

    expect(persist).toHaveBeenCalledOnce()
    expect(persist).toHaveBeenCalledWith(document(2))
    expect(autosave.snapshot()).toEqual({ failure: null, revision: 2, status: 'saved' })
    autosave.destroy()
  })

  it('persists at maximum wait 5000 ms during continuous changes', async () => {
    const persist = vi.fn()
    const autosave = new AutosaveCoordinator({ persist })
    for (let revision = 1; revision <= 5; revision += 1) {
      autosave.request(document(revision))
      await vi.advanceTimersByTimeAsync(999)
    }
    expect(persist).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(5)

    expect(persist).toHaveBeenCalledWith(document(5))
    autosave.destroy()
  })

  it('publishes pending, saving, saved, and failed without losing the in-memory revision', async () => {
    const failure = Object.assign(new Error('quota exceeded'), { code: 'QUOTA_EXCEEDED' })
    const states: string[] = []
    const autosave = new AutosaveCoordinator({ persist: async () => { throw failure } })
    autosave.subscribe((state) => states.push(state.status))
    autosave.request(document(7))

    await expect(autosave.flush()).rejects.toBe(failure)

    expect(states).toEqual(['pending', 'saving', 'failed'])
    expect(autosave.snapshot()).toMatchObject({
      failure: { actions: ['retry', 'raw-export'], code: 'QUOTA_EXCEEDED', message: 'quota exceeded' },
      revision: 7,
      status: 'failed',
    })
    autosave.destroy()
  })

  it('exposes quota recovery actions while retaining the requested in-memory snapshot', async () => {
    const failure = Object.assign(new Error('Current Markdown remains in memory.'), {
      code: 'LOCAL_PERSISTENCE_QUOTA_EXCEEDED',
    })
    let authoritative = document(11)
    const autosave = new AutosaveCoordinator({ persist: async (snapshot) => {
      authoritative = snapshot
      throw failure
    } })
    autosave.request(authoritative)

    await expect(autosave.flush()).rejects.toBe(failure)

    expect(authoritative.markdown).toBe('revision 11')
    expect(autosave.snapshot()).toMatchObject({
      failure: {
        actions: ['retry', 'raw-export'],
        code: 'LOCAL_PERSISTENCE_QUOTA_EXCEEDED',
      },
      revision: 11,
      status: 'failed',
    })
    autosave.destroy()
  })

  it('retries the last authoritative snapshot after a visible persistence failure', async () => {
    const failure = Object.assign(new Error('temporary storage failure'), { code: 'AUTOSAVE_FAILED' })
    const persist = vi.fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined)
    const autosave = new AutosaveCoordinator({ persist })
    autosave.request(document(12))

    await expect(autosave.flush()).rejects.toBe(failure)
    await autosave.retry()

    expect(persist).toHaveBeenCalledTimes(2)
    expect(persist).toHaveBeenLastCalledWith(document(12))
    expect(autosave.snapshot()).toEqual({ failure: null, revision: 12, status: 'saved' })
    autosave.destroy()
  })

  it('force-flushes the latest pending revision on pagehide', async () => {
    const persist = vi.fn()
    const autosave = new AutosaveCoordinator({ pageLifecycle: window, persist })
    autosave.request(document(9))

    window.dispatchEvent(new PageTransitionEvent('pagehide'))
    await vi.runAllTimersAsync()

    expect(persist).toHaveBeenCalledOnce()
    expect(persist).toHaveBeenCalledWith(document(9))
    expect(autosave.snapshot().status).toBe('saved')
    autosave.destroy()
  })
})
