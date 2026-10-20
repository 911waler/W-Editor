export type FormulaLayoutKind = 'aligned' | 'gathered'

interface FormulaLayoutRange {
  readonly kind: FormulaLayoutKind
  readonly from: number
  readonly to: number
  readonly bodyFrom: number
  readonly bodyTo: number
}

export const FORMULA_LAYOUT_EXAMPLES: Readonly<Record<FormulaLayoutKind, string>> = Object.freeze({
  aligned: String.raw`a + b + c &= d \\` + '\n' + 'x &= y',
  gathered: String.raw`a + b + c = d \\` + '\n' + 'x = y',
})

function escaped(source: string, offset: number): boolean {
  let preceding = 0
  for (let index = offset - 1; index >= 0 && source[index] === '\\'; index -= 1) preceding += 1
  return preceding % 2 === 1
}

// Recognize only the two supported layout environments, not arbitrary TeX syntax.
function completeLayouts(source: string): readonly FormulaLayoutRange[] {
  const ranges: FormulaLayoutRange[] = []
  const stack: Omit<FormulaLayoutRange, 'to' | 'bodyTo'>[] = []
  const token = /\\(begin|end)\{(aligned|gathered)\}/gy
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '%' && !escaped(source, index)) {
      while (index < source.length && source[index] !== '\n' && source[index] !== '\r') index += 1
      continue
    }
    if (source[index] !== '\\' || escaped(source, index)) continue
    token.lastIndex = index
    const match = token.exec(source)
    if (match === null) continue
    const kind: FormulaLayoutKind = match[2] === 'aligned' ? 'aligned' : 'gathered'
    if (match[1] === 'begin') stack.push({ kind, from: index, bodyFrom: token.lastIndex })
    else {
      const open = stack.pop()
      if (open?.kind === kind) ranges.push({ ...open, to: token.lastIndex, bodyTo: index })
      else stack.length = 0
    }
    index = token.lastIndex - 1
  }
  return ranges
}

export function formulaLayoutAtSelection(source: string, from: number, to: number): FormulaLayoutKind | null {
  // Resolve the nearest environment before checking its body, so a nested label
  // or a selection crossing it cannot fall back to an outer environment's body.
  const range = completeLayouts(source)
    .filter(candidate => (from >= candidate.from && from < candidate.to)
      || (to > from && to > candidate.from && to <= candidate.to))
    .sort((left, right) => right.bodyFrom - left.bodyFrom)[0]
  return range !== undefined && from >= range.bodyFrom && to <= range.bodyTo ? range.kind : null
}

// Add one anchor per top-level row; handwritten alignment and nested TeX stay intact.
function alignEquals(source: string): string {
  const insertions: number[] = []
  const environments: string[] = []
  const environment = /\\(begin|end)\{([a-zA-Z*]+)\}/gy
  let braces = 0
  let firstEquals: number | undefined
  let hasAlignment = false
  const finishRow = () => {
    if (!hasAlignment && firstEquals !== undefined) insertions.push(firstEquals)
    firstEquals = undefined
    hasAlignment = false
  }
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (char === '%') {
      while (index < source.length && source[index] !== '\n' && source[index] !== '\r') index += 1
    } else if (char === '\\') {
      environment.lastIndex = index
      const match = environment.exec(source)
      if (match !== null) {
        if (match[1] === 'begin') environments.push(match[2]!)
        else if (environments.at(-1) === match[2]) environments.pop()
        index = environment.lastIndex - 1
      } else {
        if (source[index + 1] === '\\' && braces === 0 && environments.length === 0) finishRow()
        // Consume escaped symbols (including \=, \&, \%, and braces) together.
        index += 1
      }
    } else if (char === '{') braces += 1
    else if (char === '}') braces = Math.max(0, braces - 1)
    else if (braces === 0 && environments.length === 0) {
      if (char === '&') hasAlignment = true
      else if (char === '=' && firstEquals === undefined) firstEquals = index
    }
  }
  finishRow()
  let result = ''
  let from = 0
  for (const index of insertions) {
    result += `${source.slice(from, index)}&`
    from = index
  }
  return result + source.slice(from)
}

export function wrapFormulaLayout(source: string, kind: FormulaLayoutKind): Readonly<{ content: string; caret: number }> {
  const outer = completeLayouts(source).find(range => range.kind === kind
    && source.slice(0, range.from).trim() === '' && source.slice(range.to).trim() === '')
  if (outer !== undefined) {
    const originalBody = source.slice(outer.bodyFrom, outer.bodyTo)
    const body = kind === 'aligned' ? alignEquals(originalBody) : originalBody
    return {
      content: source.slice(0, outer.bodyFrom) + body + source.slice(outer.bodyTo),
      caret: outer.bodyFrom + body.trimEnd().length,
    }
  }
  const originalBody = source.trim() === '' ? FORMULA_LAYOUT_EXAMPLES[kind] : source
  const body = kind === 'aligned' ? alignEquals(originalBody) : originalBody
  const before = `\\begin{${kind}}\n${body}`
  return { content: `${before}\n\\end{${kind}}`, caret: before.length }
}
