import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'

import FormulaPicker from '../../src/ui/FormulaPicker.vue'

const recentKey = 'w-editor:formula-recent-symbols:v1'
const wrappers: VueWrapper[] = []

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
  }
}

function picker(source = 'x', storage: Pick<Storage, 'getItem' | 'setItem'> | null = null) {
  const value = ref(source)
  const locale = ref<'zh' | 'en' | 'ru'>('en')
  const mode = ref<'inline' | 'block'>('inline')
  const wrapper = mount(defineComponent({
    setup: () => () => h(FormulaPicker, {
      modelValue: value.value, locale: locale.value, mode: mode.value, storage,
      'onUpdate:modelValue': (updated: string) => { value.value = updated },
      'onUpdate:mode': (updated: 'inline' | 'block') => { mode.value = updated },
    }),
  }), { attachTo: document.body })
  wrappers.push(wrapper)
  const input = () => wrapper.get<HTMLTextAreaElement>('#formula-source')
  const select = async (start: number, end = start) => {
    input().element.focus()
    input().element.setSelectionRange(start, end)
    await input().trigger('select')
  }
  const openSymbols = async () => {
    await wrapper.get('[data-formula-section="special-symbols"]').trigger('click')
    await nextTick()
  }
  const symbols = async () => {
    await openSymbols()
    await wrapper.get('[data-formula-symbol-category="greek"]').trigger('click')
  }
  return { wrapper, value, locale, mode, input, select, openSymbols, symbols }
}

afterEach(() => {
  while (wrappers.length > 0) wrappers.pop()?.unmount()
  document.body.replaceChildren()
})

