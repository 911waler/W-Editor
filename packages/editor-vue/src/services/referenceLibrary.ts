import { referenceIdentity, type DocumentReference, type ReferenceStyle } from '@w-editor/editor-core'
import { createLocalReferenceServices, emptyReferenceLibrary, parseReferenceLibrary, type LibraryEntry, type ReferenceEditorServices, type ReferenceLibrary } from './referenceEditorServices'

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const cleanEntry = ({ id, text, metadata, style }: LibraryEntry): LibraryEntry => ({ id, text, ...(metadata === undefined ? {} : { metadata }), ...(style === undefined ? {} : { style }) })
const doi = (entry: LibraryEntry): string | undefined => {
  for (const value of [entry.metadata?.doi, entry.text]) {
    if (!value) continue
    const identity = referenceIdentity(value)
    if (/^doi:10\.\d{4,9}\/\S+$/u.test(identity)) return identity
  }
  return undefined
}
const equivalent = (a: LibraryEntry, b: LibraryEntry) => doi(a) && doi(b) ? doi(a) === doi(b) : a.text.trim().replace(/\s+/gu, ' ') === b.text.trim().replace(/\s+/gu, ' ')

type Item = LibraryEntry | 'deleted' | undefined
function merge(base: ReferenceLibrary, local: ReferenceLibrary, remote: ReferenceLibrary, seeds: ReadonlySet<string>): ReferenceLibrary {
  const items = (state: ReferenceLibrary) => new Map<string, Item>([...state.entries.map(entry => [entry.id, entry] as const), ...state.deletedIds.map(id => [id, 'deleted'] as const)])
  const b = items(base), l = items(local), r = items(remote)
  for (const id of new Set([...b.keys(), ...l.keys()])) {
    const before = b.get(id), desired = l.get(id), actual = r.get(id)
    if (same(before, desired)) continue
    // Initial body content may be older than the shared library. It can only seed absent IDs.
    if (seeds.has(id) && actual !== undefined) continue
    if (!same(before, actual) && !same(desired, actual)) throw new Error('同一文献已被其他编辑者修改，待保存资料已保留；请核对后再重试。')
    if (desired === undefined) r.delete(id)
    else r.set(id, desired)
  }
  return { revision: remote.revision, entries: [...r.values()].filter((item): item is LibraryEntry => item !== undefined && item !== 'deleted'), deletedIds: [...r].filter(([, item]) => item === 'deleted').map(([id]) => id), highWater: Math.max(local.highWater, remote.highWater) }
}
interface State {
  base: ReferenceLibrary
  value: ReferenceLibrary
  seeds: Set<string>
  seen: Map<string, LibraryEntry>
  present: Set<string>
  liveDeleted: Set<string>
  loaded: boolean
  recoveryError?: Error
  loading?: Promise<ReferenceLibrary>
  queue: Promise<void>
  timer?: ReturnType<typeof setTimeout>
}

