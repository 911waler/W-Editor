export interface WebVersionCompatible {
  readonly contentSha256: string
  readonly directory: string
  readonly fileCount: number
  readonly manifestSha256: string
  readonly status: 'compatible'
  readonly version: string
}

export interface WebVersionIncompatible {
  readonly reason: string
  readonly status: 'incompatible'
  readonly version: string
}

export type WebVersionInspection = WebVersionCompatible | WebVersionIncompatible

export interface WebVersionCandidate {
  readonly directory: string
  readonly version: string
}

export interface WebVersionVerification {
  readonly ok: boolean
  readonly reason?: string
  readonly verification?: WebVersionInspection
}

export interface AtomicVersionPointerState {
  readonly activeVersion: string
  readonly schemaVersion: 1
}

export interface AtomicVersionSwitchResult {
  readonly activeVersion: string
  readonly candidateVersion: string
  readonly reason?: string
  readonly status: 'rolled-back' | 'switched'
}

export interface AtomicVersionPointer {
  readonly read: () => Promise<AtomicVersionPointerState>
  readonly switchTo: (
    candidate: WebVersionCandidate,
    verify: (candidate: Readonly<WebVersionCandidate>) => WebVersionVerification | PromiseLike<WebVersionVerification>,
  ) => Promise<AtomicVersionSwitchResult>
}

export function inspectWebVersion(options: {
  readonly directory: string
  readonly hostAdapterVersion?: string
  readonly version: string
}): WebVersionInspection

export function versionedAssetUrl(origin: string, version: string, resourcePath: string): string

export function createAtomicVersionPointer(pointerPath: string, initialVersion: string): AtomicVersionPointer
