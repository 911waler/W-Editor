<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'

import type { FormulaMode } from '@w-editor/editor-core'
import { renderSafeKatex, translateUi, type UiLocale, type UiMessageKey } from '../services'

type FormulaSection = 'quick-tools' | 'templates' | 'text-styles'
type FormulaCategory = 'common-symbols' | 'roots-indices' | 'limits-logarithms' | 'trigonometry'

interface FormulaTool {
  readonly action: 'insert' | 'replace'
  readonly id: string
  readonly labelKey: UiMessageKey
  readonly source: string
}

const QUICK_TOOLS = Object.freeze<Record<FormulaCategory, readonly FormulaTool[]>>({
  'common-symbols': Object.freeze([
    Object.freeze({ action: 'replace', id: 'fraction', labelKey: 'formula.fraction', source: String.raw`\frac{a}{b}` }),
    Object.freeze({ action: 'replace', id: 'pythagorean', labelKey: 'formula.pythagorean', source: 'a^2 + b^2 = c^2' }),
    Object.freeze({ action: 'insert', id: 'summation', labelKey: 'formula.summation', source: String.raw`\sum_{i=1}^{n}` }),
  ]),
  'roots-indices': Object.freeze([
    Object.freeze({ action: 'insert', id: 'square-root', labelKey: 'formula.squareRoot', source: String.raw`\sqrt{x}` }),
    Object.freeze({ action: 'insert', id: 'nth-root', labelKey: 'formula.nthRoot', source: String.raw`\sqrt[n]{x}` }),
    Object.freeze({ action: 'insert', id: 'superscript', labelKey: 'formula.superscriptTool', source: 'x^{n}' }),
    Object.freeze({ action: 'insert', id: 'subscript', labelKey: 'formula.subscriptTool', source: 'x_{i}' }),
  ]),
  'limits-logarithms': Object.freeze([
    Object.freeze({ action: 'insert', id: 'limit', labelKey: 'formula.limit', source: String.raw`\lim_{x \to 0} f(x)` }),
    Object.freeze({ action: 'insert', id: 'logarithm', labelKey: 'formula.logarithm', source: String.raw`\log_{b}{x}` }),
    Object.freeze({ action: 'insert', id: 'natural-logarithm', labelKey: 'formula.naturalLogarithm', source: String.raw`\ln{x}` }),
  ]),
  trigonometry: Object.freeze([
    Object.freeze({ action: 'insert', id: 'sine', labelKey: 'formula.sine', source: String.raw`\sin{x}` }),
    Object.freeze({ action: 'insert', id: 'cosine', labelKey: 'formula.cosine', source: String.raw`\cos{x}` }),
    Object.freeze({ action: 'insert', id: 'tangent', labelKey: 'formula.tangent', source: String.raw`\tan{x}` }),
  ]),
})

const SECTION_TOOLS = Object.freeze<Record<Exclude<FormulaSection, 'quick-tools'>, readonly FormulaTool[]>>({
  templates: Object.freeze([
    Object.freeze({ action: 'replace', id: 'quadratic', labelKey: 'formula.quadratic', source: String.raw`x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}` }),
    Object.freeze({ action: 'replace', id: 'integral', labelKey: 'formula.integral', source: String.raw`\int_{a}^{b} f(x)\,dx` }),
    Object.freeze({ action: 'replace', id: 'matrix', labelKey: 'formula.matrix', source: String.raw`\begin{bmatrix} a & b \\ c & d \end{bmatrix}` }),
  ]),
  'text-styles': Object.freeze([
    Object.freeze({ action: 'insert', id: 'bold-text', labelKey: 'formula.boldText', source: String.raw`\mathbf{x}` }),
    Object.freeze({ action: 'insert', id: 'roman-text', labelKey: 'formula.romanText', source: String.raw`\mathrm{text}` }),
    Object.freeze({ action: 'insert', id: 'italic-text', labelKey: 'formula.italicText', source: String.raw`\mathit{x}` }),
  ]),
})

const props = withDefaults(defineProps<{
  readonly error?: string | null
  readonly locale: UiLocale
  readonly mode: FormulaMode
  readonly modelValue: string
}>(), { error: null })

const emit = defineEmits<{
  apply: []
  cancel: []
  'update:mode': [mode: FormulaMode]
  'update:modelValue': [value: string]
}>()

