import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'

import FormulaPicker from '../../src/ui/FormulaPicker.vue'

const wrappers: VueWrapper[] = []

function clipboardPaste(text?: string): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  if (text !== undefined) Object.defineProperty(event, 'clipboardData', { value: {
    getData: (format: string) => format === 'text/plain' ? text : '',
  } })
  return event
}

function picker(source = '', initialMode: 'inline' | 'block' = 'inline') {
  const value = ref(source)
  const mode = ref(initialMode)
  const wrapper = mount(defineComponent({
    setup: () => () => h(FormulaPicker, {
      modelValue: value.value, mode: mode.value, locale: 'en', storage: null,
      'onUpdate:modelValue': (updated: string) => { value.value = updated },
      'onUpdate:mode': (updated: 'inline' | 'block') => { mode.value = updated },
    }),
  }), { attachTo: document.body })
  wrappers.push(wrapper)
  const input = wrapper.get<HTMLTextAreaElement>('#formula-source')
  const select = async (start: number, end = start) => {
    input.element.focus()
    input.element.setSelectionRange(start, end)
    await input.trigger('select')
  }
  const paste = async (text?: string) => {
    const event = clipboardPaste(text)
    input.element.dispatchEvent(event)
    await nextTick()
    return event
  }
  return { wrapper, value, mode, input, select, paste }
}

afterEach(() => {
  while (wrappers.length > 0) wrappers.pop()?.unmount()
  document.body.replaceChildren()
})

