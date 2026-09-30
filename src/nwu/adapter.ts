import type { ReferenceMetadata } from '../../packages/editor-core/src'
import type { ReferenceEditorServices, ReferenceNote } from '../../packages/editor-vue/src/services/referenceEditorServices'
import { createRandomId } from '../../packages/editor-vue/src/services/randomId'
import type { PublicationInput, PublicationSettings } from './publication'
import { ScopedStorage } from './scopedStorage'
export { ScopedStorage } from './scopedStorage'
import { WORKSPACE_KEY } from '../../apps/playground/src/services/localDocumentRepository'
import type { ArticleDefinition } from '../../apps/playground/src/services/articleCatalog'
import type { UploadAdapter } from '../../packages/editor-core/src/ports'

export interface NwuBootstrap {
  isAdmin?: boolean
  userId: string | number
  csrfToken: string
  initialDocumentId: string | null
  readonly: boolean
  apiBase: string
  documentKind?: 'blog' | 'tutorial' | 'announcement'
  categories?: Record<string,string>
  categoryOrder?: string[]
  blogListUrl: string
  readerArticles?: {documentId: string; title: string; group: string; url: string}[]
  readerMetadata?: {level: string; author: string; publishedAt: string; updatedAt: string; reminderEnded: boolean; preview: boolean}
  readerEditUrl?: string | null
  readerDocument?: {documentId: string; title: string; markdown: string}
}
export type AnnouncementState = 'draft' | 'scheduled' | 'published' | 'withdrawn'
export interface Metadata { editorUserIds?: number[]; canManageAccess?: boolean; title: string; category: string; visibility: string; allowedUsernames: string[]; state?: AnnouncementState }
interface Envelope {
  document: {documentId: string; markdown: string; revision: number; serverRevision: string}
  metadata: Metadata
}
interface Draft {documentId: string; markdown: string; revision: number; baseServerRevision: string; metadata: Metadata}
type SaveInput = {documentId: string; markdown: string; revision: number}
type SaveKind = 'autosave-draft' | 'manual-save' | 'publish'

function sameMetadata(left: Metadata | undefined, right: Metadata): boolean {
  return left !== undefined && left.title === right.title && left.category === right.category
    && JSON.stringify(left.editorUserIds ?? []) === JSON.stringify(right.editorUserIds ?? [])
    && left.visibility === right.visibility && left.state === right.state
    && Array.isArray(left.allowedUsernames) && left.allowedUsernames.length === right.allowedUsernames.length
    && left.allowedUsernames.every((username, index) => username === right.allowedUsernames[index])
}

