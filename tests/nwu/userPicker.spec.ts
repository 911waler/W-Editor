import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import UserPickerDialog from '../../src/ui/UserPickerDialog.vue'

describe('grant user picker', () => {
  it('keeps selections across filtering and only applies them on confirmation', async () => {
    HTMLDialogElement.prototype.showModal = vi.fn()
    HTMLDialogElement.prototype.close = vi.fn()
    const wrapper = mount(UserPickerDialog, {props: {title:'选择可编辑用户', users:[{id:1,username:'张三'},{id:2,username:'李四'}], selected:[1]}})
    await wrapper.get('input[type="search"]').setValue('李')
    await wrapper.get('input[type="checkbox"]').setValue(true)
    expect(wrapper.emitted('confirm')).toBeUndefined()
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('confirm')?.[0]).toEqual([[1,2]])
    wrapper.unmount()
  })
  it('cancels without changing grants', async () => {
    const wrapper = mount(UserPickerDialog, {props: {title:'选择用户', users:[], selected:[]}})
    await wrapper.get('button[type="button"]').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('confirm')).toBeUndefined()
    wrapper.unmount()
  })
})
