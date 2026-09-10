import { describe, expect, it } from 'vitest'
import { NwuAdapter } from '../../src/nwu/adapter'
import { LocalDocumentRepository } from '../../apps/playground/src/services/localDocumentRepository'
const config={userId:7,csrfToken:'csrf',initialDocumentId:'blog:1',readonly:false,apiBase:'/api/blog-editor',blogListUrl:'/blogs'}
const metadata={title:'Title',category:'other',visibility:'private',allowedUsernames:[]}
const checkpoint={markdown:'old checkpoint',revision:9,savedAt:'2026-09-10T00:00:00Z'}
function server(workspace: unknown=null): typeof fetch {
 return async input=>new Response(JSON.stringify(String(input).includes('/state/')?{workspace}:{document:{documentId:'blog:1',markdown:'canonical body',revision:10,serverRevision:'r10'},metadata}))
}
describe('original workspace and checkpoint reload',()=>{
 it('persists all original checkpoint fields while freshly loaded canonical body remains authoritative',async()=>{
  const first=new NwuAdapter(config,server(),localStorage)
  await first.load('blog:1')
  const repository=new LocalDocumentRepository(first.storage)
  repository.writeDocument({schemaVersion:1,documentId:'blog:1',autosave:{...checkpoint,markdown:'stale local autosave'},manualCheckpoint:checkpoint,preModeSwitch:{...checkpoint,markdown:'before switch'},preDestructiveReplace:{...checkpoint,markdown:'before replace'},status:{lastPersistenceFailure:null}})
  const next=new NwuAdapter(config,server(),localStorage)
  await next.load('blog:1')
  const restored=new LocalDocumentRepository(next.storage).readDocument('blog:1')
  expect(restored.status).toBe('valid')
  if(restored.status!=='valid') throw new Error('Expected a seeded document')
  expect(restored.value.autosave.markdown).toBe('canonical body')
  expect(restored.value.manualCheckpoint).toEqual(checkpoint)
  expect(restored.value.preModeSwitch?.markdown).toBe('before switch')
  expect(restored.value.preDestructiveReplace?.markdown).toBe('before replace')
  const otherUser=new NwuAdapter({...config,userId:8},server(),localStorage)
  await otherUser.load('blog:1')
  const isolated=new LocalDocumentRepository(otherUser.storage).readDocument('blog:1')
  expect(isolated.status==='valid'&&isolated.value.manualCheckpoint).toBeNull()
  expect(new LocalDocumentRepository(next.storage).readDocument('blog:2').status).toBe('missing')
 })
 it('restores only same-user same-document layout and overrides stale active ID and content',async()=>{
  const workspace={userId:'7',documentId:'blog:1',workspace:{documentId:'blog:1',activeDocumentId:'blog:99',markdown:'bad cached body',mode:'source',sidebar:{collapsed:true,width:310}}}
  const a=new NwuAdapter(config,server(workspace),localStorage)
  const article=await a.load('blog:1')
  expect(article.initialMarkdown).toBe('canonical body')
  expect(a.articleModes['blog:1']).toBe('source')
  const state=new LocalDocumentRepository(a.storage).readWorkspace()
  expect(state.status==='valid'&&state.value.activeDocumentId).toBe('blog:1')
  expect(state.status==='valid'&&state.value.articlePanel).toEqual({collapsed:true,width:310})
  const other=new NwuAdapter(config,server({...workspace,userId:'99'}),localStorage)
  await other.load('blog:1')
  expect(other.articleModes['blog:1']).toBeUndefined()
  expect(new LocalDocumentRepository(other.storage).readWorkspace().status).toBe('missing')
 })
 it('migrates checkpoint keys when a runtime is promoted to a canonical document',async()=>{
  const a=new NwuAdapter(config,async input=>new Response(JSON.stringify(String(input).endsWith('/save')?{serverRevision:'r11',identityChange:{toDocumentId:'blog:2'}}:String(input).includes('/state/')?{}:{document:{documentId:'blog:1',markdown:'canonical body',revision:10,serverRevision:'r10'},metadata})),localStorage)
  await a.load('blog:1')
  new LocalDocumentRepository(a.storage).writeDocument({schemaVersion:1,documentId:'blog:1',autosave:checkpoint,manualCheckpoint:checkpoint,preModeSwitch:null,preDestructiveReplace:null,status:{lastPersistenceFailure:null}})
  await a.save({documentId:'blog:1',markdown:'canonical body',revision:10},'manual-save')
  const b=new NwuAdapter({...config,initialDocumentId:'blog:2'},async()=>new Response(JSON.stringify({document:{documentId:'blog:2',markdown:'canonical body',revision:11,serverRevision:'r11'},metadata})),localStorage)
  await b.load('blog:2')
  const state=new LocalDocumentRepository(b.storage).readDocument('blog:2')
  expect(state.status==='valid'&&state.value.manualCheckpoint).toEqual(checkpoint)
 })
})
