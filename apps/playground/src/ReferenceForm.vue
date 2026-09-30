<script setup lang="ts">
import { referenceDialogFocus as vReferenceDialogFocus } from './referenceDialogFocus'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { type DocumentReference, type ReferenceMetadata, type ReferenceStyle } from '@w-editor/editor-core'
import { formatReference } from '@w-editor/editor-vue/services'
const props = defineProps<{
  reference?: DocumentReference | undefined; busy: boolean; submitLabel: string; allowApplyStyle?: boolean
  lookupDoi?: ((doi: string, signal: AbortSignal) => Promise<ReferenceMetadata>) | undefined
}>()
const emit = defineEmits<{ save: [reference: Pick<DocumentReference, 'text' | 'metadata' | 'style'>]; style: [style: ReferenceStyle] }>()
const text = ref('')
const style = ref<ReferenceStyle>('plain')
const metadata = ref<{ -readonly [K in keyof ReferenceMetadata]: ReferenceMetadata[K] }>({})
const authors = ref('')
const metadataOpen = ref(false)
const lookupPending = ref(false)
const lookupError = ref('')
const lookupSuccess = ref(false)
let lookupVersion = 0
let lookupController: AbortController | null = null
function invalidateLookup(): void { lookupSuccess.value = false; lookupVersion++; lookupController?.abort(); lookupController = null; lookupPending.value = false }
watch(text, invalidateLookup, { flush: 'sync' })
watch(metadata, invalidateLookup, { deep: true, flush: 'sync' })
watch(authors, invalidateLookup, { flush: 'sync' })
function authorText(value: ReferenceMetadata): string {
  return (value.authors ?? []).map(author => author.literal ?? [author.family, author.given].filter(Boolean).join(', ')).join('\n')
}
watch(() => props.reference, (reference, previous) => {
  if (reference && previous && reference.id === previous.id && reference.text === previous.text && JSON.stringify(reference.metadata) === JSON.stringify(previous.metadata) && reference.style !== previous.style) {
    style.value = reference.style ?? 'plain'
    return
  }
  invalidateLookup()
  text.value = reference?.text ?? ''
  metadata.value = { ...reference?.metadata }
  authors.value = authorText(metadata.value)
  style.value = reference?.style ?? 'plain'
  metadataOpen.value = false
  lookupError.value = ''
  lookupSuccess.value = false
}, { immediate: true })
const draft = computed(() => {
  const parsedAuthors = authors.value.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const comma = line.indexOf(',')
    return comma < 0 ? { literal: line } : { family: line.slice(0, comma).trim(), given: line.slice(comma + 1).trim() }
  })
  const clean: ReferenceMetadata = { ...metadata.value, ...(parsedAuthors.length ? { authors: parsedAuthors } : {}) }
  if (!parsedAuthors.length) delete (clean as { authors?: unknown }).authors
  const hasMetadata = Object.values(clean).some(value => typeof value === 'string' ? Boolean(value.trim()) : Array.isArray(value) && value.length > 0)
  return { text: text.value.trim(), ...(hasMetadata ? { metadata: clean } : {}), style: style.value }
})
const preview = computed(() => {
  if (!draft.value.text) return ''
  try { return formatReference({ id: 'preview', number: 1, ...draft.value }) } catch { return '信息不完整，请补充或选择原始文本。' }
})
async function lookup(): Promise<void> {
  if (!props.lookupDoi) return
  invalidateLookup()
  const token = lookupVersion
  const input = metadata.value.doi?.trim() || text.value.trim()
  const controller = new AbortController()
  lookupController = controller
  lookupPending.value = true; lookupError.value = ''
  try {
    const result = await props.lookupDoi(input, controller.signal)
    if (token !== lookupVersion || controller.signal.aborted) return
    metadata.value = { ...result }
    authors.value = authorText(result)
    lookupSuccess.value = true
    if (style.value === 'plain') style.value = 'gbt7714'
  } catch (error) {
    if (token === lookupVersion && !controller.signal.aborted) lookupError.value = error instanceof Error ? error.message : String(error)
  } finally { if (token === lookupVersion) lookupPending.value = false }
}
function submit(): void { emit('save', draft.value) }
onBeforeUnmount(invalidateLookup)
const fields = [
  ['title', '标题'], ['year', '年份'], ['journal', '期刊'], ['volume', '卷'], ['issue', '期'], ['pages', '页码或文章编号'], ['doi', 'DOI'], ['url', '网址'], ['publisher', '出版者'],
] as const
</script>
<template>
  <form
    data-testid="reference-form"
    @submit.prevent="submit"
  >
    <fieldset :disabled="busy">
      <label for="reference-input">网址、DOI 或文献信息</label>
      <textarea
        id="reference-input"
        v-model="text"
        rows="3"
        placeholder="https://… / 10.… / 作者、标题等"
      ></textarea>
      <div class="reference-panel__actions">
        <button
          type="button"
          data-testid="reference-doi-lookup"
          :disabled="!lookupDoi || lookupPending || !text.trim()"
          @click="lookup"
        >
          {{ lookupPending ? '正在查询…' : '通过 DOI 补全信息' }}
        </button>
        <button
          type="button"
          data-testid="reference-details"
          :aria-expanded="metadataOpen"
          @click="metadataOpen = true"
        >
          详细信息
        </button>
      </div>
      <small
        v-if="lookupSuccess"
        data-testid="reference-doi-success"
        role="status"
      >✓ DOI 信息已获取</small>
      <small v-if="!lookupDoi">当前宿主尚未接入 DOI 查询，可手工填写字段。</small>
      <p
        v-if="lookupError"
        role="alert"
      >
        {{ lookupError }}
      </p>
      <div
        v-if="metadataOpen"
        v-reference-dialog-focus
        class="reference-details-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="文献详细信息"
        @keydown.esc.stop="metadataOpen = false"
      >
        <div class="reference-fields reference-details">
          <header>
            <strong>文献详细信息</strong><button
              type="button"
              aria-label="关闭详细信息"
              @click="metadataOpen = false"
            >
              ×
            </button>
          </header>
          <label>类型<select v-model="metadata.type"><option value="article-journal">期刊文章</option><option value="book">图书</option><option value="webpage">网页</option></select></label>
          <label
            v-for="[field, label] in fields"
            :key="field"
          >{{ label }}<input
            v-model="metadata[field]"
            :data-reference-field="field"
            type="text"
          /></label>
          <label>作者（每行一位：姓, 名；或完整名称）<textarea
            v-model="authors"
            data-reference-field="authors"
            rows="3"
          ></textarea></label>
          <label>文末条目格式<select
            v-model="style"
            data-testid="reference-style"
          ><option value="plain">原始文本</option><option value="gbt7714">GB/T 7714—2025（顺序编码）</option><option value="apa">APA（条目）</option><option value="mla">MLA（条目）</option></select></label>
          <small>正文始终使用数字编号。格式化需要结构化字段。</small>
          <p
            v-if="preview"
            class="reference-preview"
            data-testid="reference-preview"
          >
            {{ preview }}
          </p>
          <button
            type="button"
            @click="metadataOpen = false"
          >
            完成
          </button>
        </div>
      </div>
      <div class="reference-panel__actions">
        <button
          type="submit"
          data-testid="reference-save"
          :disabled="busy || !text.trim()"
        >
          {{ submitLabel }}
        </button>
        <button
          v-if="allowApplyStyle"
          type="button"
          :disabled="busy"
          @click="emit('style', style)"
        >
          将此格式用于本文全部文献
        </button>
      </div>
    </fieldset>
  </form>
