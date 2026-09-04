import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SafePreviewHtml from '../../packages/editor-vue/src/ui/SafePreviewHtml.vue'

const code = '<pre><code class="language-javascript">const value = 1</code></pre>'

describe('Renderer instance isolation', () => {
  it('allows one author preview and multiple readers to coexist and destroy independently', async () => {
    const reader = mount(SafePreviewHtml, { props: { html: code, locale: 'en', profile: 'reader' } })
    const author = mount(SafePreviewHtml, { props: { html: code, locale: 'en', profile: 'author-preview' } })
    await flushPromises()

    expect(reader.find('[data-renderer-profile="reader"]').attributes('contenteditable')).toBe('false')
    expect(reader.find('[data-w-editor-action="edit-code"]').exists()).toBe(false)
    expect(author.find('[data-w-editor-action="edit-code"]').exists()).toBe(true)
    expect(reader.findAll('[data-w-editor-action="copy-code"]')).toHaveLength(1)
    expect(author.findAll('[data-w-editor-action="copy-code"]')).toHaveLength(1)

    author.unmount()
    expect(reader.findAll('[data-w-editor-action="copy-code"]')).toHaveLength(1)
    reader.unmount()
  })
})
