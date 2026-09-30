import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(() => { document.body.replaceChildren(); localStorage.clear(); vi.unstubAllGlobals(); vi.resetModules() })

async function editor(options: {failSave?:boolean; scheduled?:boolean; failSettings?:boolean} = {}) {
  let revision = '1'
  const requests: Array<{path:string; method:string; body:Record<string,unknown>}> = []
  const publication = {serverRevision:revision,state:'draft',title:'标题',level:'normal',sendEmail:false,
    scheduledFor:options.scheduled ? '2027-01-20T10:37' : '',reminderEndsAt:'',recipientCount:2,missingCount:1,mailLabel:'邮件已停用'}
  window.history.replaceState(null,'','/admin/announcements/42/edit')
  const bootstrap = document.createElement('script')
  bootstrap.id='nwu-editor-bootstrap'; bootstrap.type='application/json'
  bootstrap.textContent=JSON.stringify({userId:7,csrfToken:'csrf',initialDocumentId:'announcement:42',readonly:false,apiBase:'/api/announcement-editor',documentKind:'announcement',blogListUrl:'/admin/announcements'})
  document.body.append(bootstrap)
  vi.stubGlobal('fetch', async (input:RequestInfo | URL, init?:RequestInit) => {
    const path=new URL(String(input)).pathname, method=init?.method ?? 'GET'
    const body=typeof init?.body==='string' ? JSON.parse(init.body) as Record<string,unknown> : {}
    requests.push({path,method,body})
    if(path.includes('/state/')) return new Response('{}')
    if(path.endsWith('/save')) {
      if(options.failSave) return new Response(JSON.stringify({error:{message:'保存失败'}}),{status:409})
      revision=String(Number(revision)+1)
      return new Response(JSON.stringify({serverRevision:revision}))
    }
    if(path.endsWith('/publication')) {
      if(method==='PUT') {
        if(options.failSettings) return new Response(JSON.stringify({error:{message:'设置冲突'}}),{status:409})
        Object.assign(publication,body); revision=String(Number(revision)+1)
      }
      if(method==='POST') {
        expect(body['baseServerRevision']).toBe(revision)
        publication.state=publication.scheduledFor ? 'scheduled' : 'published'
        revision=String(Number(revision)+1)
      }
      return new Response(JSON.stringify({...publication,serverRevision:revision}))
    }
    return new Response(JSON.stringify({document:{documentId:'announcement:42',markdown:'# 正文',revision:1,serverRevision:revision},metadata:{title:'标题',category:'other',visibility:'private',allowedUsernames:[],state:'draft'}}))
  })
  const {default:App}=await import('../../src/ui/App.vue')
  const wrapper=mount(App,{attachTo:document.body})
  await flushPromises()
  return {wrapper, requests}
}

it('opens settings in a dialog, keeps the editor URL and saves title without publishing', async () => {
  const {wrapper,requests}=await editor()
  await wrapper.get('[data-testid="announcement-settings"]').trigger('click'); await flushPromises()
  expect(document.querySelector('dialog[open]')).not.toBeNull()
  expect(window.location.pathname).toBe('/admin/announcements/42/edit')
  const title=document.querySelector<HTMLInputElement>('dialog input[name="title"]')!
  title.value='新标题';title.dispatchEvent(new Event('input',{bubbles:true}))
  document.querySelector('dialog form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))
  await flushPromises()
  expect(requests.find(r=>r.path.endsWith('/publication') && r.method==='PUT')?.body['title']).toBe('新标题')
  expect(requests.filter(r=>r.path.endsWith('/publication') && r.method==='POST')).toHaveLength(0)
  expect(document.querySelector('dialog')).toBeNull()
  await wrapper.get('[data-testid="announcement-manual-save"]').trigger('click'); await flushPromises()
  const saved=requests.filter(r=>r.path.endsWith('/save') && r.body['saveKind']==='manual-save').at(-1)
  expect((saved?.body['metadata'] as {title:string}).title).toBe('新标题')
  expect(saved?.body['baseServerRevision']).toBe('2')
  wrapper.unmount()
},20000)

it.each([false,true])('saves current body before publishing (scheduled=%s)', async scheduled => {
  const {wrapper,requests}=await editor({scheduled})
  const button=wrapper.get('[data-testid="announcement-direct-publish"]')
  expect(button.text()).toBe(scheduled ? '定时发布' : '发布公告')
  await button.trigger('click'); await flushPromises()
  const writes=requests.filter(r=>r.method==='POST' && (r.path.endsWith('/save')||r.path.endsWith('/publication')))
  expect(writes.findIndex(r=>r.path.endsWith('/save') && r.body['saveKind']==='manual-save')).toBeGreaterThanOrEqual(0)
  expect(writes.at(-1)?.path).toContain('/publication')
  expect(writes.at(-1)?.body['action']).toBe('publish')
  expect(wrapper.find('[data-testid="announcement-direct-publish"]').exists()).toBe(false)
  wrapper.unmount()
},20000)

it('does not publish when saving fails', async () => {
  const {wrapper,requests}=await editor({failSave:true})
  await wrapper.get('[data-testid="announcement-direct-publish"]').trigger('click'); await flushPromises()
  expect(requests.filter(r=>r.path.endsWith('/publication') && r.method==='POST')).toHaveLength(0)
  expect(wrapper.text()).toContain('保存失败')
  expect(wrapper.find('main.announcement-editor').exists()).toBe(true)
  wrapper.unmount()
},20000)

it('keeps settings and edited values open on a conflict', async () => {
  const {wrapper}=await editor({failSettings:true})
  await wrapper.get('[data-testid="announcement-settings"]').trigger('click'); await flushPromises()
  document.querySelector('dialog form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))
  await flushPromises()
  expect(document.querySelector('dialog[open]')?.textContent).toContain('设置冲突')
  wrapper.unmount()
},20000)
