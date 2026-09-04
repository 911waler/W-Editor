import {
  createPublicError,
  MINIMUM_HOST_ADAPTER_VERSION,
  WEB_API_VERSION,
  WEB_SCHEMA_VERSION,
  type WEditorError,
} from './publicContracts'

export interface SemVer {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease?: string
}

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u

export function parseSemVer(value: unknown): SemVer | null {
  if (typeof value !== 'string') return null
  const match = SEMVER_PATTERN.exec(value)
  if (match === null) return null
  return Object.freeze({
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    ...(match[4] === undefined ? {} : { prerelease: match[4] }),
  })
}

export function compareSemVer(left: SemVer, right: SemVer): -1 | 0 | 1 {
  if (left.major !== right.major) return left.major < right.major ? -1 : 1
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1
  if (left.prerelease === right.prerelease) return 0
  if (left.prerelease === undefined) return 1
  if (right.prerelease === undefined) return -1
  return left.prerelease < right.prerelease ? -1 : 1
}

export interface DeprecatedPublicField {
  readonly field: string
  readonly removal: string
  readonly replacement: string
  readonly since: string
}

export const DEPRECATED_PUBLIC_FIELDS: readonly DeprecatedPublicField[] = Object.freeze([
  Object.freeze({
    field: 'WEditorMountOptions.profile',
    removal: '2.0.0',
    replacement: 'omit the redundant Editor profile; use mountWRenderer profile for reader/author-preview',
    since: '1.0.0',
  }),
])

export interface WebHostCompatibilityInput {
  readonly apiVersion?: unknown
  readonly hostAdapterVersion?: unknown
  readonly schemaVersion?: unknown
  readonly usesDeprecatedFields?: readonly string[]
}

export type WebHostCompatibilityResult =
  | Readonly<{ compatible: true; deprecatedFields: readonly DeprecatedPublicField[] }>
  | Readonly<{ code: 'INCOMPATIBLE_HOST'; compatible: false; error: WEditorError<'INCOMPATIBLE_HOST'>; reason: string }>

function incompatible(reason: string): WebHostCompatibilityResult {
  const error = createPublicError('INCOMPATIBLE_HOST', reason, {
    actionHints: ['configure-host'],
    retryable: false,
  })
  return Object.freeze({ code: 'INCOMPATIBLE_HOST' as const, compatible: false as const, error, reason })
}

function compatibleVersion(value: unknown, current: string, label: string): WebHostCompatibilityResult | null {
  if (value === undefined) return null
  const candidate = parseSemVer(value)
  const provider = parseSemVer(current)
  if (candidate === null || provider === null || candidate.major !== provider.major) {
    return incompatible(`${label} ${String(value)} is incompatible with W-Editor ${current}.`)
  }
  return null
}

export function checkWebHostCompatibility(input: WebHostCompatibilityInput = {}): WebHostCompatibilityResult {
  const apiFailure = compatibleVersion(input.apiVersion, WEB_API_VERSION, 'API version')
  if (apiFailure !== null) return apiFailure
  const schemaFailure = compatibleVersion(input.schemaVersion, WEB_SCHEMA_VERSION, 'Schema version')
  if (schemaFailure !== null) return schemaFailure
  if (input.hostAdapterVersion !== undefined) {
    const adapter = parseSemVer(input.hostAdapterVersion)
    const minimum = parseSemVer(MINIMUM_HOST_ADAPTER_VERSION)
    if (adapter === null || minimum === null || adapter.major !== minimum.major || compareSemVer(adapter, minimum) < 0) {
      return incompatible(`Host adapter version ${String(input.hostAdapterVersion)} is below the minimum ${MINIMUM_HOST_ADAPTER_VERSION}.`)
    }
  }
  const deprecatedFields = Object.freeze((input.usesDeprecatedFields ?? [])
    .map((field) => DEPRECATED_PUBLIC_FIELDS.find((candidate) => candidate.field === field))
    .filter((field): field is DeprecatedPublicField => field !== undefined))
  return Object.freeze({ compatible: true as const, deprecatedFields })
}
