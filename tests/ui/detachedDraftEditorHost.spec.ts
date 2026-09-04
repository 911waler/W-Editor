import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import { DocumentSession } from '../../src/core'
import DetachedDraftEditorHost from '../../src/ui/DetachedDraftEditorHost.vue'

function mountHarness(session: DocumentSession) {
  const apply = vi.fn((source: string) => {
    session.commitSource({ markdown: source, origin: 'cherry-source', transactionId: 'detached-draft:apply' })
  })
  const cancel = vi.fn()
  const Harness = defineComponent({
    components: { DetachedDraftEditorHost },
    setup: () => {
      const source = ref('Initial draft')
      const open = ref(true)
      return {
        apply: () => {
          apply(source.value)
          open.value = false
        },
        cancel: () => {
          cancel()
          open.value = false
        },
        open,
        source,
      }
    },
    template: `
      <DetachedDraftEditorHost
        v-if="open"
        v-model="source"
        command-id="test.semantic"
        input-id="test-draft-source"
        label="Draft source"
        locale="en"
        title="Detached draft"
        @apply="apply"
        @cancel="cancel"
      />
    `,
  })
  return { apply, cancel, wrapper: mount(Harness, { attachTo: document.body }) }
}

describe('common detached-draft editor host', () => {
  it('replaces detached-editor chrome and an open discard prompt when the locale changes', async () => {
    const wrapper = mount(DetachedDraftEditorHost, {
      attachTo: document.body,
      props: {
        commandId: 'test.semantic',
        inputId: 'localized-draft-source',
        label: 'Draft source',
        locale: 'zh',
        modelValue: 'Initial',
        title: 'Detached draft',
      },
    })
    expect(wrapper.get('[role="dialog"]').text()).toContain('语义编辑器')
    expect(wrapper.text()).toContain('取消')
    expect(wrapper.text()).toContain('应用')

    await wrapper.setProps({ modelValue: 'Changed' })
    await wrapper.get('.dialog-backdrop').trigger('mousedown')
    expect(wrapper.get('[role="alertdialog"]').text()).toContain('放弃未保存的草稿？')
    expect(wrapper.get('[role="alertdialog"]').text()).toContain('文档尚未更改')

    await wrapper.setProps({ locale: 'ru' })

    expect(wrapper.get('[role="dialog"]').text()).toContain('Семантический редактор')
    expect(wrapper.text()).toContain('Отмена')
    expect(wrapper.text()).toContain('Применить')
    expect(wrapper.get('[role="alertdialog"]').text()).toContain('Отменить несохранённый черновик?')
    expect(wrapper.get('[role="alertdialog"]').text()).toContain('Документ не изменён')
    wrapper.unmount()
  })

  it('releases a pending Apply and restores draft focus when the parent reports a failure', async () => {
    const apply = vi.fn()
    const wrapper = mount(DetachedDraftEditorHost, {
      attachTo: document.body,
      props: {
        commandId: 'test.semantic',
        inputId: 'failed-draft-source',
        label: 'Draft source',
        locale: 'zh',
        modelValue: 'Retained draft',
        onApply: apply,
        title: 'Detached draft',
      },
    })
    await flushPromises()
    await wrapper.get('.primary-action').trigger('click')
    await wrapper.get('.primary-action').trigger('click')
    expect(apply).toHaveBeenCalledOnce()
    expect(wrapper.get('.primary-action').attributes('disabled')).toBeDefined()

    await wrapper.setProps({ error: 'The document revision changed before Apply. Review the current content and retry.' })
    await flushPromises()
    expect(wrapper.get('.primary-action').attributes('disabled')).toBeUndefined()
    expect(document.activeElement).toBe(wrapper.get('#failed-draft-source').element)

    await wrapper.get('.primary-action').trigger('click')
    expect(apply).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('dispatches one Apply and therefore one document transaction', async () => {
    const session = new DocumentSession({ documentId: 'draft-apply', markdown: 'Original' })
    const subscriber = vi.fn()
    session.subscribe(subscriber)
    const { apply, wrapper } = mountHarness(session)
    await wrapper.get('#test-draft-source').setValue('Applied source')
    await wrapper.get('.dialog-panel__actions .primary-action').trigger('click')
    await flushPromises()
    expect(apply).toHaveBeenCalledOnce()
    expect(session.snapshot()).toEqual({ documentId: 'draft-apply', markdown: 'Applied source', revision: 1 })
    expect(subscriber).toHaveBeenCalledOnce()
    expect(wrapper.find('[data-picker-command="test.semantic"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('cancels a dirty draft without dispatching a document transaction', async () => {
    const session = new DocumentSession({ documentId: 'draft-cancel', markdown: 'Original' })
    const subscriber = vi.fn()
    session.subscribe(subscriber)
    const { apply, cancel, wrapper } = mountHarness(session)
    await wrapper.get('#test-draft-source').setValue('Dirty source')
    await wrapper.get('.dialog-panel__actions button').trigger('click')
    await flushPromises()
    expect(cancel).toHaveBeenCalledOnce()
    expect(apply).not.toHaveBeenCalled()
    expect(session.snapshot()).toEqual({ documentId: 'draft-cancel', markdown: 'Original', revision: 0 })
    expect(subscriber).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('keeps a dirty draft open when close is rejected and dispatches nothing', async () => {
    const session = new DocumentSession({ documentId: 'draft-reject-close', markdown: 'Original' })
    const { apply, cancel, wrapper } = mountHarness(session)
    await wrapper.get('#test-draft-source').setValue('Still editing')
    await wrapper.get('.dialog-backdrop').trigger('mousedown')
    await flushPromises()
    const confirmation = wrapper.get('[role="alertdialog"]')
    expect(confirmation.text()).toContain('Discard unsaved draft?')
    await confirmation.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false)
    expect((wrapper.get('#test-draft-source').element as HTMLTextAreaElement).value).toBe('Still editing')
    expect(apply).not.toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
    expect(session.snapshot()).toEqual({ documentId: 'draft-reject-close', markdown: 'Original', revision: 0 })
    wrapper.unmount()
  })
})