/** Recovery snapshots are private and must use the host's user-scoped storage. */
export function createReferenceLibraryController(
  services: ReferenceEditorServices,
  storage: Storage,
  onChange: (documentId: string, state: ReferenceLibrary) => void = () => undefined,
  onError: (documentId: string, message: string) => void = () => undefined,
) {
  const fallback = createLocalReferenceServices(storage)
  const loadRemote = services.loadLibrary && services.saveLibrary ? services.loadLibrary : fallback.loadLibrary!
  const saveRemote = services.loadLibrary && services.saveLibrary ? services.saveLibrary : fallback.saveLibrary!
  const states = new Map<string, State>()
  let disposed = false
  const key = (id: string) => `w-editor:reference-library-pending:v1:${encodeURIComponent(id)}`
  const report = (id: string, error: unknown) => { if (!disposed) onError(id, error instanceof Error ? error.message : '文献库保存失败，待保存资料已保留。') }
  function state(id: string): State {
    const existing = states.get(id)
    if (existing) return existing
    const next: State = { base: emptyReferenceLibrary(), value: emptyReferenceLibrary(), seeds: new Set(), seen: new Map(), present: new Set(), liveDeleted: new Set(), loaded: false, queue: Promise.resolve() }
    const raw = storage.getItem(key(id))
    if (raw !== null) {
      try {
        const recovery = JSON.parse(raw) as { base: unknown; value: unknown; seeds: string[] }
        next.base = parseReferenceLibrary(recovery.base)
        next.value = parseReferenceLibrary(recovery.value)
        if (!Array.isArray(recovery.seeds) || recovery.seeds.some(id => typeof id !== 'string')) throw new Error('Invalid recovery seeds')
        next.seeds = new Set(recovery.seeds)
      } catch {
        next.recoveryError = new Error('本地待保存文献数据损坏，原始记录已保留；请先备份并恢复记录后重试。')
      }
    }
    states.set(id, next)
    if (next.recoveryError) report(id, next.recoveryError)
    return next
  }
  function publish(id: string, s: State) {
    // Persist synchronously before any network await, including cold document startup.
    if (same(s.base, s.value)) storage.removeItem(key(id))
    else storage.setItem(key(id), JSON.stringify({ base: s.base, value: s.value, seeds: [...s.seeds] }))
    if (!disposed) onChange(id, s.value)
  }
  function load(id: string): Promise<ReferenceLibrary> {
    const s = state(id)
    if (s.recoveryError) return Promise.reject(s.recoveryError)
    if (s.loaded) return Promise.resolve(s.value)
    if (s.loading) return s.loading
    s.loading = (async () => {
      try {
        const remote = parseReferenceLibrary(await loadRemote(id))
        const combined = merge(s.base, s.value, remote, s.seeds)
        s.base = remote
        s.value = combined
        s.seeds.clear()
        s.loaded = true
        publish(id, s)
        return s.value
      } catch (error) { report(id, error); throw error }
      finally { delete s.loading }
    })()
    return s.loading
  }
  function flush(id: string): Promise<void> {
    const s = state(id)
    clearTimeout(s.timer)
    const run = s.queue.catch(() => undefined).then(async () => {
      await load(id)
      while (!same(s.base, s.value)) {
        const sent = s.value
        const saved = parseReferenceLibrary(await saveRemote(id, sent))
        s.value = merge(sent, s.value, saved, new Set())
        s.base = saved
        publish(id, s)
      }
      if (!disposed) onError(id, '')
    }).catch((error: unknown) => { report(id, error); throw error })
    s.queue = run
    return run
  }
  function observe(id: string, refs: readonly DocumentReference[]) {
    const s = state(id)
    if (s.recoveryError) { report(id, s.recoveryError); return }
    const entries = new Map(s.value.entries.map(entry => [entry.id, entry]))
    let highWater = s.value.highWater
    const deletedIds = new Set(s.value.deletedIds)
    for (const ref of refs) {
      highWater = Math.max(highWater, ref.number)
      const entry = cleanEntry(ref)
      const previous = s.seen.get(ref.id)
      // Only a deletion made in this live session may be revived by an
      // absent-to-present body transition (undo or an intentional new paste).
      // Remote/persisted tombstones never gain this permission during loading.
      if (deletedIds.has(ref.id) && s.liveDeleted.has(ref.id) && !s.present.has(ref.id)) {
        deletedIds.delete(ref.id)
        s.liveDeleted.delete(ref.id)
      }
      // A known body ID changes metadata only after an observed body edit/undo.
      // Seeing an old body for the first time never overwrites a newer remote entry.
      if (!deletedIds.has(ref.id) && (!entries.has(ref.id) || (previous !== undefined && !same(previous, entry)))) {
        entries.set(ref.id, entry)
        if (!s.loaded && previous === undefined) s.seeds.add(ref.id)
        else s.seeds.delete(ref.id)
      }
      s.seen.set(ref.id, entry)
    }
    s.present = new Set(refs.map(ref => ref.id))
    const next = { ...s.value, entries: [...entries.values()], deletedIds: [...deletedIds], highWater }
    if (same(next, s.value)) return
    s.value = parseReferenceLibrary(next)
    publish(id, s)
    clearTimeout(s.timer)
    s.timer = setTimeout(() => { void flush(id).catch(() => undefined) }, 300)
  }
  async function mutate(id: string, change: (value: ReferenceLibrary) => ReferenceLibrary) {
    await load(id)
    const s = state(id)
    s.value = parseReferenceLibrary(change(s.value))
    publish(id, s)
    await flush(id)
  }
  return {
    load, observe, flush,
    get: (id: string): ReferenceLibrary => state(id).value,
    async collect(id: string, input: LibraryEntry): Promise<LibraryEntry> {
      const entry = cleanEntry(input)
      try { await load(id) }
      catch (error) {
        // A cold/offline collect still has a durable recovery record, even before
        // the first server snapshot becomes available for conflict checking.
        const s = state(id)
        if (!s.recoveryError && !s.value.entries.some(item => item.id === entry.id || equivalent(item, entry))) {
          s.value = parseReferenceLibrary({ ...s.value, entries: [...s.value.entries, entry], deletedIds: s.value.deletedIds.filter(deleted => deleted !== entry.id) })
          s.liveDeleted.delete(entry.id)
          publish(id, s)
        }
        throw error
      }
      const existing = state(id).value.entries.find(entry => entry.id === input.id || equivalent(entry, input))
      if (existing) { state(id).liveDeleted.delete(existing.id); await flush(id); return existing }
      await mutate(id, value => {
        state(id).liveDeleted.delete(entry.id)
        return { ...value, entries: [...value.entries, entry], deletedIds: value.deletedIds.filter(deleted => deleted !== entry.id) }
      })
      return entry
    },
    update: (id: string, entry: LibraryEntry) => mutate(id, value => {
      if (!value.entries.some(item => item.id === entry.id)) throw new Error('文献已被删除，请重新收集。')
      return { ...value, entries: value.entries.map(item => item.id === entry.id ? cleanEntry(entry) : item) }
    }),
    remove: (id: string, referenceId: string) => mutate(id, value => {
      state(id).liveDeleted.add(referenceId)
      return { ...value, entries: value.entries.filter(entry => entry.id !== referenceId), deletedIds: [...new Set([...value.deletedIds, referenceId])] }
    }),
    setStyle: (id: string, style: ReferenceStyle) => mutate(id, value => ({ ...value, entries: value.entries.map(entry => ({ ...entry, style })) })),
    async retry(id: string) {
      const s = state(id)
      await s.queue.catch(() => undefined)
      if (s.recoveryError) states.delete(id)
      s.loaded = false
      await load(id)
      await flush(id)
    },
    dispose() { disposed = true; for (const s of states.values()) clearTimeout(s.timer) },
  }
}
