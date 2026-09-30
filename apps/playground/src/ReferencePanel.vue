<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { referenceUrl, type DocumentReference, type ReferenceMetadata, type ReferenceStyle } from '@w-editor/editor-core'
import { formatReference, type ReferenceNote } from '@w-editor/editor-vue/services'

const props = defineProps<{
  entries: readonly DocumentReference[]; selected: string | null; error: string; busy: boolean
  counts: Readonly<Record<string, number>>; notes: Readonly<Record<string, ReferenceNote>>
  notesError: string; notesBusy: boolean; notesLoading: boolean; savedVersion: number
  lookupDoi?: ((doi: string, signal: AbortSignal) => Promise<ReferenceMetadata>) | undefined
}>()
const emit = defineEmits<{
  close: []; insert: [reference: Pick<DocumentReference, 'text' | 'metadata' | 'style'>]
  update: [original: DocumentReference, reference: Pick<DocumentReference, 'text' | 'metadata' | 'style'>]
  remove: [id: string]; jump: [id: string]; style: [style: ReferenceStyle]
  saveNote: [id: string, text: string]; reloadNotes: []
}>()
const editing = ref<DocumentReference | null>(null)
const text = ref('')
const style = ref<ReferenceStyle>('plain')
const metadata = ref<{ -readonly [K in keyof ReferenceMetadata]: ReferenceMetadata[K] }>({})
const authors = ref('')
const metadataOpen = ref(false)
const deleteId = ref<string | null>(null)
const noteDrafts = ref<Record<string, string>>({})
const lookupPending = ref(false)
const lookupError = ref('')
let lookupVersion = 0
let lookupController: AbortController | null = null
function invalidateLookup(): void { lookupVersion++; lookupController?.abort(); lookupController = null; lookupPending.value = false }
watch(text, invalidateLookup, { flush: 'sync' })
watch(metadata, invalidateLookup, { deep: true, flush: 'sync' })
watch(authors, invalidateLookup, { flush: 'sync' })
watch(() => props.notes, (notes, previous) => {
  for (const [id, note] of Object.entries(notes)) if (!(id in noteDrafts.value) || noteDrafts.value[id] === previous?.[id]?.text) noteDrafts.value[id] = note.text
}, { immediate: true })
function authorText(value: ReferenceMetadata): string {
  return (value.authors ?? []).map(author => author.literal ?? [author.family, author.given].filter(Boolean).join(', ')).join('\n')
}
function edit(reference: DocumentReference): void {
  invalidateLookup()
  editing.value = reference
  text.value = reference.text
  metadata.value = { ...reference.metadata }
  authors.value = authorText(metadata.value)
  style.value = reference.style ?? 'plain'
  metadataOpen.value = Boolean(reference.metadata)
  lookupError.value = ''
}
watch(() => props.selected, id => { const entry = props.entries.find(item => item.id === id); if (entry) edit(entry) }, { immediate: true })
watch(() => props.entries, entries => {
  if (!editing.value) return
  const current = entries.find(item => item.id === editing.value!.id)
  if (!current) { reset(); return }
  if (current.text === editing.value.text && JSON.stringify(current.metadata) === JSON.stringify(editing.value.metadata) && current.style !== editing.value.style) {
    editing.value = current
    style.value = current.style ?? 'plain'
  }
})
watch(() => props.savedVersion, () => {
  const current = props.entries.find(item => item.id === editing.value?.id)
  if (current) edit(current)
})
function reset(): void {
  invalidateLookup(); editing.value = null; text.value = ''; metadata.value = {}; authors.value = ''; lookupError.value = ''; metadataOpen.value = false
}
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
    metadataOpen.value = true
    if (style.value === 'plain') style.value = 'gbt7714'
  } catch (error) {
    if (token === lookupVersion && !controller.signal.aborted) lookupError.value = error instanceof Error ? error.message : String(error)
  } finally { if (token === lookupVersion) lookupPending.value = false }
}
function submit(): void {
  if (editing.value) emit('update', editing.value, draft.value)
  else emit('insert', draft.value)
}
function reloadNotes(): void { noteDrafts.value = {}; emit('reloadNotes') }
onBeforeUnmount(invalidateLookup)
const fields = [
  ['title', '标题'], ['year', '年份'], ['journal', '期刊'], ['volume', '卷'], ['issue', '期'], ['pages', '页码或文章编号'], ['doi', 'DOI'], ['url', '网址'], ['publisher', '出版者'],
] as const
</script>
<template>
  <aside
    class="reference-panel"
    aria-label="参考文献 / References"
    data-testid="reference-panel"
    @keydown.esc="emit('close')"
  >
    <header>
      <strong>参考文献</strong><button
        type="button"
        aria-label="关闭 / Close"
        @click="emit('close')"
      >
        ×
      </button>
    </header>
    <p class="reference-panel__hint">
      编辑时保留编号；发布时按正文首次出现顺序重排。
    </p>
    <form
      data-testid="reference-form"
      @submit.prevent="submit"
    >
      <fieldset :disabled="busy">
        <div class="reference-panel__form-title">
          <strong>{{ editing ? `修改文献 [${editing.number}]` : '新增文献' }}</strong><button
            v-if="editing"
            type="button"
            @click="reset"
          >
            新增另一条
          </button>
        </div>
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
            :aria-expanded="metadataOpen"
            @click="metadataOpen = !metadataOpen"
          >
            手工编辑字段
          </button>
        </div>
        <small v-if="!lookupDoi">当前宿主尚未接入 DOI 查询，可手工填写字段。</small>
        <p
          v-if="lookupError"
          role="alert"
        >
          {{ lookupError }}
        </p>
        <div
          v-if="metadataOpen"
          class="reference-fields"
        >
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
        </div>
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
        <div class="reference-panel__actions">
          <button
            type="submit"
            data-testid="reference-save"
            :disabled="busy || !text.trim()"
          >
            {{ editing ? '保存文献修改' : '在光标处引用' }}
          </button>
          <button
            v-if="entries.length"
            type="button"
            :disabled="busy"
            @click="emit('style', style)"
          >
            将此格式用于本文全部文献
          </button>
        </div>
      </fieldset>
    </form>
    <p
      v-if="error"
      role="alert"
    >
      {{ error }}
    </p>
    <p
      v-if="notesError"
      role="alert"
    >
      {{ notesError }} <button
        type="button"
        @click="reloadNotes"
      >
        重新载入备注（丢弃未保存备注）
      </button>
    </p>
    <ol>
      <li
        v-for="entry in entries"
        :key="entry.id"
        :class="{ selected: entry.id === selected || entry.id === editing?.id }"
        :data-reference-entry="entry.id"
      >
        <div class="reference-panel__entry-title">
          <button
            type="button"
            @click="emit('jump', entry.id)"
          >
            [{{ entry.number }}]
          </button><span>{{ formatReference(entry) }}</span>
        </div>
        <a
          v-if="referenceUrl(entry.metadata?.doi || entry.metadata?.url || entry.text)"
          :href="referenceUrl(entry.metadata?.doi || entry.metadata?.url || entry.text)!"
          target="_blank"
          rel="noopener noreferrer"
        >打开来源</a>
        <div class="reference-panel__actions">
          <button
            type="button"
            :disabled="busy"
            @click="emit('insert', entry)"
          >
            再次引用
          </button>
          <button
            type="button"
            :data-reference-edit="entry.id"
            :disabled="busy"
            @click="edit(entry)"
          >
            修改
          </button>
          <button
            type="button"
            :data-reference-delete="entry.id"
            :disabled="busy"
            @click="deleteId = entry.id"
          >
            删除
          </button>
        </div>
        <div
          v-if="deleteId === entry.id"
          class="reference-delete-confirm"
          role="alert"
        >
          <p>将移除此文献在正文中的全部 {{ counts[entry.id] ?? 0 }} 处标号；其他文献不重编号。</p>
          <button
            type="button"
            data-testid="reference-delete-confirm"
            :disabled="busy"
            @click="emit('remove', entry.id); deleteId = null"
          >
            确认删除
          </button>
          <button
            type="button"
            @click="deleteId = null"
          >
            取消
          </button>
        </div>
        <label>备注（仅编辑者可见）<textarea
          v-model="noteDrafts[entry.id]"
          :data-reference-note="entry.id"
          :disabled="notesLoading"
          maxlength="10000"
          rows="2"
          placeholder="为什么引用？相关结论或待核对事项…"
        ></textarea></label>
        <button
          type="button"
          :data-reference-note-save="entry.id"
          :disabled="notesBusy || notesLoading || Boolean(notesError)"
          @click="emit('saveNote', entry.id, noteDrafts[entry.id] ?? '')"
        >
          保存备注
        </button>
        <small v-if="notes[entry.id] && noteDrafts[entry.id] === notes[entry.id]?.text">已保存</small>
      </li>
    </ol>
    <p v-if="!entries.length">
      还没有参考文献。
    </p>
    <small>引用格式由 Citation Style Language 提供。<a
      href="https://citeproc-js.readthedocs.io/"
      target="_blank"
      rel="noopener noreferrer"
    >citeproc-js — Frank Bennett</a>。<a
      href="https://citationstyles.org/"
      target="_blank"
      rel="noopener noreferrer"
    >项目与样式来源</a></small>
  </aside>
