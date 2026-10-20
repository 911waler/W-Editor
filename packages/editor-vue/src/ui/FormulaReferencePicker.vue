<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { FormulaReferenceCandidate } from '@w-editor/editor-core'
import { renderSafeKatex } from '../services/safeKatexRenderer'
import { translateUi, type UiLocale, type UiMessageKey } from '../services/uiLocalization'

const props = withDefaults(defineProps<{
  readonly candidates: readonly FormulaReferenceCandidate[]
  readonly locale: UiLocale
  readonly error?: string | null
}>(), { error: null })
const emit = defineEmits<{ apply: [targetFrom: number]; cancel: [] }>()
const panel = ref<HTMLElement | null>(null)
const selectedFrom = ref<number | null>(props.candidates[0]?.from ?? null)
const selected = computed(() => props.candidates.find(candidate => candidate.from === selectedFrom.value))
const previews = computed(() => props.candidates.map(candidate => ({ ...candidate, html: renderSafeKatex('block', candidate.content).html })))
const t = (key: UiMessageKey, params?: Readonly<Record<string, string | number>>) => translateUi(props.locale, key, params)
onMounted(() => panel.value?.querySelector<HTMLElement>('input, button')?.focus())
function apply(): void {
  if (selected.value !== undefined) emit('apply', selected.value.from)
}
function trapFocus(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('cancel')
    return
  }
  if (event.key !== 'Tab' || panel.value === null) return
  const focusable = [...panel.value.querySelectorAll<HTMLElement>('button:not([disabled]), input:checked:not([disabled])')]
  const first = focusable[0]
  const last = focusable.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}
</script>

<template>
  <div class="dialog-backdrop">
    <section
      ref="panel"
      aria-labelledby="formula-reference-title"
      aria-describedby="formula-reference-help"
      aria-modal="true"
      class="dialog-panel formula-reference-picker"
      data-picker-command="insert.formula-reference"
      role="dialog"
      @keydown="trapFocus"
    >
      <h2 id="formula-reference-title">
        {{ t('formula.referenceTitle') }}
      </h2>
      <p id="formula-reference-help">
        {{ t('formula.referenceHelp') }}
      </p>
      <fieldset
        v-if="previews.length"
        class="formula-reference-picker__list"
      >
        <legend class="visually-hidden">
          {{ t('formula.referenceChoose') }}
        </legend>
        <label
          v-for="candidate in previews"
          :key="candidate.from"
          class="formula-reference-picker__candidate"
        >
          <input
            v-model="selectedFrom"
            type="radio"
            name="formula-reference-target"
            :value="candidate.from"
          />
          <span class="formula-reference-picker__number">{{ t('formula.referenceNumber', { number: candidate.number }) }}</span>
          <!-- Safe KaTeX output is sanitized by renderSafeKatex. -->
          <!-- eslint-disable vue/no-v-html -->
          <span
            class="formula-reference-picker__preview"
            v-html="candidate.html"
          ></span>
          <!-- eslint-enable vue/no-v-html -->
        </label>
      </fieldset>
      <p
        v-else
        data-formula-reference-empty
      >
        {{ t('formula.referenceEmpty') }}
      </p>
      <p
        v-if="error"
        class="dialog-error"
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
          type="button"
          class="primary-action"
          :disabled="selected === undefined"
          @click="apply"
        >
          {{ t('formula.referenceInsert') }}
        </button>
      </div>
    </section>
  </div>
</template>
