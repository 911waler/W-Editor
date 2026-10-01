<script setup lang="ts">
import { referenceDialogFocus as vReferenceDialogFocus } from './referenceDialogFocus'
import { computed, ref, watch } from 'vue'
import { JOURNAL_REFERENCE_STYLES, referenceUrl, type DocumentReference, type ReferenceMetadata, type ReferenceStyle } from '@w-editor/editor-core'
import { REFERENCE_STYLE_LABELS, type ReferenceNote } from '@w-editor/editor-vue/services'
import ReferenceForm from './ReferenceForm.vue'
import ReferenceStylePicker from './ReferenceStylePicker.vue'
import { useReferenceFormatting } from './useReferenceFormatting'
const props = defineProps<{
  currentStyle?: ReferenceStyle | null
  entries: readonly DocumentReference[]; selected: string | null; error: string; busy: boolean
  counts: Readonly<Record<string, number>>; notes: Readonly<Record<string, ReferenceNote>>
  notesError: string; notesBusy: boolean; notesLoading: boolean; savedVersion: number
  lookupDoi?: ((doi: string, signal: AbortSignal) => Promise<ReferenceMetadata>) | undefined
}>()
const emit = defineEmits<{
  requestInsert: []; close: []; insert: [reference: Pick<DocumentReference, 'text' | 'metadata' | 'style'>]
  update: [original: DocumentReference, reference: Pick<DocumentReference, 'text' | 'metadata' | 'style'>]
  remove: [id: string]; jump: [id: string]; style: [style: ReferenceStyle]
  saveNote: [id: string, text: string]; reloadNotes: []
}>()
const { format: formatReference, error: formattingError } = useReferenceFormatting(() => props.entries)
const stylePickerOpen = ref(false)
const currentStyle = computed(() => props.currentStyle ?? (props.entries.length && props.entries.every(entry => (entry.style ?? 'plain') === (props.entries[0]?.style ?? 'plain')) ? props.entries[0]?.style ?? 'plain' : null))
watch(() => props.busy, (busy, wasBusy) => { if (wasBusy && !busy && !props.error) stylePickerOpen.value = false })
const editing = ref<DocumentReference | null>(null)
const deleteId = ref<string | null>(null)
const noteEditing = ref<Record<string, boolean>>({})
const noteDrafts = ref<Record<string, string>>({})
const pendingNotes = new Map<string, string>()
function edit(reference: DocumentReference): void { editing.value = reference }
function openNote(id: string): void { noteDrafts.value[id] = props.notes[id]?.text ?? ''; noteEditing.value[id] = true }
function saveNote(id: string, text: string): void { pendingNotes.set(id, text); emit('saveNote', id, text) }
watch(() => props.notes, notes => {
  for (const [id, text] of pendingNotes) {
    if ((notes[id]?.text ?? '') === text) { noteEditing.value[id] = false; pendingNotes.delete(id) }
  }
})
watch(() => props.notesBusy, busy => { if (!busy && !props.notesError) { for (const id of pendingNotes.keys()) noteEditing.value[id] = false; pendingNotes.clear() } })
watch(() => props.savedVersion, () => { editing.value = null })
watch(() => props.entries, entries => {
  if (!editing.value) return
  const current = entries.find(entry => entry.id === editing.value?.id)
  if (!current) { editing.value = null; return }
  // A document-wide format change updates the conflict-check baseline, not local field edits.
  if (current.text === editing.value.text && JSON.stringify(current.metadata) === JSON.stringify(editing.value.metadata) && current.style !== editing.value.style) editing.value = current
})
function reloadNotes(): void { noteDrafts.value = {}; noteEditing.value = {}; pendingNotes.clear(); emit('reloadNotes') }
</script>
<template>
  <aside
    class="reference-panel"
    aria-label="参考文献 / References"
    data-testid="reference-panel"
    @keydown.esc="emit('close')"
  >
    <header class="reference-panel__header">
      <div class="reference-panel__heading">
        <strong>参考文献</strong><span class="reference-panel__count">{{ entries.length }} 篇</span>
      </div><button
        type="button"
        aria-label="关闭 / Close"
        @click="emit('close')"
      >
        ×
      </button>
    </header>
    <button
      type="button"
      data-testid="reference-add"
      :disabled="busy"
      @click="emit('requestInsert')"
    >
      新增文献
    </button>
    <button
      class="reference-panel__style"
      type="button"
      data-testid="reference-style-open"
      :disabled="busy"
      @click="stylePickerOpen = true"
    >
      引用样式 · {{ currentStyle ? REFERENCE_STYLE_LABELS[currentStyle] : '混合格式' }} ▾
    </button>
    <ReferenceStylePicker
      v-if="stylePickerOpen"
      :entries="entries"
      :current-style="currentStyle"
      :busy="busy"
      :error="error"
      @close="stylePickerOpen = false"
      @apply="emit('style', $event)"
    />
    <p
      v-if="formattingError"
      role="alert"
    >
      {{ formattingError }}
    </p>
    <div
      v-if="editing"
      v-reference-dialog-focus
      class="reference-edit-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="修改文献"
      @keydown.esc.stop="editing = null"
    >
      <div class="reference-edit-dialog">
        <header>
          <strong>修改文献 [{{ editing.number }}]</strong><button
            type="button"
            aria-label="关闭修改文献"
            @click="editing = null"
          >
            ×
          </button>
        </header>
        <ReferenceForm
          :reference="editing"
          :busy="busy"
          :lookup-doi="lookupDoi"
          submit-label="保存文献修改"
          allow-apply-style
          @save="emit('update', editing!, $event)"
          @style="emit('style', $event)"
        />
        <p
          v-if="error"
          role="alert"
        >
          {{ error }}
        </p>
      </div>
    </div>
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
            class="reference-panel__number"
            :aria-label="`跳转到正文引用 ${entry.number}`"
            @click="emit('jump', entry.id)"
          >
            [{{ entry.number }}]
          </button><span class="reference-panel__citation">{{ formatReference(entry) }}</span>
        </div>
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
            class="reference-panel__delete"
            :data-reference-delete="entry.id"
            :disabled="busy"
            @click="deleteId = entry.id"
          >
            删除
          </button>
          <button
            v-if="!noteEditing[entry.id]"
            type="button"
            :data-reference-note-open="entry.id"
            :disabled="notesLoading"
            @click="openNote(entry.id)"
          >
            备注
          </button>
          <a
            v-if="referenceUrl(entry.metadata?.doi || entry.metadata?.url || entry.text)"
            class="reference-panel__source"
            :href="referenceUrl(entry.metadata?.doi || entry.metadata?.url || entry.text)!"
            aria-label="打开文献来源（新窗口）"
            target="_blank"
            rel="noopener noreferrer"
          >来源 ↗</a>
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
        <p
          v-if="notes[entry.id]?.text && !noteEditing[entry.id]"
          class="reference-note-text"
          :data-reference-note-text="entry.id"
        >
          {{ notes[entry.id]?.text }}
        </p>
        <div
          v-if="noteEditing[entry.id]"
          class="reference-panel__note-editor"
        >
          <label>备注（仅编辑者可见）<textarea
            v-model="noteDrafts[entry.id]"
            :data-reference-note="entry.id"
            :disabled="notesBusy || notesLoading"
            maxlength="10000"
            rows="3"
          ></textarea></label>
          <div class="reference-panel__actions">
            <button
              type="button"
              :data-reference-note-save="entry.id"
              :disabled="notesBusy || notesLoading || Boolean(notesError)"
              @click="saveNote(entry.id, noteDrafts[entry.id] ?? '')"
            >
              保存备注
            </button>
            <button
              type="button"
              :data-reference-note-cancel="entry.id"
              :disabled="notesBusy"
              @click="noteEditing[entry.id] = false"
            >
              取消
            </button>
            <button
              v-if="notes[entry.id]?.text"
              type="button"
              :data-reference-note-delete="entry.id"
              :disabled="notesBusy || notesLoading || Boolean(notesError)"
              @click="saveNote(entry.id, '')"
            >
              删除备注
            </button>
          </div>
        </div>
      </li>
    </ol>
    <p v-if="!entries.length">
      还没有参考文献。
    </p>
    <small class="reference-panel__credits">引用格式由 Citation Style Language 提供。<a
      href="https://citeproc-js.readthedocs.io/"
      target="_blank"
      rel="noopener noreferrer"
    >citeproc-js — Frank Bennett</a>。<a
      href="https://citationstyles.org/"
      target="_blank"
      rel="noopener noreferrer"
    >项目与样式来源</a></small>
    <nav
      class="reference-panel__guidelines"
      aria-label="期刊参考文献格式要求"
      data-testid="reference-journal-guidelines"
    >
      <strong>期刊参考文献格式要求</strong>
      <a
        v-for="journal in JOURNAL_REFERENCE_STYLES"
        :key="journal.id"
        :href="journal.guidelinesUrl"
        target="_blank"
        rel="noopener noreferrer"
      >{{ journal.label }}</a>
    </nav>
  </aside>
