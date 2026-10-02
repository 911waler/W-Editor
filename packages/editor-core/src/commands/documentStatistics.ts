import type { DocumentSnapshot } from '../core'
import type { JSONContent } from '@tiptap/core'
import { projectOrdinaryMarkdown } from '../codecs/ordinaryBlocks'
import type { DisclosureItem } from '../codecs/disclosures'
import type { TimelineItem } from '../codecs/timeline'

export interface DocumentStatistics {
  readonly bytes: number
  readonly characters: number
  readonly charactersWithoutWhitespace: number
  readonly lines: number
  readonly paragraphs: number
  readonly revision: number
  readonly words: number
}

const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu

function markdownBodyText(markdown: string): string {
  return bodyText(projectOrdinaryMarkdown({ documentId: 'body-statistics', markdown, revision: 0 }).content)
}

function bodyText(node: JSONContent): string {
  if (node.type === 'text') return node.marks?.some(mark => mark.type === 'code') ? ' ' : node.text ?? ''
  // These known prose containers store their editable bodies in attributes.
  // Re-project only those bodies, never generic source/metadata attributes.
  if (node.type === 'semanticBlock' && node.attrs !== undefined) {
    const attrs = node.attrs
    switch (attrs['kind']) {
      case 'panel':
        return [attrs['title'], markdownBodyText(attrs['body'])].join('\n')
      case 'column-layout':
        return [attrs['title'], ...(attrs['items'] as readonly string[]).map(markdownBodyText)].join('\n')
      case 'disclosure':
        return (attrs['items'] as readonly DisclosureItem[]).map(item => [item.label, markdownBodyText(item.body)].join('\n')).join('\n')
      case 'timeline':
        return [attrs['title'], ...(attrs['items'] as readonly TimelineItem[]).map(item => [item.time, item.title, markdownBodyText(item.body)].join('\n'))].join('\n')
    }
  }
  // Only projected text content is prose. Citation/figure/formula metadata and
  // generated bibliography/TOC text must never enter the count.
  if (node.type === 'codeBlock' || node.content === undefined) return ' '
  const separator = node.type === 'paragraph' || node.type === 'heading' ? '' : '\n'
  return node.content.map(bodyText).join(separator)
}

/** Han characters + other language/number tokens, excluding non-prose nodes. */
export function calculateBodyWordCount(snapshot: DocumentSnapshot): number {
  const text = markdownBodyText(snapshot.markdown)
  const han = text.match(/\p{Script=Han}/gu)?.length ?? 0
  const other = text.replace(/\p{Script=Han}/gu, ' ')
  return han + (other.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*/gu)?.length ?? 0)
}

export function calculateDocumentStatistics(snapshot: DocumentSnapshot): DocumentStatistics {
  const markdown = snapshot.markdown
  const normalized = markdown.replace(/\r\n?/g, '\n')
  const paragraphs = normalized.trim().length === 0
    ? 0
    : normalized.trim().split(/\n[\t ]*\n+/u).filter((paragraph) => paragraph.trim().length > 0).length
  return Object.freeze({
    bytes: new TextEncoder().encode(markdown).byteLength,
    characters: [...markdown].length,
    charactersWithoutWhitespace: [...markdown].filter((character) => !/\s/u.test(character)).length,
    lines: markdown.length === 0 ? 0 : normalized.split('\n').length,
    paragraphs,
    revision: snapshot.revision,
    words: normalized.match(WORD_PATTERN)?.length ?? 0,
  })
}
