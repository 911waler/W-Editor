import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MarkdownImportZone from '../../apps/playground/src/MarkdownImportZone.vue'

const props = { label:'导入 Markdown', hint:'拖入 Markdown 文件，或', chooseLabel:'选择文件' }
describe('Markdown import drop zone', () => {
  it('highlights file drags, emits files and prevents browser navigation', async () => {
    const wrapper = mount(MarkdownImportZone, {props})
    const file = new File(['# hello'], 'hello.md')
    await wrapper.trigger('dragenter', {dataTransfer:{types:['Files']}})
    expect(wrapper.classes()).toContain('is-dragging')
    await wrapper.trigger('dragenter', {dataTransfer:{types:['Files']}})
    await wrapper.trigger('dragleave', {dataTransfer:{types:['Files']}})
    expect(wrapper.classes()).toContain('is-dragging')
    const event = new Event('drop', {bubbles:true,cancelable:true})
    Object.defineProperty(event,'dataTransfer',{value:{types:['Files'],files:[file]}})
    wrapper.element.dispatchEvent(event)
    await wrapper.vm.$nextTick()
    expect(event.defaultPrevented).toBe(true)
    expect(wrapper.emitted('files')?.[0]?.[0]).toEqual([file])
    expect(wrapper.classes()).not.toContain('is-dragging')
    wrapper.unmount()
  })
  it('keeps the chooser accessible and rejects new drops while busy', async () => {
    const wrapper = mount(MarkdownImportZone, {props})
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('choose')).toHaveLength(1)
    await wrapper.setProps({disabled:true})
    await wrapper.trigger('drop',{dataTransfer:{types:['Files'],files:[new File(['x'],'x.md')]}})
    expect(wrapper.emitted('files')).toBeUndefined()
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
})