export class NwuAdapter {
  readonly storage: ScopedStorage
  readonly savedMarkdown = new Map<string, string>()
  readonly articleModes: Record<string, 'source' | 'visual' | 'preview'> = {}
  private layouts = new Map<string,{documentId:string;mode:string;sidebar:Readonly<Record<string,unknown>>}>()
  readonly documents = new Map<string,Envelope>()
  onIdentity: (id: string) => void = () => undefined
  onNotice: (message: string) => void = () => undefined
  private media = new Map<string, Promise<string>>()
  private operations = new Map<string,string>()
  private aliases = new Map<string,string>()
  private queue: Promise<unknown> = Promise.resolve()
  private recoveryPrefix: string
  constructor(readonly config: NwuBootstrap, private request: typeof fetch = window.fetch.bind(window), private backing: Storage = localStorage) {
    const scope = `nwu-editor:${encodeURIComponent(config.apiBase)}:${encodeURIComponent(String(config.userId))}`
    this.storage = new ScopedStorage(backing, scope)
    this.recoveryPrefix = `${scope}:recovery:`
  }
  id(id: string): string { return this.aliases.get(id) ?? id }
  private async json<T>(path: string, body?: unknown, method = 'GET', signal?: AbortSignal): Promise<T> {
    const url = new URL(`${this.config.apiBase}${path}`, window.location.href)
    if(url.origin !== window.location.origin) throw new Error('Editor API must be same-origin.')
    const response = await this.request(url.href, {method, credentials:'same-origin', ...(signal ? {signal} : {}), headers:{'X-CSRFToken':this.config.csrfToken,...(body === undefined ? {} : {'Content-Type':'application/json'})},...(body === undefined ? {} : {body:JSON.stringify(body)})})
    const result = await response.json()
    if(!response.ok) throw Object.assign(new Error(result.error?.message ?? '保存失败，本地内容已保留。'), {code:result.error?.code ?? 'SAVE_FAILED'})
    return result as T
  }
  private accept(envelope: Envelope): ArticleDefinition {
    if (!this.savedMarkdown.has(envelope.document.documentId)) this.savedMarkdown.set(envelope.document.documentId,envelope.document.markdown)
    this.documents.set(envelope.document.documentId,envelope)
    this.storage.seedDocument(envelope.document.documentId,envelope.document.markdown)
    return {documentId:envelope.document.documentId,initialMarkdown:envelope.document.markdown,title:envelope.metadata.title,group:this.config.categories?.[envelope.metadata.category] ?? this.config.categories?.['other'] ?? '其他'}
  }
  readonly referenceServices: ReferenceEditorServices = {
    loadNotes: async documentId => (await this.json<{notes: Record<string, ReferenceNote>}>(`/documents/${encodeURIComponent(this.id(documentId))}/reference-notes`)).notes,
    saveNote: async (documentId, referenceId, input) => this.json<ReferenceNote>(
      `/documents/${encodeURIComponent(this.id(documentId))}/reference-notes/${encodeURIComponent(referenceId)}`,
      {text: input.text, baseRevision: input.revision}, 'PUT',
    ),
    lookupDoi: async (documentId, doi, signal) => (await this.json<{metadata: ReferenceMetadata}>(
      `/documents/${encodeURIComponent(this.id(documentId))}/reference-metadata?doi=${encodeURIComponent(doi)}`,
      undefined, 'GET', signal,
    )).metadata,
  }
  async users(): Promise<{id:number;username:string}[]> {
    return (await this.json<{users:{id:number;username:string}[]}>('/users')).users
  }
  async create(input: {title: string; markdown?: string}) {
    const body=input.markdown === undefined ? input : {...input,markdown:await this.durableMarkdown(input.markdown)}
    return this.accept(await this.json<Envelope>('/documents',body,'POST'))
  }
  async list(): Promise<ArticleDefinition[]> {
    const items: ArticleDefinition[]=[]
    let cursor: string | null = null
    do {
      const page: {items:{documentId:string;title:string;group?:string}[];nextCursor:string|null} = await this.json(`/documents${cursor === null ? '' : `?cursor=${encodeURIComponent(cursor)}`}`)
      items.push(...page.items.map(item=>({...item,initialMarkdown:''})))
      cursor=page.nextCursor
    } while(cursor !== null)
    return items
  }
  async load(id: string): Promise<ArticleDefinition> {
    const canonical=this.id(id)
    const envelope = await this.json<Envelope>(`/documents/${encodeURIComponent(canonical)}`)
    this.savedMarkdown.set(canonical,envelope.document.markdown)
    this.savedMarkdown.set(id,envelope.document.markdown)
    const retained=this.recovery(canonical)
    if(retained?.markdown===envelope.document.markdown && sameMetadata(retained.metadata,envelope.metadata)) {
      this.backing.removeItem(this.recoveryPrefix+'divergent:'+canonical)
    }
    const state = await this.json<{workspace?:{userId:string;documentId:string;workspace:unknown}|null;draft?: {documentId:string;userId:string;markdown:string;baseServerRevision:string;metadata:Metadata;localRevision?:number}|null}>(`/state/${encodeURIComponent(canonical)}`)
    const draft=state.draft
    if(draft && draft.documentId===canonical && String(draft.userId)===String(this.config.userId) && draft.baseServerRevision===envelope.document.serverRevision) {
      envelope.document.markdown=draft.markdown
      envelope.metadata={...draft.metadata,...(envelope.metadata.editorUserIds === undefined ? {} : {editorUserIds:envelope.metadata.editorUserIds}),...(envelope.metadata.canManageAccess === undefined ? {} : {canManageAccess:envelope.metadata.canManageAccess})}
    } else if(draft && draft.documentId===canonical && String(draft.userId)===String(this.config.userId)
      && (draft.markdown!==envelope.document.markdown || !sameMetadata(draft.metadata,envelope.metadata))) {
      const key=this.recoveryPrefix+'divergent:'+canonical
      if(this.backing.getItem(key)===null) this.backing.setItem(key,JSON.stringify({documentId:canonical,markdown:draft.markdown,revision:draft.localRevision ?? 0,baseServerRevision:draft.baseServerRevision,metadata:draft.metadata ?? envelope.metadata}))
    }
    this.accept(envelope)
    if(id!==canonical) this.storage.seedDocument(id,envelope.document.markdown)
    const stored=state.workspace
    if(stored && String(stored.userId)===String(this.config.userId) && stored.documentId===canonical && typeof stored.workspace==='object' && stored.workspace!==null) {
      const layout=stored.workspace as Record<string,unknown>
      const sidebar=layout['sidebar'] as Record<string,unknown> | undefined
      if(layout['documentId']===canonical && sidebar && typeof sidebar==='object' && typeof sidebar['collapsed']==='boolean' && typeof sidebar['width']==='number' && Number.isFinite(sidebar['width'])) {
        const width=Math.min(360,Math.max(200,sidebar['width']))
        this.storage.setItem(WORKSPACE_KEY,JSON.stringify({schemaVersion:1,activeDocumentId:id,catalogDocumentIds:[id],articlePanel:{collapsed:sidebar['collapsed'],width}}))
        const mode=layout['mode']
        if(mode==='source' || mode==='visual' || mode==='preview') this.articleModes[id]=mode
        this.layouts.set(canonical,{documentId:canonical,mode:this.articleModes[id] ?? 'visual',sidebar:{collapsed:sidebar['collapsed'],width}})
      }
    }
    return {documentId:id,initialMarkdown:envelope.document.markdown,title:envelope.metadata.title,group:this.config.categories?.[envelope.metadata.category] ?? this.config.categories?.['other'] ?? '其他'}
  }
  metadata(id: string): Metadata { const value=this.documents.get(this.id(id)); if(!value) throw new Error('Document not loaded.'); return value.metadata }
  setMetadata(id: string, metadata: Metadata) { const envelope=this.documents.get(this.id(id)); if(envelope) envelope.metadata={...metadata,allowedUsernames:[...metadata.allowedUsernames]} }
  recovery(id: string): Draft | null {
    const canonical=this.id(id)
    try { return JSON.parse(this.backing.getItem(this.recoveryPrefix+'divergent:'+canonical) ?? this.backing.getItem(this.recoveryPrefix+canonical) ?? 'null') as Draft|null } catch { return null }
  }
  save(input: SaveInput, kind: SaveKind): Promise<void> {
    const run = this.queue.catch(()=>undefined).then(async()=>{
      if(this.config.readonly) throw new Error('Read-only document.')
      const id=this.id(input.documentId), envelope=this.documents.get(id)
      if(!envelope) throw new Error('Document not loaded.')
      // Resolve pasted data URLs before persisting the recovery snapshot. A
      // base64 image can be several times larger than its source and two pasted
      // images can exceed the browser's localStorage quota even though the
      // server-facing Markdown will only contain short protected URLs.
      const markdown=await this.durableMarkdown(input.markdown)
      const recovery: Draft={...input,documentId:id,markdown,baseServerRevision:envelope.document.serverRevision,metadata:envelope.metadata}
      this.backing.setItem(this.recoveryPrefix+id,JSON.stringify(recovery))
      const protectedKey=this.recoveryPrefix+'divergent:'+id
      const previous=this.recovery(id)
      if(this.backing.getItem(protectedKey)!==null && previous?.baseServerRevision===recovery.baseServerRevision) this.backing.setItem(protectedKey,JSON.stringify(recovery))
      const signature=JSON.stringify({id,markdown,revision:input.revision,base:envelope.document.serverRevision,metadata:envelope.metadata,kind})
      const operationId=this.operations.get(signature) ?? createRandomId()
      this.operations.set(signature,operationId)
      const receipt=await this.json<{serverRevision?:string;identityChange?:{toDocumentId:string};notices?:{text:string}[]}>(`/documents/${encodeURIComponent(id)}/save`,{
        documentId:id,markdown,localRevision:input.revision,baseServerRevision:envelope.document.serverRevision,
        metadata:envelope.metadata,operationId,origin:kind==='autosave-draft'?'autosave':kind==='publish'?'publish':'user',overwrite:false,saveKind:kind,
      },'POST').catch((error: unknown)=>{
        if(typeof error==='object' && error!==null && 'code' in error && error.code==='REVISION_CONFLICT') this.backing.setItem(protectedKey,JSON.stringify(recovery))
        throw error
      })
      this.operations.delete(signature)
      if(receipt.serverRevision) envelope.document.serverRevision=receipt.serverRevision
      envelope.document.markdown=input.markdown
      if(receipt.identityChange) {
        const next=receipt.identityChange.toDocumentId
        this.storage.promoteDocument(input.documentId,next)
        this.aliases.set(input.documentId,next)
        envelope.document.documentId=next
        this.documents.set(next,envelope)
        const protectedDraft=this.backing.getItem(protectedKey)
        if(protectedDraft!==null) {
          this.backing.setItem(this.recoveryPrefix+'divergent:'+next,protectedDraft)
          this.backing.removeItem(protectedKey)
        }
        this.onIdentity(next)
        const layout=this.layouts.get(id)
        if(layout) {
          const promoted={...layout,documentId:next}
          this.layouts.set(next,promoted)
          try { await this.json(`/state/${encodeURIComponent(next)}`,{workspace:promoted,schemaVersion:'1.0.0',csrfToken:this.config.csrfToken},'PUT') }
          catch { this.onNotice('正文已保存，工作区布局暂未保存。') }
        }
      }
      if(kind!=='autosave-draft') {
        this.savedMarkdown.set(input.documentId,input.markdown)
        this.savedMarkdown.set(this.id(input.documentId),input.markdown)
      }
      this.backing.removeItem(this.recoveryPrefix+id)
      for(const notice of receipt.notices ?? []) this.onNotice(notice.text)
    })
    this.queue=run
    return run
  }
  private publicationRequest(id: string, method: string, data?: PublicationInput | {action: string}): Promise<PublicationSettings> {
    const run = this.queue.catch(() => undefined).then(async () => {
      if(this.config.documentKind !== 'announcement' || this.config.readonly) throw new Error('公告不可编辑。')
      const canonical=this.id(id), envelope=this.documents.get(canonical)
      if(!envelope) throw new Error('公告尚未载入。')
      const result=await this.json<PublicationSettings>(`/documents/${encodeURIComponent(canonical)}/publication`,
        data ? {...data,baseServerRevision:envelope.document.serverRevision} : undefined,method)
      if(method==='GET' && result.serverRevision!==envelope.document.serverRevision) {
        throw new Error('公告已被其他操作修改，请先保存或导出当前正文，再重新载入。')
      }
      envelope.document.serverRevision=result.serverRevision
      envelope.metadata={...envelope.metadata,title:result.title,state:result.state}
      return result
    })
    this.queue=run
    return run
  }
  publication(id: string): Promise<PublicationSettings> { return this.publicationRequest(id,'GET') }
  savePublication(id: string, input: PublicationInput): Promise<PublicationSettings> { return this.publicationRequest(id,'PUT',input) }
  publishAnnouncement(id: string): Promise<PublicationSettings> { return this.publicationRequest(id,'POST',{action:'publish'}) }
  cancelAnnouncementSchedule(id: string): Promise<PublicationSettings> { return this.publicationRequest(id,'POST',{action:'cancel-schedule'}) }
  async saveWorkspace(input: {documentId:string;mode:string;sidebar:Readonly<Record<string,unknown>>}) {
    await this.queue.catch(()=>undefined)
    if(this.config.readonly) return
    this.layouts.set(this.id(input.documentId),{...input,documentId:this.id(input.documentId)})
    try {
      await this.json(`/state/${encodeURIComponent(this.id(input.documentId))}`,{workspace:{...input,documentId:this.id(input.documentId)},schemaVersion:'1.0.0',csrfToken:this.config.csrfToken},'PUT')
    } catch(error) { this.onNotice('工作区布局未保存，请稍后重试。'); throw error }
  }
  readonly uploadAdapter: UploadAdapter = {
    upload: async ({file,kind,signal}) => {
      const abort=new AbortController()
      const cancel=()=>abort.abort()
      if(signal?.aborted) abort.abort()
      signal?.addEventListener('abort',cancel,{once:true})
      try {
        const body=new FormData()
        body.append('file',new Blob([await file.arrayBuffer()],{type:file.type}),file.name)
        body.append('kind',kind==='image'?'image':'attachment')
        return await this.upload(body,abort.signal)
      } finally { signal?.removeEventListener('abort',cancel) }
    },
  }
  private async upload(body: FormData, signal?: AbortSignal) {
    if(this.config.readonly) throw new Error('Read-only document.')
    body.append('csrfToken',this.config.csrfToken)
    const response=await this.request(`${this.config.apiBase}/assets`,{method:'POST',credentials:'same-origin',body,...(signal ? {signal} : {})})
    const result=await response.json()
    if(!response.ok) throw new Error(result.error?.message ?? '上传失败，请重试。')
    const url=new URL(result.asset.url,window.location.href)
    if(url.origin!==window.location.origin) throw new Error('Asset URL must be same-origin.')
    return {...result.asset,url:url.href}
  }
  private async durableMarkdown(markdown: string): Promise<string> {
    const matches=[...markdown.matchAll(/!\[[^\]]*\]\((data:image\/(?:avif|gif|jpeg|png|webp);base64,[A-Za-z0-9+/]+=*)\)(?:\{data-type=drawio data-xml=([^}]+)\})?/giu)]
    let result=markdown
    for(const match of matches) {
      const data=match[1] ?? ''
      const key=match[0]
      let upload=this.media.get(key)
      if(!upload) {
        upload=(async()=>{
          if(match[2]) return (await this.persistDrawio({png:data,xml:decodeURI(match[2])})).png
          const mediaType=data.slice(5,data.indexOf(';'))
          const bytes=Uint8Array.from(atob(data.split(',')[1] ?? ''),c=>c.charCodeAt(0))
          const body=new FormData()
          body.append('file',new Blob([bytes],{type:mediaType}),`image.${mediaType.split('/')[1]}`)
          body.append('kind','image')
          return (await this.upload(body)).url as string
        })()
        this.media.set(key,upload)
        upload.catch(()=>this.media.delete(key))
      }
      result=result.replace(key,key.replace(data,await upload))
    }
    return result
  }
  async persistDrawio(payload: {png:string;xml:string}) {
    const bytes=Uint8Array.from(atob(payload.png.split(',')[1] ?? ''),character=>character.charCodeAt(0))
    const body=new FormData()
    body.append('file',new Blob([bytes],{type:'image/png'}),'diagram.png')
    body.append('kind','drawio')
    body.append('xml',payload.xml)
    const asset = await this.upload(body)
    return {png: asset.url as string, xml: payload.xml}
  }
}
