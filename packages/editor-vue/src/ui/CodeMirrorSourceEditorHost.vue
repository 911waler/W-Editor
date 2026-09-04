<script setup lang="ts">
import { indentWithTab } from '@codemirror/commands'
import { basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, keymap, type DecorationSet } from '@codemirror/view'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { highlightCodeTokens } from '../adapters/codeSyntaxHighlighting'
import { codeLanguageOptions } from '@w-editor/editor-core'
import { translateUi, type UiLocale, type UiMessageKey } from '../services/uiLocalization'

const props = withDefaults(defineProps<{
  readonly commandId: string
  readonly error?: string | null
  readonly inputId: string
  readonly label: string
  readonly languageInputId?: string
  readonly languageLabel?: string | null
  readonly languageValue?: string | null
  readonly locale: UiLocale
  readonly modelValue: string
  readonly sourceMode?: 'code' | 'markdown'
  readonly title: string
  readonly titleOverride?: string | null
}>(), { error: null, languageInputId: 'code-language', languageLabel: null, languageValue: null, sourceMode: 'markdown', titleOverride: null })
const emit = defineEmits<{
  apply: [source: string, language?: string]
  cancel: []
  'update:languageValue': [language: string]
  'update:modelValue': [source: string]
}>()

const editorHost = ref<HTMLElement | null>(null)
const confirmDiscard = ref(false)
const initialSource = props.modelValue
const initialLanguage = props.languageValue
const currentSource = ref(props.modelValue)
const currentLanguage = ref(props.languageValue ?? '')
const dirty = computed(() => currentSource.value !== initialSource || currentLanguage.value !== (initialLanguage ?? ''))
let editorView: EditorView | null = null
const applyPending = ref(false)
const setCodeHighlightLanguage = StateEffect.define<string>()

interface CodeHighlightState {
  readonly decorations: DecorationSet
  readonly language: string
}

function codeHighlightDecorations(state: EditorState, language: string): DecorationSet {
  return Decoration.set(highlightCodeTokens(state.doc.toString(), language).map((token) => (
    Decoration.mark({ attributes: { 'data-code-token': token.token }, class: token.className })
      .range(token.from, token.to)
  )), true)
}

function codeHighlighting(initialLanguage: string): Extension {
  const field = StateField.define<CodeHighlightState>({
    create: (state) => Object.freeze({
      decorations: codeHighlightDecorations(state, initialLanguage),
      language: initialLanguage,
    }),
    provide: (stateField) => EditorView.decorations.from(stateField, (value) => value.decorations),
    update: (previous, transaction) => {
      let language = previous.language
      for (const effect of transaction.effects) {
        if (effect.is(setCodeHighlightLanguage)) language = effect.value
      }
      if (!transaction.docChanged && language === previous.language) return previous
      return Object.freeze({ decorations: codeHighlightDecorations(transaction.state, language), language })
    },
  })
  return field
}

function t(key: UiMessageKey): string {
  return translateUi(props.locale, key)
}
const displayedTitle = computed(() => props.sourceMode === 'code'
  ? props.titleOverride ?? t('codeEditor.title')
  : props.title)
const displayedSourceLabel = computed(() => props.sourceMode === 'code' ? t('codeEditor.source') : props.label)
const displayedLanguageLabel = computed(() => props.sourceMode === 'code'
  ? t('codeEditor.language')
  : props.languageLabel ?? t('codeEditor.language'))
const displayedLanguageOptions = computed(() => codeLanguageOptions(currentLanguage.value).map((option) => Object.freeze({
  label: option.value.length === 0 ? t('codeNode.plainText') : option.label,
  value: option.value,
})))

function setValue(source: string): void {
  currentSource.value = source
  if (editorView === null || editorView.state.doc.toString() === source) return
  editorView.dispatch({ changes: { from: 0, insert: source, to: editorView.state.doc.length } })
}

function requestClose(): void {
  if (dirty.value) {
    confirmDiscard.value = true
    return
  }
  emit('cancel')
}

function keepEditing(): void {
  confirmDiscard.value = false
  void nextTick(() => editorView?.focus())
}

