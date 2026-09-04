<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRaw } from 'vue'

import {
  normalizeUploadedAsset,
  validateAssetUrl,
  type UploadAdapter,
  type UploadedAsset,
  type AssetKind,
} from '../adapters'
import {
  translateUi,
  type UiLocale,
  type UiMessageKey,
  type UiMessageParams,
} from '../services/uiLocalization'

export interface AssetDraft {
  readonly kind: AssetKind
  readonly mediaType: string
  readonly name: string
  readonly size: number
  readonly url: string
}

const props = defineProps<{
  readonly initialName?: string
  readonly initialMediaType?: string
  readonly initialSize?: number
  readonly initialUrl?: string
  readonly kind: AssetKind
  readonly locale: UiLocale
  readonly uploadAdapter: UploadAdapter
}>()
const emit = defineEmits<{
  apply: [draft: AssetDraft]
  cancel: []
}>()

const name = ref(props.initialName ?? '')
const url = ref(props.initialUrl ?? '')
type MediaErrorCode =
  | 'nameInvalid'
  | 'nameRequired'
  | 'uploadCancelled'
  | 'uploadFailed'
  | 'urlCredentials'
  | 'urlRequired'
  | 'urlUnsupported'
interface MediaErrorState {
  readonly code: MediaErrorCode
  readonly detail?: string
}
const ERROR_KEYS: Readonly<Record<MediaErrorCode, UiMessageKey>> = Object.freeze({
  nameInvalid: 'media.nameInvalid',
  nameRequired: 'media.nameRequired',
  uploadCancelled: 'media.uploadCancelled',
  uploadFailed: 'media.uploadFailed',
  urlCredentials: 'media.urlCredentials',
  urlRequired: 'media.urlRequired',
  urlUnsupported: 'media.urlUnsupported',
})
const KIND_KEYS: Readonly<Record<AssetKind, UiMessageKey>> = Object.freeze({
  audio: 'media.kind.audio',
  file: 'media.kind.file',
  image: 'media.kind.image',
  pdf: 'media.kind.pdf',
  video: 'media.kind.video',
  word: 'media.kind.word',
})
const error = ref<MediaErrorState | null>(null)
const uploading = ref(false)
const uploaded = ref<UploadedAsset | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)
let controller: AbortController | null = null

const DEFAULT_MEDIA_TYPE: Readonly<Record<AssetKind, string>> = Object.freeze({
  audio: 'audio/*',
  file: 'application/octet-stream',
  image: 'image/*',
  pdf: 'application/pdf',
  video: 'video/*',
  word: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
})
const ACCEPT: Readonly<Record<AssetKind, string>> = Object.freeze({
  audio: 'audio/*',
  file: '*',
  image: 'image/*',
  pdf: '.pdf,application/pdf',
  video: 'video/*',
  word: '.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
})
function t(key: UiMessageKey, params?: UiMessageParams): string {
  return translateUi(props.locale, key, params)
}

const kindLabel = computed(() => t(KIND_KEYS[props.kind]))
const heading = computed(() => t('media.heading', { kind: kindLabel.value }))
const errorMessage = computed(() => {
  if (error.value === null) return null
  const localized = t(ERROR_KEYS[error.value.code])
  return error.value.detail === undefined ? localized : `${localized} ${error.value.detail}`
})
const accept = computed(() => ACCEPT[props.kind])

onMounted(async () => {
  await nextTick()
  nameInput.value?.focus()
})

onBeforeUnmount(() => controller?.abort())

