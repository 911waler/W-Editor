export interface FencedCodeMatch {
  readonly code: string
  readonly fenceCharacter: '`' | '~'
  readonly fenceLength: number
  readonly language: string
  readonly source: string
  readonly sourceSpan: Readonly<{ from: number; to: number }>
}

export interface CodeLanguageOption {
  readonly label: string
  readonly value: string
}

export const CODE_LANGUAGE_OPTIONS: readonly CodeLanguageOption[] = Object.freeze([
  Object.freeze({ label: 'Plain text', value: '' }),
  Object.freeze({ label: 'Bash', value: 'bash' }),
  Object.freeze({ label: 'C', value: 'c' }),
  Object.freeze({ label: 'C++', value: 'cpp' }),
  Object.freeze({ label: 'C#', value: 'csharp' }),
  Object.freeze({ label: 'CSS', value: 'css' }),
  Object.freeze({ label: 'Dart', value: 'dart' }),
  Object.freeze({ label: 'Diff', value: 'diff' }),
  Object.freeze({ label: 'Dockerfile', value: 'dockerfile' }),
  Object.freeze({ label: 'Go', value: 'go' }),
  Object.freeze({ label: 'GraphQL', value: 'graphql' }),
  Object.freeze({ label: 'HTML', value: 'html' }),
  Object.freeze({ label: 'Java', value: 'java' }),
  Object.freeze({ label: 'JavaScript', value: 'javascript' }),
  Object.freeze({ label: 'JSON', value: 'json' }),
  Object.freeze({ label: 'JSX', value: 'jsx' }),
  Object.freeze({ label: 'Kotlin', value: 'kotlin' }),
  Object.freeze({ label: 'LaTeX', value: 'latex' }),
  Object.freeze({ label: 'Lua', value: 'lua' }),
  Object.freeze({ label: 'Markdown', value: 'markdown' }),
  Object.freeze({ label: 'MATLAB', value: 'matlab' }),
  Object.freeze({ label: 'PHP', value: 'php' }),
  Object.freeze({ label: 'PowerShell', value: 'powershell' }),
  Object.freeze({ label: 'Python', value: 'python' }),
  Object.freeze({ label: 'R', value: 'r' }),
  Object.freeze({ label: 'Ruby', value: 'ruby' }),
  Object.freeze({ label: 'Rust', value: 'rust' }),
  Object.freeze({ label: 'Shell', value: 'shell' }),
  Object.freeze({ label: 'SQL', value: 'sql' }),
  Object.freeze({ label: 'Swift', value: 'swift' }),
  Object.freeze({ label: 'TOML', value: 'toml' }),
  Object.freeze({ label: 'TSX', value: 'tsx' }),
  Object.freeze({ label: 'TypeScript', value: 'typescript' }),
  Object.freeze({ label: 'Vue', value: 'vue' }),
  Object.freeze({ label: 'XML', value: 'xml' }),
  Object.freeze({ label: 'YAML', value: 'yaml' }),
])

export function codeLanguageOptions(currentLanguage: string): readonly CodeLanguageOption[] {
  const normalized = currentLanguage.trim()
  if (CODE_LANGUAGE_OPTIONS.some((option) => option.value === normalized)) return CODE_LANGUAGE_OPTIONS
  return Object.freeze([
    ...CODE_LANGUAGE_OPTIONS,
    Object.freeze({ label: normalized, value: normalized }),
  ])
}

export const FENCED_CODE_STARTER = "```javascript\nconsole.log('Hello from W-Editor')\n```"

function lineEnd(markdown: string, offset: number): number {
  const newline = markdown.indexOf('\n', offset)
  if (newline === -1) return markdown.length
  return newline > offset && markdown[newline - 1] === '\r' ? newline - 1 : newline
}

function nextLineOffset(markdown: string, end: number): number {
  if (end >= markdown.length) return markdown.length
  return markdown[end] === '\r' && markdown[end + 1] === '\n' ? end + 2 : end + 1
}

function openerAt(markdown: string, offset: number): Readonly<{
  character: '`' | '~'
  fence: string
  language: string
  lineEnd: number
}> | null {
  const end = lineEnd(markdown, offset)
  const match = /^(`{3,}|~{3,})[ \t]*([^\s`]*)[ \t]*$/u.exec(markdown.slice(offset, end))
  if (match === null) return null
  const fence = match[1] ?? ''
  return Object.freeze({
    character: fence[0] as '`' | '~',
    fence,
    language: match[2] ?? '',
    lineEnd: end,
  })
}

export function parseFencedCodeAt(markdown: string, offset: number): FencedCodeMatch | null {
  const opener = openerAt(markdown, offset)
  if (opener === null) return null
  const codeFrom = nextLineOffset(markdown, opener.lineEnd)
  let cursor = codeFrom
  while (cursor < markdown.length) {
    const candidateEnd = lineEnd(markdown, cursor)
    const candidate = markdown.slice(cursor, candidateEnd)
    const closing = new RegExp(`^${opener.character}{${opener.fence.length},}[ \\t]*$`, 'u')
    if (closing.test(candidate)) {
      const codeTo = cursor > codeFrom && markdown[cursor - 1] === '\n'
        ? cursor - (markdown[cursor - 2] === '\r' ? 2 : 1)
        : cursor
      return Object.freeze({
        code: markdown.slice(codeFrom, codeTo),
        fenceCharacter: opener.character,
        fenceLength: opener.fence.length,
        language: opener.language,
        source: markdown.slice(offset, candidateEnd),
        sourceSpan: Object.freeze({ from: offset, to: candidateEnd }),
      })
    }
    cursor = nextLineOffset(markdown, candidateEnd)
  }
  return null
}

export function rawFencedCodeCandidateAt(markdown: string, offset: number): Readonly<{ source: string; to: number }> | null {
  if (openerAt(markdown, offset) === null || parseFencedCodeAt(markdown, offset) !== null) return null
  return Object.freeze({ source: markdown.slice(offset), to: markdown.length })
}

export function fencedCodeAtSelection(
  markdown: string,
  selection: Readonly<{ from: number; to: number }>,
): FencedCodeMatch | null {
  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  let offset = 0
  while (offset <= markdown.length) {
    const match = parseFencedCodeAt(markdown, offset)
    if (match !== null && from >= match.sourceSpan.from && to <= match.sourceSpan.to) return match
    const end = lineEnd(markdown, offset)
    if (end >= markdown.length) break
    offset = nextLineOffset(markdown, end)
  }
  return null
}

function longestBacktickRun(code: string): number {
  return [...code.matchAll(/`+/gu)].reduce((longest, match) => Math.max(longest, match[0].length), 0)
}

export function serializeFencedCode(language: string, code: string): string {
  const normalizedLanguage = language.trim()
  if (!/^[A-Za-z0-9_+.-]*$/u.test(normalizedLanguage)) {
    throw new RangeError('Code language must be a single safe identifier.')
  }
  if (code.includes('\0')) throw new RangeError('Code content cannot contain NUL.')
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(code) + 1))
  return `${fence}${normalizedLanguage}\n${code}\n${fence}`
}
