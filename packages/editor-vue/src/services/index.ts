/** Shared Vue workspace services; persistence shells remain host-owned. */
export const SERVICES_BOUNDARY = 'editor-vue/services' as const

export * from './activeModeHistory'
export * from './randomId'
export * from './appearanceTheme'
export * from './applicationCompositionRoot'
export * from './autosaveCoordinator'
export * from './browserFileExport'
export * from './browserRenderedExport'
export * from './destructiveReplacementCoordinator'
export * from './fullscreenController'
export * from './lineSpacing'
export * from './modeCoordinator'
export * from './nativeHistoryModeAdapter'
export * from './rehydrateCherryFormulas'
export * from './safeKatexRenderer'
export * from './sanitizeCherryHtml'
export * from './settingsStore'
export * from './instanceDomService'
export * from './shortcutPreferences'
export * from './toolbarMatrixValidation'
export * from './uiLocalization'
export * from './visualSynchronization'
export * from './workspaceModeAdapters'
export * from '@w-editor/editor-core'

export * from './outlinePresentation'

export * from './referencePublication'

export * from "./referenceEditorServices"
export * from './citationFormatting'

export type { DocumentHistoryVersion, DocumentHistorySnapshot, DocumentHistoryPage, DocumentHistoryServices } from './documentHistory'

export * from "./referenceLibrary"
