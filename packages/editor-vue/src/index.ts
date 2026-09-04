import './ui/styles.css'
import './ui/scopedVendorStyles.css'
import 'cherry-markdown/dist/cherry-markdown.min.css'
import 'katex/dist/katex.min.css'

/** Public package boundary for shared Vue editor surfaces and renderers. */
export const EDITOR_VUE_PACKAGE = '@w-editor/editor-vue' as const

export * from './adapters'
export { default as ChartTableEditorHost } from './ui/ChartTableEditorHost.vue'
export { default as CodeMirrorSourceEditorHost } from './ui/CodeMirrorSourceEditorHost.vue'
export { default as DetachedDraftEditorHost } from './ui/DetachedDraftEditorHost.vue'
export { default as DrawioDialog } from './ui/DrawioDialog.vue'
export { default as FormulaPicker } from './ui/FormulaPicker.vue'
export { default as MediaEditorHost } from './ui/MediaEditorHost.vue'
export type { AssetDraft } from './ui/MediaEditorHost.vue'
export { default as SafePreviewHtml } from './ui/SafePreviewHtml.vue'
export { default as SourceEditorSurface } from './ui/SourceEditorSurface.vue'
export { default as TiptapReaderPresentation } from './ui/TiptapReaderPresentation.vue'
export { default as VisualEditorSurface } from './ui/VisualEditorSurface.vue'
