import type { DocumentSnapshot, PatchPlan } from '../core'
import { serializeFormula, type FormulaMode } from '../codecs'

export interface FormulaCommandPlan {
  readonly plan: PatchPlan
  readonly selection: Readonly<{ from: number; to: number }>
  readonly source: string
}

export function formulaSource(content: string, mode: FormulaMode = 'block'): string {
  return serializeFormula(mode, content)
}

export function createFormulaCommandPlan(
  snapshot: DocumentSnapshot,
  selection: Readonly<{ from: number; to: number }>,
  content: string,
  transactionId: string,
  mode: FormulaMode = 'block',
): FormulaCommandPlan {
  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  if (from < 0 || to > snapshot.markdown.length) throw new RangeError('Formula selection is outside the current Markdown snapshot.')
  const source = formulaSource(content, mode)
  const selected = snapshot.markdown.slice(from, to)
  let patchFrom: number
  let patchTo: number
  let replacement: string
  if (mode === 'inline') {
    patchFrom = from
    patchTo = to
    replacement = source
  } else if (/^\$\$\r?\n[\s\S]+\r?\n\$\$$/u.test(selected)) {
    patchFrom = from
    patchTo = to
    replacement = source
  } else {
    const lineEndCandidate = snapshot.markdown.indexOf('\n', from)
    patchFrom = lineEndCandidate === -1 ? snapshot.markdown.length : lineEndCandidate
    patchTo = patchFrom
    replacement = snapshot.markdown.length === 0 ? source : `\n\n${source}`
  }
  return Object.freeze({
    plan: Object.freeze({
      baseRevision: snapshot.revision,
      patches: Object.freeze([Object.freeze({
        codecId: 'formula',
        expected: snapshot.markdown.slice(patchFrom, patchTo),
        from: patchFrom,
        replacement,
        to: patchTo,
      })]),
      transactionId,
    }),
    selection: Object.freeze({ from: patchFrom, to: patchFrom + replacement.length }),
    source,
  })
}