function apply(): void {
  const assetUrl = validateAssetUrl(url.value, { allowInlineImage: props.kind === 'image' })
  const assetName = name.value.trim()
  if (assetName.length === 0) {
    error.value = Object.freeze({ code: 'nameRequired' })
    return
  }
  if (/[\]\r\n]/u.test(assetName)) {
    error.value = Object.freeze({ code: 'nameInvalid' })
    return
  }
  if (!assetUrl.valid) {
    error.value = Object.freeze({
      code: assetUrl.code === 'ASSET_URL_REQUIRED'
        ? 'urlRequired'
        : assetUrl.code === 'ASSET_URL_CREDENTIALS'
          ? 'urlCredentials'
          : 'urlUnsupported',
    })
    return
  }
  emit('apply', Object.freeze({
    kind: props.kind,
    mediaType: uploaded.value?.mediaType
      ?? (props.initialMediaType?.trim().length ? props.initialMediaType.trim() : DEFAULT_MEDIA_TYPE[props.kind]),
    name: assetName,
    size: uploaded.value?.size ?? props.initialSize ?? 0,
    url: assetUrl.url,
  }))
}

async function selectFile(event: Event): Promise<void> {
  const input = event.currentTarget
  if (!(input instanceof HTMLInputElement)) return
  const file = input.files?.[0]
  input.value = ''
  if (file === undefined) return
  controller?.abort()
  controller = new AbortController()
  uploading.value = true
  uploaded.value = null
  error.value = null
  try {
    const adapter = toRaw(props.uploadAdapter)
    const result = normalizeUploadedAsset(await adapter.upload({
      file,
      kind: props.kind,
      signal: controller.signal,
    }))
    name.value = result.name
    url.value = result.url
    uploaded.value = result
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === 'AbortError') {
      error.value = Object.freeze({ code: 'uploadCancelled' })
    } else {
      error.value = Object.freeze({
        code: 'uploadFailed',
        ...(reason instanceof Error && reason.message.length > 0 ? { detail: reason.message } : {}),
      })
    }
  } finally {
    uploading.value = false
    controller = null
  }
}

function cancel(): void {
  controller?.abort()
  emit('cancel')
}
</script>

<template>
  <div
    class="dialog-backdrop"
    @mousedown.self="cancel"
  >
    <section
      :aria-labelledby="`media-dialog-title-${kind}`"
      aria-modal="true"
      class="dialog-panel media-editor"
      :data-editor-command="`insert.${kind}`"
      role="dialog"
      @keydown.esc.prevent="cancel"
    >
      <p class="section-kicker">
        {{ t('media.kicker') }}
      </p>
      <h2 :id="`media-dialog-title-${kind}`">
        {{ heading }}
      </h2>

      <label :for="`media-name-${kind}`">{{ t('media.name') }}</label>
      <input
        :id="`media-name-${kind}`"
        ref="nameInput"
        v-model="name"
        autocomplete="off"
        type="text"
        @input="error = null"
      />

      <label :for="`media-url-${kind}`">{{ t('media.url') }}</label>
      <input
        :id="`media-url-${kind}`"
        v-model="url"
        autocomplete="url"
        placeholder="https://…"
        type="url"
        @input="error = null; uploaded = null"
      />

      <div class="media-editor__upload">
        <label :for="`media-file-${kind}`">{{ t('media.localFile', { kind: kindLabel }) }}</label>
        <input
          :id="`media-file-${kind}`"
          :accept="accept"
          :disabled="uploading"
          type="file"
          @change="selectFile"
        />
        <p
          v-if="uploading"
          aria-live="polite"
          role="status"
        >
          {{ t('media.uploading') }}
        </p>
        <p
          v-else-if="uploaded"
          class="media-editor__metadata"
          data-upload-result="ready"
        >
          {{ t('media.uploadReady', { mediaType: uploaded.mediaType, size: uploaded.size }) }}
        </p>
      </div>

      <p
        v-if="errorMessage"
        class="dialog-panel__error"
        role="alert"
      >
        {{ errorMessage }}
      </p>

      <div class="dialog-panel__actions">
        <button
          type="button"
          @click="cancel"
        >
          {{ t('common.cancel') }}
        </button>
        <button
          class="primary-action"
          :disabled="uploading"
          type="button"
          @click="apply"
        >
          {{ t('common.apply') }}
        </button>
      </div>
    </section>
  </div>
</template>
