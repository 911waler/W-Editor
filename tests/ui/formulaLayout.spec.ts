import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'

import FormulaPicker from '../../src/ui/FormulaPicker.vue'
import { wrapFormulaLayout } from '../../packages/editor-vue/src/services/formulaLayout'

const wrappers: VueWrapper[] = []
const wrap = (kind: 'aligned' | 'gathered', body: string) => `\\begin{${kind}}\n${body}\n\\end{${kind}}`
const domLength = (value: string) => value.replace(/\r\n/gu, '\n').length

function picker(source = '', initialMode: 'inline' | 'block' = 'inline') {
  const value = ref(source)
  const mode = ref(initialMode)
  const locale = ref<'zh' | 'en' | 'ru'>('en')
  const wrapper = mount(defineComponent({
    setup: () => () => h(FormulaPicker, {
      modelValue: value.value, mode: mode.value, locale: locale.value, storage: null,
      'onUpdate:modelValue': (updated: string) => { value.value = updated },
      'onUpdate:mode': (updated: 'inline' | 'block') => { mode.value = updated },
    }),
  }), { attachTo: document.body })
  wrappers.push(wrapper)
  const input = () => wrapper.get<HTMLTextAreaElement>('#formula-source')
  const select = async (from: number, to = from) => {
    input().element.focus()
    input().element.setSelectionRange(from, to)
    await input().trigger('select')
  }
  const layout = async () => {
    await wrapper.get('[data-formula-section="special-symbols"]').trigger('click')
    await wrapper.get('[data-formula-symbol-category="layout"]').trigger('click')
  }
  const tool = (id: string) => wrapper.get<HTMLButtonElement>(`[data-formula-layout-tool="${id}"]`)
  return { wrapper, value, mode, locale, input, select, layout, tool }
}

afterEach(() => {
  while (wrappers.length > 0) wrappers.pop()?.unmount()
  document.body.replaceChildren()
})