</template>
<style scoped>
.reference-panel {
  --reference-border: var(--app-border, #d5ddd8);
  --reference-muted: var(--app-text-secondary, #53635b);
  --reference-panel-padding: 18px;
  position: fixed; inset: 90px 16px 24px auto; z-index: 50;
  width: min(420px, calc(100vw - 32px)); box-sizing: border-box;
  overflow: auto; padding: var(--reference-panel-padding);
  background: var(--app-surface, #fff); color: var(--app-text, #24352c);
  border: 1px solid var(--reference-border); border-radius: 8px;
  font-size: 14px; line-height: 1.5;
}
header { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
.reference-panel__header {
  position: sticky; top: calc(-1 * var(--reference-panel-padding)); z-index: 1;
  margin: calc(-1 * var(--reference-panel-padding)) calc(-1 * var(--reference-panel-padding)) 0;
  padding: var(--reference-panel-padding) var(--reference-panel-padding) 12px;
  background: var(--app-surface, #fff); border-bottom: 1px solid var(--reference-border);
}
.reference-panel__heading { display: flex; align-items: baseline; gap: 10px; }
.reference-panel__heading strong { font-size: 16px; }
.reference-panel__count { color: var(--reference-muted); font-size: 12px; white-space: nowrap; }
[data-testid="reference-add"] { margin-top: 16px; }
.reference-panel__style { display: block; margin-top: 12px; width: 100%; text-align: left; font-size: 13px; }
label { display: block; margin-top: 10px; font-size: 13px; }
p { font-size: 13px; }
textarea { display: block; width: 100%; box-sizing: border-box; margin: 6px 0; padding: 8px; border: 1px solid var(--reference-border); border-radius: 4px; background: var(--app-surface, #fff); color: inherit; font: inherit; resize: vertical; }
ol { list-style: none; padding: 0; margin: 14px 0 20px; }
li { padding: 16px 0; border-bottom: 1px solid var(--reference-border); overflow-wrap: anywhere; }
li.selected { background: var(--app-surface-muted, #eef3f0); outline: 1px solid var(--reference-border); border-radius: 4px; }
.reference-panel__entry-title { display: flex; align-items: flex-start; gap: 10px; }
.reference-panel__number { flex: 0 0 auto; min-width: 34px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.reference-panel__citation { flex: 1; min-width: 0; line-height: 1.6; overflow-wrap: anywhere; }
.reference-panel__actions { display: flex; align-items: center; gap: 2px 6px; flex-wrap: wrap; margin: 9px 0 0; padding-left: 44px; }
.reference-panel__actions > button, .reference-panel__source { border: 0; padding: 5px 4px; background: transparent; font-size: 13px; line-height: 20px; }
.reference-panel__source { color: var(--reference-muted); text-decoration: none; white-space: nowrap; }
.reference-panel__source:hover { text-decoration: underline; }
.reference-panel__actions > .reference-panel__delete { color: var(--app-text-secondary, #72504b); }
.reference-delete-confirm { margin-top: 12px; padding: 10px; border: 1px solid var(--reference-border); border-radius: 4px; }
button { cursor: pointer; padding: 5px 8px; border: 1px solid var(--reference-border); border-radius: 4px; background: var(--app-surface, #fff); color: inherit; font: inherit; line-height: 20px; }
button:hover:not(:disabled), .reference-panel__source:hover { background: var(--app-surface-muted, #eef3f0); }
button:focus-visible, a:focus-visible, textarea:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
button:disabled { cursor: default; opacity: .55; }
.reference-note-text { margin: 8px 0 0 44px; color: var(--reference-muted); white-space: pre-wrap; font-size: 12px; line-height: 1.6; }
.reference-panel__note-editor { margin: 12px 0 0 44px; }
.reference-panel__note-editor .reference-panel__actions { padding-left: 0; }
.reference-panel__credits { display: block; color: var(--reference-muted); font-size: 11px; line-height: 1.6; }
.reference-panel__credits a { color: inherit; }
.reference-panel__guidelines { display: grid; gap: 5px; margin-top: 14px; color: var(--reference-muted); font-size: 11px; line-height: 1.6; }
.reference-panel__guidelines strong { font-size: 12px; font-weight: 600; }
.reference-panel__guidelines a { width: fit-content; max-width: 100%; color: inherit; overflow-wrap: anywhere; text-underline-offset: 2px; }
.reference-edit-overlay { position: fixed; inset: 0; z-index: 70; background: #0005; display: flex; align-items: flex-start; justify-content: center; padding-top: 16vh; }
.reference-edit-dialog { width: min(480px, calc(100vw - 64px)); max-height: 70vh; overflow: auto; padding: 20px; background: var(--app-surface, #fff); border: 1px solid var(--reference-border); border-radius: 8px; }
@media (pointer: coarse) {
  button, .reference-panel__actions > button, .reference-panel__source { min-height: 44px; }
}
@media (max-width: 480px) {
  .reference-panel { --reference-panel-padding: 14px; inset: 72px 8px 8px; width: auto; }
}
</style>
