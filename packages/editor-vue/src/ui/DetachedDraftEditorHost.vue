<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'

import { translateUi, type UiLocale, type UiMessageKey } from '../services/uiLocalization'

const props = withDefaults(defineProps<{
  readonly commandId: string
  readonly error?: string | null
  readonly inputId: string
  readonly label: string
  readonly locale: UiLocale
  readonly modelValue: string
  readonly rows?: number
  readonly selectOnMount?: boolean
  readonly title: string
}>(), {
  error: null,
  rows: 10,
  selectOnMount: false,
})

const emit = defineEmits<{
  apply: []
  cancel: []
  'update:modelValue': [value: string]
}>()

const initialSource = props.modelValue
const input = ref<HTMLTextAreaElement | null>(null)
const closeConfirmationOpen = ref(false)
const applyPending = ref(false)
const dirty = computed(() => props.modelValue !== initialSource)

function t(key: UiMessageKey): string {
  return translateUi(props.locale, key)
}

onMounted(() => {
  void nextTick(() => {
    input.value?.focus()
    if (props.selectOnMount) input.value?.select()
  })
})

watch(() => props.error, (error) => {
  if (error === null || error === undefined) return
  applyPending.value = false
  void nextTick(() => input.value?.focus())
})

function updateSource(event: Event): void {
  applyPending.value = false
  emit('update:modelValue', (event.currentTarget as HTMLTextAreaElement).value)
}

function apply(): void {
  if (applyPending.value) return
  applyPending.value = true
  emit('apply')
}

function cancel(): void {
  emit('cancel')
}

function requestClose(): void {
  if (!dirty.value) {
    cancel()
    return
  }
  closeConfirmationOpen.value = true
}

function keepEditing(): void {
  closeConfirmationOpen.value = false
  void nextTick(() => input.value?.focus())
}
</script>

<template>
  <div
    class="dialog-backdrop"
    @mousedown.self="requestClose"
  >
    <section
      :data-picker-command="commandId"
      :aria-labelledby="`${inputId}-dialog-title`"
      aria-modal="true"
      class="dialog-panel detached-draft-editor"
      role="dialog"
      @keydown.esc.prevent="requestClose"
    >
      <p class="section-kicker">
        {{ t('draftEditor.kicker') }}
      </p>
      <h2 :id="`${inputId}-dialog-title`">
        {{ title }}
      </h2>
      <label :for="inputId">{{ label }}</label>
      <textarea
        :id="inputId"
        ref="input"
        :rows="rows"
        :value="modelValue"
        @input="updateSource"
      ></textarea>
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
          @click="cancel"
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

      <section
        v-if="closeConfirmationOpen"
        aria-labelledby="dirty-close-title"
        aria-modal="true"
        class="detached-draft-close-confirmation"
        role="alertdialog"
      >
        <h3 id="dirty-close-title">
          {{ t('draftEditor.discardTitle') }}
        </h3>
        <p>{{ t('draftEditor.unchangedExplanation') }}</p>
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
            @click="cancel"
          >
            {{ t('common.discardChanges') }}
          </button>
        </div>
      </section>
    </section>
  </div>
</template>
