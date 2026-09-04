import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import { CODE_LANGUAGE_OPTIONS } from '../../src/codecs'
import CodeMirrorSourceEditorHost from '../../src/ui/CodeMirrorSourceEditorHost.vue'

function mountEditor(locale: 'en' | 'ru' | 'zh' = 'en') {
  const apply = vi.fn()
  const cancel = vi.fn()
  const wrapper = mount(CodeMirrorSourceEditorHost, {
    attachTo: document.body,
    props: {
      commandId: 'raw.source',
      inputId: 'raw-source-test',
      label: 'Exact Markdown source',
      locale,
      modelValue: '@@unknown@@',
      onApply: apply,
      onCancel: cancel,
      title: 'Unknown source',
    },
  })
  return { apply, cancel, wrapper }
}

describe('raw-node local CodeMirror 6 source editor', () => {
  it('replaces code-editor chrome and an open dirty-close confirmation when the locale changes', async () => {
    const { wrapper } = mountEditor('zh')
    await flushPromises()
    expect(wrapper.get('[role="dialog"]').text()).toContain('源码编辑器')
    expect(wrapper.get('h2').text()).toBe('Unknown source')
    expect(wrapper.text()).toContain('取消')
    expect(wrapper.text()).toContain('应用')

    const exposed = wrapper.vm as unknown as { setValue: (source: string) => void }
    exposed.setValue('changed')
    await nextTick()
    await wrapper.get('.dialog-backdrop').trigger('mousedown')
    expect(wrapper.get('[role="alertdialog"]').text()).toContain('放弃本地源码更改？')

    await wrapper.setProps({ locale: 'ru' })

    expect(wrapper.get('[role="dialog"]').text()).toContain('Редактор исходного кода')
    expect(wrapper.get('h2').text()).toBe('Unknown source')
    expect(wrapper.text()).toContain('Отмена')
    expect(wrapper.text()).toContain('Применить')
    expect(wrapper.get('[role="alertdialog"]').text()).toContain('Отменить изменения локального исходного кода?')
    wrapper.unmount()
  })

  it('mounts a real CodeMirror editor and emits one exact Apply', async () => {
    const { apply, wrapper } = mountEditor()
    await flushPromises()
    expect(wrapper.find('.cm-editor').exists()).toBe(true)
    expect(wrapper.find('textarea').exists()).toBe(false)
    const exposed = wrapper.vm as unknown as { setValue: (source: string) => void }
    exposed.setValue('**known**')
    await nextTick()
    await wrapper.get('.dialog-panel__actions .primary-action').trigger('click')
    await wrapper.get('.dialog-panel__actions .primary-action').trigger('click')
    expect(apply).toHaveBeenCalledOnce()
    expect(apply).toHaveBeenCalledWith('**known**')
    wrapper.unmount()
  })

  it('cancels a dirty draft without emitting Apply', async () => {
    const { apply, cancel, wrapper } = mountEditor()
    await flushPromises()
    const exposed = wrapper.vm as unknown as { setValue: (source: string) => void }
    exposed.setValue('@@still-unknown@@')
    await nextTick()
    await wrapper.get('.dialog-panel__actions button').trigger('click')
    expect(cancel).toHaveBeenCalledOnce()
    expect(apply).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('rejects a dirty backdrop close without emitting either action', async () => {
    const { apply, cancel, wrapper } = mountEditor()
    await flushPromises()
    const exposed = wrapper.vm as unknown as { setValue: (source: string) => void }
    exposed.setValue('changed')
    await nextTick()
    await wrapper.get('.dialog-backdrop').trigger('mousedown')
    expect(wrapper.get('[role="alertdialog"]').text()).toContain('Discard local source changes?')
    await wrapper.get('[role="alertdialog"] button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false)
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Exact Markdown source')
    expect(apply).not.toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('releases a pending Apply and restores editor focus when the parent reports a failure', async () => {
    const { apply, wrapper } = mountEditor()
    await flushPromises()
    await wrapper.get('.primary-action').trigger('click')
    await wrapper.get('.primary-action').trigger('click')
    expect(apply).toHaveBeenCalledOnce()
    expect(wrapper.get('.primary-action').attributes('disabled')).toBeDefined()

    await wrapper.setProps({ error: 'The dedicated-editor transaction was rejected. Review the draft and retry.' })
    await flushPromises()
    expect(wrapper.get('.primary-action').attributes('disabled')).toBeUndefined()
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Exact Markdown source')

    await wrapper.get('.primary-action').trigger('click')
    expect(apply).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('exposes a detached language selector for code source without embedding CodeMirror in the document', async () => {
    const apply = vi.fn()
    const wrapper = mount(CodeMirrorSourceEditorHost, {
      attachTo: document.body,
      props: {
        commandId: 'insert.code-block',
        inputId: 'code-source-test',
        label: 'Code source',
        locale: 'zh',
        languageInputId: 'code-language-test',
        languageLabel: 'Language',
        languageValue: 'typescript',
        modelValue: 'const value = 1',
        onApply: apply,
        sourceMode: 'code',
        title: 'Code block',
      },
    })
    await flushPromises()
    const editor = wrapper.get('.cm-editor').element
    expect(wrapper.get('h2').text()).toBe('代码块')
    expect(wrapper.get('.code-mirror-dialog').attributes('data-source-mode')).toBe('code')
    expect(wrapper.text()).toContain('语言')
    expect(wrapper.text()).toContain('源码')
    await wrapper.setProps({ locale: 'ru' })
    expect(wrapper.get('.cm-editor').element).toBe(editor)
    expect(wrapper.get('h2').text()).toBe('Блок кода')
    expect(wrapper.text()).toContain('Язык')
    expect(wrapper.text()).toContain('Исходный код')
    const language = wrapper.get('select#code-language-test')
    expect((language.element as HTMLSelectElement).value).toBe('typescript')
    expect(language.findAll('option').map((option) => option.attributes('value')))
      .toEqual(CODE_LANGUAGE_OPTIONS.map((option) => option.value))
    await wrapper.get('#code-language-test').setValue('javascript')
    const exposed = wrapper.vm as unknown as { setValue: (source: string) => void }
    exposed.setValue('const value = 2')
    await nextTick()
    await wrapper.get('.primary-action').trigger('click')
    expect(apply).toHaveBeenCalledWith('const value = 2', 'javascript')
    expect(wrapper.find('.cm-editor').exists()).toBe(true)
    wrapper.unmount()
  })

  it('uses Tab and Shift+Tab for code indentation while raw Markdown keeps normal focus navigation', async () => {
    const code = mount(CodeMirrorSourceEditorHost, {
      attachTo: document.body,
      props: {
        commandId: 'insert.code-block',
        inputId: 'tab-code-source',
        label: 'Code source',
        locale: 'en',
        languageValue: 'javascript',
        modelValue: 'first()\nsecond()',
        sourceMode: 'code',
        title: 'Code block',
      },
    })
    await flushPromises()
    const content = code.get('.cm-content').element
    const exposed = code.vm as unknown as { value: () => string }
    const tab = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Tab' })
    content.dispatchEvent(tab)
    await nextTick()
    expect(tab.defaultPrevented).toBe(true)
    expect(exposed.value()).toBe('  first()\nsecond()')

    const shiftTab = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Tab', shiftKey: true })
    content.dispatchEvent(shiftTab)
    await nextTick()
    expect(shiftTab.defaultPrevented).toBe(true)
    expect(exposed.value()).toBe('first()\nsecond()')
    code.unmount()

    const raw = mountEditor().wrapper
    await flushPromises()
    const rawContent = raw.get('.cm-content').element
    const rawTab = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Tab' })
    rawContent.dispatchEvent(rawTab)
    await nextTick()
    expect(rawTab.defaultPrevented).toBe(false)
    const rawExposed = raw.vm as unknown as { value: () => string }
    expect(rawExposed.value()).toBe('@@unknown@@')
    raw.unmount()
  })

  it('rehighlights the open CodeMirror surface when the selected language changes', async () => {
    const wrapper = mount(CodeMirrorSourceEditorHost, {
      attachTo: document.body,
      props: {
        commandId: 'insert.code-block',
        inputId: 'highlight-code-source',
        label: 'Code source',
        locale: 'en',
        languageInputId: 'highlight-code-language',
        languageValue: 'javascript',
        modelValue: "def greet(name):\n    print('Hello', name)",
        sourceMode: 'code',
        title: 'Code block',
      },
    })
    await flushPromises()
    expect(wrapper.find('.cm-content .hljs-keyword').exists()).toBe(false)

    await wrapper.get('#highlight-code-language').setValue('python')
    await nextTick()

    expect(wrapper.get('.cm-content .hljs-keyword').text()).toBe('def')
    expect(wrapper.get('.cm-content .hljs-built_in').text()).toBe('print')
    wrapper.unmount()
  })

  it('uses a reactive code-mode title override without replacing CodeMirror or author source', async () => {
    const apply = vi.fn()
    const source = 'flowchart TD\n  A-->B'
    const wrapper = mount(CodeMirrorSourceEditorHost, {
      attachTo: document.body,
      props: {
        commandId: 'mermaid.source',
        inputId: 'mermaid-source-test',
        label: 'Mermaid source',
        locale: 'zh',
        modelValue: source,
        onApply: apply,
        sourceMode: 'code',
        title: 'Fallback Mermaid title',
        titleOverride: 'Mermaid 流程图',
      },
    })
    await flushPromises()
    const editor = wrapper.get('.cm-editor').element
    const content = wrapper.get('.cm-content').element
    expect(wrapper.props('sourceMode')).toBe('code')
    expect(wrapper.get('h2').text()).toBe('Mermaid 流程图')
    expect(wrapper.get('label[for="mermaid-source-test"]').text()).toBe('源码')
    expect(wrapper.get('.cm-content').attributes('aria-label')).toBe('源码')

    await wrapper.setProps({ locale: 'ru', titleOverride: 'Mermaid Блок-схема' })

    expect(wrapper.get('.cm-editor').element).toBe(editor)
    expect(wrapper.get('.cm-content').element).toBe(content)
    expect(wrapper.get('h2').text()).toBe('Mermaid Блок-схема')
    expect(wrapper.get('label[for="mermaid-source-test"]').text()).toBe('Исходный код')
    expect(wrapper.get('.cm-content').attributes('aria-label')).toBe('Исходный код')
    const exposed = wrapper.vm as unknown as { value: () => string }
    expect(exposed.value()).toBe(source)
    await wrapper.get('.primary-action').trigger('click')
    expect(apply).toHaveBeenCalledOnce()
    expect(apply).toHaveBeenCalledWith(source)
    wrapper.unmount()
  })
})
