import { mount } from '@vue/test-utils'
import { markRaw } from 'vue'
import { describe, expect, it } from 'vitest'

import { DocumentSession, SynchronizationStateStore } from '../../src/core'
import SourceEditorSurface from '../../src/ui/SourceEditorSurface.vue'

describe('SourceEditorSurface localization', () => {
  it('updates declarative and application-owned source labels without replacing the editor content', async () => {
    const session = new DocumentSession({ documentId: 'localized-source', markdown: 'Alpha' })
    const wrapper = mount(SourceEditorSurface, {
      props: {
        locale: 'zh',
        session: markRaw(session),
        state: markRaw(new SynchronizationStateStore(session.snapshot())),
      },
    })
    const host = wrapper.get('.source-editor-host').element
    const content = document.createElement('div')
    content.className = 'cm-content'
    host.append(content)

    expect(wrapper.get('label[for="markdown-source-editor"]').text()).toBe('Markdown 源码')
    expect(wrapper.get('[role="toolbar"]').attributes('aria-label')).toBe('源码选择操作')
    expect(wrapper.get('[aria-keyshortcuts="Alt+Shift+Q"]').attributes('aria-label')).toBe('引用所选源码')
    expect(wrapper.get('[aria-keyshortcuts="Alt+Shift+Q"]').text()).toContain('引用')
    expect(wrapper.get('#markdown-source').attributes('aria-label')).toBe('Markdown 源码测试控件')

    await wrapper.setProps({ locale: 'ru' })

    expect(host.querySelector('.cm-content')).toBe(content)
    expect(content.getAttribute('aria-label')).toBe('Исходный Markdown')
    expect(wrapper.get('label[for="markdown-source-editor"]').text()).toBe('Исходный Markdown')
    expect(wrapper.get('[role="toolbar"]').attributes('aria-label')).toBe('Действия с выделением исходного текста')
    expect(wrapper.get('[aria-keyshortcuts="Alt+Shift+Q"]').attributes('aria-label')).toBe('Цитировать выделенный исходный текст')
    expect(wrapper.get('[aria-keyshortcuts="Alt+Shift+Q"]').text()).toContain('Цитата')
    expect(wrapper.get('#markdown-source').attributes('aria-label')).toBe('Тестовый элемент исходного Markdown')
  })

})
