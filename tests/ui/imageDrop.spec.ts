import { flushPromises, mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import PlaygroundApp from '../../apps/playground/src/PlaygroundApp.vue'
import type { UploadAdapter, UploadedAsset, UploadRequest } from '../../src/adapters'

const baseline = 'Before After'
function asset(name = 'one'): UploadedAsset {
  return {name, url: `https://assets.example.test/${name}.png`, mediaType: 'image/png', size: 4}
}
function drop(files: File[], types = ['Files']) {
  const event = new Event('drop', {bubbles: true, cancelable: true})
  Object.defineProperty(event, 'dataTransfer', {value: {files, types}})
  return event
}
const png = (name: string) => new File(['png'], `${name}.png`, {type: 'image/png'})
async function editor(uploadAdapter: UploadAdapter, readonlyMode = false) {
  const app = mount(PlaygroundApp, {attachTo: document.body, props: {
    uploadAdapter, readonlyMode,
    articleCatalog: [
      {documentId: 'image-drop-a', title: 'A', initialMarkdown: baseline},
      {documentId: 'image-drop-b', title: 'B', initialMarkdown: baseline},
    ],
  }})
  await flushPromises()
  await app.get('[data-command-id="mode.source"]').trigger('click')
  await flushPromises()
  app.get<HTMLTextAreaElement>('#markdown-source').element.setSelectionRange(7, 7)
  return app
}

it('uploads a batch and inserts its image URLs at the drop caret in order', async () => {
  let count = 0
  const app = await editor({upload: async () => asset(++count === 1 ? 'one' : 'two')})
  try {
    const event = drop([png('one'), png('two')])
    app.get('[data-testid="editor-surface"]').element.dispatchEvent(event)
    await flushPromises()
    expect(event.defaultPrevented).toBe(true)
    expect(app.get<HTMLTextAreaElement>('#markdown-source').element.value)
      .toBe('Before ![one](https://assets.example.test/one.png)![two](https://assets.example.test/two.png)After')
    expect(app.find('[data-testid="image-drop-status"]').exists()).toBe(false)
  } finally { app.unmount() }
})

it('leaves the document intact when a later image upload fails', async () => {
  let count = 0
  const app = await editor({upload: async () => {
    if (++count === 2) throw new Error('Synthetic upload failed')
    return asset()
  }})
  try {
    app.get('[data-testid="editor-surface"]').element.dispatchEvent(drop([png('one'), png('two')]))
    await flushPromises()
    expect(app.find('[data-testid="image-drop-error"]').exists()).toBe(true)
    expect(app.get<HTMLTextAreaElement>('#markdown-source').element.value).toBe(baseline)
    expect(app.find('[data-testid="image-drop-status"]').exists()).toBe(false)
  } finally { app.unmount() }
})

it('ignores a late upload result after cancellation', async () => {
  let finish!: (value: UploadedAsset) => void
  let request: UploadRequest | undefined
  const app = await editor({upload: input => {
    request = input
    return new Promise(resolve => { finish = resolve })
  }})
  try {
    app.get('[data-testid="editor-surface"]').element.dispatchEvent(drop([png('one')]))
    await flushPromises()
    await app.get('[data-testid="image-drop-cancel"]').trigger('click')
    expect(request?.signal?.aborted).toBe(true)
    finish(asset())
    await flushPromises()
    expect(app.get<HTMLTextAreaElement>('#markdown-source').element.value).toBe(baseline)
    expect(app.find('[data-testid="image-drop-status"]').exists()).toBe(false)
    expect(app.find('[data-testid="image-drop-error"]').exists()).toBe(false)
  } finally { app.unmount() }
})

it('rejects a late result when the document changed during upload', async () => {
  let finish!: (value: UploadedAsset) => void
  const app = await editor({upload: () => new Promise(resolve => { finish = resolve })})
  try {
    app.get('[data-testid="editor-surface"]').element.dispatchEvent(drop([png('one')]))
    await flushPromises()
    // Simulate an external update despite the upload overlay blocking local input.
    await app.get('#markdown-source').setValue('Newer external content')
    finish(asset())
    await flushPromises()
    expect(app.get<HTMLTextAreaElement>('#markdown-source').element.value).toBe('Newer external content')
    expect(app.get('[data-testid="image-drop-error"]').text()).toContain('已变化')
  } finally { app.unmount() }
})

it('aborts when unmounted and ignores an adapter that resolves after abort', async () => {
  let finish!: (value: UploadedAsset) => void
  let request: UploadRequest | undefined
  const app = await editor({upload: input => {
    request = input
    return new Promise(resolve => { finish = resolve })
  }})
  app.get('[data-testid="editor-surface"]').element.dispatchEvent(drop([png('one')]))
  await flushPromises()
  app.unmount()
  expect(request?.signal?.aborted).toBe(true)
  finish(asset())
  await flushPromises()
  const stored = window.localStorage.getItem('w-editor:v1:document:image-drop-a') ?? ''
  expect(stored).not.toContain('https://assets.example.test/one.png')
})

it('cancels a pending upload when switching to another document', async () => {
  let finish!: (value: UploadedAsset) => void
  let request: UploadRequest | undefined
  const app = await editor({upload: input => {
    request = input
    return new Promise(resolve => { finish = resolve })
  }})
  try {
    app.get('[data-testid="editor-surface"]').element.dispatchEvent(drop([png('one')]))
    await flushPromises()
    await app.get('button[data-document-id="image-drop-b"]').trigger('click')
    await flushPromises()
    expect(app.get('.workspace-shell').attributes('data-document-id')).toBe('image-drop-b')
    expect(request?.signal?.aborted).toBe(true)
    finish(asset())
    await flushPromises()
    expect(app.find('[data-testid="image-drop-status"]').exists()).toBe(false)
    expect(app.find('img').exists()).toBe(false)
    expect(app.find('[data-testid="image-drop-error"]').exists()).toBe(false)
  } finally { app.unmount() }
})

it('rejects mixed files without uploading and leaves text drops to the editor', async () => {
  let uploads = 0
  const app = await editor({upload: async () => { uploads++; return asset() }})
  try {
    const mixed = drop([png('one'), new File(['text'], 'note.txt', {type: 'text/plain'})])
    app.get('[data-testid="editor-surface"]').element.dispatchEvent(mixed)
    await flushPromises()
    expect(mixed.defaultPrevented).toBe(true)
    expect(app.find('[data-testid="image-drop-error"]').exists()).toBe(true)
    expect(uploads).toBe(0)
    const text = drop([], ['text/plain'])
    app.get('[data-testid="editor-surface"]').element.dispatchEvent(text)
    expect(text.defaultPrevented).toBe(false)
    expect(app.get<HTMLTextAreaElement>('#markdown-source').element.value).toBe(baseline)
  } finally { app.unmount() }
})

it('rejects file drops in preview and read-only mode without uploading', async () => {
  let uploads = 0
  const app = await editor({upload: async () => { uploads++; return asset() }})
  try {
    await app.get('[data-command-id="mode.preview"]').trigger('click')
    await flushPromises()
    const event = drop([png('one')])
    app.get('[data-testid="editor-surface"]').element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(uploads).toBe(0)
    await app.get('[data-command-id="mode.source"]').trigger('click')
    await app.setProps({readonlyMode: true})
    expect(app.find('[data-testid="editor-surface"]').exists()).toBe(false)
    expect(uploads).toBe(0)
  } finally { app.unmount() }
})
