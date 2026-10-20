import {
  isCompatibleAlignmentBody,
  mediaSource,
  parseAlignmentAt,
  parseMediaAt,
  parseInlineImageAt,
  projectOrdinaryMarkdown,
  serializeImage,
  type ImageLayoutSettings,
  type MediaKind,
  type MediaModel,
} from '../codecs'
import type { DocumentSnapshot, PatchPlan } from '../core'

export interface MediaCommandPlan {
  readonly plan: PatchPlan
  readonly selection: Readonly<{ from: number; to: number }>
  readonly source: string
}

export function mediaAtSelection(
  markdown: string,
  selection: Readonly<{ from: number; to: number }>,
): MediaModel | null {
  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  let imageOffset = markdown.indexOf('![')
  while (imageOffset !== -1) {
    const image = parseInlineImageAt(markdown, imageOffset)
    if (image !== null && from >= image.sourceSpan.from && to <= image.sourceSpan.to && from < image.sourceSpan.to) {
      return Object.freeze({ ...image, kind: 'image', commandId: 'insert.image' })
    }
    imageOffset = markdown.indexOf('![', imageOffset + 2)
  }
  let offset = 0
  while (offset <= markdown.length) {
    const media = parseMediaAt(markdown, offset)
    if (media !== null && media.kind !== 'image' && from >= media.sourceSpan.from && to <= media.sourceSpan.to) return media
    const newline = markdown.indexOf('\n', offset)
    if (newline === -1) break
    offset = newline + 1
  }
  return null
}

export function createMediaCommandPlan(
  snapshot: DocumentSnapshot,
  selection: Readonly<{ from: number; to: number }>,
  kind: MediaKind,
  name: string,
  url: string,
  transactionId: string,
  imageLayout?: ImageLayoutSettings,
): MediaCommandPlan {
  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  if (from < 0 || to > snapshot.markdown.length) throw new RangeError('Media selection is outside the current Markdown snapshot.')
  const selected = mediaAtSelection(snapshot.markdown, { from, to })
  const replacesSelected = selected?.kind === kind
  const oldImage = replacesSelected && kind === 'image' ? parseInlineImageAt(selected.source, 0) : null
  const source = kind === 'image'
    ? serializeImage({ name, url,
        width: imageLayout === undefined ? oldImage?.width ?? null : imageLayout.width,
        height: imageLayout === undefined ? oldImage?.height ?? null : imageLayout.height,
        ...(oldImage === null ? {} : { source: oldImage.source }) })
    : mediaSource(kind, name, url)
  const lineEnd = snapshot.markdown.indexOf('\n', from)
  let range = replacesSelected
    ? selected.sourceSpan
    : kind === 'image' ? Object.freeze({ from, to })
    : Object.freeze({ from: lineEnd === -1 ? snapshot.markdown.length : lineEnd, to: lineEnd === -1 ? snapshot.markdown.length : lineEnd })
  let replacement = replacesSelected || kind === 'image' || snapshot.markdown.length === 0 ? source : `\n\n${source}`
  let imageEnd = range.from + replacement.length
  if (kind === 'image' && imageLayout?.alignment !== undefined) {
    // Use the same top-level units as the visual projection so continuation lines
    // in lists, table cells and quotes cannot acquire an invalid nested wrapper.
    const entry = projectOrdinaryMarkdown(snapshot).map.entries.find((candidate) => (
      range.from >= candidate.sourceSpan.from && range.to <= candidate.sourceSpan.to
    ))
    const existing = entry?.codecId.startsWith('alignment-') === true
      ? parseAlignmentAt(snapshot.markdown, entry.sourceSpan.from)
      : null
    // Indented continuation paragraphs may belong to a Markdown list even when
    // the ordinary projection represents them separately. Never lift them out.
    const indented = entry !== undefined && /^[ \t]+/mu.test(snapshot.markdown.slice(entry.sourceSpan.from, entry.sourceSpan.to))
    const paragraph = !indented && (entry?.codecId === 'paragraph' || entry?.codecId === 'heading')
    const lineStart = snapshot.markdown.lastIndexOf('\n', Math.max(0, from - 1)) + 1
    const lineTo = snapshot.markdown.indexOf('\n', from)
    const emptyLine = entry === undefined && from === to
      && snapshot.markdown.slice(lineStart, lineTo === -1 ? snapshot.markdown.length : lineTo).length === 0
    if (existing !== null && !indented && isCompatibleAlignmentBody(existing.body)) {
      const edited = snapshot.markdown.slice(existing.sourceSpan.from, range.from)
        + source + snapshot.markdown.slice(range.to, existing.sourceSpan.to)
      replacement = edited.replace(/^(:::[ \t]+)(left|center|right|justify)/u, `$1${imageLayout.alignment}`)
      imageEnd += replacement.length - edited.length
      range = existing.sourceSpan
    } else if ((paragraph || emptyLine || snapshot.markdown.length === 0) && imageLayout.alignment !== 'left') {
      const paragraphRange = entry?.sourceSpan ?? range
      const opener = `::: ${imageLayout.alignment}\n`
      replacement = opener + snapshot.markdown.slice(paragraphRange.from, range.from)
        + source + snapshot.markdown.slice(range.to, paragraphRange.to) + '\n:::'
      imageEnd += opener.length
      range = paragraphRange
    }
  }
  return Object.freeze({
    plan: Object.freeze({
      baseRevision: snapshot.revision,
      patches: Object.freeze([Object.freeze({
        codecId: `media-${kind}`,
        expected: snapshot.markdown.slice(range.from, range.to),
        from: range.from,
        replacement,
        to: range.to,
      })]),
      transactionId,
    }),
    selection: Object.freeze({ from: imageEnd, to: imageEnd }),
    source,
  })
}