</template>
<style scoped>
.reference-panel { position: fixed; inset: 90px 16px 24px auto; z-index: 50; width: min(420px, calc(100vw - 32px)); overflow: auto; padding: 20px; background: var(--app-surface, #fff); color: var(--app-text, #24352c); border: 1px solid #9caaa2; border-radius: 10px; box-shadow: 0 8px 32px #0002; }
fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
header, .reference-panel__form-title { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
label { display: block; margin-top: 10px; font-size: 13px; }
p, small { font-size: 13px; }
.reference-panel__hint, small { color: var(--app-text-secondary, #52655d); }
textarea, input, select { display: block; width: 100%; box-sizing: border-box; margin: 5px 0; padding: 7px; border: 1px solid #aab6af; border-radius: 4px; background: var(--app-surface, #fff); color: inherit; }
.reference-panel__actions { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0; }
ol { list-style: none; padding: 0; }
li { padding: 14px 8px; border-bottom: 1px solid #ccc; overflow-wrap: anywhere; }
li.selected { border-left: 3px solid #38705b; }
.reference-panel__entry-title { display: flex; align-items: start; gap: 6px; }
.reference-preview { padding: 10px; background: var(--app-surface-muted, #eef3f0); overflow-wrap: anywhere; }
.reference-delete-confirm { padding: 8px; border: 1px solid #bd7364; }
button { cursor: pointer; padding: 5px 8px; border: 1px solid #aab6af; border-radius: 4px; background: var(--app-surface, #fff); color: inherit; }
button:disabled { cursor: default; opacity: .55; }
</style>
