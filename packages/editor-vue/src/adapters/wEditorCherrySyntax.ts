// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- Include Cherry's missing ESM addon declaration in cross-package declaration builds.
/// <reference path="../types/cherry-mermaid-addon.d.ts" />

import Cherry from 'cherry-markdown/dist/cherry-markdown.esm.js'
import MermaidCodeEngine from 'cherry-markdown/dist/addons/cherry-code-block-mermaid-plugin.esm.js'
import mermaid from 'mermaid'

import { W_EDITOR_MERMAID_OPTIONS } from './mermaidPreviewRenderer'

const sentenceHook = Cherry.constants.HOOKS_TYPE_LIST.SEN
const wEditorMermaidEngine = new MermaidCodeEngine({
  ...W_EDITOR_MERMAID_OPTIONS,
  mermaid,
  sequence: Object.freeze({ useMaxWidth: false }),
  theme: 'default',
})

const WEditorUnderline = Cherry.createSyntaxHook('wEditorUnderline', sentenceHook, {
  makeHtml: (source: string) => source.replace(/\+\+([^+\n]+?)\+\+/gu, '<u>$1</u>'),
  rule: () => ({
    begin: '\\+\\+',
    content: '([^+\\n]+?)',
    end: '\\+\\+',
    reg: /\+\+([^+\n]+?)\+\+/gu,
  }),
})

const WEditorSubscript = Cherry.createSyntaxHook('wEditorSubscript', sentenceHook, {
  // Cherry reserves literal tildes as `~T` before sentence hooks run. Register
  // after strikethrough so `~~text~~` has already been consumed and only the
  // W-Editor single-tilde form remains.
  makeHtml: (source: string) => source.replace(/~T([^~\n]+?)~T/gu, '<sub>$1</sub>'),
  rule: () => ({
    begin: '~T',
    content: '([^~\\n]+?)',
    end: '~T',
    reg: /~T([^~\n]+?)~T/gu,
  }),
})

export const W_EDITOR_CHERRY_ENGINE_OPTIONS = Object.freeze({
  customSyntax: Object.freeze({
    wEditorSubscript: Object.freeze({ after: 'strikethrough', syntaxClass: WEditorSubscript }),
    wEditorUnderline: Object.freeze({ after: 'strikethrough', syntaxClass: WEditorUnderline }),
  }),
  syntax: Object.freeze({
    codeBlock: Object.freeze({
      customRenderer: Object.freeze({
        mermaid: wEditorMermaidEngine,
      }),
      mermaid: Object.freeze({ showSourceToolbar: false, src: '', svg2img: false }),
    }),
    inlineMath: Object.freeze({ engine: 'katex' }),
    mathBlock: Object.freeze({ engine: 'katex' }),
    sub: false,
    underline: false,
  }),
})
