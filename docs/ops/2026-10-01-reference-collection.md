# Persistent per-document reference collection

## Symptom

Removing the last body citation also removed its reference from the sidebar. Readers needed a way to collect references before citing them, keep shared metadata after deleting citation markers, and recover interrupted library saves.

## Confirmed cause

The sidebar was derived solely from body citation links. The editor had no separate versioned reference collection or durable pending-write recovery.

## Changes

- Add a private per-document library with revision checks, tombstones, stable IDs, DOI normalization, collection order, and a citation-number high-water mark.
- Keep cited entries above collected entries. Collection alone never adds a body citation or changes public exports.
- Capture reference changes even with the sidebar closed. Source capture uses reference-relevant change events; ordinary typing does not trigger library writes.
- Persist pending snapshots before network waits. Retry merges disjoint edits and retains overlapping conflicts for review. Only deletions made in the live session may be revived by a subsequent absent-to-present body transition.
- Expose NWU library GET/PUT transport while retaining standalone local storage services and the standalone article-switch draft/export policy.
- Synchronize the shared feature delta from the NWU checkout relative to `ab44c2a`, using the immutable snapshot captured in `/tmp/reference-collection-sync-snapshot`. Patches were applied rather than replacing the standalone Playground file.

The standalone NWU shell predates the separate history-dialog integration in the NWU checkout. Its unrelated history UI and history-copy changes were not imported; standalone collection and existing NWU transport received the applicable changes.

This is a local source update in `/tmp/w-editor-sync-20260930`. No GitHub push, production deployment, installer build, or user-data migration occurred. Source rollback is the preceding commit `11937b0`; preserve private local library and pending records when rolling back.

## Verification

- TypeScript/Vue build: `node node_modules/vue-tsc/bin/vue-tsc.js --build --force` passed.
- Fifteen focused files passed, 100 tests total, covering library recovery/conflicts, local persistence, publication, numbering, source events, clipboard and document styles, collection UI, NWU transport, announcement publication, and permissions UI fixtures.
- `git diff --check` passed.
- Compared the resulting Playground against the synchronized snapshot; the remaining differences preserve the existing standalone article-switch policy and draft/export controls.

## Remaining work

No known unresolved issue within the verified shared collection functionality. Windows application runtime/build verification remains deferred. NWU host history-dialog/copy integration is not present in this standalone branch and was not part of this scoped synchronization.