describe('formula special symbols', () => {
  it('adds recent-first category tabs, defaults to Recently used, and safely renders all 65 commands', async () => {
    const app = picker()
    await app.openSymbols()
    expect(app.wrapper.findAll('[data-formula-symbol-category]').map(tab => tab.attributes('data-formula-symbol-category')))
      .toEqual(['recent', 'greek', 'operators', 'relations', 'arrows', 'layout'])
    expect(app.wrapper.get('[data-formula-symbol-category="recent"]').attributes('aria-selected')).toBe('true')
    const ids: string[] = []
    for (const [category, count] of [['greek', 37], ['operators', 10], ['relations', 9], ['arrows', 9]] as const) {
      await app.wrapper.get(`[data-formula-symbol-category="${category}"]`).trigger('click')
      const buttons = app.wrapper.findAll('[data-formula-symbol]')
      expect(buttons).toHaveLength(count)
      for (const button of buttons) {
        const id = button.attributes('data-formula-symbol')
        expect(id).toBeDefined()
        ids.push(id!)
        expect(button.find('.katex').exists()).toBe(true)
        expect(button.find('.katex-error').exists()).toBe(false)
        expect(button.attributes('aria-label')).toBe(button.attributes('title'))
        expect(button.attributes('aria-label')).toContain(`\\${button.attributes('data-formula-symbol')}`)
      }
    }
    expect(new Set(ids).size).toBe(65)
    expect(app.value.value).toBe('x')
  })

  it('replaces only the selected source range and restores the controlled textarea caret and preview', async () => {
    const app = picker('x+y')
    await app.select(1, 2)
    await app.symbols()
    await app.wrapper.get('[data-formula-symbol="alpha"]').trigger('click')
    await nextTick()

    expect(app.value.value).toBe('x\\alpha y')
    expect(app.input().element.selectionStart).toBe(8)
    expect(app.input().element.selectionEnd).toBe(8)
    expect(document.activeElement).toBe(app.input().element)
    expect(app.wrapper.get('[data-formula-live-preview] annotation').text()).toBe('x\\alpha y')
    app.mode.value = 'block'
    await nextTick()
    expect(app.wrapper.find('[data-formula-live-preview] .katex-display').exists()).toBe(true)
  })

  it('keeps command boundaries and the caret during repeated insertion and category navigation', async () => {
    const app = picker('x')
    await app.select(0)
    await app.symbols()
    await app.wrapper.get('[data-formula-symbol="alpha"]').trigger('click')
    await nextTick()
    await app.wrapper.get('[data-formula-symbol-category="arrows"]').trigger('click')
    await app.wrapper.get('[data-formula-symbol-category="greek"]').trigger('click')
    await app.wrapper.get('[data-formula-symbol="beta"]').trigger('click')
    await nextTick()

    expect(app.value.value).toBe('\\alpha \\beta x')
    expect(app.input().element.selectionStart).toBe(13)
    expect(app.wrapper.find('[data-formula-live-preview] .katex-error').exists()).toBe(false)
  })

  it('preserves the selection while navigating category tabs with the keyboard', async () => {
    const app = picker('left+right')
    await app.select(4, 5)
    await app.symbols()
    const greek = app.wrapper.get<HTMLButtonElement>('[data-formula-symbol-category="greek"]')
    greek.element.focus()
    await greek.trigger('keydown', { key: 'ArrowRight' })
    await nextTick()
    const operators = app.wrapper.get<HTMLButtonElement>('[data-formula-symbol-category="operators"]')
    expect(operators.attributes('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(operators.element)
    await app.wrapper.get('[data-formula-symbol="times"]').trigger('click')
    await nextTick()

    expect(app.value.value).toBe('left\\times right')
    expect(document.activeElement).toBe(app.input().element)
  })

  it('stores a unique recent-first list capped at 12, including cancelled drafts, and reloads it on reopen', async () => {
    const storage = memoryStorage()
    const app = picker('', storage)
    await app.symbols()
    const inserted = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu', 'nu']
    for (const id of inserted) await app.wrapper.get(`[data-formula-symbol="${id}"]`).trigger('click')
    await app.wrapper.get('[data-formula-symbol="gamma"]').trigger('click')
    const expected = ['gamma', 'nu', 'mu', 'lambda', 'kappa', 'iota', 'theta', 'eta', 'zeta', 'epsilon', 'delta', 'beta']
    expect(JSON.parse(storage.data.get(recentKey)!)).toEqual(expected)
    await app.wrapper.get('.dialog-panel__actions button').trigger('click')
    expect(app.wrapper.findComponent(FormulaPicker).emitted('cancel')).toHaveLength(1)
    app.wrapper.unmount()

    const reopened = picker('unchanged', storage)
    await reopened.symbols()
    await reopened.wrapper.get('[data-formula-symbol-category="recent"]').trigger('click')
    expect(reopened.wrapper.findAll('[data-formula-symbol]').map(button => button.attributes('data-formula-symbol'))).toEqual(expected)
    expect(reopened.value.value).toBe('unchanged')
    await reopened.select(2, 5)
    await reopened.wrapper.get('[data-formula-symbol="nu"]').trigger('click')
    expect(reopened.value.value).toBe('un\\nu nged')
  })

  it('shows guidance for empty recents and ignores storage data outside the catalog', async () => {
    const storage = memoryStorage()
    storage.data.set(recentKey, '["\\\\evil{payload}","unknown"]')
    const app = picker('x', storage)
    await app.symbols()
    await app.wrapper.get('[data-formula-symbol-category="recent"]').trigger('click')
    expect(app.wrapper.findAll('[data-formula-symbol]')).toHaveLength(0)
    expect(app.wrapper.get('[data-formula-recent-empty]').text()).not.toBe('')
    expect(app.value.value).toBe('x')
  })

  it('updates category labels and recent-symbol names live in Chinese, English and Russian', async () => {
    const app = picker('x')
    app.locale.value = 'zh'
    await nextTick()
    await app.select(0)
    await app.symbols()
    expect(app.wrapper.get('[data-formula-section="special-symbols"]').text()).toBe('特殊符号')
    expect(app.wrapper.get('[data-formula-symbol="alpha"]').attributes('title')).toBe('小写阿尔法 (\\alpha)')
    await app.wrapper.get('[data-formula-symbol="alpha"]').trigger('click')
    await app.wrapper.get('[data-formula-symbol-category="recent"]').trigger('click')

    for (const [locale, section, recent, label] of [
      ['en', 'Special symbols', 'Recently used', 'Lowercase alpha (\\alpha)'],
      ['ru', 'Специальные символы', 'Недавние', 'Строчная альфа (\\alpha)'],
      ['zh', '特殊符号', '最近使用', '小写阿尔法 (\\alpha)'],
    ] as const) {
      app.locale.value = locale
      await nextTick()
      expect(app.wrapper.get('[data-formula-section="special-symbols"]').text()).toBe(section)
      expect(app.wrapper.get('[data-formula-symbol-category="recent"]').text()).toBe(recent)
      expect(app.wrapper.get('[data-formula-symbol="alpha"]').attributes('title')).toBe(label)
      expect(app.wrapper.get('[data-formula-symbol="alpha"]').attributes('aria-label')).toBe(label)
      expect(app.value.value).toBe('\\alpha x')
    }
  })

  it.each(['read', 'write'])('keeps insertion, preview and dialog actions working when storage %s fails', async failure => {
    const storage = {
      getItem: () => { if (failure === 'read') throw new Error('blocked read'); return null },
      setItem: () => { if (failure === 'write') throw new Error('blocked write') },
    }
    const app = picker('x', storage)
    await app.select(0)
    await app.symbols()
    await app.wrapper.get('[data-formula-symbol="alpha"]').trigger('click')
    expect(app.value.value).toBe('\\alpha x')
    expect(app.wrapper.find('[data-formula-live-preview] .katex').exists()).toBe(true)
    await app.wrapper.get('.primary-action').trigger('click')
    expect(app.wrapper.findComponent(FormulaPicker).emitted('apply')).toHaveLength(1)
    await app.wrapper.get('.dialog-panel__actions button').trigger('click')
    expect(app.wrapper.findComponent(FormulaPicker).emitted('cancel')).toHaveLength(1)
  })

  it('keeps the existing quick tools, templates and text styles functional', async () => {
    const app = picker('x')
    await app.symbols()
    await app.wrapper.get('[data-formula-section="templates"]').trigger('click')
    await app.wrapper.get('[data-formula-tool="matrix"]').trigger('click')
    expect(app.value.value).toBe('\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}')
    await app.wrapper.get('[data-formula-section="text-styles"]').trigger('click')
    await app.wrapper.get('[data-formula-tool="bold-text"]').trigger('click')
    expect(app.value.value).toContain('\\mathbf{x}')
    await app.wrapper.get('[data-formula-section="quick-tools"]').trigger('click')
    await app.wrapper.get('[data-formula-tool="fraction"]').trigger('click')
    expect(app.value.value).toBe('\\frac{a}{b}')
  })
})
