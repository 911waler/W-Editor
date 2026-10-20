/** Keep structural numbering separate from visual heading-level indentation. */
export function numberOutline<T extends { readonly level: number }>(items: readonly T[]): readonly (T & { readonly number: string; readonly depth: number; readonly indentDepth: number })[] {
  const baseLevel = items.reduce((minimum, item) => Math.min(minimum, item.level), Number.POSITIVE_INFINITY)
  const levels: number[] = []
  const counts: number[] = []
  return items.map(item => {
    while (levels.length && levels[levels.length - 1]! >= item.level) levels.pop()
    const depth = levels.length
    counts[depth] = (counts[depth] ?? 0) + 1
    counts.length = depth + 1
    levels.push(item.level)
    return { ...item, depth, indentDepth: item.level - baseLevel, number: counts.join('.') }
  })
}

/** Keep original numbering and navigation indices when hiding a collapsed subtree. */
export function visibleOutlineItems<T extends { readonly depth: number }>(items: readonly T[], collapsed: ReadonlySet<number>): readonly (T & {
  readonly outlineIndex: number
  readonly hasChildren: boolean
  readonly collapsed: boolean
})[] {
  const visible = []
  let hiddenBelow: number | undefined
  for (const [outlineIndex, item] of items.entries()) {
    if (hiddenBelow !== undefined && item.depth > hiddenBelow) continue
    hiddenBelow = undefined
    const hasChildren = (items[outlineIndex + 1]?.depth ?? 0) > item.depth
    const isCollapsed = hasChildren && collapsed.has(outlineIndex)
    visible.push({ ...item, outlineIndex, hasChildren, collapsed: isCollapsed })
    if (isCollapsed) hiddenBelow = item.depth
  }
  return visible
}

export function activeOutlineIndex(tops: readonly number[], readingTop: number, atEnd = false): number {
  if (!tops.length) return -1
  if (atEnd) return tops.length - 1
  let active = 0
  tops.forEach((top, index) => { if (top <= readingTop) active = index })
  return active
}
