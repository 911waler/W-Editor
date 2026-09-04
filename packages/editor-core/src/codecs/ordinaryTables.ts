export type OrdinaryTableAlignment = 'center' | 'left' | 'right' | 'unspecified'

export interface OrdinaryTableMatch {
  readonly alignments: readonly OrdinaryTableAlignment[]
  readonly delimiters: readonly string[]
  readonly headers: readonly string[]
  readonly rows: readonly (readonly string[])[]
  readonly source: string
  readonly sourceSpan: Readonly<{ from: number; to: number }>
}

export interface OrdinaryTableDimensions {
  readonly columns: number
  readonly dataRows: number
}

function assertPickerDimension(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1 || value > 9) {
    throw new RangeError(`${label} must be an integer from 1 through 9.`)
  }
}

export function ordinaryTableStarterSource(dimensions: OrdinaryTableDimensions): string {
  assertPickerDimension(dimensions.columns, 'Table columns')
  assertPickerDimension(dimensions.dataRows, 'Table data rows')
  const header = `|${' Header |'.repeat(dimensions.columns)}`
  const delimiter = `|${' ------ |'.repeat(dimensions.columns)}`
  const row = `|${' Sample |'.repeat(dimensions.columns)}`
  return [header, delimiter, ...Array.from({ length: dimensions.dataRows }, () => row)].join('\n')
}

export const ORDINARY_TABLE_STARTER = ordinaryTableStarterSource({ columns: 2, dataRows: 1 })

function lineEnd(markdown: string, offset: number): number {
  const newline = markdown.indexOf('\n', offset)
  if (newline === -1) return markdown.length
  return newline > offset && markdown[newline - 1] === '\r' ? newline - 1 : newline
}

function nextLineOffset(markdown: string, end: number): number {
  if (end >= markdown.length) return markdown.length
  return markdown[end] === '\r' && markdown[end + 1] === '\n' ? end + 2 : end + 1
}

export function splitTableRow(line: string): readonly string[] | null {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return null
  const cells: string[] = []
  let cell = ''
  let backtickRun = 0
  let offset = 0
  while (offset < trimmed.length) {
    const character = trimmed[offset] ?? ''
    if (character === '\\' && offset + 1 < trimmed.length) {
      const escaped = trimmed[offset + 1] ?? ''
      cell += escaped === '|' ? '|' : `\\${escaped}`
      offset += 2
      continue
    }
    if (character === '`') {
      let run = 1
      while (trimmed[offset + run] === '`') run += 1
      backtickRun = backtickRun === 0 ? run : backtickRun === run ? 0 : backtickRun
      cell += '`'.repeat(run)
      offset += run
      continue
    }
    if (character === '|' && backtickRun === 0) {
      cells.push(cell.trim())
      cell = ''
      offset += 1
      continue
    }
    cell += character
    offset += 1
  }
  cells.push(cell.trim())
  if (trimmed.startsWith('|')) cells.shift()
  if (trimmed.endsWith('|')) cells.pop()
  return cells.length === 0 ? null : Object.freeze(cells)
}

function delimiterAlignment(source: string): OrdinaryTableAlignment | null {
  const delimiter = source.trim()
  if (!/^:?-{3,}:?$/u.test(delimiter)) return null
  if (delimiter.startsWith(':') && delimiter.endsWith(':')) return 'center'
  if (delimiter.endsWith(':')) return 'right'
  if (delimiter.startsWith(':')) return 'left'
  return 'unspecified'
}

export function parseOrdinaryTableAt(markdown: string, offset: number): OrdinaryTableMatch | null {
  if (!Number.isInteger(offset) || offset < 0 || offset > markdown.length) return null
  const headerEnd = lineEnd(markdown, offset)
  const delimiterFrom = nextLineOffset(markdown, headerEnd)
  if (delimiterFrom >= markdown.length) return null
  const delimiterEnd = lineEnd(markdown, delimiterFrom)
  const headers = splitTableRow(markdown.slice(offset, headerEnd))
  const delimiters = splitTableRow(markdown.slice(delimiterFrom, delimiterEnd))
  if (headers === null || delimiters === null || headers.length !== delimiters.length) return null
  const alignments = delimiters.map(delimiterAlignment)
  if (alignments.some((alignment) => alignment === null)) return null

  const rows: string[][] = []
  let to = delimiterEnd
  let cursor = nextLineOffset(markdown, delimiterEnd)
  while (cursor < markdown.length) {
    const candidateEnd = lineEnd(markdown, cursor)
    const line = markdown.slice(cursor, candidateEnd)
    if (line.trim().length === 0) break
    const cells = splitTableRow(line)
    if (cells === null) break
    if (cells.length !== headers.length) return null
    rows.push([...cells])
    to = candidateEnd
    cursor = nextLineOffset(markdown, candidateEnd)
  }
  return Object.freeze({
    alignments: Object.freeze(alignments as OrdinaryTableAlignment[]),
    delimiters: Object.freeze([...delimiters]),
    headers,
    rows: Object.freeze(rows.map((row) => Object.freeze(row))),
    source: markdown.slice(offset, to),
    sourceSpan: Object.freeze({ from: offset, to }),
  })
}
