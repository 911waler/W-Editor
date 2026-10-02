<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { JOURNAL_REFERENCE_STYLES, type DocumentReference, type ReferenceStyle } from '@w-editor/editor-core'
import { ensureReferenceStyles, formatReference, REFERENCE_STYLE_LABELS } from '@w-editor/editor-vue/services'
import { referenceDialogFocus as vReferenceDialogFocus } from './referenceDialogFocus'

const props = defineProps<{ entries: readonly DocumentReference[]; currentStyle: ReferenceStyle | null; busy: boolean; error?: string }>()
const emit = defineEmits<{ apply: [style: ReferenceStyle]; close: [] }>()
const search = ref('')
const selected = ref<ReferenceStyle>(props.currentStyle ?? 'plain')
const loading = ref(false)
const loadError = ref('')
let loadVersion = 0
const basics: readonly ReferenceStyle[] = ['plain', 'gbt7714', 'apa', 'mla']
const choices = [
  ...basics.map(id => ({ id, label: REFERENCE_STYLE_LABELS[id], aliases: [] as readonly string[], issns: [] as readonly string[] })),
  ...JOURNAL_REFERENCE_STYLES,
]
const normalize = (value: string) => value.toLocaleLowerCase().replace(/[\s-]+/g, '')
const results = computed(() => {
  const query = normalize(search.value.trim())
  return choices.filter(choice => [choice.label, ...choice.aliases, ...choice.issns].some(value => normalize(value).includes(query)))
})
async function preload(): Promise<void> {
  const version = ++loadVersion
  loading.value = true
  loadError.value = ''
  try { await ensureReferenceStyles([selected.value]) }
  catch (error) { if (version === loadVersion) loadError.value = error instanceof Error ? error.message : '格式加载失败，请重试。' }
  finally { if (version === loadVersion) loading.value = false }
}
watch(selected, preload, { immediate: true, flush: 'sync' })
onBeforeUnmount(() => { loadVersion++ })
const sample: DocumentReference = {
  id: 'style-example', number: 1, text: '示例文献',
  metadata: { title: 'A study of materials and their properties', authors: [{ family: 'Wang', given: 'Lin' }, { family: 'Smith', given: 'Alex' }], year: '2025', journal: 'Example Journal', volume: '12', pages: '45–52', type: 'article-journal' },
}
const preview = computed(() => {
  if (loading.value || loadError.value) return { entries: [], error: '' }
  try { return { entries: (props.entries.length ? props.entries.slice(0, 2) : [sample]).map(entry => ({ number: entry.number, text: formatReference({ ...entry, style: selected.value }) })), error: '' } }
  catch { return { entries: [], error: '当前文献信息无法生成预览，请补充信息或选择其他格式。' } }
})
const incompleteCount = computed(() => props.entries.filter(entry => {
  const metadata = entry.metadata
  return !metadata?.title?.trim() || !metadata.year?.trim() || !metadata.authors?.some(author => author.literal?.trim() || author.family?.trim() || author.given?.trim())
}).length)
const canApply = computed(() => !props.busy && !loading.value && !loadError.value && !preview.value.error)
function close(): void { if (!props.busy) emit('close') }
function apply(): void { if (canApply.value) emit('apply', selected.value) }
</script>

