import {
  panelDescriptor,
  panelStarterSource,
  parsePanelAt,
  validatePanelSource,
  type PanelCommandId,
  type PanelModel,
} from '../codecs'
import type { DocumentSnapshot, PatchPlan } from '../core'

export interface PanelCommandPlan {
  readonly plan: PatchPlan
  readonly selection: Readonly<{ from: number; to: number }>
  readonly source: string
}

export function panelAtSelection(
  markdown: string,
  selection: Readonly<{ from: number; to: number }>,
): PanelModel | null {
  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  let offset = 0
  while (offset < markdown.length) {
    const panel = parsePanelAt(markdown, offset)
    if (panel !== null) {
      if (from >= panel.sourceSpan.from && to <= panel.sourceSpan.to) return panel
      offset = panel.sourceSpan.to
      continue
    }
    const next = markdown.indexOf('\n', offset)
    if (next === -1) break
    offset = next + 1
  }
  return null
}

export function createPanelCommandPlan(
  snapshot: DocumentSnapshot,
  selection: Readonly<{ from: number; to: number }>,
  commandId: PanelCommandId,
  transactionId: string,
  draftSource = panelStarterSource(commandId),
): PanelCommandPlan {
  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  if (from < 0 || to > snapshot.markdown.length) throw new RangeError('Panel selection is outside the current Markdown snapshot.')
  const descriptor = panelDescriptor(commandId)
  if (descriptor === null) throw new RangeError(`Unknown panel command: ${commandId}.`)
  const validation = validatePanelSource(commandId, draftSource)
  if (!validation.valid) throw new RangeError(validation.message)
  const source = draftSource
  const selectedPanel = panelAtSelection(snapshot.markdown, { from, to })
  const replacesSelectedPanel = selectedPanel !== null
  const patchFrom = replacesSelectedPanel
    ? selectedPanel.sourceSpan.from
    : snapshot.markdown.indexOf('\n', from) === -1 ? snapshot.markdown.length : snapshot.markdown.indexOf('\n', from)
  const patchTo = replacesSelectedPanel ? selectedPanel.sourceSpan.to : patchFrom
  const replacement = replacesSelectedPanel || snapshot.markdown.length === 0 ? source : `\n\n${source}`
  return Object.freeze({
    plan: Object.freeze({
      baseRevision: snapshot.revision,
      patches: Object.freeze([Object.freeze({
        codecId: `panel-${descriptor.variant}`,
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
