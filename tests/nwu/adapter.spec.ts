import { describe, it, expect } from 'vitest'
import { NwuAdapter, ScopedStorage } from '../../src/nwu/adapter'
const bootstrap = { userId: 7, csrfToken: 'csrf', initialDocumentId: 'blog:1', readonly: false, apiBase: '/api/blog-editor', blogListUrl: '/blogs' }
const envelope = { document: { documentId: 'blog:1', markdown: 'server', revision: 2, serverRevision: 'r2' }, metadata: {title:'Title', category:'other', visibility:'private', allowedUsernames:[]} }
function transport(handler: (path: string, body: Record<string, unknown>) => unknown) {
 return async (input: RequestInfo | URL, init?: RequestInit) => {
  const result = handler(String(input), init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : {})
  return new Response(JSON.stringify(result), {status: typeof result === 'object' && result !== null && 'error' in result ? 409 : 200})
 }
}
describe('NWU original Web data adapter', () => {
 it('scopes cache by user and never restores local document authority automatically', () => {
  const a = new ScopedStorage(localStorage, 'u1')
  const b = new ScopedStorage(localStorage, 'u2')
  a.setItem('setting','blue')
  a.setItem('w-editor:v1:document:blog:1','stale')
  expect(b.getItem('setting')).toBeNull()
  expect(new ScopedStorage(localStorage,'u1').getItem('w-editor:v1:document:blog:1')).toBeNull()
  expect(new ScopedStorage(localStorage,'u1').getItem('setting')).toBe('blue')
 })
 it('loads server draft only against matching canonical revision', async () => {
  const a = new NwuAdapter(bootstrap, transport(path => path.includes('/state/') ? {draft:{documentId:'blog:1',userId:'7',baseServerRevision:'r1',markdown:'stale'}} : envelope), localStorage)
  expect((await a.load('blog:1')).initialMarkdown).toBe('server')
 })
 it('retains failed edits and old revision on conflict; never retries with overwrite', async () => {
  const bodies: Record<string,unknown>[]=[]
  const a = new NwuAdapter(bootstrap, transport((path,body) => {
   if (path.endsWith('/save')) { bodies.push(body); return {error:{code:'REVISION_CONFLICT',message:'Conflict'}} }
   return path.includes('/state/') ? {} : envelope
  }), localStorage)
  await a.load('blog:1')
  await expect(a.save({documentId:'blog:1',markdown:'my edits',revision:3},'manual-save')).rejects.toThrow()
  expect(a.recovery('blog:1')?.markdown).toBe('my edits')
  expect(bodies[0]?.['baseServerRevision']).toBe('r2')
  expect(bodies[0]?.['overwrite']).toBe(false)
 })
 it('serializes saves and applies canonical identity receipt to subsequent saves', async () => {
  const bodies: Record<string,unknown>[]=[]
  const a = new NwuAdapter(bootstrap, transport((path,body) => {
   if(path.endsWith('/save')) { bodies.push(body); return {serverRevision:'r3', identityChange:{fromDocumentId:'blog:1',toDocumentId:'blog:2'}} }
   return path.includes('/state/') ? {} : envelope
  }), localStorage)
  await a.load('blog:1')
  await Promise.all([a.save({documentId:'blog:1',markdown:'first',revision:3},'manual-save'),a.save({documentId:'blog:1',markdown:'second',revision:4},'autosave-draft')])
  expect(bodies[1]?.['documentId']).toBe('blog:2')
  expect(bodies[1]?.['baseServerRevision']).toBe('r3')
 })
 it('creates real server documents with import Markdown', async () => {
  const a = new NwuAdapter(bootstrap, transport((_path,body)=>({...envelope,document:{...envelope.document,documentId:'draft:abc',markdown:body['markdown']}})), localStorage)
  expect(await a.create({title:'Imported',markdown:'hello'})).toEqual({documentId:'draft:abc',initialMarkdown:'hello',title:'Title',group:'其他'})
 })
})