describe('formula dialog external delimiter paste', () => {
  it.each([
    { clipboard: String.raw`\(x+y\)`, body: 'x+y', mode: 'inline' },
    { clipboard: String.raw`\[x+y\]`, body: 'x+y', mode: 'block' },
    { clipboard: '$x+y$', body: 'x+y', mode: 'inline' },
    { clipboard: '$$x+y$$', body: 'x+y', mode: 'block' },
    { clipboard: ' \t$$\n  x+y \n$$\r\n', body: 'x+y', mode: 'block' },
    { clipboard: String.raw`\(\text{cost \$5}\)`, body: String.raw`\text{cost \$5}`, mode: 'inline' },
    { clipboard: String.raw`$x\\$`, body: String.raw`x\\`, mode: 'inline' },
    { clipboard: String.raw`\(\text{literal \\)}+x\)`, body: String.raw`\text{literal \\)}+x`, mode: 'inline' },
    { clipboard: String.raw`\(x\\\)`, body: String.raw`x\\`, mode: 'inline' },
    { clipboard: String.raw`\[x\%+1\]`, body: String.raw`x\%+1`, mode: 'block' },
  ] as const)('unwraps a complete $mode payload: $clipboard', async ({ clipboard, body, mode }) => {
    const app = picker('old draft', mode === 'inline' ? 'block' : 'inline')
    await app.select(0, 9)
    const event = await app.paste(clipboard)

    expect(event.defaultPrevented).toBe(true)
    expect(app.value.value).toBe(body)
    expect(app.mode.value).toBe(mode)
    expect(app.input.element.value).toBe(body)
    expect(document.activeElement).toBe(app.input.element)
    expect(app.input.element.selectionStart).toBe(body.length)
    expect(app.input.element.selectionEnd).toBe(body.length)
  })

  it('preserves internal CRLF, row breaks and comments, then inserts a symbol at the actual DOM caret', async () => {
    const body = '\\begin{aligned}\r\na&=b\\\\\r\nc&=d % keep this comment\r\n\\end{aligned}'
    const app = picker()
    const event = await app.paste(` \r\n$$\r\n ${body}\r\n$$\t `)
    expect(event.defaultPrevented).toBe(true)
    expect(app.value.value).toBe(body)
    expect(app.mode.value).toBe('block')
    expect(app.input.element.selectionStart).toBe(app.input.element.value.length)
    await app.wrapper.get('[data-formula-section="special-symbols"]').trigger('click')
    await app.wrapper.get('[data-formula-symbol-category="greek"]').trigger('click')
    await app.wrapper.get('[data-formula-symbol="alpha"]').trigger('click')
    await nextTick()
    expect(app.value.value).toBe(`${body}\\alpha `)
    expect(app.input.element.selectionStart).toBe(app.input.element.value.length)
    expect(document.activeElement).toBe(app.input.element)
  })

  it('ignores delimiter-looking text inside comments while preserving it verbatim', async () => {
    const app = picker()
    const body = 'x % fake \\] and $$ remain a comment\r\n+y'
    const event = await app.paste(`\\[${body}\\]`)
    expect(event.defaultPrevented).toBe(true)
    expect(app.value.value).toBe(body)
    expect(app.mode.value).toBe('block')
  })

  it('preserves unselected CRLF text when replacing a DOM selection and inserting another symbol', async () => {
    const app = picker('a\r\nXYZ\r\nb')
    await app.select(2, 5)
    expect((await app.paste(String.raw`\(x\)`)).defaultPrevented).toBe(true)
    expect(app.value.value).toBe('a\r\nx\r\nb')
    expect(app.input.element.selectionStart).toBe(3)
    await app.wrapper.get('[data-formula-section="special-symbols"]').trigger('click')
    await app.wrapper.get('[data-formula-symbol-category="greek"]').trigger('click')
    await app.wrapper.get('[data-formula-symbol="alpha"]').trigger('click')
    expect(app.value.value).toBe('a\r\nx\\alpha \r\nb')
  })

  it('unwraps valid outer delimiters even when the inner LaTeX preview is invalid', async () => {
    const app = picker()
    const event = await app.paste(String.raw`\[\unknowncommand{\]`)
    expect(event.defaultPrevented).toBe(true)
    expect(app.value.value).toBe(String.raw`\unknowncommand{`)
    expect(app.mode.value).toBe('block')
    expect(app.wrapper.get('[data-formula-live-preview] [data-preview-state]').attributes('data-preview-state')).toBe('error')
  })

  it('replaces only the selected draft range, switches mode, and preserves the next symbol insertion point', async () => {
    const app = picker('abXYZcd')
    await app.select(2, 5)
    expect((await app.paste(String.raw`\[x+y\]`)).defaultPrevented).toBe(true)
    expect(app.value.value).toBe('abx+ycd')
    expect(app.mode.value).toBe('block')
    expect(app.input.element.selectionStart).toBe(5)
    await app.wrapper.get('[data-formula-section="special-symbols"]').trigger('click')
    await app.wrapper.get('[data-formula-symbol-category="greek"]').trigger('click')
    await app.wrapper.get('[data-formula-symbol="alpha"]').trigger('click')
    expect(app.value.value).toBe('abx+y\\alpha cd')
  })

  it('keeps the textarea unwrapped when the normalized content is unchanged and resets pending Apply', async () => {
    const app = picker('x+y')
    await app.wrapper.get('.primary-action').trigger('click')
    expect(app.wrapper.get<HTMLButtonElement>('.primary-action').element.disabled).toBe(true)
    await app.select(0, 3)
    expect((await app.paste('$$ x+y $$')).defaultPrevented).toBe(true)
    expect(app.value.value).toBe('x+y')
    expect(app.input.element.value).toBe('x+y')
    expect(app.mode.value).toBe('block')
    expect(app.wrapper.get<HTMLButtonElement>('.primary-action').element.disabled).toBe(false)
  })

  it.each([
    '', 'x+y', 'Before $x$ after', '$x', '$x$$', '$$x$', '$$$x$$$', '$$', '$ $', '$$\n \n$$',
    String.raw`\(\)`, String.raw`\[ \]`, String.raw`\(x\]`, String.raw`\[x\)`, '$a$ $b$', '$$a$$$$b$$',
    String.raw`\(a\)\(b\)`, String.raw`\[a\] and \[b\]`, String.raw`\$x\$`, String.raw`$x\$`, String.raw`\(x\\)`,
    String.raw`\(a\(b\)\)`, String.raw`\[a\[b\]\]`,
    '$$x % closing delimiter is commented out $$',
  ])('leaves native paste unchanged for incomplete, ambiguous or unwrapped payloads: %j', async clipboard => {
    const app = picker('draft', 'block')
    await app.select(1, 3)
    expect((await app.paste(clipboard)).defaultPrevented).toBe(false)
    expect(app.value.value).toBe('draft')
    expect(app.mode.value).toBe('block')
  })

  it('leaves ordinary typing, composition and missing clipboard data untouched', async () => {
    const app = picker()
    await app.input.setValue('$$')
    expect(app.value.value).toBe('$$')
    expect(app.mode.value).toBe('inline')
    app.input.element.value = String.raw`\[x+y\]`
    app.input.element.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }))
    await nextTick()
    expect(app.value.value).toBe(String.raw`\[x+y\]`)
    expect(app.mode.value).toBe('inline')
    expect((await app.paste()).defaultPrevented).toBe(false)
    expect(app.value.value).toBe(String.raw`\[x+y\]`)
  })
})
