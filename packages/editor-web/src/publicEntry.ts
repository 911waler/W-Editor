import { createToolbarCommandDescriptors } from '@w-editor/editor-core'

/** Canonical public source shared by the browser ESM and IIFE entries. */
export const EDITOR_WEB_PACKAGE = '@w-editor/editor-web' as const

/** Shared command inventory exposed for host/release parity verification. */
export const W_EDITOR_COMMAND_IDS = Object.freeze(createToolbarCommandDescriptors().map(({ id }) => id))

export { WEB_BUNDLED_RUNTIME_DEPENDENCIES } from './bundledRuntimeDependencies'
export * from './publicContracts'
export { mountWEditor, WEditorContractError } from './editorMount'
export { mountWRenderer } from './rendererMount'
export * from './resourceResolver'
export * from './saveAdapter'
export * from './versioning'
