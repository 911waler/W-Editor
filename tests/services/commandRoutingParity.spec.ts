import { describe, expect, it, vi } from 'vitest'

import {
  CommandRegistry,
  CommandSemanticMismatchError,
  type CommandContext,
  type CommandDispatcher,
} from '../../src/services/commandRegistry'
import { createToolbarCommandDescriptors } from '../../src/services/toolbarCommands'

function context(mode: CommandContext['mode']): CommandContext {
  return Object.freeze({ mode, selectionKind: 'text' })
}

describe('source and visual command routing parity', () => {
  it('requires the same Cherry semantic outcome while preserving adapter-specific selection operations', async () => {
    const source: CommandDispatcher = {
      execute: vi.fn((commandId) => Object.freeze({
        adapterOperation: 'checked-source-range-replacement',
        changed: true,
        commandId,
        semanticOutcome: `cherry:${commandId}`,
      })),
    }
    const visual: CommandDispatcher = {
      execute: vi.fn((commandId) => Object.freeze({
        adapterOperation: 'tiptap-text-selection-mark',
        changed: true,
        commandId,
        semanticOutcome: `cherry:${commandId}`,
      })),
    }
    const registry = new CommandRegistry(createToolbarCommandDescriptors(), {
      application: { execute: vi.fn() },
      source,
      visual,
    })

    const sourceResult = await registry.execute('text.bold', context('source'))
    const visualResult = await registry.execute('text.bold', context('visual'))

    expect(sourceResult).toMatchObject({
      adapterOperation: 'checked-source-range-replacement',
      owner: 'source',
      semanticOutcome: 'cherry:text.bold',
      status: 'executed',
    })
    expect(visualResult).toMatchObject({
      adapterOperation: 'tiptap-text-selection-mark',
      owner: 'visual',
      semanticOutcome: 'cherry:text.bold',
      status: 'executed',
    })
    if (sourceResult.status !== 'executed' || visualResult.status !== 'executed') {
      throw new Error('Both applicable editor commands must execute.')
    }
    expect(sourceResult.semanticOutcome).toBe(visualResult.semanticOutcome)
    expect(sourceResult.adapterOperation).not.toBe(visualResult.adapterOperation)
  })

  it('rejects an adapter result that does not preserve the descriptor semantic identity', async () => {
    const registry = new CommandRegistry(createToolbarCommandDescriptors(), {
      application: { execute: vi.fn() },
      source: { execute: vi.fn() },
      visual: {
        execute: vi.fn((commandId) => Object.freeze({
          adapterOperation: 'incorrect-visual-operation',
          changed: true,
          commandId,
          semanticOutcome: 'cherry:text.italic',
        })),
      },
    })

    await expect(registry.execute('text.bold', context('visual'))).rejects.toBeInstanceOf(CommandSemanticMismatchError)
  })
})
