export interface TocHeadingInput {
  readonly explicitAnchor?: string | null
  readonly level: number
  readonly text: string
}

export interface TocHeadingItem {
  readonly anchor: string
  readonly level: number
  readonly text: string
}

export interface ParsedHeadingAnchor {
  readonly body: string
  readonly explicitAnchor: string | null
}

const EXPLICIT_ANCHOR = /^(.*?)[ \t]+\{#([A-Za-z0-9-]+)\}$/u

export function parseHeadingAnchor(body: string): ParsedHeadingAnchor {
  const match = EXPLICIT_ANCHOR.exec(body)
  if (match === null) return Object.freeze({ body, explicitAnchor: null })
  return Object.freeze({ body: match[1] ?? '', explicitAnchor: match[2] ?? null })
}

export function cherryHeadingAnchor(text: string): string {
  let anchor = ''
  for (let index = 0; index < text.length; index += 1) {
    const character = text.charAt(index)
    if (/[A-Za-z]/u.test(character)) {
      anchor += character.toLowerCase()
    } else if (/[0-9]/u.test(character)) {
      anchor += character
    } else if (/[\s\-_]/u.test(character)) {
      if (anchor.length > 0 && !anchor.endsWith('-')) anchor += '-'
    } else if (character.charCodeAt(0) > 255) {
      try {
        anchor += encodeURIComponent(character)
      } catch {
        // Cherry ignores isolated surrogate halves while deriving heading ids.
      }
    }
  }
  return anchor
}

export function createTocHeadingItems(headings: readonly TocHeadingInput[]): readonly TocHeadingItem[] {
  const generatedCounts = new Map<string, number>()
  return Object.freeze(headings.map((heading) => {
    let anchor = heading.explicitAnchor ?? cherryHeadingAnchor(heading.text)
    if (heading.explicitAnchor === null || heading.explicitAnchor === undefined) {
      const count = (generatedCounts.get(anchor) ?? 0) + 1
      generatedCounts.set(anchor, count)
      if (count > 1) anchor = `${anchor}-${count}`
    }
    return Object.freeze({ anchor, level: heading.level, text: heading.text })
  }))
}
