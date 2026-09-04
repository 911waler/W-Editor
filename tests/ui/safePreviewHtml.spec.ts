import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SafePreviewHtml from '../../src/ui/SafePreviewHtml.vue'

describe('SafePreviewHtml Cherry structure', () => {
  it('keeps Cherry theme scope separate from the Markdown document flow', async () => {
    const wrapper = mount(SafePreviewHtml, {
      props: {
        html: '<h1>一级标题</h1><p>正文</p>',
        locale: 'zh',
      },
    })
    await flushPromises()

    const theme = wrapper.get('.preview-rendered-theme')
    const content = wrapper.get('.preview-rendered-content')
    expect(theme.classes()).toEqual(expect.arrayContaining(['cherry', 'theme__default']))
    expect(content.classes()).toContain('cherry-markdown')
    expect(content.classes()).not.toContain('cherry')
    expect(content.element.parentElement).toBe(theme.element)
    expect(content.get('h1').text()).toBe('一级标题')
    expect(content.get('p').text()).toBe('正文')

    await wrapper.setProps({ theme: 'abyss' })
    expect(theme.classes()).toContain('theme__abyss')
    expect(theme.classes()).not.toContain('theme__default')
  })
})

describe('SafePreviewHtml code controls', () => {
  it('hydrates icon actions, a 12-line fold, and live localized labels in place', async () => {
    const code = Array.from({ length: 16 }, (_, index) => `const line${index + 1} = ${index + 1}`).join('\n')
    const wrapper = mount(SafePreviewHtml, {
      props: {
        html: `<pre><code class="language-typescript">${code}</code></pre>`,
        locale: 'zh',
      },
    })
    await flushPromises()

    const codeElement = wrapper.get('code').element
    const copy = wrapper.get('[data-w-editor-action="copy-code"]')
    const edit = wrapper.get('[data-w-editor-action="edit-code"]')
    const collapse = wrapper.get('[data-w-editor-action="collapse-code"]')
    const expand = wrapper.get('[data-w-editor-action="expand-code"]')
    expect(wrapper.get('[data-w-editor-node="code-block"]').attributes('data-code-lines')).toBe('16')
    expect(wrapper.get('[data-w-editor-node="code-block"]').attributes('data-folded')).toBe('true')
    expect(wrapper.get('[role="toolbar"]').attributes('aria-label')).toBe('代码块操作')
    expect(copy.text()).toBe('')
    expect(copy.find('.ch-icon-copy').exists()).toBe(true)
    expect(copy.attributes('aria-label')).toBe('复制代码')
    expect(edit.text()).toBe('')
    expect(edit.find('.ch-icon-edit').exists()).toBe(true)
    expect(edit.attributes('aria-label')).toBe('编辑代码')
    expect((collapse.element as HTMLButtonElement).hidden).toBe(true)
    expect(expand.attributes('aria-label')).toBe('展开代码')

    await edit.trigger('click')
    expect(wrapper.emitted('codeEdit')).toEqual([[0]])
    await expand.trigger('click')
    expect(wrapper.get('[data-w-editor-node="code-block"]').attributes('data-folded')).toBe('false')
    expect(collapse.attributes('aria-label')).toBe('折叠代码')

    await wrapper.setProps({ locale: 'ru' })
    expect(wrapper.get('code').element).toBe(codeElement)
    expect(wrapper.get('[role="toolbar"]').attributes('aria-label')).toBe('Действия с блоком кода')
    expect(copy.attributes('aria-label')).toBe('Копировать код')
    expect(edit.attributes('aria-label')).toBe('Редактировать код')
    expect(collapse.attributes('aria-label')).toBe('Свернуть код')
  })
})

describe('SafePreviewHtml task controls', () => {
  const taskHtml = '<ul><li class="check-list-item" data-w-editor-task-index="0"><p><span class="ch-icon ch-icon-square"></span> Parent</p></li><li class="check-list-item" data-w-editor-task-index="1"><p><span class="ch-icon ch-icon-check"></span> Done</p></li></ul>'

  it('hydrates author-preview icons as accessible task toggles', async () => {
    const wrapper = mount(SafePreviewHtml, { props: { html: taskHtml, locale: 'en' } })
    await flushPromises()

    const tasks = wrapper.findAll('input[type="checkbox"][data-w-editor-task-index]')
    expect(tasks).toHaveLength(2)
    expect(tasks[0]?.attributes('aria-label')).toBe('Task item checkbox for Parent')
    expect((tasks[0]?.element as HTMLInputElement).checked).toBe(false)
    expect((tasks[1]?.element as HTMLInputElement).checked).toBe(true)
    await tasks[0]?.setValue(true)
    expect(wrapper.emitted('taskToggle')).toEqual([[{ checked: true, index: 0 }]])
  })

  it('keeps reader tasks semantic and non-interactive', async () => {
    const wrapper = mount(SafePreviewHtml, { props: { html: taskHtml, locale: 'en', profile: 'reader' } })
    await flushPromises()

    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
    const indicators = wrapper.findAll('[data-w-editor-task-state]')
    expect(indicators).toHaveLength(2)
    expect(indicators[0]?.attributes('aria-label')).toBe('Incomplete task: Parent')
    expect(indicators[1]?.attributes('aria-label')).toBe('Completed task: Done')
  })

  it('does not turn an unbound author HTML lookalike into a document mutation control', async () => {
    const wrapper = mount(SafePreviewHtml, {
      props: {
        html: '<li class="check-list-item"><p><span class="ch-icon ch-icon-square"></span> Lookalike</p></li>',
        locale: 'en',
      },
    })
    await flushPromises()
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
    expect(wrapper.emitted('taskToggle')).toBeUndefined()
  })
})
