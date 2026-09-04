/** Public package boundary for framework-neutral W-Editor authority and contracts. */
export const EDITOR_CORE_PACKAGE = '@w-editor/editor-core' as const

export * from './publicContracts'
export * from './ports'
export * from './core/boundedScheduler'
export * from './core/documentSession'
export * from './core/operationState'
export * from './core/projectionRevisionGate'
export * from './codecs'
export * from './commands'
