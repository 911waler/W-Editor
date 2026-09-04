<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { CherrySourceAdapter } from '@w-editor/editor-vue/adapters'
import { DocumentSession } from '@w-editor/editor-core'

const initialMarkdown = '# Adapter source\n\nhistory'
const host = ref<HTMLElement | null>(null)
const ready = ref(false)
const lifecycle = ref<'mounted' | 'destroyed'>('mounted')
const authority = ref('')
const adapterValue = ref('')
const revision = ref(0)
const changeCount = ref(0)
const selection = ref('none')
const composing = ref(false)
const searchMatches = ref('[]')
const origins = ref<string[]>([])
let adapter: CherrySourceAdapter | undefined
let session: DocumentSession | undefined
let unsubscribe: (() => void) | undefined

function sync(): void {
  if (session !== undefined) {
    const snapshot = session.snapshot()
    authority.value = snapshot.markdown
    revision.value = snapshot.revision
  }
  if (adapter !== undefined) {
    adapterValue.value = adapter.value()
    const currentSelection = adapter.selection()
    selection.value = `${currentSelection.anchor}:${currentSelection.head}`
    composing.value = adapter.isComposing()
  }
}

function requireAdapter(): CherrySourceAdapter {
  if (adapter === undefined) throw new Error('Cherry source adapter probe is not mounted.')
  return adapter
}

function requireSession(): DocumentSession {
  if (session === undefined) throw new Error('Cherry source adapter session is not mounted.')
  return session
}

function selectHistory(): void {
  const current = requireAdapter()
  const from = current.value().indexOf('history')
  current.setSelection({ anchor: from, head: from + 'history'.length })
  sync()
}

function replaceSelection(): void {
  requireAdapter().replaceSelection({
    codecId: 'search-replace',
    replacement: 'replaced',
    selectReplacement: true,
    transactionId: 'adapter-selection-replace',
  })
  sync()
}

function searchSource(): void {
  searchMatches.value = JSON.stringify(requireAdapter().search('source'))
}

function undo(): void {
  requireAdapter().undo()
  requireAdapter().flush()
  sync()
}

function redo(): void {
  requireAdapter().redo()
  requireAdapter().flush()
  sync()
}

function importSnapshot(): void {
  requireSession().commitSource({
    markdown: '# External\r\n\r\nexact  source\r\n',
    origin: 'import',
    transactionId: 'adapter-external-import',
  })
  sync()
}

function destroyAdapter(): void {
  adapter?.destroy()
  adapter = undefined
  lifecycle.value = 'destroyed'
  ready.value = false
}

function commitAfterDestroy(): void {
  requireSession().commitSource({
    markdown: 'after destroy',
    origin: 'import',
    transactionId: 'adapter-after-destroy',
  })
  sync()
}

onMounted(() => {
  if (host.value === null) throw new Error('Cherry source adapter host is unavailable.')
  session = new DocumentSession({ documentId: 'adapter-probe', markdown: initialMarkdown })
  unsubscribe = session.subscribe((change) => {
    changeCount.value += 1
    origins.value.push(change.acknowledgement.origin)
    sync()
  })
  adapter = new CherrySourceAdapter({
    host: host.value,
    onAcknowledgement: () => sync(),
    onCompositionChange: (next) => {
      composing.value = next
    },
    session,
  })
  sync()
  ready.value = true
})

onBeforeUnmount(() => {
  adapter?.destroy()
  unsubscribe?.()
})
</script>

<template>
  <section
    class="cherry-source-adapter-probe"
    data-testid="cherry-source-adapter-probe"
    :data-lifecycle="lifecycle"
    :data-ready="ready"
  >
    <h2>Cherry source adapter probe</h2>
    <div
      ref="host"
      style="min-height: 160px"
      data-testid="cherry-source-adapter-host"
    ></div>
    <button
      type="button"
      @click="selectHistory"
    >
      Select history
    </button>
    <button
      type="button"
      @click="replaceSelection"
    >
      Replace selection
    </button>
    <button
      type="button"
      @click="searchSource"
    >
      Search source
    </button>
    <button
      type="button"
      @click="undo"
    >
      Adapter undo
    </button>
    <button
      type="button"
      @click="redo"
    >
      Adapter redo
    </button>
    <button
      type="button"
      @click="importSnapshot"
    >
      Import external snapshot
    </button>
    <button
      type="button"
      @click="destroyAdapter"
    >
      Destroy adapter
    </button>
    <button
      type="button"
      @click="commitAfterDestroy"
    >
      Commit after destroy
    </button>
    <output data-testid="adapter-authority">{{ authority }}</output>
    <output data-testid="adapter-value">{{ adapterValue }}</output>
    <output data-testid="adapter-revision">{{ revision }}</output>
    <output data-testid="adapter-change-count">{{ changeCount }}</output>
    <output data-testid="adapter-selection">{{ selection }}</output>
    <output data-testid="adapter-composing">{{ composing }}</output>
    <output data-testid="adapter-search-matches">{{ searchMatches }}</output>
    <output data-testid="adapter-origins">{{ JSON.stringify(origins) }}</output>
  </section>
</template>
