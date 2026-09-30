/** Presentation-only hierarchy: never writes numbering into document headings. */
export function numberOutline<T extends { readonly level: number }>(items: readonly T[]): readonly (T & { readonly number: string; readonly depth: number })[] {
  const levels: number[] = []
  const counts: number[] = []
  return items.map(item => {
    while (levels.length && levels[levels.length - 1]! >= item.level) levels.pop()
    const depth = levels.length
    counts[depth] = (counts[depth] ?? 0) + 1
    counts.length = depth + 1
    levels.push(item.level)
    return { ...item, depth, number: counts.join('.') }
  })
}

export function activeOutlineIndex(tops: readonly number[], readingTop: number, atEnd = false): number {
  if (!tops.length) return -1
  if (atEnd) return tops.length - 1
  let active = 0
  tops.forEach((top, index) => { if (top <= readingTop) active = index })
  return active
}