</template>
<style scoped>
fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
header, .reference-panel__form-title { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
label { display: block; margin-top: 10px; font-size: 13px; }
p, small { font-size: 13px; }
.reference-panel__hint, small { color: var(--app-text-secondary, #52655d); }
textarea, input, select { display: block; width: 100%; box-sizing: border-box; margin: 5px 0; padding: 7px; border: 1px solid #aab6af; border-radius: 4px; background: var(--app-surface, #fff); color: inherit; }
.reference-panel__actions { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0; }
.reference-preview { padding: 10px; background: var(--app-surface-muted, #eef3f0); overflow-wrap: anywhere; }
button { cursor: pointer; padding: 5px 8px; border: 1px solid #aab6af; border-radius: 4px; background: var(--app-surface, #fff); color: inherit; }
button:disabled { cursor: default; opacity: .55; }
.reference-details-overlay { position: fixed; inset: 0; z-index: 80; background: #0005; display: flex; align-items: flex-start; justify-content: center; padding-top: 12vh; }
.reference-details { width: min(520px, calc(100vw - 64px)); max-height: 70vh; overflow: auto; padding: 20px; background: var(--app-surface, #fff); border: 1px solid #9caaa2; border-radius: 10px; box-shadow: 0 8px 32px #0002; }
</style>
