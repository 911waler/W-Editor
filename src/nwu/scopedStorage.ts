import { DOCUMENT_KEY_PREFIX, WORKSPACE_KEY, documentStorageKey, type DocumentEnvelopeV1, type PersistedSnapshotV1 } from '../../apps/playground/src/services/localDocumentRepository'

type Checkpoints = Pick<DocumentEnvelopeV1, 'manualCheckpoint' | 'preModeSwitch' | 'preDestructiveReplace'>
const emptyCheckpoints = (): Checkpoints => ({manualCheckpoint:null,preModeSwitch:null,preDestructiveReplace:null})
function validSnapshot(value: unknown): value is PersistedSnapshotV1 | null {
  if(value===null) return true
  if(typeof value!=='object' || value===null) return false
  const snapshot=value as Record<string,unknown>
  return typeof snapshot['markdown']==='string' && Number.isInteger(snapshot['revision']) && Number(snapshot['revision'])>=0 && typeof snapshot['savedAt']==='string'
}

/** Cache checkpoints/settings durably, but seed live document bodies only from the server. */
export class ScopedStorage implements Storage {
  private memory = new Map<string,string>()
  private aliases = new Map<string,string>()
  constructor(private backing: Storage, private scope: string) {}
  private transient(key: string) { return key.startsWith(DOCUMENT_KEY_PREFIX) || key === WORKSPACE_KEY }
  private canonical(id: string) { return this.aliases.get(id) ?? id }
  private checkpointKey(id: string) { return `${this.scope}:checkpoints:${encodeURIComponent(this.canonical(id))}` }
  private documentId(key: string) { try { return decodeURIComponent(key.slice(DOCUMENT_KEY_PREFIX.length)) } catch { return '' } }
  private checkpoints(id: string): Checkpoints {
    try {
      const value=JSON.parse(this.backing.getItem(this.checkpointKey(id)) ?? 'null') as (Checkpoints & {documentId:string;schemaVersion:number}) | null
      if(value?.schemaVersion===1 && value.documentId===this.canonical(id) && validSnapshot(value.manualCheckpoint) && validSnapshot(value.preModeSwitch) && validSnapshot(value.preDestructiveReplace)) {
        return {manualCheckpoint:value.manualCheckpoint,preModeSwitch:value.preModeSwitch,preDestructiveReplace:value.preDestructiveReplace}
      }
    } catch { /* Retain malformed cached data; it never becomes live source. */ }
    return emptyCheckpoints()
  }
  seedDocument(id: string, markdown: string): void {
    const envelope: DocumentEnvelopeV1={schemaVersion:1,documentId:id,autosave:{markdown,revision:0,savedAt:new Date().toISOString()},...this.checkpoints(id),status:{lastPersistenceFailure:null}}
    this.memory.set(documentStorageKey(id),JSON.stringify(envelope))
  }
  promoteDocument(from: string, to: string): void {
    const priorKey=this.checkpointKey(from)
    const snapshots=this.checkpoints(from)
    if(this.backing.getItem(priorKey)!==null) {
      this.backing.setItem(this.checkpointKey(to),JSON.stringify({schemaVersion:1,documentId:to,...snapshots}))
      this.backing.removeItem(priorKey)
    }
    this.aliases.set(from,to)
  }
  get length() { return this.keys().length }
  private keys() { return [...new Set([...this.memory.keys(), ...Array.from({length:this.backing.length},(_,i)=>this.backing.key(i)).filter((k): k is string=>k?.startsWith(`${this.scope}:`) === true).map(k=>k.slice(this.scope.length+1))])] }
  key(index: number) { return this.keys()[index] ?? null }
  getItem(key: string) { return this.transient(key) ? this.memory.get(key) ?? null : this.backing.getItem(`${this.scope}:${key}`) }
  setItem(key: string,value: string) {
    if(!this.transient(key)) { this.backing.setItem(`${this.scope}:${key}`,value); return }
    if(key.startsWith(DOCUMENT_KEY_PREFIX)) {
      let envelope: DocumentEnvelopeV1 | null=null
      try { envelope=JSON.parse(value) as DocumentEnvelopeV1 } catch { /* Original repository exposes its raw recovery error. */ }
      const id=this.documentId(key)
      if(envelope?.schemaVersion===1 && envelope.documentId===id && validSnapshot(envelope.manualCheckpoint) && validSnapshot(envelope.preModeSwitch) && validSnapshot(envelope.preDestructiveReplace)) {
        this.backing.setItem(this.checkpointKey(id),JSON.stringify({schemaVersion:1,documentId:this.canonical(id),manualCheckpoint:envelope.manualCheckpoint,preModeSwitch:envelope.preModeSwitch,preDestructiveReplace:envelope.preDestructiveReplace}))
      }
    }
    this.memory.set(key,value)
  }
  removeItem(key: string) { this.memory.delete(key); this.backing.removeItem(`${this.scope}:${key}`) }
  clear() { for(const key of this.keys()) this.removeItem(key) }
}