const panel = ref<HTMLElement | null>(null)
const input = ref<HTMLTextAreaElement | null>(null)
const inlineRadio = ref<HTMLInputElement | null>(null)
const blockRadio = ref<HTMLInputElement | null>(null)
const applyPending = ref(false)
const activeSection = ref<FormulaSection>('quick-tools')
const activeCategory = ref<FormulaCategory>('common-symbols')

const visibleTools = computed<readonly FormulaTool[]>(() => activeSection.value === 'quick-tools'
  ? QUICK_TOOLS[activeCategory.value]
  : SECTION_TOOLS[activeSection.value])
const visibleToolsId = computed(() => activeSection.value === 'quick-tools'
  ? activeCategory.value
  : activeSection.value)
const livePreview = computed(() => renderSafeKatex(props.mode, props.modelValue))

function t(key: UiMessageKey): string {
  return translateUi(props.locale, key)
}

function focusSource(select = false): void {
  void nextTick(() => {
    input.value?.focus()
    if (select) input.value?.select()
  })
}

onMounted(() => focusSource())

watch(() => props.error, (error) => {
  if (error === null || error === undefined) return
  applyPending.value = false
  focusSource()
})

function updateSource(event: Event): void {
  applyPending.value = false
  emit('update:modelValue', (event.currentTarget as HTMLTextAreaElement).value)
}

function updateMode(mode: FormulaMode): void {
  applyPending.value = false
  emit('update:mode', mode)
}

function moveMode(event: KeyboardEvent, mode: FormulaMode): void {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
  event.preventDefault()
  const next: FormulaMode = mode === 'inline' ? 'block' : 'inline'
  updateMode(next)
  void nextTick(() => (next === 'inline' ? inlineRadio.value : blockRadio.value)?.focus())
}

function replaceWithTemplate(value: string): void {
  applyPending.value = false
  emit('update:modelValue', value)
  void nextTick(() => {
    input.value?.focus()
    input.value?.setSelectionRange(value.length, value.length)
  })
}

function insertSymbol(value: string): void {
  const start = input.value?.selectionStart ?? props.modelValue.length
  const end = input.value?.selectionEnd ?? start
  const next = `${props.modelValue.slice(0, start)}${value}${props.modelValue.slice(end)}`
  applyPending.value = false
  emit('update:modelValue', next)
  void nextTick(() => {
    const caret = start + value.length
    input.value?.focus()
    input.value?.setSelectionRange(caret, caret)
  })
}

function selectSection(section: FormulaSection): void {
  activeSection.value = section
}

function selectCategory(category: FormulaCategory): void {
  activeSection.value = 'quick-tools'
  activeCategory.value = category
}

function applyTool(tool: FormulaTool): void {
  if (tool.action === 'replace') replaceWithTemplate(tool.source)
  else insertSymbol(tool.source)
}

function previewHtml(source: string): string {
  return renderSafeKatex('inline', source).html
}

function apply(): void {
  if (applyPending.value) return
  applyPending.value = true
  emit('apply')
}

function trapFocus(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('cancel')
    return
  }
  if (event.key !== 'Tab' || panel.value === null) return
  const focusable = [...panel.value.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => !element.hidden)
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}
</script>

