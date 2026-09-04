<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import Cherry from 'cherry-markdown/dist/cherry-markdown.esm.js'
import 'cherry-markdown/dist/cherry-markdown.min.css'
import * as echarts from 'echarts'
import mermaid from 'mermaid'

import { dispatchCherrySourceHistoryShortcut } from '@w-editor/editor-vue/adapters'

const initialMarkdown = '# Published source\n\nhistory'
const host = ref<HTMLElement | null>(null)
const ready = ref(false)
const value = ref('')
const selection = ref('none')
const composing = ref(false)
const renderedHtml = ref('')
const lifecycle = ref<'mounted' | 'destroyed'>('mounted')
let cherry: Cherry | undefined

function view(): ReturnType<Cherry['getCodeMirror']> {
  if (cherry === undefined) throw new Error('Cherry capability probe is not mounted.')
  return cherry.getCodeMirror()
}

function readAuthority(): void {
  if (cherry === undefined) return
  const editorView = view()
  value.value = editorView.state.doc.toString()
  const main = editorView.state.selection.main
  selection.value = `${main.anchor}:${main.head}`
}

function selectPublished(): void {
  view().dispatch({ selection: { anchor: 2, head: 11 }, scrollIntoView: true })
  readAuthority()
}

function undoPublished(): void {
  dispatchCherrySourceHistoryShortcut(view(), 'undo')
  readAuthority()
}

function redoPublished(): void {
  dispatchCherrySourceHistoryShortcut(view(), 'redo')
  readAuthority()
}

function renderCurrent(): void {
  const renderHost = document.createElement('div')
  renderHost.id = `cherry-capability-render-${crypto.randomUUID()}`
  renderHost.hidden = true
  document.body.append(renderHost)
  const renderer = new Cherry({
    id: renderHost.id,
    value: view().state.doc.toString(),
    externals: { echarts, mermaid },
    editor: { defaultModel: 'previewOnly' },
    toolbars: { toolbar: false, toolbarRight: false, bubble: false, float: false, sidebar: false },
  })
  try {
    renderedHtml.value = renderer.getHtml(false)
  } finally {
    renderer.destroy()
    renderHost.remove()
  }
}

function destroyProbe(): void {
  cherry?.destroy()
  cherry = undefined
  lifecycle.value = 'destroyed'
  ready.value = false
}

onMounted(() => {
  if (host.value === null) throw new Error('Cherry capability host is unavailable.')
  cherry = new Cherry({
    el: host.value,
    value: initialMarkdown,
    externals: { echarts, mermaid },
    editor: { defaultModel: 'editOnly' },
    callback: {
      afterChange: () => readAuthority(),
      afterInit: () => readAuthority(),
    },
    toolbars: { toolbar: false, toolbarRight: false, bubble: false, float: false, sidebar: false },
  })
  const content = view().contentDOM
  content.addEventListener('compositionstart', () => {
    composing.value = true
  })
  content.addEventListener('compositionend', () => {
    composing.value = false
  })
  readAuthority()
  ready.value = true
})

onBeforeUnmount(() => {
  cherry?.destroy()
})
</script>

<template>
  <section
    class="cherry-capability-probe"
    data-testid="cherry-capability-probe"
    :data-ready="ready"
    :data-lifecycle="lifecycle"
  >
    <h2>Published Cherry capability probe</h2>
    <div
      ref="host"
      style="min-height: 160px"
      data-testid="cherry-capability-host"
    ></div>
    <button
      type="button"
      @click="selectPublished"
    >
      Select Published
    </button>
    <button
      type="button"
      @click="undoPublished"
    >
      Undo Published
    </button>
    <button
      type="button"
      @click="redoPublished"
    >
      Redo Published
    </button>
    <button
      type="button"
      @click="renderCurrent"
    >
      Render current
    </button>
    <button
      type="button"
      @click="destroyProbe"
    >
      Destroy Cherry
    </button>
    <output data-testid="cherry-value">{{ value }}</output>
    <output data-testid="cherry-selection">{{ selection }}</output>
    <output data-testid="cherry-composing">{{ composing }}</output>
    <output data-testid="cherry-rendered-html">{{ renderedHtml }}</output>
  </section>
</template>
