import {
  normalizePublicError,
  type WSaveKind,
  type WSaveRequest,
  type WSaveResponse,
} from './publicContracts'

export class WSaveAdapterContractError extends Error {
  readonly code = 'SAVE_FAILED' as const

  constructor(message: string) {
    super(message)
    this.name = 'WSaveAdapterContractError'
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WSaveAdapterContractError('SaveAdapter response must be an object.')
  }
  return value as Record<string, unknown>
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new WSaveAdapterContractError(`SaveAdapter response ${field} must be a non-empty string.`)
  }
  return value
}

function normalizeDraftState(value: unknown): WSaveResponse['draftState'] {
  const draft = recordValue(value)
  const baseServerRevision = draft['baseServerRevision']
  if (baseServerRevision !== null && typeof baseServerRevision !== 'string') {
    throw new WSaveAdapterContractError('SaveAdapter draftState baseServerRevision must be a string or null.')
  }
  const status = draft['status']
  if (status !== 'none' && status !== 'saved' && status !== 'merged' && status !== 'stale') {
    throw new WSaveAdapterContractError('SaveAdapter draftState status is invalid.')
  }
  const updatedAt = draft['updatedAt']
  if (updatedAt !== undefined && typeof updatedAt !== 'string') {
    throw new WSaveAdapterContractError('SaveAdapter draftState updatedAt must be a string when present.')
  }
  return Object.freeze({
    baseServerRevision,
    status,
    ...(updatedAt === undefined ? {} : { updatedAt }),
  })
}

export function createSaveRequest(
  input: Readonly<{
    readonly baseServerRevision?: string
    readonly documentId: string
    readonly localRevision: number
    readonly markdown: string
    readonly metadata?: Readonly<Record<string, unknown>>
    readonly origin: WSaveRequest['origin']
    readonly overwrite?: boolean
    readonly saveKind: WSaveKind
  }>,
): WSaveRequest {
  return Object.freeze({
    baseServerRevision: input.baseServerRevision ?? null,
    documentId: input.documentId,
    localRevision: input.localRevision,
    markdown: input.markdown,
    metadata: Object.freeze({ ...(input.metadata ?? {}) }),
    origin: input.origin,
    overwrite: input.overwrite ?? false,
    saveKind: input.saveKind,
  })
}

export function normalizeSaveResponse(value: unknown, saveKind: WSaveKind): WSaveResponse {
  const response = recordValue(value)
  const versionId = response['versionId']
  if (saveKind === 'autosave-draft' && versionId !== undefined) {
    throw new WSaveAdapterContractError('SaveAdapter autosave response must not include versionId.')
  }
  if (saveKind !== 'autosave-draft') nonEmptyString(versionId, 'versionId')
  if (versionId !== undefined && typeof versionId !== 'string') {
    throw new WSaveAdapterContractError('SaveAdapter response versionId must be a string when present.')
  }
  return Object.freeze({
    draftState: normalizeDraftState(response['draftState']),
    savedAt: nonEmptyString(response['savedAt'], 'savedAt'),
    serverRevision: nonEmptyString(response['serverRevision'], 'serverRevision'),
    ...(versionId === undefined ? {} : { versionId }),
  })
}

export function saveFailure(failure: unknown) {
  return normalizePublicError(failure, 'SAVE_FAILED')
}