describe('durable imported media', () => {
 it('uploads original draw.io data PNG before importing, preserving editable XML', async () => {
  let imported=''
  const a=new NwuAdapter(bootstrap,transport((path,body)=> {
   if(path.endsWith('/assets')) return {asset:{url:'/uploads/diagram.png',name:'diagram.png',mediaType:'image/png',size:3}}
   imported=String(body['markdown'])
   return {...envelope,document:{...envelope.document,markdown:imported}}
  }),localStorage)
  await a.create({title:'Import',markdown:'![diagram](data:image/png;base64,AAAA){data-type=drawio data-xml=%3Cmxfile%3E%3C/mxfile%3E}'})
  expect(imported).toContain('/uploads/diagram.png)')
  expect(imported).not.toContain('data:image')
  expect(imported).toContain('data-xml=%3Cmxfile%3E%3C/mxfile%3E')
 })
})

describe('HTTP LAN UUID support', () => {
 it('provides RFC4122 UUIDs when the secure-context randomUUID API is absent', async () => {
  const { installRandomUuid }=await import('../../src/nwu/uuid')
  const cryptoLike={getRandomValues:(bytes:Uint8Array)=>{bytes.fill(42);return bytes}}
  const uuid=installRandomUuid(cryptoLike)()
  expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
 })
})

describe('uncertain save retries', () => {
 it('reuses the operation identity for an unchanged request after a lost response', async () => {
  const ids:unknown[]=[]
  const a=new NwuAdapter(bootstrap,transport((path,body)=>{
   if(path.endsWith('/save')) {ids.push(body['operationId']); if(ids.length===1) throw new Error('network lost'); return {serverRevision:'r3'} }
   return path.includes('/state/') ? {} : envelope
  }),localStorage)
  await a.load('blog:1')
  const input={documentId:'blog:1',markdown:'edits',revision:1}
  await expect(a.save(input,'manual-save')).rejects.toThrow('network lost')
  await a.save(input,'manual-save')
  expect(ids[0]).toBe(ids[1])
 })
})

describe('divergent server draft recovery', () => {
 it('retains conflict edits after a successful stale-base autosave and reloads server authority with explicit recovery', async () => {
  let canonical=envelope
  let draft:unknown=null
  const request=transport((path,body)=>{
   if(path.endsWith('/save')) {
    if(body['saveKind']==='manual-save') return {error:{code:'REVISION_CONFLICT'}}
    draft={documentId:'blog:1',userId:'7',markdown:body['markdown'],baseServerRevision:body['baseServerRevision'],metadata:envelope.metadata,localRevision:4}
    return {serverRevision:'r2'}
   }
   return path.includes('/state/') ? {draft} : canonical
  })
  const stale=new NwuAdapter(bootstrap,request,localStorage)
  await stale.load('blog:1')
  await expect(stale.save({documentId:'blog:1',markdown:'conflict text',revision:3},'manual-save')).rejects.toThrow()
  await stale.save({documentId:'blog:1',markdown:'latest conflict text',revision:4},'autosave-draft')
  expect(stale.recovery('blog:1')?.markdown).toBe('latest conflict text')
  canonical={...envelope,document:{...envelope.document,markdown:'other tab authority',serverRevision:'r3'}}
  const reopened=new NwuAdapter(bootstrap,request,localStorage)
  expect((await reopened.load('blog:1')).initialMarkdown).toBe('other tab authority')
  expect(reopened.recovery('blog:1')?.markdown).toBe('latest conflict text')
 })
 it('offers mismatched server drafts as recovery even without any browser cache', async () => {
  const a=new NwuAdapter(bootstrap,transport(path=>path.includes('/state/')?{draft:{documentId:'blog:1',userId:'7',baseServerRevision:'r1',markdown:'server divergent',metadata:envelope.metadata,localRevision:7}}:envelope),localStorage)
  expect((await a.load('blog:1')).initialMarkdown).toBe('server')
  expect(a.recovery('blog:1')?.markdown).toBe('server divergent')
 })
})

