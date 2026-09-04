import type { DocumentSnapshot, PatchPlan } from '../publicContracts'
import { parseFencedCodeAt, rawFencedCodeCandidateAt } from '../codecs/fencedCode'

export interface TaskItemMarker {
  readonly checked: boolean
  readonly from: number
  readonly index: number
  readonly marker: '[ ]' | '[X]' | '[x]'
  readonly to: number
}

function nextLineOffset(markdown: string, offset: number): number {
  const lineFeed = markdown.indexOf('\n', offset)
  return lineFeed === -1 ? markdown.length : lineFeed + 1
}

export function taskItemMarkers(markdown: string): readonly TaskItemMarker[] {
  const markers: TaskItemMarker[] = []
  let offset = 0
  while (offset < markdown.length) {
    const fenced = parseFencedCodeAt(markdown, offset)
    if (fenced !== null) {
      offset = fenced.sourceSpan.to
      if (markdown[offset] === '\r' && markdown[offset + 1] === '\n') offset += 2
      else if (markdown[offset] === '\r' || markdown[offset] === '\n') offset += 1
      continue
    }
    if (rawFencedCodeCandidateAt(markdown, offset) !== null) break
    const nextOffset = nextLineOffset(markdown, offset)
    const line = markdown.slice(offset, nextOffset).replace(/\r?\n$/u, '')
    const match = /^([ \t]*-[ \t]+)(\[([ xX])\])/u.exec(line)
    if (match !== null) {
      const marker = match[2] as TaskItemMarker['marker']
      const from = offset + (match[1]?.length ?? 0)
      markers.push(Object.freeze({
        checked: (match[3] ?? '').toLowerCase() === 'x',
        from,
        index: markers.length,
        marker,
        to: from + marker.length,
      }))
    }
    offset = nextOffset
  }
  return Object.freeze(markers)
}

export function createTaskItemCheckedPlan(
  snapshot: DocumentSnapshot,
  taskIndex: number,
  checked: boolean,
  transactionId: string,
): PatchPlan | null {
  if (!Number.isInteger(taskIndex) || taskIndex < 0) throw new RangeError('Task item index must be a non-negative integer.')
  const marker = taskItemMarkers(snapshot.markdown)[taskIndex]
  if (marker === undefined) throw new RangeError(`Task item ${taskIndex} does not exist in the current Markdown snapshot.`)
  if (marker.checked === checked) return null
  return Object.freeze({
    baseRevision: snapshot.revision,
    patches: Object.freeze([Object.freeze({
      codecId: 'task-list',
      expected: marker.marker,
      from: marker.from,
      replacement: checked ? '[x]' : '[ ]',
      to: marker.to,
    })]),
    transactionId,
  })
}
