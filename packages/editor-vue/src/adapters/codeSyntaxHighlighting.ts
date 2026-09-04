import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import dart from 'highlight.js/lib/languages/dart'
import diff from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import graphql from 'highlight.js/lib/languages/graphql'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import latex from 'highlight.js/lib/languages/latex'
import lua from 'highlight.js/lib/languages/lua'
import markdown from 'highlight.js/lib/languages/markdown'
import matlab from 'highlight.js/lib/languages/matlab'
import php from 'highlight.js/lib/languages/php'
import powershell from 'highlight.js/lib/languages/powershell'
import python from 'highlight.js/lib/languages/python'
import r from 'highlight.js/lib/languages/r'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

export interface CodeHighlightToken {
  readonly className: string
  readonly from: number
  readonly to: number
  readonly token: string
}

const LANGUAGE_DEFINITIONS = Object.freeze({
  bash,
  c,
  cpp,
  csharp,
  css,
  dart,
  diff,
  dockerfile,
  go,
  graphql,
  ini,
  java,
  javascript,
  json,
  kotlin,
  latex,
  lua,
  markdown,
  matlab,
  php,
  powershell,
  python,
  r,
  ruby,
  rust,
  sql,
  swift,
  typescript,
  xml,
  yaml,
})

for (const [name, definition] of Object.entries(LANGUAGE_DEFINITIONS)) {
  hljs.registerLanguage(name, definition)
}

const HIGHLIGHT_LANGUAGE_BY_DECLARATION: Readonly<Record<string, string>> = Object.freeze({
  bash: 'bash',
  c: 'c',
  cpp: 'cpp',
  csharp: 'csharp',
  css: 'css',
  dart: 'dart',
  diff: 'diff',
  dockerfile: 'dockerfile',
  go: 'go',
  graphql: 'graphql',
  html: 'xml',
  java: 'java',
  javascript: 'javascript',
  json: 'json',
  jsx: 'javascript',
  kotlin: 'kotlin',
  latex: 'latex',
  lua: 'lua',
  markdown: 'markdown',
  matlab: 'matlab',
  php: 'php',
  powershell: 'powershell',
  python: 'python',
  r: 'r',
  ruby: 'ruby',
  rust: 'rust',
  shell: 'bash',
  sql: 'sql',
  swift: 'swift',
  toml: 'ini',
  tsx: 'typescript',
  typescript: 'typescript',
  vue: 'xml',
  xml: 'xml',
  yaml: 'yaml',
})

export function supportsCodeHighlightLanguage(declaredLanguage: string): boolean {
  return HIGHLIGHT_LANGUAGE_BY_DECLARATION[declaredLanguage.trim().toLowerCase()] !== undefined
}

export function highlightCodeTokens(source: string, declaredLanguage: string): readonly CodeHighlightToken[] {
  const language = HIGHLIGHT_LANGUAGE_BY_DECLARATION[declaredLanguage.trim().toLowerCase()]
  if (language === undefined || source.length === 0) return Object.freeze([])

  const template = document.createElement('template')
  template.innerHTML = hljs.highlight(source, { ignoreIllegals: true, language }).value
  const tokens: CodeHighlightToken[] = []
  let offset = 0

  const visit = (node: Node, inheritedClasses: readonly string[]): void => {
    if (node instanceof Text) {
      const to = offset + node.data.length
      if (to > offset && inheritedClasses.length > 0) {
        const classes = [...new Set(inheritedClasses)]
        const primary = classes.find((className) => className.startsWith('hljs-')) ?? classes[0] ?? 'token'
        tokens.push(Object.freeze({
          className: classes.join(' '),
          from: offset,
          to,
          token: primary.replace(/^hljs-/u, ''),
        }))
      }
      offset = to
      return
    }
    if (!(node instanceof Element)) return
    const classes = Object.freeze([...inheritedClasses, ...node.classList])
    for (const child of node.childNodes) visit(child, classes)
  }

  for (const child of template.content.childNodes) visit(child, Object.freeze([]))
  return offset === source.length ? Object.freeze(tokens) : Object.freeze([])
}
