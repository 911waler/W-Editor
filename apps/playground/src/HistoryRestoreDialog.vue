<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import type { DocumentHistoryServices, DocumentHistoryVersion, DocumentHistorySnapshot } from '@w-editor/editor-vue/services'
import { referenceDialogFocus as vReferenceDialogFocus } from './referenceDialogFocus'
const props = defineProps<{ documentId: string; services: DocumentHistoryServices; recovery: DocumentHistorySnapshot | null; busy: boolean; error: string }>()
const emit = defineEmits<{ close: []; restore: [version: DocumentHistorySnapshot] }>()
const versions = shallowRef<readonly DocumentHistoryVersion[]>([])
const selected = shallowRef<DocumentHistorySnapshot | null>(null)
const selectedId = ref<string | null>(null)
const cursor = ref<string | null>(null)
const loading = ref(false)
const selecting = ref(false)
const loadError = ref('')
const listController = new AbortController()
let selectionController: AbortController | null = null
let generation = 0
function timestamp(value: string | null): string {
  if (!value || Number.isNaN(Date.parse(value))) return '保存时间未知'
  return new Date(value).toLocaleString()
}
function kindLabel(kind: string): string {
  return ({ baseline: '起始版本', 'manual-save': '手动保存', publish: '发布', recovery: '未成功保存的恢复草稿' } as Record<string, string>)[kind] ?? '保存版本'
}
async function load(): Promise<void> {
  if (loading.value) return
  loading.value = true; loadError.value = ''
  try {
    const page = await props.services.list(props.documentId, cursor.value ?? undefined, listController.signal)
    if (listController.signal.aborted) return
    versions.value = [...new Map([...versions.value, ...page.versions].map(version => [version.id, version])).values()]
    cursor.value = page.nextCursor
  } catch (failure) { if (!listController.signal.aborted) loadError.value = failure instanceof Error ? failure.message : String(failure) }
  finally { loading.value = false }
}
async function select(version: DocumentHistoryVersion): Promise<void> {
  selectionController?.abort()
  const token = ++generation
  const controller = new AbortController()
  selectionController = controller
  selected.value = null; selectedId.value = version.id; selecting.value = true; loadError.value = ''
  try {
    const value = await props.services.get(props.documentId, version.id, controller.signal)
    if (token === generation && !controller.signal.aborted) selected.value = value
  } catch (failure) { if (token === generation && !controller.signal.aborted) loadError.value = failure instanceof Error ? failure.message : String(failure) }
  finally { if (token === generation) selecting.value = false }
}
function selectRecovery(): void {
  selectionController?.abort(); generation++; selecting.value = false
  selectedId.value = 'local-recovery'; selected.value = props.recovery
}
function keydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && !props.busy) { event.stopPropagation(); emit('close') }
}
onMounted(() => { void load() })
onBeforeUnmount(() => { listController.abort(); selectionController?.abort(); generation++ })
</script>
<template>
  <div
    class="history-backdrop"
    @keydown="keydown"
  >
    <section
      v-reference-dialog-focus
      class="history-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-title"
      tabindex="-1"
      data-testid="history-restore-dialog"
    >
      <header>
        <h2 id="history-title">
          选择历史版本
        </h2><button
          type="button"
          :disabled="busy"
          aria-label="关闭历史版本"
          @click="emit('close')"
        >
          ×
        </button>
      </header>
      <p>选择版本后恢复为新副本，原文保留。笔记历史从启用版本记录后开始。</p>
      <div class="history-columns">
        <nav aria-label="历史版本">
          <button
            v-if="recovery"
            type="button"
            data-testid="history-recovery"
            :disabled="busy"
            :aria-pressed="selectedId === 'local-recovery'"
            @click="selectRecovery"
          >
            <strong>未成功保存的恢复草稿（仅本人）</strong><small>{{ timestamp(recovery.savedAt) }}</small>
          </button>
          <button
            v-for="version in versions"
            :key="version.id"
            type="button"
            :data-history-version="version.id"
            :disabled="busy"
            :aria-pressed="selectedId === version.id"
            @click="select(version)"
          >
            <strong>{{ version.title || '未命名' }}</strong><span>{{ kindLabel(version.kind) }} · #{{ version.id }}</span><small>{{ timestamp(version.savedAt) }}</small>
          </button>
          <p
            v-if="loading"
            role="status"
          >
            正在加载版本…
          </p>
          <p v-else-if="!versions.length">
            暂无已保存的历史版本。
          </p>
          <button
            v-if="cursor"
            type="button"
            :disabled="loading || busy"
            @click="load"
          >
            加载更多
          </button>
          <button
            v-if="loadError"
            type="button"
            :disabled="loading || busy"
            @click="load"
          >
            重新加载列表
          </button>
        </nav>
        <div class="history-preview">
          <p
            v-if="selecting"
            role="status"
          >
            正在加载正文…
          </p>
          <template v-else-if="selected">
            <strong>正文预览（Markdown）</strong><pre data-testid="history-preview">{{ selected.markdown }}</pre>
          </template>
          <p v-else>
            请选择左侧版本。
          </p>
        </div>
      </div>
      <p
        v-if="loadError || props.error"
        role="alert"
      >
        {{ loadError || props.error }}
      </p>
      <footer>
        <button
          type="button"
          :disabled="busy"
          @click="emit('close')"
        >
          取消
        </button><button
          type="button"
          data-testid="history-restore-confirm"
          :disabled="!selected || selecting || busy"
          @click="selected && emit('restore', selected)"
        >
          {{ busy ? '正在恢复…' : '恢复为副本' }}
        </button>
      </footer>
    </section>
  </div>
</template>
<style scoped>
.history-backdrop { position: fixed; inset: 0; z-index: 180; background: #0006; display: grid; place-items: center; padding: 20px; }
.history-dialog { width: min(860px, 100%); max-height: 88vh; overflow: auto; background: var(--app-surface, #fff); color: var(--app-text, #24352c); border-radius: 10px; padding: 20px; }
header, footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; } h2 { margin: 0; font-size: 18px; }
.history-columns { display: grid; grid-template-columns: minmax(200px, 1fr) minmax(0, 2fr); gap: 16px; min-height: 200px; }
nav { max-height: 48vh; overflow: auto; } nav button { width: 100%; text-align: left; display: grid; gap: 4px; margin-bottom: 6px; }
button { padding: 8px 12px; cursor: pointer; border: 1px solid #9caea4; border-radius: 5px; color: inherit; background: inherit; } button:disabled { opacity: .5; cursor: default; } button[aria-pressed="true"] { border-color: #287557; background: #28755716; }
small { color: var(--app-text-secondary, #66756e); } pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 44vh; overflow: auto; font-size: 13px; } footer { justify-content: flex-end; margin-top: 15px; }
@media (max-width: 600px) { .history-columns { grid-template-columns: 1fr; } nav { max-height: 22vh; } }
</style>
