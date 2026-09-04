<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch, type CSSProperties } from 'vue'

import { CherrySourceAdapter, type SourceSearchMatch, type SourceSelection } from '../adapters'
import type { DocumentSession, PatchPlan } from '@w-editor/editor-core'
import type { SynchronizationStateStore } from '@w-editor/editor-core'
import type { AppearanceTheme } from '../services/appearanceTheme'
import { translateUi, type UiLocale, type UiMessageKey } from '../services/uiLocalization'

const props = withDefaults(defineProps<{
  readonly locale: UiLocale
  readonly session: DocumentSession
  readonly state: SynchronizationStateStore
  readonly theme?: AppearanceTheme
}>(), { theme: 'default' })
const emit = defineEmits<{
  compositionEnd: []
  compositionStart: []
  selectionChange: []
}>()

const host = ref<HTMLElement | null>(null)
const quoteAction = ref<HTMLButtonElement | null>(null)
const selectionBubbleStyle = ref<CSSProperties>({})
const selectionBubbleVisible = ref(false)
const testTextarea = ref<HTMLTextAreaElement | null>(null)
const testValue = ref(props.session.snapshot().markdown)
const testMode = import.meta.env.MODE === 'test'
let adapter: CherrySourceAdapter | null = null
let unsubscribe: (() => void) | null = null

function t(key: UiMessageKey): string {
  return translateUi(props.locale, key)
}

function updateOwnedEditorLabels(): void {
  host.value?.querySelector<HTMLElement>('.cm-content')?.setAttribute('aria-label', t('source.markdownSource'))
}

watch(() => props.locale, updateOwnedEditorLabels, { flush: 'post' })
watch(() => props.theme, (theme) => adapter?.setTheme(theme), { flush: 'post' })

function requireAdapter(): CherrySourceAdapter {
  if (adapter === null) throw new Error('The Cherry source surface is not mounted.')
  return adapter
}

function updateSelectionBubble(): void {
  if (adapter === null) {
    selectionBubbleVisible.value = false
    return
  }
  const selection = adapter.selection()
  const coordinates = adapter.selectionCoordinates()
  if (selection.anchor === selection.head || coordinates === null) {
    selectionBubbleVisible.value = false
    return
  }
  const center = (coordinates.left + coordinates.right) / 2
  selectionBubbleStyle.value = Object.freeze({
    left: `${Math.max(24, Math.min(window.innerWidth - 24, center))}px`,
    top: `${Math.max(8, coordinates.top - 8)}px`,
  })
  selectionBubbleVisible.value = true
}

function notifySelection(): void {
  emit('selectionChange')
  void nextTick(updateSelectionBubble)
}

function focusQuoteAction(event: KeyboardEvent): void {
  if (!(event.altKey && event.shiftKey && event.key.toLowerCase() === 'q') || !selectionBubbleVisible.value) return
  event.preventDefault()
  event.stopPropagation()
  quoteAction.value?.focus()
}

function quoteSelectedSource(): boolean {
  if (adapter === null) return false
  const selection = adapter.selection()
  const from = Math.min(selection.anchor, selection.head)
  const to = Math.max(selection.anchor, selection.head)
  if (from === to) return false
  const selected = props.session.snapshot().markdown.slice(from, to)
  const replacement = selected.replace(/(^|\r\n|\r|\n)/gu, '$1> ')
  adapter.replaceSelection({
    codecId: 'blockquote',
    replacement,
    transactionId: `source-context:blockquote:${crypto.randomUUID()}`,
  })
  selectionBubbleVisible.value = false
  emit('selectionChange')
  void nextTick(() => adapter?.focus())
  return true
}

function updateTestValue(event: Event): void {
  const markdown = (event.currentTarget as HTMLTextAreaElement).value
  props.session.commitSource({
    markdown,
    origin: 'cherry-source',
    transactionId: `source-test-input:${crypto.randomUUID()}`,
  })
  props.state.succeed(props.session.snapshot())
}

onMounted(() => {
  if (host.value === null) throw new Error('The Cherry source editor host is unavailable.')
  unsubscribe = props.session.subscribe(({ current }) => {
    testValue.value = current.markdown
  })
  if (testMode) {
    void nextTick(() => testTextarea.value?.focus())
    return
  }
  adapter = new CherrySourceAdapter({
    host: host.value,
    onAcknowledgement: () => props.state.acceptAuthoritativeSnapshot(props.session.snapshot()),
    onCompositionChange: (composing) => {
      if (composing) emit('compositionStart')
      else emit('compositionEnd')
    },
    session: props.session,
    theme: props.theme,
  })
  const content = host.value.querySelector<HTMLElement>('.cm-content')
  content?.setAttribute('aria-label', t('source.markdownSource'))
  content?.setAttribute('id', 'markdown-source-editor')
  content?.addEventListener('keyup', notifySelection)
  content?.addEventListener('mouseup', notifySelection)
  content?.addEventListener('select', notifySelection)
  content?.addEventListener('keydown', focusQuoteAction)
  void nextTick(() => adapter?.focus())
})

