import type { CommitAcknowledgement, DocumentSession, PatchPlan, SourcePatch } from '../core/documentSession'
import type { ProjectionMap, ProjectionMapEntry, SourceSpan, ValidationResult } from './contracts'

export class StaleProjectionMapError extends Error {
  readonly code = 'STALE_PROJECTION_MAP'

  constructor(mapRevision: number, documentRevision: number) {
    super(`Projection map revision ${mapRevision} does not match document revision ${documentRevision}.`)
    this.name = 'StaleProjectionMapError'
  }
}

export class ProjectionMapValidationError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ProjectionMapValidationError'
    this.code = code
  }
}

export interface ReparseUnitInput {
  readonly candidateMarkdown: string
  readonly entry: ProjectionMapEntry
  readonly revision: number
  readonly sourceSpan: SourceSpan
}

export interface ProjectionMapUpdateHooks {
  readonly rebuild: (candidateMarkdown: string, revision: number) => ProjectionMap
  readonly reparseUnit: (input: ReparseUnitInput) => ProjectionMapEntry
  readonly validate: (map: ProjectionMap, candidateMarkdown: string) => ValidationResult
}

export interface ProjectionMapCommitResult {
  readonly acknowledgement: CommitAcknowledgement
  readonly map: ProjectionMap
  readonly strategy: 'affected-units' | 'full-rebuild'
}

function intersects(span: SourceSpan, patch: SourcePatch): boolean {
  if (patch.from === patch.to) {
    return patch.from >= span.from && patch.from <= span.to
  }
  return patch.from < span.to && patch.to > span.from
}

function shiftSpan(span: SourceSpan, patches: readonly SourcePatch[]): SourceSpan {
  let shift = 0
  for (const patch of patches) {
    if (patch.to <= span.from) {
      shift += patch.replacement.length - (patch.to - patch.from)
    }
  }
  return Object.freeze({ from: span.from + shift, to: span.to + shift })
}

function shiftedEntry(entry: ProjectionMapEntry, patches: readonly SourcePatch[]): ProjectionMapEntry {
  const sourceSpan = shiftSpan(entry.sourceSpan, patches)
  const safeSourceSpan = shiftSpan(entry.safePatchUnit.sourceSpan, patches)
  return Object.freeze({
    ...entry,
    safePatchUnit: Object.freeze({ ...entry.safePatchUnit, sourceSpan: safeSourceSpan }),
    sourceSpan,
  })
}

function assertProjectionMap(map: ProjectionMap, markdown: string, revision: number): void {
  if (map.revision !== revision) {
    throw new ProjectionMapValidationError('INVALID_MAP_REVISION', 'Projection map revision does not match its candidate document.')
  }
  if (map.documentLength !== markdown.length) {
    throw new ProjectionMapValidationError('INVALID_MAP_LENGTH', 'Projection map length does not match its candidate document.')
  }
  for (const entry of map.entries) {
    const { from, to } = entry.sourceSpan
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > markdown.length) {
      throw new ProjectionMapValidationError('INVALID_MAP_SPAN', `Projection ${entry.projectionId} has an invalid source span.`)
    }
    if (markdown.slice(from, to) !== entry.originalSource) {
      throw new ProjectionMapValidationError('INVALID_MAP_SOURCE', `Projection ${entry.projectionId} does not retain its exact source.`)
    }
    const safe = entry.safePatchUnit
    if (markdown.slice(safe.sourceSpan.from, safe.sourceSpan.to) !== safe.expectedSource) {
      throw new ProjectionMapValidationError('INVALID_SAFE_PATCH_SOURCE', `Safe patch unit ${safe.unitId} does not match its source.`)
    }
  }
}

export class ProjectionMapTransaction {
  #map: ProjectionMap

  constructor(map: ProjectionMap) {
    this.#map = map
  }

  snapshot(): ProjectionMap {
    return this.#map
  }

  apply(session: DocumentSession, plan: PatchPlan, hooks: ProjectionMapUpdateHooks): ProjectionMapCommitResult {
    const current = session.snapshot()
    if (this.#map.revision !== current.revision) {
      throw new StaleProjectionMapError(this.#map.revision, current.revision)
    }
    const candidateMarkdown = session.previewPatchPlan(plan)
    const revision = candidateMarkdown === current.markdown ? current.revision : current.revision + 1
    const patches = [...plan.patches].sort((left, right) => left.from - right.from || left.to - right.to)
    const directEntries = new Map<SourcePatch, ProjectionMapEntry>()
    let requiresFullRebuild = false

    for (const patch of patches) {
      const overlapping = this.#map.entries.filter((entry) => intersects(entry.sourceSpan, patch))
      const exact = overlapping.filter((entry) => (
        entry.codecId === patch.codecId
        && entry.safePatchUnit.sourceSpan.from === patch.from
        && entry.safePatchUnit.sourceSpan.to === patch.to
      ))
      if (overlapping.length !== 1 || exact.length !== 1 || exact[0]?.safePatchUnit.structural === true) {
        requiresFullRebuild = true
        break
      }
      const entry = exact[0]
      if (entry !== undefined) directEntries.set(patch, entry)
    }

    let nextMap: ProjectionMap
    let strategy: ProjectionMapCommitResult['strategy']
    if (requiresFullRebuild) {
      strategy = 'full-rebuild'
      nextMap = hooks.rebuild(candidateMarkdown, revision)
    } else {
      strategy = 'affected-units'
      const affectedIds = new Set([...directEntries.values()].map((entry) => entry.projectionId))
      const nextEntries = this.#map.entries.map((entry) => {
        if (!affectedIds.has(entry.projectionId)) {
          return shiftedEntry(entry, patches)
        }
        const patch = patches.find((candidate) => directEntries.get(candidate)?.projectionId === entry.projectionId)
        if (patch === undefined) {
          throw new ProjectionMapValidationError('MISSING_AFFECTED_PATCH', `Projection ${entry.projectionId} lost its patch mapping.`)
        }
        const shiftBefore = shiftSpan({ from: entry.sourceSpan.from, to: entry.sourceSpan.from }, patches).from - entry.sourceSpan.from
        const sourceSpan = Object.freeze({
          from: entry.sourceSpan.from + shiftBefore,
          to: entry.sourceSpan.from + shiftBefore + patch.replacement.length,
        })
        return hooks.reparseUnit({ candidateMarkdown, entry, revision, sourceSpan })
      })
      nextMap = Object.freeze({ documentLength: candidateMarkdown.length, entries: Object.freeze(nextEntries), revision })
    }

    assertProjectionMap(nextMap, candidateMarkdown, revision)
    const validation = hooks.validate(nextMap, candidateMarkdown)
    if (!validation.valid) {
      throw new ProjectionMapValidationError(validation.code, validation.message)
    }

    const acknowledgement = session.commitPatchPlan(plan)
    this.#map = nextMap
    return Object.freeze({ acknowledgement, map: nextMap, strategy })
  }
}
