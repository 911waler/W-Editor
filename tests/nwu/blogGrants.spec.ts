import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'

const wrappers: {unmount:()=>void}[]=[]
afterEach(() => { wrappers.splice(0).forEach(wrapper=>wrapper.unmount()); document.body.replaceChildren(); localStorage.clear(); vi.unstubAllGlobals(); vi.resetModules() })
async function setup(admin:boolean, manager:boolean) {
  HTMLDialogElement.prototype.showModal=vi.fn()
  HTMLDialogElement.prototype.close=vi.fn()
  window.history.replaceState(null,'','/blogs/1/edit')
  const saves: Record<string,unknown>[]=[]
  vi.stubGlobal('fetch', async(input:RequestInfo|URL,init?:RequestInit)=>{
    const path=new URL(String(input)).pathname
    if(path.endsWith('/reference-library')) { expect(init?.method ?? 'GET').toBe('GET'); return Response.json({revision:0,entries:[],deletedIds:[],highWater:0}) }
    if(path.endsWith('/users')) return Response.json({users:[{id:2,username:'张三'},{id:3,username:'李四'}]})
    if(path.includes('/state/')) return Response.json({})
    if(path.endsWith('/documents')) return Response.json({items:[],nextCursor:null})
    if(path.endsWith('/save')) { saves.push(JSON.parse(String(init?.body))); return Response.json({serverRevision:'blog:1:revision:2'}) }
    return Response.json({document:{documentId:'blog:1',markdown:'Original',revision:1,serverRevision:'blog:1:revision:1'},metadata:{title:'Shared',category:'other',visibility:'selected',allowedUsernames:['张三'],editorUserIds:[2],canManageAccess:manager}})
  })
  const bootstrap=document.createElement('script')
  bootstrap.id='nwu-editor-bootstrap'; bootstrap.type='application/json'
  bootstrap.textContent=JSON.stringify({userId:1,csrfToken:'test',initialDocumentId:'blog:1',readonly:false,apiBase:'/api/blog-editor',blogListUrl:'/blogs',isAdmin:admin})
  document.body.append(bootstrap)
  const {default:App}=await import('../../src/ui/App.vue')
  const wrapper=mount(App,{attachTo:document.body}); wrappers.push(wrapper)
  await flushPromises()
  await wrapper.findAll('button').find(button=>button.text()==='笔记属性')!.trigger('click')
  return {wrapper,saves}
}
it('admin selects viewers and editors and publishes both lists',async()=>{
  const {wrapper,saves}=await setup(true,true)
  await wrapper.findAll('button').find(button=>button.text()==='选择可查看用户')!.trigger('click'); await flushPromises()
  const dialog=wrapper.get('dialog')
  expect((dialog.findAll('input[type="checkbox"]')[0]!.element as HTMLInputElement).checked).toBe(true)
  await dialog.findAll('input[type="checkbox"]')[1]!.setValue(true)
  await dialog.get('form').trigger('submit')
  expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('张三\n李四')
  await wrapper.findAll('button').find(button=>button.text()==='选择可编辑用户')!.trigger('click'); await flushPromises()
  await wrapper.get('dialog').findAll('input[type="checkbox"]')[1]!.setValue(true)
  await wrapper.get('dialog form').trigger('submit')
  await wrapper.get('form[aria-label="笔记属性"]').trigger('submit'); await flushPromises()
  expect(saves.at(-1)?.['metadata']).toMatchObject({allowedUsernames:['张三','李四'],editorUserIds:[2,3]})
}, 20000)
it('ordinary authors can select editors; delegated editors cannot change access',async()=>{
  let setupResult=await setup(false,true)
  expect(setupResult.wrapper.text()).toContain('选择可编辑用户')
  expect(setupResult.wrapper.text()).not.toContain('选择可查看用户')
  setupResult.wrapper.unmount(); wrappers.splice(0); document.body.replaceChildren(); localStorage.clear(); vi.resetModules()
  setupResult=await setup(false,false)
  expect(setupResult.wrapper.text()).not.toContain('选择可编辑用户')
  expect(setupResult.wrapper.get('form[aria-label="笔记属性"] textarea').attributes()).toHaveProperty('disabled')
  expect(setupResult.wrapper.get('form[aria-label="笔记属性"] select:disabled').attributes()).toHaveProperty('disabled')
})