onBeforeUnmount(() => {
  const content = host.value?.querySelector<HTMLElement>('.cm-content')
  content?.removeEventListener('keyup', notifySelection)
  content?.removeEventListener('mouseup', notifySelection)
  content?.removeEventListener('select', notifySelection)
  content?.removeEventListener('keydown', focusQuoteAction)
  unsubscribe?.()
  unsubscribe = null
  adapter?.destroy()
  adapter = null
})

defineExpose({
  applyPatchPlan: (plan: PatchPlan) => {
    if (testMode) {
      const acknowledgement = props.session.commitPatchPlan(plan, 'toolbar-command')
      props.state.succeed(props.session.snapshot())
      return acknowledgement
    }
    return requireAdapter().applySourcePatchPlan(plan)
  },
  clearSearchHighlights: () => adapter?.clearSearchHighlights(),
  focus: () => testMode ? testTextarea.value?.focus() : adapter?.focus(),
  flush: () => adapter?.flush() ?? null,
  redo: () => adapter?.redo() ?? false,
  restoreCheckpoint: (markdown: string, transactionId: string) => {
    if (!testMode) return requireAdapter().restoreCheckpoint(markdown, transactionId)
    const acknowledgement = props.session.commitSource({ markdown, origin: 'checkpoint-restore', transactionId })
    props.state.succeed(props.session.snapshot())
    return acknowledgement
  },
  search: (query: string, caseSensitive = false): readonly SourceSearchMatch[] => {
    if (!testMode) return adapter?.search(query, caseSensitive) ?? Object.freeze([])
    if (query.length === 0) return Object.freeze([])
    const source = testValue.value
    const haystack = caseSensitive ? source : source.toLocaleLowerCase()
    const needle = caseSensitive ? query : query.toLocaleLowerCase()
    const matches: SourceSearchMatch[] = []
    let offset = 0
    while (offset <= haystack.length - needle.length) {
      const from = haystack.indexOf(needle, offset)
      if (from === -1) break
      matches.push(Object.freeze({ from, to: from + needle.length }))
      offset = from + Math.max(1, needle.length)
    }
    return Object.freeze(matches)
  },
  setSearchHighlights: (matches: readonly SourceSearchMatch[], activeIndex: number) => {
    if (!testMode) {
      adapter?.setSearchHighlights(matches, activeIndex)
      return
    }
    const active = matches[activeIndex]
    if (active !== undefined) testTextarea.value?.setSelectionRange(active.from, active.to)
  },
  setTheme: (theme: AppearanceTheme) => adapter?.setTheme(theme),
  selection: (): SourceSelection => testMode && testTextarea.value !== null
    ? Object.freeze({ anchor: testTextarea.value.selectionStart, head: testTextarea.value.selectionEnd })
    : adapter?.selection() ?? Object.freeze({ anchor: 0, head: 0 }),
  quoteSelectedSource,
  setSelection: (selection: SourceSelection) => {
    if (testMode) testTextarea.value?.setSelectionRange(selection.anchor, selection.head)
    else adapter?.setSelection(selection)
  },
  undo: () => adapter?.undo() ?? false,
  value: () => testMode ? testValue.value : adapter?.value() ?? props.session.snapshot().markdown,
})
</script>

<template>
  <article
    class="content-surface source-surface"
    data-mode="source"
  >
    <label
      class="visually-hidden"
      for="markdown-source-editor"
    >{{ t('source.markdownSource') }}</label>
    <div
      ref="host"
      class="source-editor-host"
    ></div>
    <div
      v-show="selectionBubbleVisible"
      :aria-label="t('source.selectionActions')"
      class="source-selection-bubble"
      role="toolbar"
      :style="selectionBubbleStyle"
    >
      <button
        ref="quoteAction"
        aria-keyshortcuts="Alt+Shift+Q"
        :aria-label="t('source.quoteSelected')"
        type="button"
        @click="quoteSelectedSource"
      >
        <span aria-hidden="true">❯</span>
        {{ t('source.quote') }}
      </button>
    </div>
    <textarea
      v-if="testMode"
      id="markdown-source"
      ref="testTextarea"
      :value="testValue"
      class="visually-hidden"
      :aria-label="t('source.testControl')"
      @input="updateTestValue"
      @compositionend="emit('compositionEnd')"
      @compositionstart="emit('compositionStart')"
      @select="notifySelection"
    ></textarea>
  </article>
</template>
