import { describe, expect, it, vi } from 'vitest'

import { BoundedScheduler } from '../../src/core/boundedScheduler'

function schedulerFor(
  run: (batch: readonly number[]) => void | Promise<void>,
): BoundedScheduler<readonly number[]> {
  return new BoundedScheduler({
    coalesce: (pending, next) => Object.freeze([...pending, ...next]),
    maxWaitMs: 1_000,
    run,
    trailingDelayMs: 250,
  })
}

describe('BoundedScheduler', () => {
  it('resets the trailing delay while preserving one maximum-wait deadline', async () => {
    const run = vi.fn<(batch: readonly number[]) => void>()
    const scheduler = schedulerFor(run)

    scheduler.request([1])
    await vi.advanceTimersByTimeAsync(200)
    scheduler.request([2])
    await vi.advanceTimersByTimeAsync(200)
    scheduler.request([3])
    await vi.advanceTimersByTimeAsync(200)
    scheduler.request([4])
    await vi.advanceTimersByTimeAsync(200)
    scheduler.request([5])

    expect(run).not.toHaveBeenCalled()
    expect(scheduler.snapshot()).toEqual({ failure: null, pending: true, status: 'pending' })

    await vi.advanceTimersByTimeAsync(200)

    expect(run).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledWith([1, 2, 3, 4, 5])
    expect(scheduler.snapshot()).toEqual({ failure: null, pending: false, status: 'idle' })
  })

  it('runs after the trailing delay when requests stop', async () => {
    const run = vi.fn<(batch: readonly number[]) => void>()
    const scheduler = schedulerFor(run)

    scheduler.request([1])
    await vi.advanceTimersByTimeAsync(249)
    expect(run).not.toHaveBeenCalled()
    scheduler.request([2])
    await vi.advanceTimersByTimeAsync(249)
    expect(run).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)

    expect(run).toHaveBeenCalledWith([1, 2])
  })

  it('cancels pending work and both deadlines without invoking the runner', async () => {
    const run = vi.fn<(batch: readonly number[]) => void>()
    const scheduler = schedulerFor(run)

    scheduler.request([1])
    expect(scheduler.cancel()).toBe(true)
    expect(scheduler.cancel()).toBe(false)
    await vi.advanceTimersByTimeAsync(2_000)

    expect(run).not.toHaveBeenCalled()
    expect(scheduler.snapshot()).toEqual({ failure: null, pending: false, status: 'idle' })
  })

  it('force-flushes immediately and resolves only after the runner completes', async () => {
    let release: (() => void) | undefined
    const run = vi.fn(() => new Promise<void>((resolve) => {
      release = resolve
    }))
    const scheduler = schedulerFor(run)
    scheduler.request([1])

    const flushed = scheduler.flush()
    await Promise.resolve()
    expect(run).toHaveBeenCalledWith([1])
    expect(scheduler.snapshot()).toEqual({ failure: null, pending: false, status: 'running' })

    release?.()
    await flushed

    expect(scheduler.snapshot()).toEqual({ failure: null, pending: false, status: 'idle' })
    await vi.advanceTimersByTimeAsync(2_000)
    expect(run).toHaveBeenCalledOnce()
  })

  it('retains an observable failure and rejects a forced flush', async () => {
    const failure = new Error('patch serialization failed')
    const scheduler = schedulerFor(async () => {
      throw failure
    })
    scheduler.request([1])

    await expect(scheduler.flush()).rejects.toBe(failure)

    expect(scheduler.snapshot()).toEqual({ failure, pending: false, status: 'failed' })
  })

  it('serially drains a re-entrant request before a forced flush resolves', async () => {
    const calls: number[][] = []
    let requestAgain = (): void => {}
    const scheduler = schedulerFor(async (batch) => {
      calls.push([...batch])
      if (batch.includes(1)) requestAgain()
    })
    requestAgain = () => scheduler.request([2])
    scheduler.request([1])

    await scheduler.flush()

    expect(calls).toEqual([[1], [2]])
    expect(scheduler.snapshot()).toEqual({ failure: null, pending: false, status: 'idle' })
  })
})
