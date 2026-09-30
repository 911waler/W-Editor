<script setup lang="ts">
import { ref, watch } from 'vue'
const props = defineProps<{ disabled?: boolean; label: string; hint: string; chooseLabel: string; library?: boolean }>()
const emit = defineEmits<{ choose: [event: MouseEvent]; files: [files: File[], event: DragEvent] }>()
const dragDepth = ref(0)
watch(() => props.disabled, () => { dragDepth.value = 0 })
function isFileDrag(event: DragEvent) { return Array.from(event.dataTransfer?.types ?? []).includes('Files') }
function enter(event: DragEvent) {
  if (!isFileDrag(event)) return
  event.preventDefault()
  event.stopPropagation()
  if (!props.disabled) dragDepth.value += 1
}
function over(event: DragEvent) {
  if (!isFileDrag(event)) return
  event.preventDefault()
  event.stopPropagation()
  if (event.dataTransfer) event.dataTransfer.dropEffect = props.disabled ? 'none' : 'copy'
}
function leave(event: DragEvent) {
  if (!isFileDrag(event)) return
  event.stopPropagation()
  dragDepth.value = Math.max(0, dragDepth.value - 1)
}
function drop(event: DragEvent) {
  if (!isFileDrag(event)) return
  event.preventDefault()
  event.stopPropagation()
  dragDepth.value = 0
  if (!props.disabled) emit('files', Array.from(event.dataTransfer?.files ?? []), event)
}
</script>
<template>
  <div
    class="markdown-import-zone"
    :class="{ 'is-dragging': dragDepth > 0, 'is-disabled': disabled }"
    data-testid="markdown-import-zone"
    role="group"
    :aria-label="label"
    :aria-busy="disabled || undefined"
    @dragenter="enter"
    @dragover="over"
    @dragleave="leave"
    @drop="drop"
  >
    <span class="markdown-import-zone__hint">{{ hint }}</span>
    <button
      class="tool-button"
      data-testid="import-markdown"
      :data-desktop-library-import="library ? 'true' : undefined"
      type="button"
      :disabled="disabled"
      @click="emit('choose', $event)"
    >
      {{ chooseLabel }}
    </button>
  </div>
</template>
<style scoped>
.markdown-import-zone {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
  box-sizing: border-box;
  max-width: 100%;
  padding: 8px 12px;
  border: 1px dashed var(--border, #a8afb7);
  border-radius: 8px;
  color: inherit;
  background: transparent;
  transition: border-color 120ms ease, background-color 120ms ease;
}
.markdown-import-zone__hint { font-size: 12px; line-height: 1.5; }
.markdown-import-zone.is-dragging {
  border-color: #34856c;
  background: color-mix(in srgb, #34856c 12%, transparent);
  outline: 2px solid #34856c;
  outline-offset: 1px;
}
.markdown-import-zone:focus-within { border-style: solid; }
.markdown-import-zone.is-disabled { opacity: 0.6; }
@media (prefers-reduced-motion: reduce) { .markdown-import-zone { transition: none; } }
</style>
