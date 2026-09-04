import type { RendererExtension } from '@w-editor/editor-vue/host'

import type { WRendererExtension, WRendererExtensionContext } from './publicContracts'

export function adaptRendererExtensions(extensions: readonly WRendererExtension[] | undefined): readonly RendererExtension[] {
  return Object.freeze((extensions ?? []).map((extension): RendererExtension => ({
    id: extension.id,
    permissions: Object.freeze([...extension.permissions]),
    render: (context): string | null => {
      const publicContext: WRendererExtensionContext = Object.freeze({
        profile: context.profile,
        resourceOptions: Object.freeze({ ...context.resourceOptions }),
        snapshot: Object.freeze({ ...context.snapshot }),
      })
      return extension.render(publicContext)
    },
  })))
}
