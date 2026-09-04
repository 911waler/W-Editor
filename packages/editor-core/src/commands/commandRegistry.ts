import type { EditorMode } from './modeContracts'

export type CommandLocale = 'en' | 'ru' | 'zh'
export type CommandOwner = 'application' | 'source' | 'visual'

export interface CommandContext {
  readonly activeCommandIds?: ReadonlySet<string>
  readonly mode: EditorMode
  readonly selectionKind: 'none' | 'semantic-node' | 'text'
}

export interface CommandState {
  readonly active: boolean
  readonly disabledReason: string | null
  readonly enabled: boolean
}

export interface CommandVerification {
  readonly automatedEvidence: readonly string[]
  readonly manualCheck: string
  readonly matrixId: string
}

export interface CommandDescriptor {
  readonly contextualFor: readonly string[]
  readonly group: {
    readonly id: string
    readonly labels: Readonly<Record<CommandLocale, string>>
    readonly order: number
  }
  readonly icon: string
  readonly iconClass?: string | null
  readonly id: string
  readonly labels: Readonly<Record<CommandLocale, string>>
  readonly order: number
  readonly owner: Readonly<Record<EditorMode, CommandOwner | null>>
  readonly semanticOutcome: string
  readonly selection: readonly CommandContext['selectionKind'][]
  readonly state: (context: CommandContext) => CommandState
  readonly surface: {
    readonly control: 'button' | 'menu-item'
    readonly menuId: string | null
    readonly order: number
    readonly region: 'main' | 'mode' | 'overflow'
  }
  readonly verification: CommandVerification
}

export interface CommandDispatchResult {
  readonly adapterOperation?: string
  readonly changed: boolean
  readonly commandId: string
  readonly detail?: string
  readonly semanticOutcome: string
}

export interface CommandDispatcher {
  readonly execute: (commandId: string, context: CommandContext) => CommandDispatchResult | Promise<CommandDispatchResult>
}

export interface CommandDispatchers {
  readonly application: CommandDispatcher
  readonly source: CommandDispatcher
  readonly visual: CommandDispatcher
}

export interface CommandQuery extends CommandState {
  readonly owner: CommandOwner | null
}

export type CommandExecutionResult =
  | {
      readonly changed: false
      readonly commandId: string
      readonly detail: string
      readonly owner: null
      readonly status: 'disabled'
    }
  | {
      readonly changed: boolean
      readonly commandId: string
      readonly adapterOperation?: string
      readonly detail?: string
      readonly owner: CommandOwner
      readonly semanticOutcome: string
      readonly status: 'executed'
    }

export class DuplicateCommandIdError extends Error {
  readonly code = 'DUPLICATE_COMMAND_ID'

  constructor(commandId: string) {
    super(`Duplicate command ID: ${commandId}.`)
    this.name = 'DuplicateCommandIdError'
  }
}

export class UnknownCommandError extends Error {
  readonly code = 'UNKNOWN_COMMAND'

  constructor(commandId: string) {
    super(`Unknown command: ${commandId}.`)
    this.name = 'UnknownCommandError'
  }
}

export class MissingCommandHandlerError extends Error {
  readonly code = 'MISSING_COMMAND_HANDLER'

  constructor(commandId: string) {
    super(`No executable handler is registered for command ${commandId}.`)
    this.name = 'MissingCommandHandlerError'
  }
}

export class CommandSemanticMismatchError extends Error {
  readonly code = 'COMMAND_SEMANTIC_MISMATCH'

  constructor(commandId: string, expected: string, received: string) {
    super(`Command ${commandId} returned semantic outcome ${received}; expected ${expected}.`)
    this.name = 'CommandSemanticMismatchError'
  }
}

function freezeDescriptor(descriptor: CommandDescriptor): CommandDescriptor {
  return Object.freeze({
    ...descriptor,
    contextualFor: Object.freeze([...descriptor.contextualFor]),
    group: Object.freeze({
      ...descriptor.group,
      labels: Object.freeze({ ...descriptor.group.labels }),
    }),
    labels: Object.freeze({ ...descriptor.labels }),
    owner: Object.freeze({ ...descriptor.owner }),
    selection: Object.freeze([...descriptor.selection]),
    surface: Object.freeze({ ...descriptor.surface }),
    verification: Object.freeze({
      ...descriptor.verification,
      automatedEvidence: Object.freeze([...descriptor.verification.automatedEvidence]),
    }),
  })
}

export class CommandRegistry {
  readonly #byId = new Map<string, CommandDescriptor>()
  readonly #dispatchers: CommandDispatchers | null
  readonly #ordered: readonly CommandDescriptor[]

