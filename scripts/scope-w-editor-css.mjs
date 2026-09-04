const W_EDITOR_ROOT = '.w-editor-instance'

function findNextBrace(source, start) {
  let quote = null
  let comment = false
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]
    const next = source[index + 1]
    if (comment) {
      if (character === '*' && next === '/') {
        comment = false
        index += 1
      }
      continue
    }
    if (quote !== null) {
      if (character === '\\') index += 1
      else if (character === quote) quote = null
      continue
    }
    if (character === '/' && next === '*') {
      comment = true
      index += 1
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === '{') return index
  }
  return -1
}

function findMatchingBrace(source, open) {
  let depth = 0
  let quote = null
  let comment = false
  for (let index = open; index < source.length; index += 1) {
    const character = source[index]
    const next = source[index + 1]
    if (comment) {
      if (character === '*' && next === '/') {
        comment = false
        index += 1
      }
      continue
    }
    if (quote !== null) {
      if (character === '\\') index += 1
      else if (character === quote) quote = null
      continue
    }
    if (character === '/' && next === '*') {
      comment = true
      index += 1
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === '{') depth += 1
    if (character === '}' && --depth === 0) return index
  }
  throw new SyntaxError('Unclosed CSS block while scoping W-Editor styles.')
}

function splitSelectors(selector) {
  const parts = []
  let start = 0
  let paren = 0
  let bracket = 0
  let quote = null
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index]
    if (quote !== null) {
      if (character === '\\') index += 1
      else if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === '(') paren += 1
    else if (character === ')') paren -= 1
    else if (character === '[') bracket += 1
    else if (character === ']') bracket -= 1
    else if (character === ',' && paren === 0 && bracket === 0) {
      parts.push(selector.slice(start, index))
      start = index + 1
    }
  }
  parts.push(selector.slice(start))
  return parts
}

function scopeSelectorPart(part) {
  const leading = part.match(/^\s*/u)?.[0] ?? ''
  const trailing = part.match(/\s*$/u)?.[0] ?? ''
  const selector = part.trim()
  if (selector.length === 0) return part
  if (selector.startsWith(W_EDITOR_ROOT)) return part
  if (selector === ':root') return `${leading}${W_EDITOR_ROOT}${trailing}`
  if (selector.startsWith(':root')) return `${leading}${selector.replace(/^:root/u, W_EDITOR_ROOT)}${trailing}`
  if (/^(?:html|body|#app)(?:\b|\s|[.#:[>+~])/u.test(selector)) {
    return `${leading}${W_EDITOR_ROOT}${selector.replace(/^(?:html|body|#app)/u, '')}${trailing}`
  }
  if (selector === '*') return `${leading}${W_EDITOR_ROOT} *${trailing}`
  return `${leading}${W_EDITOR_ROOT} ${selector}${trailing}`
}

function scopeSelector(selector) {
  return splitSelectors(selector).map(scopeSelectorPart).join(',')
}

function namespaceFonts(declarations, id) {
  if (/cherry-markdown[\\/]dist[\\/]/iu.test(id)) {
    return declarations.replace(/(font-family\s*:\s*)(["']?)ch-icon\2/gu, '$1$2w-editor-ch-icon$2')
  }
  if (/katex[\\/]dist[\\/]/iu.test(id)) {
    return declarations.replace(/((?:font-family|font)\s*:\s*[^;{}]*)/gu, (declaration) => (
      declaration.replace(/\bKaTeX_/gu, 'WEditor_KaTeX_')
    ))
  }
  return declarations
}

function transformCssBlock(source, id) {
  let output = ''
  let cursor = 0
  while (cursor < source.length) {
    const open = findNextBrace(source, cursor)
    if (open === -1) {
      output += source.slice(cursor)
      break
    }
    const prelude = source.slice(cursor, open)
    const close = findMatchingBrace(source, open)
    const body = source.slice(open + 1, close)
    const trimmed = prelude.trim()
    if (trimmed.startsWith('@')) {
      const atRule = trimmed.toLowerCase()
      const transformedBody = atRule.startsWith('@font-face')
        ? namespaceFonts(body, id)
        : atRule.includes('keyframes')
          ? body
          : transformCssBlock(body, id)
      output += `${prelude}{${transformedBody}}`
    } else {
      output += `${scopeSelector(prelude)}{${namespaceFonts(body, id)}}`
    }
    cursor = close + 1
  }
  return output
}

export function scopeWEditorCssText(source, id = '') {
  return transformCssBlock(source, id)
}

function shouldScope(id) {
  return /(?:packages[\\/]editor-vue[\\/]src[\\/]ui[\\/]styles\.css|cherry-markdown[\\/]dist[\\/]cherry-markdown\.min\.css|katex[\\/]dist[\\/]katex\.min\.css)$/iu.test(id.split('?')[0] ?? '')
}

export function createWEditorCssScopePlugin() {
  return {
    enforce: 'pre',
    name: 'w-editor-scope-vendor-css',
    transform(code, id) {
      if (!shouldScope(id)) return null
      return { code: scopeWEditorCssText(code, id), map: null }
    },
  }
}
