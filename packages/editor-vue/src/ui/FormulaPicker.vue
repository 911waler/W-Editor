<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'

import type { FormulaMode } from '@w-editor/editor-core'
import { renderSafeKatex, translateUi, type UiLocale, type UiMessageKey } from '../services'
import { formulaFromClipboard } from '../services/formulaPaste'
import {
  FORMULA_LAYOUT_EXAMPLES,
  formulaLayoutAtSelection,
  wrapFormulaLayout,
  type FormulaLayoutKind,
} from '../services/formulaLayout'
import type { UiMessageParams } from '../services/uiLocalization'
import {
  FORMULA_SYMBOL_CATEGORIES,
  FORMULA_SYMBOLS,
  formulaSymbolById,
  readRecentFormulaSymbolIds,
  rememberFormulaSymbol,
  type FormulaSymbol,
  type FormulaSymbolCategory,
} from '../services/formulaSymbols'

type FormulaSection = 'quick-tools' | 'special-symbols' | 'templates' | 'text-styles'
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

const SECTION_TOOLS = Object.freeze<Record<'templates' | 'text-styles', readonly FormulaTool[]>>({
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
  // Omitted storage uses the service's guarded browser fallback; null disables persistence.
  // eslint-disable-next-line vue/require-default-prop
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'> | null
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
const activeSection = ref<FormulaSection>('special-symbols')
const activeCategory = ref<FormulaCategory>('common-symbols')
const activeSymbolCategory = ref<FormulaSymbolCategory | 'recent' | 'layout'>('recent')
const recentSymbolIds = ref(readRecentFormulaSymbolIds(props.storage))
const sourceSelection = ref<Readonly<{ start: number; end: number }> | null>(null)
const symbolCategories = Object.freeze([
  Object.freeze({ id: 'recent' as const, labelKey: 'formula.recentSymbols' as const }),
  ...FORMULA_SYMBOL_CATEGORIES,
  Object.freeze({ id: 'layout' as const, labelKey: 'formula.layout' as const }),
])

const visibleTools = computed<readonly FormulaTool[]>(() => activeSection.value === 'quick-tools'
  ? QUICK_TOOLS[activeCategory.value]
  : activeSection.value === 'special-symbols' ? [] : SECTION_TOOLS[activeSection.value])
const visibleSymbols = computed(() => activeSymbolCategory.value === 'recent'
  ? recentSymbolIds.value.map(formulaSymbolById).filter((symbol): symbol is FormulaSymbol => symbol !== undefined)
  : FORMULA_SYMBOLS.filter(symbol => symbol.category === activeSymbolCategory.value))
const visibleToolsId = computed(() => activeSection.value === 'quick-tools'
  ? activeCategory.value
  : activeSection.value)
const livePreview = computed(() => renderSafeKatex(props.mode, props.modelValue))
const selectedLayout = computed(() => sourceSelection.value === null ? null : formulaLayoutAtSelection(
  props.modelValue, sourceOffset(sourceSelection.value.start), sourceOffset(sourceSelection.value.end),
))
const layoutGuidance = computed(() => selectedLayout.value === null ? t('formula.layoutEnvironmentRequired')
  : selectedLayout.value === 'gathered' ? t('formula.layoutAlignmentRequired') : t('formula.layoutReady'))
const layoutTemplates = Object.freeze([
  Object.freeze({ kind: 'aligned' as const, labelKey: 'formula.multilineAligned' as const, hintKey: 'formula.alignedHint' as const, captionKey: 'formula.alignedCaption' as const }),
  Object.freeze({ kind: 'gathered' as const, labelKey: 'formula.multilineGathered' as const, hintKey: 'formula.gatheredHint' as const, captionKey: 'formula.gatheredCaption' as const }),
])

function t(key: UiMessageKey, params?: UiMessageParams): string {
  return translateUi(props.locale, key, params)
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
  rememberSourceSelection()
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

function replaceWithTemplate(value: string, sourceCaret = value.length): void {
  applyPending.value = false
  emit('update:modelValue', value)
  void nextTick(() => {
    input.value?.focus()
    const caret = textareaLength(value.slice(0, sourceCaret))
    input.value?.setSelectionRange(caret, caret)
    rememberSourceSelection()
  })
}

function insertSymbol(value: string): void {
  if (document.activeElement === input.value || sourceSelection.value === null) rememberSourceSelection()
  const length = textareaLength(props.modelValue)
  const selectedFrom = Math.min(sourceSelection.value?.start ?? length, length)
  const selectedTo = Math.min(sourceSelection.value?.end ?? selectedFrom, length)
  const start = sourceOffset(selectedFrom)
  const end = sourceOffset(selectedTo)
  const next = `${props.modelValue.slice(0, start)}${value}${props.modelValue.slice(end)}`
  applyPending.value = false
  emit('update:modelValue', next)
  void nextTick(() => {
    const caret = selectedFrom + textareaLength(value)
    input.value?.focus()
    input.value?.setSelectionRange(caret, caret)
    rememberSourceSelection()
  })
}

function textareaLength(value: string): number {
  return value.replace(/\r\n/gu, '\n').length
}

function sourceOffset(textareaOffset: number): number {
  let index = 0
  for (let offset = 0; offset < textareaOffset && index < props.modelValue.length; offset += 1) {
    index += props.modelValue[index] === '\r' && props.modelValue[index + 1] === '\n' ? 2 : 1
  }
  return index
}

function pasteFormula(event: ClipboardEvent): void {
  if (event.clipboardData === null || event.clipboardData === undefined) return
  const formula = formulaFromClipboard(event.clipboardData.getData('text/plain'))
  if (formula === null) return
  event.preventDefault()
  rememberSourceSelection()
  updateMode(formula.mode)
  insertSymbol(formula.content)
}

function rememberSourceSelection(): void {
  if (input.value === null) return
  sourceSelection.value = { start: input.value.selectionStart, end: input.value.selectionEnd }
}

function applyLayoutTemplate(kind: FormulaLayoutKind): void {
  const result = wrapFormulaLayout(props.modelValue, kind)
  updateMode('block')
  replaceWithTemplate(result.content, result.caret)
}

function insertLayoutToken(kind: 'newline' | 'alignment'): void {
  if (selectedLayout.value === null || (kind === 'alignment' && selectedLayout.value !== 'aligned')) return
  insertSymbol(kind === 'newline' ? '\\\\\n' : '&')
}

function layoutTemplateHint(kind: FormulaLayoutKind, hintKey: UiMessageKey): string {
  return t(hintKey, { environment: `\\begin{${kind}}…\\end{${kind}}` })
}

function layoutPreview(kind: FormulaLayoutKind): string {
  return renderSafeKatex('block', wrapFormulaLayout(FORMULA_LAYOUT_EXAMPLES[kind], kind).content).html
}

function insertCatalogSymbol(symbol: FormulaSymbol): void {
  insertSymbol(`${symbol.source} `)
  recentSymbolIds.value = rememberFormulaSymbol(recentSymbolIds.value, symbol.id, props.storage)
}

function symbolLabel(symbol: FormulaSymbol): string {
  return `${t(symbol.labelKey)} (${symbol.source})`
}

function moveSymbolCategory(event: KeyboardEvent, index: number): void {
  let next: number | null = null
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % symbolCategories.length
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + symbolCategories.length) % symbolCategories.length
  if (event.key === 'Home') next = 0
  if (event.key === 'End') next = symbolCategories.length - 1
  if (next === null) return
  event.preventDefault()
  const category = symbolCategories[next]
  if (category === undefined) return
  activeSymbolCategory.value = category.id
  void nextTick(() => panel.value?.querySelector<HTMLElement>(`[data-formula-symbol-category="${category.id}"]`)?.focus())
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
            :aria-current="activeSection === 'special-symbols' ? 'page' : undefined"
            data-formula-section="special-symbols"
            type="button"
            @click="selectSection('special-symbols')"
          >
            {{ t('formula.specialSymbols') }}
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
            v-if="activeSection === 'special-symbols'"
            :aria-label="t('formula.symbolCategories')"
            class="formula-picker__categories"
            role="tablist"
          >
            <button
              v-for="(category, index) in symbolCategories"
              :id="`formula-symbol-category-${category.id}`"
              :key="category.id"
              aria-controls="formula-symbols-panel"
              :aria-selected="activeSymbolCategory === category.id"
              :data-formula-symbol-category="category.id"
              :tabindex="activeSymbolCategory === category.id ? 0 : -1"
              role="tab"
              type="button"
              @click="activeSymbolCategory = category.id"
              @keydown="moveSymbolCategory($event, index)"
            >
              {{ t(category.labelKey) }}
            </button>
          </div>
          <div
            v-if="activeSection === 'special-symbols'"
            id="formula-symbols-panel"
            :aria-labelledby="`formula-symbol-category-${activeSymbolCategory}`"
            class="formula-picker__symbol-panel"
            role="tabpanel"
          >
            <div
              v-if="activeSymbolCategory === 'layout'"
              data-formula-tools="layout"
            >
              <div class="formula-picker__tools formula-picker__tools--layout">
                <button
                  v-for="tool in layoutTemplates"
                  :key="tool.kind"
                  :aria-label="`${t(tool.labelKey)} — ${layoutTemplateHint(tool.kind, tool.hintKey)}`"
                  :aria-describedby="`formula-layout-caption-${tool.kind}`"
                  :title="layoutTemplateHint(tool.kind, tool.hintKey)"
                  :data-formula-layout-tool="tool.kind"
                  class="formula-picker__symbol"
                  type="button"
                  @click="applyLayoutTemplate(tool.kind)"
                >
                  <!-- Safe KaTeX output is produced by renderSafeKatex before reaching the template. -->
                  <!-- eslint-disable vue/no-v-html -->
                  <span
                    aria-hidden="true"
                    class="formula-picker__preview"
                    v-html="layoutPreview(tool.kind)"
                  ></span>
                  <!-- eslint-enable vue/no-v-html -->
                  <span>{{ t(tool.labelKey) }}</span>
                  <span
                    :id="`formula-layout-caption-${tool.kind}`"
                    class="formula-picker__layout-caption"
                    data-formula-layout-caption
                  >{{ t(tool.captionKey) }}</span>
                </button>
                <button
                  :aria-label="`${t('formula.insertLineBreak')} — ${t('formula.lineBreakHint')}`"
                  :title="`${t('formula.lineBreakHint')}${selectedLayout === null ? ` ${t('formula.layoutEnvironmentRequired')}` : ''}`"
                  :disabled="selectedLayout === null"
                  aria-describedby="formula-layout-guidance"
                  class="formula-picker__symbol"
                  data-formula-layout-tool="newline"
                  type="button"
                  @click="insertLayoutToken('newline')"
                >
                  <code aria-hidden="true">\\</code>
                  <span>{{ t('formula.insertLineBreak') }}</span>
                </button>
                <button
                  :aria-label="`${t('formula.insertAlignmentPoint')} — ${t('formula.alignmentPointHint')}`"
                  :title="`${t('formula.alignmentPointHint')}${selectedLayout !== 'aligned' ? ` ${layoutGuidance}` : ''}`"
                  :disabled="selectedLayout !== 'aligned'"
                  aria-describedby="formula-layout-guidance"
                  class="formula-picker__symbol"
                  data-formula-layout-tool="alignment"
                  type="button"
                  @click="insertLayoutToken('alignment')"
                >
                  <code aria-hidden="true">&amp;</code>
                  <span>{{ t('formula.insertAlignmentPoint') }}</span>
                </button>
              </div>
              <p
                class="formula-picker__recent-empty"
                data-formula-alignment-help
              >
                {{ t('formula.alignmentHelp') }}
              </p>
              <p
                id="formula-layout-guidance"
                class="formula-picker__recent-empty"
                data-formula-layout-guidance
              >
                {{ layoutGuidance }}
              </p>
            </div>
            <div
              v-else-if="visibleSymbols.length > 0"
              class="formula-picker__symbol-grid"
            >
              <button
                v-for="symbol in visibleSymbols"
                :key="symbol.id"
                :aria-label="symbolLabel(symbol)"
                :title="symbolLabel(symbol)"
                :data-formula-symbol="symbol.id"
                class="formula-picker__symbol formula-picker__symbol--compact"
                type="button"
                @click="insertCatalogSymbol(symbol)"
              >
                <!-- Safe KaTeX output is produced by renderSafeKatex before reaching the template. -->
                <!-- eslint-disable vue/no-v-html -->
                <span
                  aria-hidden="true"
                  class="formula-picker__glyph"
                  v-html="previewHtml(symbol.source)"
                ></span>
                <!-- eslint-enable vue/no-v-html -->
              </button>
            </div>
            <p
              v-else
              class="formula-picker__recent-empty"
              data-formula-recent-empty
            >
              {{ t('formula.noRecentSymbols') }}
            </p>
          </div>
          <div
            v-else
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
            @blur="rememberSourceSelection"
            @click="rememberSourceSelection"
            @input="updateSource"
            @paste="pasteFormula"
            @keyup="rememberSourceSelection"
            @select="rememberSourceSelection"
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
