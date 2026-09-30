import { normalizeReferences, referenceRegistry, scanReferences, type DocumentSession, type DocumentSnapshot } from '@w-editor/editor-core'

/** Publish a coherent snapshot; never overwrite edits made while persistence is pending. */
export async function publishReferenceSnapshot(
  session: DocumentSession,
  persist: (snapshot: DocumentSnapshot) => Promise<void>,
  flush: () => Promise<void>,
): Promise<DocumentSnapshot> {
  await flush()
  const original = session.snapshot()
  const markdown = normalizeReferences(original.markdown)
  const published = { ...original, markdown, revision: original.revision + (markdown === original.markdown ? 0 : 1) }
  await persist(published)
  await flush()
  if (session.snapshot().revision === original.revision) {
    if (markdown !== original.markdown) session.commitPatchPlan({ baseRevision: original.revision, transactionId: `references:publish:${original.revision}`, patches: [{ codecId: 'references', from: 0, to: original.markdown.length, expected: original.markdown, replacement: markdown }] }, 'toolbar-command')
    referenceRegistry(session).reset(scanReferences(markdown))
  }
  return published
}
