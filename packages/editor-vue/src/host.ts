/** Public, framework-neutral host bridge; internal Vue components stay private. */
export const EDITOR_VUE_HOST_CONTRACT = '@w-editor/editor-vue/host' as const

export { normalizeUploadedAsset } from './adapters/uploadAdapter'
export {
  serializeOrdinaryTiptapPatch,
  TiptapTransactionPatchPlanner,
  TiptapVisualAdapter,
} from './adapters'
export type { SemanticNodeCopyEvent } from './adapters'
export { createInstanceDomService, InstanceDomService } from './services/instanceDomService'
export type { InstanceDomServiceOptions } from './services/instanceDomService'
export { createSharedRendererPipeline, SharedRendererPipeline } from './rendering/sharedRendererPipeline'
export type { SharedRendererPipelineOptions, SharedRendererResult } from './rendering/sharedRendererPipeline'
export type { RendererExtension, RendererExtensionContext, RendererExtensionPermission } from './rendering/rendererExtensions'
export { sanitizeRendererExtensions } from './rendering/rendererExtensions'
export type { RendererHydrationOptions } from './rendering/rendererHydration'
export type { RendererProfile, RendererProfileCapabilities } from './rendering/rendererProfiles'
export { createTiptapPresentation } from './rendering/tiptapPresentation'
export type {
  TiptapPresentationInstance,
  TiptapPresentationOptions,
  TiptapPresentationTaskToggleEvent,
} from './rendering/tiptapPresentation'
export { createUiLocalizationStore, VisualSynchronizationService } from './services'
export type { AppearanceTheme } from './services/appearanceTheme'
export type { UiLocale, UiLocalizationStore } from './services/uiLocalization'
