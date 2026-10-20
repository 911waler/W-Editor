<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRaw } from 'vue'
import type { ImageLayoutSettings } from '@w-editor/editor-core'

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
  readonly imageLayout?: ImageLayoutSettings
}

const props = defineProps<{
  readonly initialName?: string
  readonly initialMediaType?: string
  readonly initialSize?: number
  readonly initialUrl?: string
  readonly initialWidth?: number | null
  readonly initialHeight?: number | null
  readonly initialAlignment?: 'left' | 'center' | 'right' | null
  readonly imageAlignmentAvailable?: boolean
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
const imageWidth = ref(props.initialWidth?.toString() ?? '')
const imageHeight = ref(props.initialHeight?.toString() ?? '')
const imageAlignment = ref(props.initialAlignment === undefined ? 'left' : props.initialAlignment)
const aspectLocked = ref(true)
const aspectRatio = ref(ratioOf(imageWidth.value, imageHeight.value))
const naturalSize = ref<{ readonly width: number; readonly height: number } | null>(null)
const imagePreviewFailed = ref(false)
let dimensionMode: 'unchanged' | 'custom' | 'original' = 'unchanged'
const ALIGNMENTS = ['left', 'center', 'right'] as const
const ALIGNMENT_KEYS: Readonly<Record<typeof ALIGNMENTS[number], UiMessageKey>> = Object.freeze({
  left: 'media.image.alignLeft',
  center: 'media.image.alignCenter',
  right: 'media.image.alignRight',
})
type MediaErrorCode =
  | 'imageSizeInvalid'
  | 'imageSourceInvalid'
  | 'imageSourceRequired'
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
  imageSizeInvalid: 'media.image.sizeInvalid',
  imageSourceInvalid: 'media.image.sourceInvalid',
  imageSourceRequired: 'media.image.sourceRequired',
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
const imagePreviewUrl = computed(() => {
  if (props.kind !== 'image') return null
  const source = validateAssetUrl(url.value, { allowInlineImage: true })
  return source.valid ? source.url : null
})
const imageFileLabel = computed(() => t(url.value.length > 0 ? 'media.image.replace' : 'media.image.select'))

onMounted(async () => {
  await nextTick()
  nameInput.value?.focus()
})

onBeforeUnmount(() => controller?.abort())

function positiveNumber(value: string): number | null {
  const number = Number(value)
  return value.trim().length > 0 && Number.isFinite(number) && number > 0 ? number : null
}

function ratioOf(width: string, height: string): number | null {
  const parsedWidth = positiveNumber(width)
  const parsedHeight = positiveNumber(height)
  return parsedWidth !== null && parsedHeight !== null ? parsedWidth / parsedHeight : null
}

function refreshImageDimensions(): void {
  if (dimensionMode === 'custom') return
  const natural = naturalSize.value
  if (dimensionMode === 'original') {
    imageWidth.value = natural?.width.toString() ?? ''
    imageHeight.value = natural?.height.toString() ?? ''
  } else {
    const ratio = natural === null ? null : natural.width / natural.height
    const width = props.initialWidth
      ?? (ratio !== null && props.initialHeight != null ? Math.round(props.initialHeight * ratio) : natural?.width)
    const height = props.initialHeight
      ?? (ratio !== null && props.initialWidth != null ? Math.round(props.initialWidth / ratio) : natural?.height)
    imageWidth.value = width?.toString() ?? ''
    imageHeight.value = height?.toString() ?? ''
  }
  aspectRatio.value = ratioOf(imageWidth.value, imageHeight.value)
}

function imageLoaded(event: Event): void {
  const image = event.currentTarget
  if (!(image instanceof HTMLImageElement) || image.getAttribute('src') !== imagePreviewUrl.value) return
  if (image.naturalWidth <= 0 || image.naturalHeight <= 0) return
  naturalSize.value = { width: image.naturalWidth, height: image.naturalHeight }
  imagePreviewFailed.value = false
  refreshImageDimensions()
  if (dimensionMode === 'custom' && aspectLocked.value && aspectRatio.value === null) {
    const width = positiveNumber(imageWidth.value)
    const height = positiveNumber(imageHeight.value)
    const naturalRatio = image.naturalWidth / image.naturalHeight
    if (width !== null && imageHeight.value.trim() === '') imageHeight.value = Math.round(width / naturalRatio).toString()
    else if (height !== null && imageWidth.value.trim() === '') imageWidth.value = Math.round(height * naturalRatio).toString()
    aspectRatio.value = ratioOf(imageWidth.value, imageHeight.value)
  }
  aspectRatio.value ??= image.naturalWidth / image.naturalHeight
}

function setImageDimension(dimension: 'width' | 'height', event: Event): void {
  const input = event.currentTarget
  if (!(input instanceof HTMLInputElement)) return
  dimensionMode = 'custom'
  error.value = null
  const changed = dimension === 'width' ? imageWidth : imageHeight
  const other = dimension === 'width' ? imageHeight : imageWidth
  changed.value = input.value
  const value = positiveNumber(input.value)
  if (aspectLocked.value && aspectRatio.value !== null && value !== null) {
    other.value = Math.round(dimension === 'width' ? value / aspectRatio.value : value * aspectRatio.value).toString()
  }
}

function setAspectLock(event: Event): void {
  const input = event.currentTarget
  if (!(input instanceof HTMLInputElement)) return
  aspectLocked.value = input.checked
  if (input.checked) aspectRatio.value = ratioOf(imageWidth.value, imageHeight.value)
}

function resetImageSize(): void {
  dimensionMode = 'original'
  error.value = null
  refreshImageDimensions()
}

function validPixelDimension(value: string): boolean {
  const number = positiveNumber(value)
  return number !== null && Number.isInteger(number) && number >= 16 && number <= 4096
}

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
      code: props.kind === 'image'
        ? assetUrl.code === 'ASSET_URL_REQUIRED' ? 'imageSourceRequired' : 'imageSourceInvalid'
        : assetUrl.code === 'ASSET_URL_REQUIRED'
        ? 'urlRequired'
        : assetUrl.code === 'ASSET_URL_CREDENTIALS'
          ? 'urlCredentials'
          : 'urlUnsupported',
    })
    return
  }
  if (props.kind === 'image' && dimensionMode === 'custom'
    && (!validPixelDimension(imageWidth.value) || !validPixelDimension(imageHeight.value))) {
    error.value = Object.freeze({ code: 'imageSizeInvalid' })
    return
  }
  const imageLayout: ImageLayoutSettings = Object.freeze({
    width: dimensionMode === 'custom' ? Number(imageWidth.value) : dimensionMode === 'original' ? null : props.initialWidth ?? null,
    height: dimensionMode === 'custom' ? Number(imageHeight.value) : dimensionMode === 'original' ? null : props.initialHeight ?? null,
    ...(props.imageAlignmentAvailable && imageAlignment.value !== null ? { alignment: imageAlignment.value } : {}),
  })
  emit('apply', Object.freeze({
    kind: props.kind,
    mediaType: uploaded.value?.mediaType
      ?? (props.initialMediaType?.trim().length ? props.initialMediaType.trim() : DEFAULT_MEDIA_TYPE[props.kind]),
    name: assetName,
    size: uploaded.value?.size ?? props.initialSize ?? 0,
    url: assetUrl.url,
    ...(props.kind === 'image' ? { imageLayout } : {}),
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
    if (props.kind === 'image') {
      naturalSize.value = null
      imagePreviewFailed.value = false
      refreshImageDimensions()
      if (dimensionMode === 'custom') aspectRatio.value = ratioOf(imageWidth.value, imageHeight.value)
    }
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === 'AbortError') {
      error.value = Object.freeze({ code: 'uploadCancelled' })
    } else {
      error.value = Object.freeze({
        code: 'uploadFailed',
        ...(props.kind !== 'image' && reason instanceof Error && reason.message.length > 0 ? { detail: reason.message } : {}),
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

      <template v-if="kind !== 'image'">
        <label :for="`media-url-${kind}`">{{ t('media.url') }}</label>
        <input
          :id="`media-url-${kind}`"
          v-model="url"
          autocomplete="url"
          placeholder="https://…"
          type="url"
          @input="error = null; uploaded = null"
        />
      </template>

      <template v-else>
        <div
          v-if="imagePreviewUrl"
          class="media-editor__preview"
        >
          <img
            :key="imagePreviewUrl"
            :src="imagePreviewUrl"
            alt=""
            data-image-preview
            :class="{ 'media-editor__preview-image--failed': imagePreviewFailed }"
            @load="imageLoaded"
            @error="imagePreviewFailed = true"
          />
          <p v-if="imagePreviewFailed">
            {{ t('media.image.previewUnavailable') }}
          </p>
        </div>

        <fieldset
          class="media-editor__settings"
          :aria-describedby="`media-alignment-help-${kind}`"
        >
          <legend>{{ t('media.image.alignment') }}</legend>
          <div class="media-editor__alignment">
            <button
              v-for="alignment in ALIGNMENTS"
              :key="alignment"
              :aria-pressed="imageAlignment === alignment"
              :data-image-align="alignment"
              :disabled="!imageAlignmentAvailable"
              type="button"
              @click="imageAlignment = alignment"
            >
              {{ t(ALIGNMENT_KEYS[alignment]) }}
            </button>
          </div>
          <p
            :id="`media-alignment-help-${kind}`"
            class="media-editor__hint"
          >
            {{ t(imageAlignmentAvailable ? 'media.image.alignmentHelp' : 'media.image.alignmentUnavailable') }}
          </p>
        </fieldset>

        <fieldset class="media-editor__settings">
          <legend>{{ t('media.image.size') }}</legend>
          <div class="media-editor__dimensions">
            <div>
              <label :for="`media-width-${kind}`">{{ t('media.image.width') }}</label>
              <input
                :id="`media-width-${kind}`"
                :value="imageWidth"
                :aria-invalid="error?.code === 'imageSizeInvalid' || undefined"
                :placeholder="t('media.image.auto')"
                inputmode="numeric"
                min="16"
                max="4096"
                step="1"
                type="number"
                @input="setImageDimension('width', $event)"
              />
            </div>
            <div>
              <label :for="`media-height-${kind}`">{{ t('media.image.height') }}</label>
              <input
                :id="`media-height-${kind}`"
                :value="imageHeight"
                :aria-invalid="error?.code === 'imageSizeInvalid' || undefined"
                :placeholder="t('media.image.auto')"
                inputmode="numeric"
                min="16"
                max="4096"
                step="1"
                type="number"
                @input="setImageDimension('height', $event)"
              />
            </div>
          </div>
          <div class="media-editor__size-actions">
            <label
              class="media-editor__aspect-lock"
              :for="`media-aspect-lock-${kind}`"
            >
              <input
                :id="`media-aspect-lock-${kind}`"
                :checked="aspectLocked"
                type="checkbox"
                @change="setAspectLock"
              />
              {{ t('media.image.aspectLock') }}
            </label>
            <button
              type="button"
              data-image-reset
              @click="resetImageSize"
            >
              {{ t('media.image.originalSize') }}
            </button>
          </div>
        </fieldset>
      </template>

      <div class="media-editor__upload">
        <label :for="`media-file-${kind}`">{{ kind === 'image' ? imageFileLabel : t('media.localFile', { kind: kindLabel }) }}</label>
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
          {{ t(kind === 'image' ? 'media.image.uploading' : 'media.uploading') }}
        </p>
        <p
          v-else-if="uploaded"
          class="media-editor__metadata"
          data-upload-result="ready"
        >
          {{ t(kind === 'image' ? 'media.image.uploadReady' : 'media.uploadReady', { mediaType: uploaded.mediaType, size: uploaded.size }) }}
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
