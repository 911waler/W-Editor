import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
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
 it('opens the restored source mode and collapsed sidebar, then persists a visible mode change', async () => {
  const {NwuAdapter}=await import('../../src/nwu/adapter')
  const adapter=new NwuAdapter({userId:7,csrfToken:'x',initialDocumentId:'blog:1',readonly:false,apiBase:'/api/blog-editor',blogListUrl:'/blogs'},async input=>new Response(JSON.stringify(String(input).includes('/state/')?{workspace:{userId:'7',documentId:'blog:1',workspace:{documentId:'blog:1',mode:'source',sidebar:{collapsed:true,width:310}}}}:{document:{documentId:'blog:1',markdown:'canonical text',revision:5,serverRevision:'r5'},metadata:{title:'Title',category:'other',visibility:'private',allowedUsernames:[]}})),localStorage)
  const article=await adapter.load('blog:1')
  let persistedMode=''
  const wrapper=mount(PlaygroundApp,{attachTo:document.body,props:{articleCatalog:[article],storage:adapter.storage,articleModes:adapter.articleModes,persistence:{saveWorkspace:input=>{persistedMode=input.mode}}}})
  await flushPromises()
  expect(wrapper.get('#markdown-source').element).toHaveProperty('value','canonical text')
  expect(wrapper.find('.article-panel--collapsed').exists()).toBe(true)
  await wrapper.get('[data-command-id="mode.visual"]').trigger('click')
  await flushPromises()
  expect(persistedMode).toBe('visual')
  wrapper.unmount()
 })
})
