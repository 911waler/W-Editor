import { describe, expect, it, vi } from 'vitest'

import { CommandRegistry, type CommandDispatcher } from '../../src/services/commandRegistry'
import { createToolbarCommandDescriptors } from '../../src/services/toolbarCommands'

describe('preview command safety', () => {
  it('does not dispatch any content mutation command against hidden editors', async () => {
    const source: CommandDispatcher = { execute: vi.fn() }
    const visual: CommandDispatcher = { execute: vi.fn() }
    const application: CommandDispatcher = {
      execute: vi.fn((commandId) => Object.freeze({
        changed: false,
        commandId,
        semanticOutcome: `application:${commandId}`,
      })),
    }
    const registry = new CommandRegistry(createToolbarCommandDescriptors(), { application, source, visual })
    const previewContext = Object.freeze({ mode: 'preview' as const, selectionKind: 'none' as const })
    const contentCommands = registry.list().filter((command) => command.owner.preview === null)

    expect(contentCommands.length).toBeGreaterThan(0)
    for (const command of contentCommands) {
      await expect(registry.execute(command.id, previewContext)).resolves.toMatchObject({
        changed: false,
        commandId: command.id,
        owner: null,
        status: 'disabled',
      })
    }
    expect(source.execute).not.toHaveBeenCalled()
    expect(visual.execute).not.toHaveBeenCalled()
  })

  it('keeps every declared application command available without reporting a content mutation', async () => {
    const application: CommandDispatcher = {
      execute: vi.fn((commandId) => Object.freeze({
        adapterOperation: 'application-state-only',
        changed: false,
        commandId,
        semanticOutcome: `application:${commandId}`,
      })),
    }
    const registry = new CommandRegistry(createToolbarCommandDescriptors(), {
      application,
      source: { execute: vi.fn() },
      visual: { execute: vi.fn() },
    })
    const previewContext = Object.freeze({ mode: 'preview' as const, selectionKind: 'none' as const })
    const applicationCommands = registry.list().filter((command) => command.owner.preview === 'application')

    expect(applicationCommands.length).toBeGreaterThan(0)
    for (const command of applicationCommands) {
      await expect(registry.execute(command.id, previewContext)).resolves.toMatchObject({
        changed: false,
        commandId: command.id,
        owner: 'application',
        status: 'executed',
      })
    }
    expect(application.execute).toHaveBeenCalledTimes(applicationCommands.length)
  })
})