<template>
  <div class="dialog-backdrop formula-picker-backdrop">
    <section
      ref="panel"
      aria-labelledby="formula-picker-title"
      aria-modal="true"
      class="dialog-panel formula-picker"
      data-picker-command="insert.formula"
      role="dialog"
      @keydown="trapFocus"
    >
      <header class="formula-picker__header">
        <div>
          <p class="section-kicker">
            {{ t('formula.kicker') }}
          </p>
          <h2 id="formula-picker-title">
            {{ t('formula.title') }}
          </h2>
        </div>
        <fieldset
          :aria-label="t('formula.mode')"
          class="formula-picker__mode"
          role="radiogroup"
        >
          <legend class="visually-hidden">
            {{ t('formula.mode') }}
          </legend>
          <label>
            <input
              ref="inlineRadio"
              :checked="mode === 'inline'"
              name="formula-mode"
              type="radio"
              value="inline"
              @change="updateMode('inline')"
              @keydown="moveMode($event, 'inline')"
            />
            {{ t('formula.inline') }}
          </label>
          <label>
            <input
              ref="blockRadio"
              :checked="mode === 'block'"
              name="formula-mode"
              type="radio"
              value="block"
              @change="updateMode('block')"
              @keydown="moveMode($event, 'block')"
            />
            {{ t('formula.block') }}
          </label>
        </fieldset>
      </header>

      <div class="formula-picker__workspace">
        <nav
          :aria-label="t('formula.toolSections')"
          class="formula-picker__sidebar"
        >
          <button
            :aria-current="activeSection === 'quick-tools' ? 'page' : undefined"
            data-formula-section="quick-tools"
            type="button"
            @click="selectSection('quick-tools')"
          >
            {{ t('formula.quickTools') }}
          </button>
          <button
            :aria-current="activeSection === 'templates' ? 'page' : undefined"
            data-formula-section="templates"
            type="button"
            @click="selectSection('templates')"
          >
            {{ t('formula.templates') }}
          </button>
          <button
            :aria-current="activeSection === 'text-styles' ? 'page' : undefined"
            data-formula-section="text-styles"
            type="button"
            @click="selectSection('text-styles')"
          >
            {{ t('formula.textStyles') }}
          </button>
        </nav>
        <div class="formula-picker__main">
          <div
            v-if="activeSection === 'quick-tools'"
            :aria-label="t('formula.symbolCategories')"
            class="formula-picker__categories"
            role="tablist"
          >
            <button
              :aria-selected="activeCategory === 'common-symbols'"
              data-formula-category="common-symbols"
              role="tab"
              type="button"
              @click="selectCategory('common-symbols')"
            >
              {{ t('formula.commonSymbols') }}
            </button>
            <button
              :aria-selected="activeCategory === 'roots-indices'"
              data-formula-category="roots-indices"
              role="tab"
              type="button"
              @click="selectCategory('roots-indices')"
            >
              {{ t('formula.rootsIndices') }}
            </button>
            <button
              :aria-selected="activeCategory === 'limits-logarithms'"
              data-formula-category="limits-logarithms"
              role="tab"
              type="button"
              @click="selectCategory('limits-logarithms')"
            >
              {{ t('formula.limitsLogarithms') }}
            </button>
            <button
              :aria-selected="activeCategory === 'trigonometry'"
              data-formula-category="trigonometry"
              role="tab"
              type="button"
              @click="selectCategory('trigonometry')"
            >
              {{ t('formula.trigonometry') }}
            </button>
          </div>
          <div
            class="formula-picker__tools"
            :data-formula-tools="visibleToolsId"
          >
            <button
              v-for="tool in visibleTools"
              :key="tool.id"
              :aria-label="t(tool.labelKey)"
              class="formula-picker__symbol"
              :data-formula-tool="tool.id"
              type="button"
              @click="applyTool(tool)"
            >
              <!-- Safe KaTeX output is produced by renderSafeKatex before reaching the template. -->
              <!-- eslint-disable vue/no-v-html -->
              <span
                aria-hidden="true"
                class="formula-picker__preview"
                v-html="previewHtml(tool.source)"
              ></span>
              <!-- eslint-enable vue/no-v-html -->
              <span>{{ t(tool.labelKey) }}</span>
            </button>
          </div>

          <section
            :aria-label="t('formula.preview')"
            class="formula-picker__live-preview"
            data-formula-live-preview
          >
            <p class="formula-picker__live-preview-label">
              {{ t('formula.preview') }}
            </p>
            <!-- Safe KaTeX output is produced by renderSafeKatex before reaching the template. -->
            <!-- eslint-disable vue/no-v-html -->
            <div
              :aria-label="mode === 'block' ? t('formula.renderedBlock') : t('formula.renderedInline')"
              :data-preview-state="livePreview.status"
              class="formula-picker__live-preview-content"
              role="img"
              v-html="livePreview.html"
            ></div>
            <!-- eslint-enable vue/no-v-html -->
          </section>

          <label for="formula-source">{{ t('formula.source') }}</label>
          <textarea
            id="formula-source"
            ref="input"
            :value="modelValue"
            rows="5"
            @input="updateSource"
          ></textarea>
          <p
            v-if="error"
            class="dialog-error"
            role="alert"
          >
            {{ error }}
          </p>
        </div>
      </div>

      <div class="dialog-panel__actions">
        <button
          type="button"
          @click="emit('cancel')"
        >
          {{ t('common.cancel') }}
        </button>
        <button
          class="primary-action"
          :disabled="applyPending"
          type="button"
          @click="apply"
        >
          {{ t('common.apply') }}
        </button>
      </div>
    </section>
  </div>
</template>
