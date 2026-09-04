import { basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { Editor } from '@tiptap/core'
import * as VueRuntime from 'vue'

/**
 * The Web distribution owns these runtime dependencies. The probes reference
 * their browser entry points so tree-shaking cannot turn them into host peers.
 */
export const WEB_BUNDLED_RUNTIME_DEPENDENCIES = Object.freeze({
  cherryMarkdown: '0.11.9',
  codeMirror: '6.0.2',
  katex: '0.16.47',
  probes: Object.freeze({
    codeMirrorBasicSetup: Array.isArray(basicSetup),
    codeMirrorState: typeof EditorState.create === 'function',
    codeMirrorView: typeof EditorView === 'function',
    tiptapEditor: typeof Editor === 'function',
    vueRuntime: typeof VueRuntime.createApp === 'function',
  }),
  tiptap: '3.30.2',
  vue: '3.5.41',
})
