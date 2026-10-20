import type { DocumentSnapshot, PatchPlan } from '../core'
import { formulaReferenceCandidates, formulaReferenceMarkdown } from '../codecs/formulaReferences'
import { isFormulaId } from '../codecs/formulas'

export function createFormulaReferenceCommandPlan(
  snapshot: DocumentSnapshot,
  selection: Readonly<{ from: number; to: number }>,
  targetFrom: number,
  newFormulaId: string,
  transactionId: string,
): Readonly<{ plan: PatchPlan; selection: Readonly<{ from: number; to: number }>; source: string; targetId: string }> {
  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  const candidates = formulaReferenceCandidates(snapshot.markdown)
  const target = candidates.find(candidate => candidate.from === targetFrom)
  if (!target || from < 0 || to > snapshot.markdown.length) throw new RangeError('Formula reference target or selection is unavailable.')
  if (candidates.some(candidate => from < candidate.to && to > candidate.from || from === to && from > candidate.from && from < candidate.to)) {
    throw new RangeError('Formula reference cannot overwrite or enter a formula.')
  }
  const targetId = target.formulaId ?? newFormulaId
  if (!isFormulaId(targetId) || candidates.some(candidate => candidate !== target && candidate.formulaId === targetId)) throw new RangeError('Formula identity is invalid or ambiguous.')
  const source = formulaReferenceMarkdown(targetId)
  const marker = target.formulaId === null ? `\n<!-- w-editor-formula-id: ${targetId} -->` : ''
  const prefix = candidates.some(candidate => candidate.to === from) ? '\n\n' : ''
  const suffix = candidates.some(candidate => candidate.from === to) ? '\n\n' : ''
  const patches: PatchPlan['patches'][number][] = [{ from, to, expected: snapshot.markdown.slice(from, to), replacement: `${prefix}${source}${suffix}`, codecId: 'formula-reference' }]
  let insertionFrom = from + prefix.length
  if (marker) {
    if (from === target.to) {
      patches[0] = { ...patches[0]!, replacement: `${marker}\n\n${source}` }
      insertionFrom += marker.length
    } else {
      patches.push({ from: target.to, to: target.to, expected: '', replacement: marker, codecId: 'formula' })
      if (target.to < from) insertionFrom += marker.length
    }
  }
  return Object.freeze({ plan: Object.freeze({ baseRevision: snapshot.revision, transactionId, patches: Object.freeze(patches.sort((a, b) => a.from - b.from)) }), source, targetId,
    selection: Object.freeze({ from: insertionFrom, to: insertionFrom + source.length }) })
}
