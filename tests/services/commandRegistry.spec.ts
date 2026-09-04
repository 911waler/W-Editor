import { describe, expect, it, vi } from 'vitest'

import {
  CommandRegistry,
  DuplicateCommandIdError,
  ShortcutDispatcher,
  type CommandContext,
  type CommandDescriptor,
  type CommandDispatcher,
} from '../../src/services/commandRegistry'

const context = (mode: CommandContext['mode']): CommandContext => Object.freeze({
  mode,
  selectionKind: 'text',
})

function descriptor(id: string, groupOrder: number, commandOrder: number): CommandDescriptor {
  return Object.freeze({
    contextualFor: Object.freeze([]),
    group: Object.freeze({
      id: groupOrder === 1 ? 'text' : 'application',
      labels: Object.freeze({ en: 'Group', ru: 'Группа', zh: '分组' }),
      order: groupOrder,
    }),
    icon: id === 'text.bold' ? 'B' : '•',
    id,
    labels: Object.freeze({ en: `EN ${id}`, ru: `RU ${id}`, zh: `ZH ${id}` }),
    order: commandOrder,
    owner: Object.freeze({ preview: null, source: 'source', visual: 'visual' }),
    semanticOutcome: `cherry:${id}`,
    selection: Object.freeze<readonly CommandContext['selectionKind'][]>(['text']),
    state: (commandContext: CommandContext) => commandContext.selectionKind === 'text'
      ? Object.freeze({ active: id === 'text.bold', disabledReason: null, enabled: true })
      : Object.freeze({ active: false, disabledReason: 'Requires a text selection.', enabled: false }),
    verification: Object.freeze({
      automatedEvidence: Object.freeze([`unit:${id}`, `e2e:${id}`]),
      manualCheck: `Manually verify ${id}.`,
      matrixId: id,
    }),
    surface: Object.freeze({ control: 'button', menuId: null, order: commandOrder, region: 'main' }),
  })
}

describe('CommandRegistry contract', () => {
  it('keeps stable IDs unique and returns immutable group/order output', () => {
    expect(() => new CommandRegistry([descriptor('text.bold', 1, 1), descriptor('text.bold', 1, 2)]))
      .toThrow(DuplicateCommandIdError)
    const registry = new CommandRegistry([
      descriptor('application.fullscreen', 2, 1),
      descriptor('text.italic', 1, 2),
      descriptor('text.bold', 1, 1),
    ])

    expect(registry.list().map(({ id }) => id)).toEqual(['text.bold', 'text.italic', 'application.fullscreen'])
    expect(Object.isFrozen(registry.list())).toBe(true)
  })

  it('provides localized presentation, mode ownership, state, disabled reasons, and verification metadata', () => {
    const registry = new CommandRegistry([descriptor('text.bold', 1, 1)])

    expect(registry.presentation('text.bold', 'zh')).toEqual({ groupId: 'text', label: 'ZH text.bold' })
    expect(registry.presentation('text.bold', 'en')).toEqual({ groupId: 'text', label: 'EN text.bold' })
    expect(registry.presentation('text.bold', 'ru')).toEqual({ groupId: 'text', label: 'RU text.bold' })
    expect(registry.query('text.bold', context('source'))).toMatchObject({ active: true, enabled: true, owner: 'source' })
    expect(registry.query('text.bold', context('visual'))).toMatchObject({ active: true, enabled: true, owner: 'visual' })
    expect(registry.query('text.bold', context('preview'))).toEqual({
      active: false,
      disabledReason: 'Unavailable in final preview.',
      enabled: false,
      owner: null,
    })
    expect(registry.get('text.bold').verification).toEqual({
      automatedEvidence: ['unit:text.bold', 'e2e:text.bold'],
      manualCheck: 'Manually verify text.bold.',
      matrixId: 'text.bold',
    })
  })

  it('returns a structured execution result and never dispatches disabled commands', async () => {
    const source: CommandDispatcher = { execute: vi.fn(async (commandId) => ({ changed: true, commandId, detail: 'source applied', semanticOutcome: `cherry:${commandId}` })) }
    const visual: CommandDispatcher = { execute: vi.fn() }
    const application: CommandDispatcher = { execute: vi.fn() }
    const registry = new CommandRegistry([descriptor('text.bold', 1, 1)], { application, source, visual })

    await expect(registry.execute('text.bold', context('source'))).resolves.toEqual({
      changed: true,
      commandId: 'text.bold',
      detail: 'source applied',
      owner: 'source',
      semanticOutcome: 'cherry:text.bold',
      status: 'executed',
    })
    await expect(registry.execute('text.bold', context('preview'))).resolves.toEqual({
      changed: false,
      commandId: 'text.bold',
      detail: 'Unavailable in final preview.',
      owner: null,
      status: 'disabled',
    })
    expect(source.execute).toHaveBeenCalledOnce()
  })

  it('dispatches configurable shortcuts through stable command IDs', async () => {
    const source: CommandDispatcher = { execute: vi.fn(async (commandId) => ({ changed: true, commandId, semanticOutcome: `cherry:${commandId}` })) }
    const registry = new CommandRegistry([descriptor('text.bold', 1, 1)], {
      application: { execute: vi.fn() },
      source,
      visual: { execute: vi.fn() },
    })
    const shortcuts = new ShortcutDispatcher(registry, { 'Mod-b': 'text.bold' })

    expect(shortcuts.bindings()).toEqual({ 'Mod-b': 'text.bold' })
    expect(shortcuts.commandId('Mod-b')).toBe('text.bold')
    expect(shortcuts.commandId('Mod-i')).toBeNull()
    await expect(shortcuts.dispatch('Mod-b', context('source'))).resolves.toMatchObject({ commandId: 'text.bold', status: 'executed' })
    await expect(shortcuts.dispatch('Mod-i', context('source'))).resolves.toBeNull()
    shortcuts.configure({ 'Mod-i': 'text.bold' })
    expect(shortcuts.bindings()).toEqual({ 'Mod-i': 'text.bold' })
    await expect(shortcuts.dispatch('Mod-b', context('source'))).resolves.toBeNull()
    await expect(shortcuts.dispatch('Mod-i', context('source'))).resolves.toMatchObject({ commandId: 'text.bold', status: 'executed' })
  })
})