  constructor(descriptors: readonly CommandDescriptor[], dispatchers?: CommandDispatchers) {
    for (const candidate of descriptors) {
      if (this.#byId.has(candidate.id)) throw new DuplicateCommandIdError(candidate.id)
      this.#byId.set(candidate.id, freezeDescriptor(candidate))
    }
    this.#ordered = Object.freeze([...this.#byId.values()].sort((left, right) =>
      left.group.order - right.group.order
      || left.order - right.order
      || left.id.localeCompare(right.id)))
    this.#dispatchers = dispatchers ?? null
  }

  list(): readonly CommandDescriptor[] {
    return this.#ordered
  }

  get(commandId: string): CommandDescriptor {
    const descriptor = this.#byId.get(commandId)
    if (descriptor === undefined) throw new UnknownCommandError(commandId)
    return descriptor
  }

  presentation(commandId: string, locale: CommandLocale): { readonly groupId: string; readonly label: string } {
    const descriptor = this.get(commandId)
    return Object.freeze({ groupId: descriptor.group.id, label: descriptor.labels[locale] })
  }

  query(commandId: string, context: CommandContext): CommandQuery {
    const descriptor = this.get(commandId)
    const owner = descriptor.owner[context.mode]
    if (owner === null) {
      return Object.freeze({
        active: false,
        disabledReason: context.mode === 'preview' ? 'Unavailable in final preview.' : 'Unavailable in the current mode.',
        enabled: false,
        owner,
      })
    }
    return Object.freeze({ ...descriptor.state(context), owner })
  }

  async execute(commandId: string, context: CommandContext): Promise<CommandExecutionResult> {
    const descriptor = this.get(commandId)
    const query = this.query(commandId, context)
    if (!query.enabled || query.owner === null) {
      return Object.freeze({
        changed: false,
        commandId,
        detail: query.disabledReason ?? 'Command is disabled.',
        owner: null,
        status: 'disabled',
      })
    }
    const dispatcher = this.#dispatchers?.[query.owner]
    if (dispatcher === undefined) throw new MissingCommandHandlerError(commandId)
    const result = await dispatcher.execute(commandId, context)
    if (result.semanticOutcome !== descriptor.semanticOutcome) {
      throw new CommandSemanticMismatchError(commandId, descriptor.semanticOutcome, result.semanticOutcome)
    }
    return Object.freeze({
      ...(result.adapterOperation === undefined ? {} : { adapterOperation: result.adapterOperation }),
      changed: result.changed,
      commandId,
      ...(result.detail === undefined ? {} : { detail: result.detail }),
      owner: query.owner,
      semanticOutcome: result.semanticOutcome,
      status: 'executed',
    })
  }
}

export type CommandHandler = (context: CommandContext) => CommandDispatchResult | Promise<CommandDispatchResult>

export class CommandMapDispatcher implements CommandDispatcher {
  readonly #handlers: ReadonlyMap<string, CommandHandler>

  constructor(handlers: Readonly<Record<string, CommandHandler>> | ReadonlyMap<string, CommandHandler>) {
    this.#handlers = handlers instanceof Map ? new Map(handlers) : new Map(Object.entries(handlers))
  }

  execute(commandId: string, context: CommandContext): CommandDispatchResult | Promise<CommandDispatchResult> {
    const handler = this.#handlers.get(commandId)
    if (handler === undefined) throw new MissingCommandHandlerError(commandId)
    return handler(context)
  }
}

export class ShortcutDispatcher {
  readonly #registry: CommandRegistry
  #shortcuts: Readonly<Record<string, string>>

  constructor(registry: CommandRegistry, shortcuts: Readonly<Record<string, string>>) {
    this.#registry = registry
    this.#shortcuts = Object.freeze({ ...shortcuts })
  }

  configure(shortcuts: Readonly<Record<string, string>>): void {
    for (const commandId of Object.values(shortcuts)) this.#registry.get(commandId)
    this.#shortcuts = Object.freeze({ ...shortcuts })
  }

  bindings(): Readonly<Record<string, string>> {
    return this.#shortcuts
  }

  commandId(shortcut: string): string | null {
    return this.#shortcuts[shortcut] ?? null
  }

  dispatch(shortcut: string, context: CommandContext): Promise<CommandExecutionResult | null> {
    const commandId = this.#shortcuts[shortcut]
    return commandId === undefined ? Promise.resolve(null) : this.#registry.execute(commandId, context)
  }
}
