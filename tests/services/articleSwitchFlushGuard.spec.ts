import { describe, expect, it, vi } from 'vitest'

import { ArticleCatalogAdapter, openDefaultArticle } from '../../src/services/articleCatalog'
import { ArticleSwitchFlushGuard, CompositionBarrier } from '../../src/services/articleSwitchFlushGuard'

const article = openDefaultArticle(new ArticleCatalogAdapter().initial())

describe('article switch flush guard', () => {
  it('waits for composition then flushes synchronization, conversion, and persistence in order', async () => {
    const events: string[] = []
    const composition = new CompositionBarrier()
    composition.begin()
    const guard = new ArticleSwitchFlushGuard({
      flushComposition: async () => { events.push('composition'); await composition.wait() },
      flushConversion: () => { events.push('conversion') },
      flushPersistence: () => { events.push('persistence') },
      flushSynchronization: () => { events.push('synchronization') },
    })

    const flushing = guard.flush(article)
    await Promise.resolve()
    expect(events).toEqual(['composition'])
    composition.end()
    await flushing

    expect(events).toEqual(['composition', 'synchronization', 'conversion', 'persistence'])
  })

  it.each(['composition', 'synchronization', 'conversion', 'persistence'] as const)(
    'stops at %s failure and reports the exact blocking stage',
    async (failedStage) => {
      const events: string[] = []
      const failure = new Error(`${failedStage} failed`)
      const stage = (name: typeof failedStage) => () => {
        events.push(name)
        if (name === failedStage) throw failure
      }
      const onFailure = vi.fn()
      const guard = new ArticleSwitchFlushGuard({
        flushComposition: stage('composition'),
        flushConversion: stage('conversion'),
        flushPersistence: stage('persistence'),
        flushSynchronization: stage('synchronization'),
        onFailure,
      })

      await expect(guard.flush(article)).rejects.toBe(failure)

      const order = ['composition', 'synchronization', 'conversion', 'persistence']
      expect(events).toEqual(order.slice(0, order.indexOf(failedStage) + 1))
      expect(onFailure).toHaveBeenCalledWith(failedStage, failure)
    },
  )
})
