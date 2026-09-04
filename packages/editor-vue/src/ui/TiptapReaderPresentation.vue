<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { DocumentSnapshot } from '@w-editor/editor-core'
import {
  createTiptapPresentation,
  type TiptapPresentationInstance,
} from '../rendering/tiptapPresentation'
import type { AppearanceTheme } from '../services/appearanceTheme'
import {
  createUiLocalizationStore,
  type UiLocale,
} from '../services/uiLocalization'

const props = defineProps<{
  readonly documentId: string
  readonly locale: UiLocale
  readonly markdown: string
  readonly revision: number
  readonly theme: AppearanceTheme
}>()

const emit = defineEmits<{
  error: [failure: unknown]
}>()

const container = ref<HTMLElement | null>(null)
const localization = createUiLocalizationStore(props.locale)
let presentation: TiptapPresentationInstance | null = null

const themeClass = computed(() => `theme__${props.theme}`)

function snapshot(): DocumentSnapshot {
  return Object.freeze({
    documentId: props.documentId,
    markdown: props.markdown,
    revision: props.revision,
  })
}

onMounted(() => {
  if (container.value === null) throw new Error('The Tiptap Reader container is unavailable.')
  presentation = createTiptapPresentation(container.value, {
    localization,
    onError: (failure) => emit('error', failure),
    profile: 'reader',
    snapshot: snapshot(),
  })
})

watch(() => props.locale, (locale) => localization.setLocale(locale))
watch(
  () => [props.documentId, props.markdown, props.revision] as const,
  () => presentation?.setSnapshot(snapshot()),
)

onBeforeUnmount(() => {
  presentation?.destroy()
  presentation = null
})

defineExpose({
  settle: () => presentation?.settle() ?? Promise.resolve(),
})
</script>

<template>
  <div
    ref="container"
    class="tiptap-reader-presentation w-editor-instance"
    :class="themeClass"
    data-presentation-engine="tiptap"
    data-renderer-profile="reader"
  ></div>
</template>
