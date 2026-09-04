<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

import {
  defaultSharedRendererPipeline,
  type RendererProfile,
  type SharedRendererPipeline,
  updateRendererLabels,
} from '../rendering'
import type { AppearanceTheme } from '../services/appearanceTheme'
import type { UiLocale } from '../services/uiLocalization'

const props = withDefaults(defineProps<{
  readonly html: string
  readonly locale: UiLocale
  readonly pipeline?: SharedRendererPipeline
  readonly profile?: RendererProfile
  readonly theme?: AppearanceTheme
}>(), {
  pipeline: () => defaultSharedRendererPipeline,
  profile: 'author-preview',
  theme: 'default',
})
const emit = defineEmits<{
  codeEdit: [index: number]
  taskToggle: [event: Readonly<{ checked: boolean; index: number }>]
}>()
const host = ref<HTMLElement | null>(null)
let disposeHydration: (() => void) | null = null

function hydratePreview(): void {
  disposeHydration?.()
  disposeHydration = null
  if (host.value === null) return
  const template = host.value.ownerDocument.createElement('template')
  template.innerHTML = props.html
  for (const anchor of template.content.querySelectorAll<HTMLAnchorElement>('a.anchor')) {
    anchor.removeAttribute('href')
    anchor.setAttribute('aria-hidden', 'true')
  }
  for (const toc of template.content.querySelectorAll<HTMLElement>('.toc')) {
    const items = [...toc.children].filter((child): child is HTMLLIElement => child instanceof HTMLLIElement && child.classList.contains('toc-li'))
    if (items.length === 0) continue
    const first = items[0]
    if (first === undefined) continue
    const list = toc.ownerDocument.createElement('ol')
    list.className = 'toc-node__list'
    toc.insertBefore(list, first)
    for (const item of items) list.append(item)
  }
  host.value.replaceChildren(template.content.cloneNode(true))
  const pipeline = props.pipeline ?? defaultSharedRendererPipeline
  disposeHydration = pipeline.hydrate(host.value, {
    locale: props.locale,
    onCodeEdit: (index) => emit('codeEdit', index),
    onTaskToggle: (event) => emit('taskToggle', event),
    profile: props.profile,
  })
}

watch([host, () => props.html, () => props.profile], hydratePreview, { flush: 'post', immediate: true })
watch(() => props.locale, (locale) => {
  if (host.value !== null) updateRendererLabels(host.value, locale)
}, { flush: 'post' })
onBeforeUnmount(() => disposeHydration?.())
</script>

<template>
  <div
    class="w-editor-instance cherry rendered-document-theme preview-rendered-theme"
    :class="`theme__${theme}`"
  >
    <div
      ref="host"
      class="cherry-markdown rendered-document-content preview-rendered-content"
      :aria-readonly="profile === 'reader' ? 'true' : undefined"
      :data-renderer-profile="profile"
    ></div>
  </div>
</template>