function apply(): void {
  if (applyPending.value) return
  applyPending.value = true
  if (props.languageValue === null) emit('apply', currentSource.value)
  else emit('apply', currentSource.value, currentLanguage.value)
}

function updateLanguage(): void {
  applyPending.value = false
  editorView?.dispatch({ effects: setCodeHighlightLanguage.of(currentLanguage.value) })
  emit('update:languageValue', currentLanguage.value)
}

watch(() => props.error, (error) => {
  if (error === null) return
  applyPending.value = false
  void nextTick(() => editorView?.focus())
})
watch(() => props.modelValue, (source) => setValue(source))
watch(() => props.languageValue, (language) => {
  if (language === null) return
  currentLanguage.value = language
  editorView?.dispatch({ effects: setCodeHighlightLanguage.of(language) })
})
watch(displayedSourceLabel, (label) => editorView?.contentDOM.setAttribute('aria-label', label), { flush: 'post' })

onMounted(async () => {
  if (editorHost.value === null) throw new Error('The CodeMirror editor host is unavailable.')
  editorView = new EditorView({
    parent: editorHost.value,
    state: EditorState.create({
      doc: currentSource.value,
      extensions: [
        basicSetup,
        ...(props.sourceMode === 'markdown' ? [markdown()] : []),
        ...(props.sourceMode === 'code' ? [keymap.of([indentWithTab]), codeHighlighting(currentLanguage.value)] : []),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': displayedSourceLabel.value }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return
          const source = update.state.doc.toString()
          currentSource.value = source
          applyPending.value = false
          emit('update:modelValue', source)
        }),
      ],
    }),
  })
  await nextTick()
  editorView.focus()
})

onBeforeUnmount(() => {
  editorView?.destroy()
  editorView = null
})

defineExpose({
  dirty: () => dirty.value,
  setValue,
  value: () => currentSource.value,
})
</script>

<template>
  <div
    class="dialog-backdrop"
    @mousedown.self="requestClose"
  >
    <section
      :data-editor-command="commandId"
      :data-source-mode="sourceMode"
      :aria-labelledby="`${inputId}-title`"
      aria-modal="true"
      class="dialog-panel code-mirror-dialog"
      role="dialog"
      @keydown.esc.prevent="requestClose"
    >
      <p class="section-kicker">
        {{ t('codeEditor.kicker') }}
      </p>
      <h2 :id="`${inputId}-title`">
        {{ displayedTitle }}
      </h2>
      <template v-if="languageValue !== null">
        <div class="code-mirror-dialog__language-field">
          <label :for="languageInputId">{{ displayedLanguageLabel }}</label>
          <select
            :id="languageInputId"
            v-model="currentLanguage"
            class="code-mirror-dialog__language"
            @change="updateLanguage"
          >
            <option
              v-for="option in displayedLanguageOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </div>
      </template>
      <label :for="inputId">{{ displayedSourceLabel }}</label>
      <div
        :id="inputId"
        ref="editorHost"
        class="code-mirror-dialog__editor"
      ></div>
      <p
        v-if="error"
        class="dialog-panel__error"
        role="alert"
      >
        {{ error }}
      </p>
      <div class="dialog-panel__actions">
        <button
          type="button"
          @click="emit('cancel')"
        >
          {{ t('common.cancel') }}
        </button>
        <button
          class="primary-action"
          :disabled="applyPending"
          type="button"
          @click="apply"
        >
          {{ error === null ? t('common.apply') : t('common.retry') }}
        </button>
      </div>
    </section>

    <section
      v-if="confirmDiscard"
      aria-labelledby="discard-raw-draft-title"
      aria-modal="true"
      class="dialog-panel dialog-panel--confirm"
      role="alertdialog"
    >
      <h2 id="discard-raw-draft-title">
        {{ t('codeEditor.discardTitle') }}
      </h2>
      <p>{{ t('codeEditor.dirtyExplanation') }}</p>
      <div class="dialog-panel__actions">
        <button
          type="button"
          @click="keepEditing"
        >
          {{ t('common.keepEditing') }}
        </button>
        <button
          class="danger-action"
          type="button"
          @click="emit('cancel')"
        >
          {{ t('common.discardChanges') }}
        </button>
      </div>
    </section>
  </div>
</template>
