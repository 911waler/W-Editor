import { onBeforeUnmount, ref, watch } from 'vue'
import type { DocumentReference } from '@w-editor/editor-core'
import { areReferenceStylesReady, ensureReferenceStyles, formatReference, onReferenceStylesLoaded } from '@w-editor/editor-vue/services'

/** Only style changes load assets; ordinary metadata edits reuse the formatter cache. */
export function useReferenceFormatting(references: () => readonly DocumentReference[]) {
  const revision = ref(0)
  const error = ref('')
  let generation = 0
  const unsubscribe = onReferenceStylesLoaded(() => {
    revision.value++
    if (areReferenceStylesReady(references().map(entry => entry.style ?? 'plain'))) error.value = ''
  })
  watch(() => references().map(entry => entry.style ?? 'plain').join('|'), async () => {
    const current = ++generation
    error.value = ''
    try { await ensureReferenceStyles(references().map(entry => entry.style ?? 'plain')) }
    catch (reason) { if (current === generation) error.value = reason instanceof Error ? reason.message : '引用样式加载失败，请重试。' }
  }, { immediate: true })
  onBeforeUnmount(() => { generation++; unsubscribe() })
  function format(reference: DocumentReference): string {
    // Establish a Vue dependency for asynchronous, locally served CSL chunks.
    void revision.value
    return formatReference(reference)
  }
  return { format, error }
}