<template>
  <div
    v-reference-dialog-focus
    class="style-overlay"
    data-testid="reference-style-picker"
    role="dialog"
    aria-modal="true"
    aria-label="选择参考文献格式"
    @keydown.esc.stop.prevent="close"
  >
    <section class="style-dialog">
      <header>
        <h2>选择参考文献格式</h2>
        <button
          type="button"
          aria-label="关闭格式选择"
          :disabled="busy"
          @click="close"
        >
          ×
        </button>
      </header>
      <p class="hint">
        按目标期刊或通用格式排版文末参考文献。正文引文保留数字编号。
      </p>
      <label for="reference-style-search">搜索期刊或格式</label>
      <input
        id="reference-style-search"
        v-model="search"
        data-testid="reference-style-search"
        type="search"
        placeholder="期刊名称、别名或 ISSN"
        :disabled="busy"
      />
      <div
        class="style-options"
        role="group"
        aria-label="可用格式"
      >
        <button
          v-for="choice in results"
          :key="choice.id"
          type="button"
          class="style-option"
          :class="{ selected: selected === choice.id }"
          :data-testid="`reference-style-result-${choice.id}`"
          :aria-pressed="selected === choice.id"
          :disabled="busy"
          @click="selected = choice.id"
        >
          <span>{{ choice.label }}</span>
          <small v-if="choice.issns.length">ISSN {{ choice.issns.join(' / ') }}</small>
        </button>
        <p
          v-if="!results.length"
          class="hint"
          role="status"
        >
          没有匹配的格式，请尝试其他名称或通用格式。
        </p>
      </div>
      <h3>预览 · {{ REFERENCE_STYLE_LABELS[selected] }}</h3>
      <div
        class="style-preview"
        data-testid="reference-style-preview"
        aria-live="polite"
        :aria-busy="loading"
      >
        <p v-if="loading">
          正在加载格式…
        </p>
        <template v-else-if="!loadError && !preview.error">
          <small>{{ entries.length ? `使用本文前 ${Math.min(entries.length, 2)} 条文献预览` : '示例文献（本文尚无参考文献）' }}</small>
          <p
            v-for="entry in preview.entries"
            :key="entry.number"
          >
            [{{ entry.number }}] {{ entry.text }}
          </p>
        </template>
        <p
          v-if="loadError || preview.error"
          role="alert"
        >
          {{ loadError || preview.error }}
        </p>
        <button
          v-if="loadError"
          type="button"
          :disabled="busy"
          @click="preload"
        >
          重新加载
        </button>
      </div>
      <p
        v-if="incompleteCount && selected !== 'plain'"
        class="hint"
        role="status"
      >
        {{ incompleteCount }} 条文献缺少标题、作者或年份，格式化结果可能不完整。请在文献详细信息中补充。
      </p>
      <p
        v-if="error"
        role="alert"
      >
        {{ error }}
      </p>
      <footer>
        <button
          type="button"
          :disabled="busy"
          @click="close"
        >
          取消
        </button>
        <button
          type="button"
          class="apply"
          data-testid="reference-style-apply"
          :disabled="!canApply"
          @click="apply"
        >
          {{ busy ? '正在应用…' : '应用到全文' }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.style-overlay { position: fixed; inset: 0; z-index: 90; display: flex; align-items: flex-start; justify-content: center; padding: 7vh 20px; background: #0005; }
.style-dialog { box-sizing: border-box; width: min(600px, 100%); max-height: 86vh; overflow: auto; padding: 20px; border: 1px solid #9caaa2; border-radius: 10px; background: var(--app-surface, #fff); color: var(--app-text, inherit); box-shadow: 0 8px 32px #0002; }
header, footer { display: flex; align-items: center; gap: 12px; }
header { justify-content: space-between; }
footer { justify-content: flex-end; margin-top: 18px; }
h2 { margin: 0; font-size: 18px; }
h3 { margin: 18px 0 8px; font-size: 14px; }
p, label, input, button { font-size: 13px; }
p { line-height: 1.6; }
small, .hint { color: var(--app-text-secondary, #52655d); }
input { display: block; box-sizing: border-box; width: 100%; margin: 6px 0 10px; padding: 9px; border: 1px solid #aab6af; border-radius: 4px; background: var(--app-surface, #fff); color: inherit; }
button { cursor: pointer; padding: 7px 10px; border: 1px solid #aab6af; border-radius: 4px; background: var(--app-surface, #fff); color: inherit; }
button:disabled { cursor: default; opacity: .55; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--app-accent, #397960); outline-offset: 2px; }
.style-options { display: grid; gap: 5px; max-height: 220px; overflow: auto; padding: 3px; }
.style-option { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; text-align: left; }
.style-option.selected { border-color: var(--app-accent, #397960); background: var(--app-surface-muted, #eef3f0); box-shadow: inset 3px 0 var(--app-accent, #397960); }
.style-preview { padding: 12px; background: var(--app-surface-muted, #eef3f0); border-radius: 4px; overflow-wrap: anywhere; }
.style-preview p { margin: 8px 0 0; }
.apply { border-color: var(--app-accent, #397960); font-weight: 600; }
@media (max-width: 480px) { .style-overlay { padding: 3vh 12px; } .style-dialog { padding: 16px; max-height: 94vh; } }
</style>
