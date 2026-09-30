<script setup lang="ts">
import { referenceDialogFocus as vReferenceDialogFocus } from './referenceDialogFocus'
import { ref, watch } from 'vue'
import { referenceUrl, type DocumentReference, type ReferenceMetadata, type ReferenceStyle } from '@w-editor/editor-core'
import { formatReference, type ReferenceNote } from '@w-editor/editor-vue/services'
import ReferenceForm from './ReferenceForm.vue'
const props = defineProps<{
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
    <button
      type="button"
      data-testid="reference-add"
      :disabled="busy"
      @click="emit('requestInsert')"
    >
      新增文献
    </button>
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
        <p
          v-if="notes[entry.id]?.text && !noteEditing[entry.id]"
          class="reference-note-text"
          :data-reference-note-text="entry.id"
        >
          {{ notes[entry.id]?.text }}
        </p>
        <button
          v-if="!noteEditing[entry.id]"
          type="button"
          :data-reference-note-open="entry.id"
          :disabled="notesLoading"
          @click="openNote(entry.id)"
        >
          备注
        </button>
        <div v-else>
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
.reference-note-text { color: var(--app-text-secondary, #68776f); white-space: pre-wrap; }
.reference-edit-overlay { position: fixed; inset: 0; z-index: 70; background: #0005; display: flex; align-items: flex-start; justify-content: center; padding-top: 16vh; }
.reference-edit-dialog { width: min(480px, calc(100vw - 64px)); max-height: 70vh; overflow: auto; padding: 20px; background: var(--app-surface, #fff); border: 1px solid #9caaa2; border-radius: 10px; box-shadow: 0 8px 32px #0002; }
</style>