describe('formula line breaks and alignment', () => {
  it.each([false, true])('aligns plain equals signs into two preview columns, including an existing aligned environment: %s', async existing => {
    const body = 'aa=bbbbbbbbbb\\\\\nbbbbbbbbbb=a'
    const app = picker(existing ? wrap('aligned', body) : body)
    await app.layout()
    await app.tool('aligned').trigger('click')
    expect(app.value.value).toBe('\\begin{aligned}\naa&=bbbbbbbbbb\\\\\nbbbbbbbbbb&=a\n\\end{aligned}')
    expect(app.wrapper.get('[data-preview-state]').attributes('data-preview-state')).toBe('ready')
    const columns = app.wrapper.findAll('[data-formula-live-preview] .katex-html .mtable > .col-align-r, [data-formula-live-preview] .katex-html .mtable > .col-align-l')
    expect(columns).toHaveLength(2)
    expect(columns[0]!.text()).toContain('aa')
    expect(columns[0]!.text()).not.toContain('=')
    expect(columns[1]!.text().match(/=/gu)).toHaveLength(2)
  })

  it('keeps handwritten alignment points and only aligns the first ordinary top-level equals sign per row', async () => {
    const source = String.raw`x = y = z \\ a&=b \\ c = d & e \\ \text{a=b} + {q=r} + \= + f = g \\ x+y`
    const app = picker(source)
    await app.layout()
    await app.tool('aligned').trigger('click')
    expect(app.value.value).toBe(wrap('aligned', String.raw`x &= y = z \\ a&=b \\ c = d & e \\ \text{a=b} + {q=r} + \= + f &= g \\ x+y`))
    const once = app.value.value
    await app.tool('aligned').trigger('click')
    expect(app.value.value).toBe(once)
  })

  it('ignores equals signs, row breaks, and alignment points inside nested environments, groups, and comments', () => {
    const source = String.raw`\begin{matrix}a=b & c=d \\ e=f & g=h\end{matrix} + x=y \\`
      + '\r\n' + String.raw`\begin{cases}a=b & c=d \\ e=f & g=h\end{cases} = z \\`
      + '\r\n' + String.raw`{a=b \\ c=d & e=f} + q=r \\`
      + '\r\n' + String.raw`x % fake = & \\ \begin{matrix}`
      + '\r\n' + String.raw`+y=z \\ \{a=b\} \& c=d`
    const expected = String.raw`\begin{matrix}a=b & c=d \\ e=f & g=h\end{matrix} + x&=y \\`
      + '\r\n' + String.raw`\begin{cases}a=b & c=d \\ e=f & g=h\end{cases} &= z \\`
      + '\r\n' + String.raw`{a=b \\ c=d & e=f} + q&=r \\`
      + '\r\n' + String.raw`x % fake = & \\ \begin{matrix}`
      + '\r\n' + String.raw`+y&=z \\ \{a&=b\} \& c=d`
    expect(wrapFormulaLayout(wrap('aligned', source), 'aligned').content).toBe(wrap('aligned', expected))
  })

  it('preserves outer whitespace and CRLF when repairing alignment, then inserts symbols at the safe body caret', async () => {
    const source = ' \r\n\\begin{aligned}\r\n  aa=bbbbbbbbbb\\\\\r\n bbbbbbbbbb=a  \r\n\\end{aligned}\t '
    const expected = ' \r\n\\begin{aligned}\r\n  aa&=bbbbbbbbbb\\\\\r\n bbbbbbbbbb&=a  \r\n\\end{aligned}\t '
    const app = picker(source)
    await app.layout()
    await app.tool('aligned').trigger('click')
    expect(app.value.value).toBe(expected)
    const end = expected.indexOf('a  \r\n') + 1
    expect(app.input().element.selectionStart).toBe(domLength(expected.slice(0, end)))
    await app.wrapper.get('[data-formula-symbol-category="greek"]').trigger('click')
    await app.wrapper.get('[data-formula-symbol="alpha"]').trigger('click')
    expect(app.value.value).toBe(expected.slice(0, end) + '\\alpha ' + expected.slice(end))
  })

  it('leaves gathered equals signs unchanged and aligns newly written rows only when clicked again', async () => {
    const app = picker('x=y\\\\\na=b')
    await app.layout()
    await app.tool('gathered').trigger('click')
    expect(app.value.value).toBe('\\begin{gathered}\nx=y\\\\\na=b\n\\end{gathered}')
    app.value.value = '\\begin{aligned}\nx&=y\\\\\na=b\n\\end{aligned}'
    await nextTick()
    expect(app.value.value).toContain('a=b')
    await app.tool('aligned').trigger('click')
    expect(app.value.value).toBe('\\begin{aligned}\nx&=y\\\\\na&=b\n\\end{aligned}')
  })

  it('preserves nested handwritten layouts while adding anchors to their outer rows', () => {
    const source = String.raw`\begin{aligned}a=b \\ c&=d\end{aligned} = x \\ \begin{gathered}p=q \\ r=s\end{gathered}=y`
    expect(wrapFormulaLayout(wrap('aligned', source), 'aligned').content).toBe(wrap('aligned', String.raw`\begin{aligned}a=b \\ c&=d\end{aligned} &= x \\ \begin{gathered}p=q \\ r=s\end{gathered}&=y`))
  })

  it('opens every fresh picker on special symbols and Recently used without changing source or mode', async () => {
    const app = picker('original', 'block')
    await nextTick()
    expect(app.wrapper.get('[data-formula-section="special-symbols"]').attributes('aria-current')).toBe('page')
    expect(app.wrapper.get('[data-formula-symbol-category="recent"]').attributes('aria-selected')).toBe('true')
    expect(app.value.value).toBe('original')
    expect(app.mode.value).toBe('block')
    await app.wrapper.get('[data-formula-section="quick-tools"]').trigger('click')
    const reopened = picker('new')
    expect(reopened.wrapper.get('[data-formula-section="special-symbols"]').attributes('aria-current')).toBe('page')
    expect(reopened.wrapper.get('[data-formula-symbol-category="recent"]').attributes('aria-selected')).toBe('true')
    expect(reopened.mode.value).toBe('inline')
  })

  it('places layout immediately after arrows and includes it in keyboard tab navigation', async () => {
    const app = picker()
    await app.wrapper.get('[data-formula-section="special-symbols"]').trigger('click')
    expect(app.wrapper.findAll('[data-formula-symbol-category]').map(tab => tab.attributes('data-formula-symbol-category')))
      .toEqual(['recent', 'greek', 'operators', 'relations', 'arrows', 'layout'])
    await app.wrapper.get('[data-formula-symbol-category="arrows"]').trigger('keydown', { key: 'ArrowRight' })
    expect(app.wrapper.get('[data-formula-symbol-category="layout"]').attributes('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(app.wrapper.get('[data-formula-symbol-category="layout"]').element)
    await app.wrapper.get('[data-formula-symbol-category="layout"]').trigger('keydown', { key: 'Home' })
    expect(app.wrapper.get('[data-formula-symbol-category="recent"]').attributes('aria-selected')).toBe('true')
    await app.wrapper.get('[data-formula-symbol-category="recent"]').trigger('keydown', { key: 'End' })
    expect(app.wrapper.get('[data-formula-symbol-category="layout"]').attributes('aria-selected')).toBe('true')
  })

  it.each(['aligned', 'gathered'] as const)('wraps the complete source verbatim with %s despite a partial selection', async kind => {
    const body = '  x+y\r\n+z  '
    const app = picker(body)
    await app.select(2, 5)
    await app.layout()
    await app.tool(kind).trigger('click')
    const expected = wrap(kind, body)
    expect(app.value.value).toBe(expected)
    expect(app.mode.value).toBe('block')
    expect(document.activeElement).toBe(app.input().element)
    const caret = domLength(`\\begin{${kind}}\n${body}`)
    expect(app.input().element.selectionStart).toBe(caret)
    await app.wrapper.get('[data-formula-symbol-category="greek"]').trigger('click')
    await app.wrapper.get('[data-formula-symbol="alpha"]').trigger('click')
    expect(app.value.value).toBe(wrap(kind, `${body}\\alpha `))
    expect(app.input().element.selectionStart).toBe(caret + 7)
  })

  it.each(['aligned', 'gathered'] as const)('creates a valid two-line %s example for whitespace-only source', async kind => {
    const app = picker(' \r\n\t ')
    await app.layout()
    await app.tool(kind).trigger('click')
    const body = kind === 'aligned'
      ? String.raw`a + b + c &= d \\` + '\n' + 'x &= y'
      : String.raw`a + b + c = d \\` + '\n' + 'x = y'
    expect(app.value.value).toBe(wrap(kind, body))
    expect(app.mode.value).toBe('block')
    expect(app.value.value).toContain(`\\begin{${kind}}\n`)
    expect(app.value.value).toContain('\\\\\n')
    expect(app.wrapper.get('[data-preview-state]').attributes('data-preview-state')).toBe('ready')
    expect(app.wrapper.find('[data-formula-live-preview] .mtable').exists()).toBe(true)
    expect(app.tool(kind).find('.mtable').exists()).toBe(true)
    expect(app.tool(kind).get('annotation').text()).toBe(app.value.value)
  })

  it('shows the template difference and explains disabled, partially enabled, and ready tools visibly', async () => {
    const app = picker()
    await app.layout()
    expect(app.tool('aligned').get('[data-formula-layout-caption]').text()).toBe('Align equals signs in columns.')
    expect(app.tool('gathered').get('[data-formula-layout-caption]').text()).toBe('Center each line independently.')
    expect(app.wrapper.get('[data-formula-layout-guidance]').text()).toContain('formula content below, outside the begin/end commands')
    expect(app.tool('newline').element.disabled).toBe(true)
    expect(app.tool('alignment').element.disabled).toBe(true)
    expect(app.tool('alignment').attributes('title')).toContain('These tools need a multiline formula.')
    expect(app.tool('alignment').attributes('title')).not.toContain('Line break is available.')
    await app.tool('aligned').trigger('click')
    expect(app.wrapper.get('[data-formula-layout-guidance]').text()).toBe('Line break and alignment point are available at the current caret or selection.')
    for (const id of ['newline', 'alignment']) {
      expect(app.tool(id).element.disabled).toBe(false)
      expect(app.tool(id).attributes('aria-describedby')).toBe('formula-layout-guidance')
    }
    await app.tool('gathered').trigger('click')
    expect(app.wrapper.get('[data-formula-layout-guidance]').text()).toBe('Line break is available. Choose Aligned lines to use an alignment point.')
    expect(app.tool('newline').element.disabled).toBe(false)
    expect(app.tool('alignment').element.disabled).toBe(true)
    expect(app.tool('alignment').attributes('title')).toContain('Line break is available.')
  })

  it('does not nest the same complete outer environment and keeps opposite-environment content', async () => {
    const original = ` \r\n${wrap('aligned', 'a &= b')}\t `
    const app = picker(original)
    await app.layout()
    await app.tool('aligned').trigger('click')
    expect(app.value.value).toBe(original)
    expect(app.input().element.selectionStart).toBe(domLength(original.slice(0, original.indexOf('\n\\end'))))
    await app.tool('gathered').trigger('click')
    expect(app.value.value).toBe(wrap('gathered', original))
    expect(app.wrapper.get('[data-preview-state]').attributes('data-preview-state')).toBe('ready')
  })

  it('keeps invalid inner source editable when wrapping', async () => {
    const app = picker(String.raw`\unknown{x}`)
    await app.layout()
    await app.tool('aligned').trigger('click')
    expect(app.value.value).toBe(wrap('aligned', String.raw`\unknown{x}`))
    expect(app.mode.value).toBe('block')
    expect(document.activeElement).toBe(app.input().element)
  })

  it('allows a new line at the outer body boundary immediately after a complete inner environment', async () => {
    const original = wrap('aligned', 'x+y')
    const app = picker(original)
    await app.layout()
    await app.tool('gathered').trigger('click')
    expect(app.input().element.selectionStart).toBe(`\\begin{gathered}\n${original}`.length)
    expect(app.tool('newline').element.disabled).toBe(false)
    expect(app.tool('alignment').element.disabled).toBe(true)
    await app.tool('newline').trigger('click')
    expect(app.value.value).toBe(wrap('gathered', `${original}\\\\\n`))
  })

  it('inserts literal line breaks or alignment points at the remembered selection and continues with symbols', async () => {
    const original = wrap('aligned', 'abXYZcd')
    const app = picker(original)
    const start = original.indexOf('XYZ')
    await app.select(start, start + 3)
    await app.layout()
    expect(app.tool('newline').element.disabled).toBe(false)
    expect(app.tool('alignment').element.disabled).toBe(false)
    expect(app.tool('newline').find('.katex').exists()).toBe(false)
    expect(app.tool('newline').get('code').text()).toContain('\\\\')
    await app.tool('newline').trigger('click')
    expect(app.value.value).toBe(wrap('aligned', 'ab\\\\\ncd'))
    expect(app.input().element.selectionStart).toBe(start + 3)
    expect(app.mode.value).toBe('inline')
    await app.tool('alignment').trigger('click')
    expect(app.value.value).toBe(wrap('aligned', 'ab\\\\\n&cd'))
    await app.wrapper.get('[data-formula-symbol-category="greek"]').trigger('click')
    await app.wrapper.get('[data-formula-symbol="beta"]').trigger('click')
    expect(app.value.value).toBe(wrap('aligned', 'ab\\\\\n&\\beta cd'))
    expect(app.input().element.selectionStart).toBe(start + 10)
  })

  it('allows newline in gathered while disabling alignment points with useful guidance', async () => {
    const source = wrap('gathered', 'x+y')
    const app = picker(source)
    await app.select(source.indexOf('x+y') + 1)
    await app.layout()
    expect(app.tool('newline').element.disabled).toBe(false)
    expect(app.tool('alignment').element.disabled).toBe(true)
    expect(app.wrapper.get('[data-formula-layout-guidance]').text()).toContain('Choose Aligned lines')
    app.tool('alignment').element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(app.value.value).toBe(source)
  })

  it.each([
    ['plain', 'x+y', 1, 1],
    ['incomplete', '\\begin{aligned}\nx+y', 17, 17],
    ['header', wrap('aligned', 'x+y'), 2, 2],
    ['closing', wrap('aligned', 'x+y'), 23, 23],
    ['crossing body boundary', wrap('aligned', 'x+y'), 1, 19],
  ] as const)('guards raw actions outside a complete body: %s', async (_name, source, from, to) => {
    const app = picker(source)
    await app.select(from, to)
    await app.layout()
    expect(app.tool('newline').element.disabled).toBe(true)
    expect(app.tool('alignment').element.disabled).toBe(true)
    expect(app.wrapper.get('[data-formula-layout-guidance]').text()).toContain('Choose Aligned lines or Centered lines')
    app.tool('newline').element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(app.value.value).toBe(source)
  })

  it.each([
    ['gathered', 'aligned', false],
    ['aligned', 'gathered', true],
  ] as const)('uses the nearest complete environment inside %s(%s)', async (outer, inner, disabled) => {
    const source = wrap(outer, wrap(inner, 'x+y'))
    const app = picker(source)
    await app.select(source.indexOf('x+y') + 1)
    await app.layout()
    expect(app.tool('newline').element.disabled).toBe(false)
    expect(app.tool('alignment').element.disabled).toBe(disabled)
  })

  it.each(['inner begin', 'inner end', 'body into inner end', 'outer body into inner begin', 'inner end into outer body'] as const)(
    'guards raw insertion when a nested environment selection touches a label: %s', async position => {
      const source = wrap('aligned', `outer\n${wrap('gathered', 'x+y')}\ntail`)
      const begin = source.indexOf('\\begin{gathered}')
      const end = source.indexOf('\\end{gathered}')
      const ranges = {
        'inner begin': [begin + 5, begin + 5],
        'inner end': [end + 4, end + 4],
        'body into inner end': [source.indexOf('x+y'), end + 4],
        'outer body into inner begin': [source.indexOf('outer'), begin + 5],
        'inner end into outer body': [end + 4, source.indexOf('tail') + 2],
      } as const
      const app = picker(source)
      const [from, to] = ranges[position]
      await app.select(from, to)
      await app.layout()
      expect(app.tool('newline').element.disabled).toBe(true)
      expect(app.tool('alignment').element.disabled).toBe(true)
      expect(app.wrapper.get('[data-formula-layout-guidance]').text()).toContain('Choose Aligned lines or Centered lines')
      for (const tool of ['newline', 'alignment']) {
        app.tool(tool).element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await nextTick()
        expect(app.value.value).toBe(source)
      }
    },
  )

  it('preserves CRLF and maps the controlled DOM caret before subsequent symbol insertion', async () => {
    const original = '\\begin{aligned}\r\na &= b\\\\\r\nc &= d\r\n\\end{aligned}'
    const app = picker(original)
    const start = original.indexOf('c &') + 1
    await app.select(domLength(original.slice(0, start)))
    await app.layout()
    await app.tool('newline').trigger('click')
    const next = `${original.slice(0, start)}\\\\\n${original.slice(start)}`
    expect(app.value.value).toBe(next)
    expect(app.input().element.selectionStart).toBe(domLength(original.slice(0, start)) + 3)
    await app.wrapper.get('[data-formula-symbol-category="greek"]').trigger('click')
    await app.wrapper.get('[data-formula-symbol="alpha"]').trigger('click')
    expect(app.value.value).toBe(`${original.slice(0, start)}\\\\\n\\alpha ${original.slice(start)}`)
  })

  it('ignores commented closing tokens and requires a real closing layout environment', async () => {
    const source = '\\begin{aligned}\r\nx % fake \\end{aligned}\r\n+y\r\n\\end{aligned}'
    const app = picker(source)
    await app.select(domLength(source.slice(0, source.indexOf('+y') + 1)))
    await app.layout()
    expect(app.tool('alignment').element.disabled).toBe(false)
    await app.tool('alignment').trigger('click')
    expect(app.value.value).toBe(source.replace('+y', '+&y'))
    app.value.value = '\\begin{aligned}\nx % closing is commented \\end{aligned}'
    await nextTick()
    await app.select(17)
    expect(app.tool('newline').element.disabled).toBe(true)
  })

  it('reactively localizes all layout controls and keeps literal environment commands in tooltips', async () => {
    const app = picker('x')
    await app.layout()
    const translations = [
      ['zh', '换行与对齐', '多行对齐', '多行居中', '换行', '对齐点', '等号按列对齐', '每行分别居中', '当前光标或选区可使用换行和对齐点。'],
      ['en', 'Line breaks & alignment', 'Aligned lines', 'Centered lines', 'Line break', 'Alignment point', 'Align equals signs in columns.', 'Center each line independently.', 'Line break and alignment point are available at the current caret or selection.'],
      ['ru', 'Переносы и выравнивание', 'Выравнивание строк', 'Строки по центру', 'Перенос строки', 'Точка выравнивания', 'Знаки равенства по столбцам.', 'Каждая строка по центру.', 'В текущей позиции курсора или выделении доступны перенос строки и точка выравнивания.'],
    ] as const
    for (const [locale, category, aligned, gathered, newline, alignment, alignedCaption, gatheredCaption] of translations) {
      app.locale.value = locale
      await nextTick()
      expect(app.wrapper.get('[data-formula-symbol-category="layout"]').text()).toBe(category)
      for (const [id, label] of [['aligned', aligned], ['gathered', gathered], ['newline', newline], ['alignment', alignment]]) {
        expect(app.tool(id!).text()).toContain(label)
        expect(app.tool(id!).attributes('aria-label')).toContain(label)
      }
      expect(app.tool('aligned').attributes('title')).toContain(String.raw`\begin{aligned}…\end{aligned}`)
      expect(app.tool('gathered').attributes('title')).toContain(String.raw`\begin{gathered}…\end{gathered}`)
      expect(app.tool('newline').attributes('title')).toContain('\\\\')
      expect(app.tool('aligned').get('[data-formula-layout-caption]').text()).toBe(alignedCaption)
      expect(app.tool('gathered').get('[data-formula-layout-caption]').text()).toBe(gatheredCaption)
      expect(app.wrapper.get('[data-formula-layout-guidance]').text()).toContain('begin/end')
    }
    await app.tool('aligned').trigger('click')
    for (const [locale, , , , , , , , ready] of translations) {
      app.locale.value = locale
      await nextTick()
      expect(app.wrapper.get('[data-formula-layout-guidance]').text()).toBe(ready)
      expect(app.tool('newline').element.disabled).toBe(false)
      expect(app.tool('alignment').element.disabled).toBe(false)
    }
  })
})
