import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PlaygroundApp from '../../apps/playground/src/PlaygroundApp.vue'
import App from '../../src/ui/App.vue'

describe('NWU original application integration', () => {
 it('opens readonly published Markdown without restoring a local editor draft', async () => {
  localStorage.setItem('w-editor:v1:document:blog%3A9',JSON.stringify({schemaVersion:1,documentId:'blog:9',autosave:{markdown:'LOCAL STALE',revision:1,savedAt:new Date().toISOString()},manualCheckpoint:null,preDestructiveReplace:null,preModeSwitch:null,status:{lastPersistenceFailure:null}}))
  const bootstrap=document.createElement('script')
  bootstrap.type='application/json'; bootstrap.id='nwu-editor-bootstrap'
  bootstrap.textContent=JSON.stringify({userId:9,csrfToken:'x',initialDocumentId:'blog:9',readonly:true,apiBase:'/api/blog-editor',blogListUrl:'/blogs',readerDocument:{documentId:'blog:9',title:'Published',markdown:'SERVER PUBLISHED'}})
  document.body.append(bootstrap)
  const wrapper=mount(App,{attachTo:document.body})
  await flushPromises()
  expect(wrapper.find('.workspace-body').exists()).toBe(false)
  expect(wrapper.get('[data-testid="desktop-reader-parity"]').text()).toContain('SERVER PUBLISHED')
  expect(wrapper.text()).not.toContain('LOCAL STALE')
  wrapper.unmount(); bootstrap.remove()
 })
 it('publishes the current original source snapshot through the synchronization barrier', async () => {
  let saved=''
  const wrapper=mount(PlaygroundApp,{attachTo:document.body,props:{articleCatalog:[{documentId:'blog:1',title:'Title',initialMarkdown:'old'}],persistence:{savePublish:input=>{saved=input.markdown}}}})
  await wrapper.get('[data-command-id="mode.source"]').trigger('click')
  await flushPromises()
  await wrapper.get('#markdown-source').setValue('new text')
  await wrapper.vm.publishForLifecycle()
  expect(saved).toBe('new text')
  wrapper.unmount()
 })
})

describe('restored original workspace presentation', () => {
 it.each(['source', 'preview', 'visual'])('opens visually despite saved %s mode, restores sidebar and allows manual mode changes', async (savedMode) => {
  const {NwuAdapter}=await import('../../src/nwu/adapter')
  const adapter=new NwuAdapter({userId:7,csrfToken:'x',initialDocumentId:'blog:1',readonly:false,apiBase:'/api/blog-editor',blogListUrl:'/blogs'},async input=>new Response(JSON.stringify(String(input).includes('/state/')?{workspace:{userId:'7',documentId:'blog:1',workspace:{documentId:'blog:1',mode:savedMode,sidebar:{collapsed:true,width:310}}}}:{document:{documentId:'blog:1',markdown:'canonical text',revision:5,serverRevision:'r5'},metadata:{title:'Title',category:'other',visibility:'private',allowedUsernames:[]}})),localStorage)
  const article=await adapter.load('blog:1')
  let persistedMode=''
  const wrapper=mount(PlaygroundApp,{attachTo:document.body,props:{articleCatalog:[article],storage:adapter.storage,articleModes:adapter.articleModes,persistence:{saveWorkspace:input=>{persistedMode=input.mode}}}})
  await flushPromises()
  expect(wrapper.get('[data-testid="editor-surface"]').attributes('data-mode')).toBe('visual')
  expect(wrapper.get('.ProseMirror').text()).toBe('canonical text')
  expect(wrapper.find('.article-panel--collapsed').exists()).toBe(true)
  await wrapper.get('[data-command-id="mode.source"]').trigger('click')
  await flushPromises()
  expect(persistedMode).toBe('source')
  expect(wrapper.get('#markdown-source').element).toHaveProperty('value','canonical text')
  wrapper.unmount()
 })
})


