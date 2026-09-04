import type { DocumentSnapshot, ResourceOptions } from '@w-editor/editor-core'

import { sanitizeCherryHtml } from '../services/sanitizeCherryHtml'
import { type RendererProfile } from './rendererProfiles'

export interface RendererExtensionContext {
  readonly profile: RendererProfile
  readonly resourceOptions: ResourceOptions
  readonly snapshot: DocumentSnapshot
}

export type RendererExtensionPermission = 'safe-fragment'

export interface RendererExtension {
  readonly id: string
  readonly permissions: readonly RendererExtensionPermission[]
  readonly render: (context: RendererExtensionContext) => string | null
}

const EXTENSION_ID = /^[a-z][a-z\d]*(?:-[a-z\d]+)*$/u
const MAX_EXTENSION_HTML_LENGTH = 100_000
const ALLOWED_EXTENSION_PERMISSIONS = new Set<RendererExtensionPermission>(['safe-fragment'])

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export function sanitizeRendererExtensions(
  extensions: readonly RendererExtension[],
  snapshot: DocumentSnapshot,
  profile: RendererProfile,
  resourceOptions: ResourceOptions,
  ownerDocument: Document = document,
): string {
  if (extensions.length === 0) return ''
  const context = Object.freeze({
    profile,
    resourceOptions: Object.freeze({ ...resourceOptions }),
    snapshot,
  }) satisfies RendererExtensionContext
  const fragments: string[] = []
  for (const extension of extensions) {
    if (!EXTENSION_ID.test(extension.id)) throw new TypeError(`Invalid Renderer extension id: ${extension.id}`)
    if (!extension.permissions.every((permission) => ALLOWED_EXTENSION_PERMISSIONS.has(permission))) {
      throw new TypeError(`Renderer extension ${extension.id} requested an unsupported permission.`)
    }
    const raw = extension.render(context)
    if (raw === null || raw.length === 0) continue
    if (raw.length > MAX_EXTENSION_HTML_LENGTH) {
      throw new RangeError(`Renderer extension ${extension.id} exceeded the HTML output limit.`)
    }
    const safe = sanitizeCherryHtml(raw, ownerDocument)
    if (safe.length === 0) continue
    fragments.push(`<div data-w-editor-extension="${escapeAttribute(extension.id)}">${safe}</div>`)
  }
  return fragments.join('')
}
