import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { MockUploadAdapter } from '../../src/adapters'
import App from '../../src/ui/App.vue'

const BASELINE = '# Upload baseline'

function seedRevisionSeven(): void {
  window.localStorage.setItem('w-editor:v1:document:welcome', JSON.stringify({
    autosave: { markdown: BASELINE, revision: 7, savedAt: '2026-01-15T12:00:00.000Z' },
    documentId: 'welcome',
    manualCheckpoint: null,
    preDestructiveReplace: null,
    preModeSwitch: null,
    schemaVersion: 1,
    status: { lastPersistenceFailure: null },
  }))
}

async function chooseFile(wrapper: ReturnType<typeof mount>, kind: 'image' | 'video'): Promise<void> {
  const input = wrapper.get<HTMLInputElement>(`#media-file-${kind}`)
  Object.defineProperty(input.element, 'files', {
    configurable: true,
    value: [new File(['selected binary'], `local.${kind}`, { type: `${kind}/*` })],
  })
  await input.trigger('change')
}

async function assertNoRevisionOrStorageResidue(wrapper: ReturnType<typeof mount>): Promise<void> {
  await wrapper.get('[data-command-id="mode.visual"]').trigger('click')
  await flushPromises()
  const stored = JSON.parse(window.localStorage.getItem('w-editor:v1:document:welcome') ?? 'null') as {
    autosave: { markdown: string; revision: number }
    preModeSwitch: { markdown: string; revision: number }
  }
  expect(stored.autosave).toMatchObject({ markdown: BASELINE, revision: 7 })
  expect(stored.preModeSwitch).toMatchObject({ markdown: BASELINE, revision: 7 })
  expect(wrapper.find('[data-semantic-kind="media"], [data-semantic-kind="attachment"]').exists()).toBe(false)
  const serialized = JSON.stringify(stored)
  expect(serialized).not.toMatch(/blob:|data:(?:image|audio|video)|selected binary|Blob/u)
}

describe('upload failure and cancellation leave no document residue', () => {
  it('keeps revision 7 and creates no node or binary storage after an injected failure', async () => {
    seedRevisionSeven()
    const wrapper = mount(App, {
      attachTo: document.body,
      props: { uploadAdapter: new MockUploadAdapter({ failureKinds: ['image'] }) },
    })
    await wrapper.get('[data-toolbar-menu="insert"] .toolbar-menu__trigger').trigger('click')
    await wrapper.get('[data-command-id="insert.image"]').trigger('click')
    await chooseFile(wrapper, 'image')
    await vi.waitFor(() => expect(wrapper.get('[data-editor-command="insert.image"] [role="alert"]').text()).toContain('failure'))
    await wrapper.get('[data-command-id="mode.source"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('#markdown-source').element).toHaveProperty('value', BASELINE)
    await wrapper.get('[data-editor-command="insert.image"] button:not(.primary-action)').trigger('click')
    await assertNoRevisionOrStorageResidue(wrapper)
    wrapper.unmount()
  })

  it('aborts an in-flight upload on Cancel and retains no partial result', async () => {
    seedRevisionSeven()
    const wrapper = mount(App, {
      attachTo: document.body,
      props: { uploadAdapter: new MockUploadAdapter({ delayMs: 10_000 }) },
    })
    await wrapper.get('[data-toolbar-menu="insert"] .toolbar-menu__trigger').trigger('click')
    await wrapper.get('[data-command-id="insert.video"]').trigger('click')
    await chooseFile(wrapper, 'video')
    expect(wrapper.get('[data-editor-command="insert.video"] [role="status"]').text()).toBe('正在通过已配置的适配器上传…')
    await wrapper.get('[data-editor-command="insert.video"] button:not(.primary-action)').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-editor-command="insert.video"]').exists()).toBe(false)
    await wrapper.get('[data-command-id="mode.source"]').trigger('click')
    await flushPromises()
    await assertNoRevisionOrStorageResidue(wrapper)
    wrapper.unmount()
  })
})