describe('native fetch and promoted recovery', () => {
 it('binds the default native transport to window', async () => {
  const original=window.fetch
  window.fetch=async function(input) {
   if(this!==window) throw new Error('Illegal invocation')
   return new Response(JSON.stringify(String(input).includes('/state/')?{}:envelope))
  }
  try {expect((await new NwuAdapter(bootstrap).load('blog:1')).initialMarkdown).toBe('server')} finally {window.fetch=original}
 })
 it('finds edits after promotion and canonical-page reload', async () => {
  let saves=0
  const a=new NwuAdapter(bootstrap,transport((path)=>{
   if(path.endsWith('/save')) {if(++saves>1) throw new Error('offline'); return {serverRevision:'r3',identityChange:{fromDocumentId:'blog:1',toDocumentId:'blog:2'}}}
   return path.includes('/state/')?{}:envelope
  }),localStorage)
  await a.load('blog:1')
  await a.save({documentId:'blog:1',markdown:'first',revision:1},'manual-save')
  await expect(a.save({documentId:'blog:1',markdown:'after promotion',revision:2},'manual-save')).rejects.toThrow()
  expect(new NwuAdapter(bootstrap,transport(()=>envelope),localStorage).recovery('blog:2')?.markdown).toBe('after promotion')
 })
})

describe('already saved server drafts', () => {
 it('does not manufacture recovery when only the base revision differs from canonical', async () => {
  const a=new NwuAdapter(bootstrap,transport(path=>path.includes('/state/')?{draft:{documentId:'blog:1',userId:'7',baseServerRevision:'r1',markdown:envelope.document.markdown,metadata:{allowedUsernames:[],visibility:'private',category:'other',title:'Title'},localRevision:7}}:envelope),localStorage)
  expect((await a.load('blog:1')).initialMarkdown).toBe('server')
  expect(a.recovery('blog:1')).toBeNull()
 })
 it('retains same-Markdown drafts when their metadata differs', async () => {
  const a=new NwuAdapter(bootstrap,transport(path=>path.includes('/state/')?{draft:{documentId:'blog:1',userId:'7',baseServerRevision:'r1',markdown:envelope.document.markdown,metadata:{...envelope.metadata,title:'Unsaved title'},localRevision:7}}:envelope),localStorage)
  await a.load('blog:1')
  expect(a.recovery('blog:1')?.metadata.title).toBe('Unsaved title')
 })
})

describe('obsolete protected recovery cleanup', () => {
 it('removes only a protected record identical to confirmed canonical content and metadata', async () => {
  let server=envelope
  let state:unknown={draft:{documentId:'blog:1',userId:'7',baseServerRevision:'r1',markdown:'previous divergence',metadata:envelope.metadata,localRevision:7}}
  const request=transport(path=>path.includes('/state/')?state:server)
  const a=new NwuAdapter(bootstrap,request,localStorage)
  await a.load('blog:1')
  expect(a.recovery('blog:1')?.markdown).toBe('previous divergence')
  server={...envelope,document:{...envelope.document,markdown:'previous divergence',serverRevision:'r3'}}
  state={}
  await a.load('blog:1')
  expect(a.recovery('blog:1')).toBeNull()
 })
})

it('keeps canonical saved text separate from a restored draft and subsequent autosaves', async () => {
 const a=new NwuAdapter(bootstrap,transport(path => path.includes('/state/') ? {draft:{documentId:'blog:1',userId:'7',baseServerRevision:'r2',markdown:'draft',metadata:envelope.metadata}} : path.endsWith('/save') ? {serverRevision:'r2'} : envelope),localStorage)
 expect((await a.load('blog:1')).initialMarkdown).toBe('draft')
 expect(a.savedMarkdown.get('blog:1')).toBe('server')
 await a.save({documentId:'blog:1',markdown:'more edits',revision:1},'autosave-draft')
 expect(a.savedMarkdown.get('blog:1')).toBe('server')
 await a.save({documentId:'blog:1',markdown:'saved new',revision:2},'manual-save')
 expect(a.savedMarkdown.get('blog:1')).toBe('saved new')
})
