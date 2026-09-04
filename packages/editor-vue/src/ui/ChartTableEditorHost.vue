<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import {
  CHART_TABLE_DESCRIPTORS,
  chartTableSource,
  type ChartTableDraft,
  type ChartTableOptionValue,
  type ChartTableType,
} from '@w-editor/editor-core'
import {
  defaultCherryChartPreviewRenderer,
  type ChartPreviewRendererContract,
} from '../adapters/cherryChartPreviewRenderer'
import {
  translateUi,
  type UiLocale,
  type UiMessageKey,
  type UiMessageParams,
} from '../services/uiLocalization'

const props = defineProps<{
  readonly chartType: ChartTableType
  readonly chartRenderer?: ChartPreviewRendererContract
  readonly columns: readonly string[]
  readonly error?: string | null
  readonly locale: UiLocale
  readonly options: Readonly<Record<string, ChartTableOptionValue>>
  readonly rows: readonly (readonly string[])[]
  readonly title: string
}>()
const emit = defineEmits<{
  apply: [draft: ChartTableDraft]
  cancel: []
}>()

const draftChartType = ref(props.chartType)
const draftColumns = ref([...props.columns])
const draftRows = ref(props.rows.map((row) => [...row]))
const draftTitle = ref(props.title)
const titleInput = ref<HTMLInputElement | null>(null)
const previewHost = ref<HTMLElement | null>(null)
const previewError = ref<string | null>(null)
const confirmDiscard = ref(false)
let applyPending = false
let disposePreview: (() => void) | null = null
const initial = JSON.stringify({
  chartType: props.chartType,
  columns: props.columns,
  rows: props.rows,
  title: props.title,
})
const dirty = computed(() => JSON.stringify({
  chartType: draftChartType.value,
  columns: draftColumns.value,
  rows: draftRows.value,
  title: draftTitle.value,
}) !== initial)
const previewSource = computed(() => {
  try {
    return Object.freeze({
      error: null,
      source: chartTableSource({
        chartType: draftChartType.value,
        columns: draftColumns.value,
        options: props.options,
        rows: draftRows.value,
        title: draftTitle.value,
      }),
    })
  } catch (error: unknown) {
    return Object.freeze({
      error: error instanceof Error && error.message.length > 0
        ? error.message
        : t('semanticNode.unknownChartError'),
      source: null,
    })
  }
})

function t(key: UiMessageKey, params?: UiMessageParams): string {
  return translateUi(props.locale, key, params)
}

onMounted(async () => {
  await nextTick()
  titleInput.value?.focus()
})

watch([previewHost, previewSource], ([host, preview]) => {
  disposePreview?.()
  disposePreview = null
  previewError.value = preview.error
  if (host === null || preview.source === null) {
    host?.replaceChildren()
    return
  }
  try {
    disposePreview = (props.chartRenderer ?? defaultCherryChartPreviewRenderer).mount(host, preview.source)
  } catch (error: unknown) {
    host.replaceChildren()
    previewError.value = error instanceof Error && error.message.length > 0
      ? error.message
      : t('semanticNode.unknownChartError')
  }
}, { flush: 'post', immediate: true })

onBeforeUnmount(() => {
  disposePreview?.()
})

function changed(): void {
  applyPending = false
}

function apply(): void {
  if (applyPending) return
  applyPending = true
  emit('apply', Object.freeze({
    chartType: draftChartType.value,
    columns: Object.freeze([...draftColumns.value]),
    options: props.options,
    rows: Object.freeze(draftRows.value.map((row) => Object.freeze([...row]))),
    title: draftTitle.value,
  }))
}

function requestClose(): void {
  if (!dirty.value) {
    emit('cancel')
    return
  }
  confirmDiscard.value = true
}
</script>

