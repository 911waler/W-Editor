import type { DocumentSnapshot } from './publicContracts'

/** Versioned, framework-neutral ports consumed by host-specific adapters. */
export const PORTS_CONTRACT_VERSION = '1.0.0' as const

export const ASSET_KINDS = Object.freeze(['image', 'audio', 'video', 'pdf', 'word', 'file'] as const)

export type AssetKind = (typeof ASSET_KINDS)[number]

export interface UploadedAssetDisplayMetadata {
  readonly durationSeconds?: number
  readonly height?: number
  readonly label?: string
  readonly width?: number
}

export interface UploadedAsset {
  readonly display?: UploadedAssetDisplayMetadata
  readonly mediaType: string
  readonly name: string
  readonly size: number
  readonly url: string
}

export interface UploadFile {
  readonly arrayBuffer: () => Promise<ArrayBuffer>
  readonly name: string
  readonly size: number
  readonly type: string
}

export interface UploadSignal {
  readonly aborted: boolean
  readonly addEventListener: (type: 'abort', listener: () => void, options?: { readonly once?: boolean }) => void
  readonly removeEventListener: (type: 'abort', listener: () => void) => void
}

export interface UploadRequest {
  readonly file: UploadFile
  readonly kind: AssetKind
  readonly signal?: UploadSignal
}

export interface UploadAdapter {
  readonly upload: (request: UploadRequest) => Promise<UploadedAsset>
}

export interface PreviewRenderResult {
  readonly html: string
  readonly snapshot: DocumentSnapshot
}

export interface PreviewRenderer {
  readonly render: (snapshot: DocumentSnapshot) => PreviewRenderResult
}

export interface ResourceLocator {
  readonly resolve: (resourcePath: string) => string
}

export interface ResourceOptions {
  readonly assetBaseUrl?: string
  readonly resourceLocator?: ResourceLocator
}

export interface SettingsChange {
  readonly key: string
  readonly value: unknown | undefined
}

export type SettingsSubscriber = (change: SettingsChange) => void

export interface SettingsStore {
  readonly clearUserOverride: (key: string) => void | Promise<void>
  readonly getSiteDefaults: () => Readonly<Record<string, unknown>> | Promise<Readonly<Record<string, unknown>>>
  readonly getUserOverrides: () => Readonly<Record<string, unknown>> | Promise<Readonly<Record<string, unknown>>>
  readonly setUserOverride: (key: string, value: unknown) => void | Promise<void>
  readonly subscribe: (subscriber: SettingsSubscriber) => () => void
}

export type PortFailureCode =
  | 'ASSET_MISSING'
  | 'PREVIEW_RENDER_FAILED'
  | 'RESOURCE_UNAVAILABLE'
  | 'SETTINGS_UNAVAILABLE'
  | 'UPLOAD_UNAVAILABLE'

export interface PortFailure {
  readonly actionHint?: string
  readonly cause?: unknown
  readonly code: PortFailureCode
  readonly message: string
  readonly retryable: boolean
}