describe('host document toolbar import', () => {
 it.each(['select', 'drop'])('imports via %s through confirmation and autosave with the sidebar collapsed', async (method) => {
  const imported = '# Synthetic import\n\n' + 'synthetic announcement line with preserved content.\n'.repeat(900)
  const bytes = new TextEncoder().encode(imported)
  expect(bytes.byteLength).toBeGreaterThan(40 * 1024)
  let autosaved = ''
  let manuallySaved = ''
  const wrapper = mount(PlaygroundApp, {attachTo:document.body, props:{
   toolbarImport:true,
   articleCatalog:[{documentId:'announcement:42',title:'Synthetic',initialMarkdown:'original content'}],
   articleModes:{'announcement:42':'source'},
   persistence:{saveAutosave:input=>{autosaved=input.markdown},saveManual:input=>{manuallySaved=input.markdown}},
  }})
  try {
   await flushPromises()
   if (!wrapper.find('.article-panel--collapsed').exists()) {
    await wrapper.get('.article-panel__header button').trigger('click')
   }
   expect(wrapper.find('.article-panel--collapsed').exists()).toBe(true)
   const button = wrapper.get('.editor-workspace [data-testid="import-markdown"]')
   expect(button.text()).toContain('选择文件')
   expect(wrapper.findAll('[data-testid="import-markdown-input"]')).toHaveLength(1)
   const input = wrapper.get<HTMLInputElement>('[data-testid="import-markdown-input"]')
   expect(input.element.closest('.article-panel')).toBeNull()
   const openPicker = vi.spyOn(input.element,'click')
   await button.trigger('click')
   expect(openPicker).toHaveBeenCalledOnce()
   const file = new File([imported], 'synthetic-40kb.md', {type:'text/markdown'})
   Object.defineProperty(file,'arrayBuffer',{value:async()=>bytes.buffer})
   Object.defineProperty(input.element,'files',{configurable:true,value:[file]})
   const performImport = () => method === 'drop'
    ? wrapper.get('[data-testid="markdown-import-zone"]').trigger('drop',{dataTransfer:{types:['Files'],files:[file]}})
    : input.trigger('change')
   await performImport()
   await flushPromises()
   expect(wrapper.get('[data-testid="document-lifecycle-confirmation"]').isVisible()).toBe(true)
   await performImport()
   expect(wrapper.findAll('[data-testid="document-lifecycle-confirmation"]')).toHaveLength(1)
   expect(wrapper.get('#markdown-source').element).toHaveProperty('value','original content')
   await wrapper.get('[data-testid="document-lifecycle-cancel"]').trigger('click')
   await flushPromises()
   expect(document.activeElement).toBe(button.element)
   expect(wrapper.get('#markdown-source').element).toHaveProperty('value','original content')
   await performImport()
   await flushPromises()
   await wrapper.get('[data-testid="document-lifecycle-confirm"]').trigger('click')
   await flushPromises()
   await vi.waitFor(()=>expect(autosaved).toBe(imported))
   await wrapper.vm.saveForLifecycle()
   expect(manuallySaved).toBe(imported)
   expect(wrapper.get('main').attributes('data-document-id')).toBe('announcement:42')
   expect(wrapper.get('#markdown-source').element).toHaveProperty('value',imported)
   expect(input.element.value).toBe('')
   const invalidFile = new File(['invalid'], 'invalid.md', {type:'text/markdown'})
   Object.defineProperty(invalidFile,'arrayBuffer',{value:async()=>new Uint8Array([255]).buffer})
   Object.defineProperty(input.element,'files',{configurable:true,value:[invalidFile]})
   await button.trigger('click')
   await input.trigger('change')
   await flushPromises()
   const error = wrapper.get('.editor-workspace [data-testid="document-lifecycle-error"]')
   expect(error.isVisible()).toBe(true)
   expect(error.attributes('role')).toBe('alert')
   expect(wrapper.get('#markdown-source').element).toHaveProperty('value',imported)
  } finally {wrapper.unmount()}
 }, 20_000)
})

describe('Markdown file validation', () => {
 it.each([true, false])('rejects multiple and non-Markdown files without replacing text (toolbar=%s)', async toolbarImport => {
  const wrapper = mount(PlaygroundApp,{attachTo:document.body,props:{toolbarImport,
   articleCatalog:[{documentId:'validation:1',title:'Original',initialMarkdown:'keep original'}],
   articleModes:{'validation:1':'source'},
  }})
  try {
   await flushPromises()
   const zone = wrapper.get('[data-testid="markdown-import-zone"]')
   await zone.trigger('drop',{dataTransfer:{types:['Files'],files:[new File(['a'],'a.md'),new File(['b'],'b.md')]}})
   await flushPromises()
   expect(wrapper.get('[data-testid="document-lifecycle-error"]').text()).toContain('一次只能导入一个')
   expect(wrapper.find('[data-testid="document-lifecycle-confirmation"]').exists()).toBe(false)
   const input=wrapper.get<HTMLInputElement>('[data-testid="import-markdown-input"]')
   Object.defineProperty(input.element,'files',{configurable:true,value:[new File(['not markdown'],'report.pdf')]})
   await input.trigger('change')
   await flushPromises()
   expect(wrapper.get('[data-testid="document-lifecycle-error"]').text()).toContain('.md 或 .markdown')
   expect(wrapper.get('#markdown-source').element).toHaveProperty('value','keep original')
  } finally { wrapper.unmount() }
 })
})