<template>
  <div
    class="dialog-backdrop dialog-backdrop--chart-table"
    @mousedown.self="requestClose"
  >
    <section
      aria-labelledby="chart-table-dialog-title"
      aria-modal="true"
      class="dialog-panel chart-table-editor"
      data-editor-command="chart-table.editor"
      role="dialog"
      @keydown.esc.prevent="requestClose"
    >
      <p class="section-kicker">
        {{ t('chartEditor.kicker') }}
      </p>
      <h2 id="chart-table-dialog-title">
        {{ t('chartEditor.title') }}
      </h2>
      <div class="chart-table-editor__workspace">
        <div class="chart-table-editor__data">
          <div class="chart-table-editor__configuration">
            <label for="chart-table-type">{{ t('chartEditor.type') }}</label>
            <select
              id="chart-table-type"
              v-model="draftChartType"
              @change="changed"
            >
              <option
                v-for="descriptor in CHART_TABLE_DESCRIPTORS"
                :key="descriptor.chartType"
                :value="descriptor.chartType"
              >
                {{ descriptor.labels[locale] }}
              </option>
            </select>
            <label for="chart-table-title">{{ t('chartEditor.titleLabel') }}</label>
            <input
              id="chart-table-title"
              ref="titleInput"
              v-model="draftTitle"
              type="text"
              @input="changed"
            />
          </div>

          <div class="chart-table-editor__grid-scroll">
            <table class="chart-table-editor__grid">
              <thead>
                <tr>
                  <th scope="col">
                    {{ t('chartEditor.series') }}
                  </th>
                  <th
                    v-for="(_column, columnIndex) in draftColumns"
                    :key="columnIndex"
                    scope="col"
                  >
                    <label :for="`chart-column-${columnIndex}`">{{ t('chartEditor.column', { number: columnIndex + 1 }) }}</label>
                    <input
                      :id="`chart-column-${columnIndex}`"
                      v-model="draftColumns[columnIndex]"
                      type="text"
                      @input="changed"
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(row, rowIndex) in draftRows"
                  :key="rowIndex"
                >
                  <td
                    v-for="(_cell, cellIndex) in row"
                    :key="cellIndex"
                  >
                    <label
                      class="visually-hidden"
                      :for="`chart-cell-${rowIndex}-${cellIndex}`"
                    >{{ t('chartEditor.cell', { cell: cellIndex + 1, row: rowIndex + 1 }) }}</label>
                    <input
                      :id="`chart-cell-${rowIndex}-${cellIndex}`"
                      v-model="row[cellIndex]"
                      type="text"
                      @input="changed"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <section
          aria-labelledby="chart-table-preview-title"
          class="chart-table-editor__preview"
        >
          <h3 id="chart-table-preview-title">
            {{ t('chartEditor.livePreview') }}
          </h3>
          <div
            ref="previewHost"
            :aria-label="t('chartEditor.livePreview')"
            class="chart-table-editor__preview-canvas"
            data-chart-draft-preview
          ></div>
          <p
            v-if="previewError"
            class="dialog-panel__error"
            role="alert"
          >
            {{ t('chartEditor.previewUnavailable', { message: previewError }) }}
          </p>
        </section>
      </div>
      <p
        v-if="error"
        class="dialog-panel__error"
        role="alert"
      >
        {{ error }}
      </p>
      <div class="dialog-panel__actions">
        <button
          type="button"
          @click="emit('cancel')"
        >
          {{ t('common.cancel') }}
        </button>
        <button
          class="primary-action"
          type="button"
          @click="apply"
        >
          {{ t('common.apply') }}
        </button>
      </div>
    </section>

    <section
      v-if="confirmDiscard"
      aria-labelledby="discard-chart-table-title"
      aria-modal="true"
      class="dialog-panel dialog-panel--confirm"
      role="alertdialog"
    >
      <h2 id="discard-chart-table-title">
        {{ t('chartEditor.discardTitle') }}
      </h2>
      <p>{{ t('chartEditor.unchanged') }}</p>
      <div class="dialog-panel__actions">
        <button
          type="button"
          @click="confirmDiscard = false"
        >
          {{ t('common.keepEditing') }}
        </button>
        <button
          class="danger-action"
          type="button"
          @click="emit('cancel')"
        >
          {{ t('common.discardChanges') }}
        </button>
      </div>
    </section>
  </div>
</template>
