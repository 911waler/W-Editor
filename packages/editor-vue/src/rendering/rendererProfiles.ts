export type RendererProfile = 'author-preview' | 'reader'

export interface RendererProfileCapabilities {
  readonly allowsCodeEdit: boolean
  readonly allowsDocumentMutation: boolean
  readonly allowsAuthorEvents: boolean
  readonly allowsTaskToggle: boolean
  readonly allowsCodeCopy: true
  readonly allowsCodeFold: true
  readonly allowsHeadingNavigation: true
  readonly profile: RendererProfile
}

export const RENDERER_PROFILE_CAPABILITIES: Readonly<Record<RendererProfile, RendererProfileCapabilities>> = Object.freeze({
  'author-preview': Object.freeze({
    allowsAuthorEvents: true,
    allowsCodeCopy: true,
    allowsCodeEdit: true,
    allowsCodeFold: true,
    allowsDocumentMutation: false,
    allowsHeadingNavigation: true,
    allowsTaskToggle: true,
    profile: 'author-preview',
  }),
  reader: Object.freeze({
    allowsAuthorEvents: false,
    allowsCodeCopy: true,
    allowsCodeEdit: false,
    allowsCodeFold: true,
    allowsDocumentMutation: false,
    allowsHeadingNavigation: true,
    allowsTaskToggle: false,
    profile: 'reader',
  }),
})

export function rendererProfileCapabilities(profile: RendererProfile): RendererProfileCapabilities {
  return RENDERER_PROFILE_CAPABILITIES[profile]
}
