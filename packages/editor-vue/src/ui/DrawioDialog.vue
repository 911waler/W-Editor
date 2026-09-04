<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRaw } from 'vue'

import type { DrawioAdapterPort, DrawioSavePayload, DrawioSession } from '../adapters'
import { translateUi, type UiLocale, type UiMessageKey } from '../services/uiLocalization'

const props = defineProps<{
  readonly adapter: DrawioAdapterPort
  readonly initialXml: string
  readonly locale: UiLocale
  readonly requestId: string
}>()

const DRAWIO_HANDSHAKE_TIMEOUT_MS = 10_000

const emit = defineEmits<{
  apply: [payload: DrawioSavePayload]
  cancel: []
}>()

const frame = ref<HTMLIFrameElement | null>(null)
type DrawioStatus = 'connecting' | 'loading' | 'ready' | 'saving' | 'unavailable'
const STATUS_KEYS: Readonly<Record<DrawioStatus, UiMessageKey>> = Object.freeze({
  connecting: 'drawio.status.connecting',
  loading: 'drawio.status.loading',
  ready: 'drawio.status.ready',
  saving: 'drawio.status.saving',
  unavailable: 'drawio.status.unavailable',
})
const status = ref<DrawioStatus>('loading')
const statusMessage = computed(() => translateUi(props.locale, STATUS_KEYS[status.value]))
let session: DrawioSession | null = null
let completed = false
let handshakeTimer: ReturnType<typeof setTimeout> | null = null

function t(key: UiMessageKey): string {
  return translateUi(props.locale, key)
}

function cancel(): void {
  if (completed) return
  completed = true
  if (handshakeTimer !== null) clearTimeout(handshakeTimer)
  if (session?.cancel() !== true) emit('cancel')
}

function markUnavailable(): void {
  if (completed || status.value === 'ready' || status.value === 'saving') return
  if (handshakeTimer !== null) {
    clearTimeout(handshakeTimer)
    handshakeTimer = null
  }
  status.value = 'unavailable'
}

function notifyLoaded(): void {
  if (status.value === 'unavailable') return
  status.value = 'connecting'
  session?.notifyLoaded()
}

function notifyLoadError(): void {
  markUnavailable()
}

function apply(): void {
  if (completed || status.value !== 'ready') return
  if (session?.requestSave() === true) status.value = 'saving'
}

onMounted(async () => {
  await nextTick()
  const iframeWindow = frame.value?.contentWindow
  if (iframeWindow === null || iframeWindow === undefined) {
    markUnavailable()
    return
  }
  try {
    session = toRaw(props.adapter).begin({
      handlers: {
        onCancel: () => {
          completed = true
          emit('cancel')
        },
        onReady: () => {
          if (status.value !== 'unavailable') status.value = 'ready'
        },
        onSave: (payload) => {
          if (status.value === 'unavailable') return
          completed = true
          emit('apply', payload)
        },
      },
      iframeWindow,
      initialXml: props.initialXml,
      requestId: props.requestId,
    })
    handshakeTimer = setTimeout(markUnavailable, DRAWIO_HANDSHAKE_TIMEOUT_MS)
  } catch {
    markUnavailable()
  }
})

onBeforeUnmount(() => {
  if (handshakeTimer !== null) clearTimeout(handshakeTimer)
  if (!completed) session?.cancel()
  session = null
})
</script>

<template>
  <div
    :aria-label="t('drawio.dialogLabel')"
    aria-modal="true"
    class="drawio-dialog"
    data-editor-command="insert.drawio"
    role="dialog"
  >
    <header>
      <div>
        <p>{{ t('drawio.kicker') }}</p>
        <h2>{{ t('drawio.title') }}</h2>
      </div>
      <div class="drawio-dialog__actions">
        <button
          :aria-label="t('drawio.cancelLabel')"
          type="button"
          @click="cancel"
        >
          {{ t('common.close') }}
        </button>
        <button
          class="drawio-dialog__apply"
          data-testid="drawio-apply"
          :disabled="status !== 'ready'"
          type="button"
          @click="apply"
        >
          {{ t('common.apply') }}
        </button>
      </div>
    </header>
    <p
      class="visually-hidden"
      role="status"
    >
      {{ statusMessage }}
    </p>
    <p
      v-if="status === 'unavailable'"
      class="drawio-dialog__error"
      data-testid="drawio-resource-error"
      role="alert"
    >
      {{ statusMessage }}
    </p>
    <iframe
      ref="frame"
      :src="adapter.editorUrl"
      data-testid="drawio-bridge-frame"
      referrerpolicy="no-referrer"
      sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-downloads"
      :title="t('drawio.iframeTitle')"
      @load="notifyLoaded"
      @error="notifyLoadError"
    ></iframe>
  </div>
</template>

<style scoped>
.drawio-dialog {
  position: fixed;
  z-index: 60;
  inset: 3vh 3vw;
  display: grid;
  grid-template-rows: auto 1fr;
  overflow: hidden;
  border: 1px solid #cbd5e1;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 24px 80px rgb(15 23 42 / 28%);
}

.drawio-dialog header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  border-bottom: 1px solid #e2e8f0;
}

.drawio-dialog h2,
.drawio-dialog p { margin: 0; }
.drawio-dialog p { color: #64748b; font-size: 12px; }
.drawio-dialog__actions { display: flex; align-items: center; gap: 8px; }
.drawio-dialog__actions button { min-height: 34px; padding: 6px 12px; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; cursor: pointer; }
.drawio-dialog__actions button:disabled { cursor: not-allowed; opacity: .55; }
.drawio-dialog__actions .drawio-dialog__apply { border-color: #176b4d; background: #176b4d; color: #fff; }
.drawio-dialog__error { margin: 0; padding: 10px 16px; border-bottom: 1px solid #fecaca; background: #fef2f2; color: #991b1b; }
.drawio-dialog iframe { width: 100%; height: 100%; border: 0; }
</style>
