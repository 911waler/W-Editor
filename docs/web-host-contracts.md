# W-Editor Web Host Contracts

<!-- Generated from packages/editor-web/src/publicContracts.ts. Keep the source type definitions authoritative. -->

Current contract versions:

- `apiVersion`: `1.0.0` — `mountWEditor`, `mountWRenderer`, instance APIs and public events.
- `schemaVersion`: `1.0.0` — document snapshots, save responses, drafts and workspace exchange values.
- `hostContractsVersion`: `1.0.0` — the contract family itself.
- `minimumHostAdapterVersion`: `1.0.0` — the lowest compatible host adapter major.

## Public boundary

Hosts call `mountWEditor(container, options)` or `mountWRenderer(container, options)`. The returned instance exposes only its documented public API: `snapshot`, `focus`, `flush`, `save`, `retry`, `exportMarkdown`, `setDocument`/`replaceDocument`, `setMarkdown` (Renderer), and `destroy`. Hosts do not import Vue components, Tiptap, CodeMirror, DOM services, or internal session objects.

`reader` and `author-preview` are the only Renderer profiles. Reader is read-only and does not emit author events.

The Web package consumes the shared implementation only through the `@w-editor/editor-vue/host` public bridge. It does not reach into editor-vue `src/` files or expose Vue/session objects to a host.

## Persistence boundary

`WSaveRequest` always carries `documentId`, canonical Markdown, `baseServerRevision`, `saveKind`, `origin`, `localRevision`, `overwrite`, and host metadata. `WSaveResponse` returns an opaque `serverRevision`, `savedAt`, optional `versionId`, and `draftState`. Autosave uses `autosave-draft`; manual save and publish are the only operations that may return a permanent `versionId`.

`serverRevision` is independent from the session-local numeric `revision`. A revision conflict keeps the local Markdown and exposes `reload`, `export`, `save-as`, and explicitly authorized `authorized-overwrite` actions. Automatic merge is not part of this contract.

Autosave is opt-in and bounded by the configured trailing delay and maximum wait. It sends `saveKind: autosave-draft` and never creates a permanent `versionId`; manual save and publish are separate operations. Save, autosave, and replacement preserve the mounted session's undo/history boundary.

Recovery drafts are keyed by `(userId, documentId)` and contain only canonical Markdown, base server revision, local revision, mode, source anchor/selection, scroll, sidebar state, schema version, and timestamp. Workspace exchange values deliberately exclude native undo, DOM, overlays, popups, hover state, and temporary UI.

## Error boundary

Public errors are discriminated by stable `code` values, including separate `AUTH_REQUIRED`, `AUTHORIZATION_DENIED`, `CSRF_REJECTED`, `REVISION_CONFLICT`, `SAVE_FAILED`, `UPLOAD_UNAVAILABLE`, `ASSET_MISSING`, `INCOMPATIBLE_HOST`, and `DESTROY_BLOCKED` categories. Each error carries retryability and safe action hints.

All snapshots, events, and error payloads delivered to a host are immutable copies. Replacing a dirty document requires an explicit host confirmation or remains blocked with save/export/cancel actions.

If no real `UploadAdapter` is configured, `uploadState()` reports `UPLOAD_UNAVAILABLE` and `uploadLocalFile()` is a no-op from the document's perspective: it cannot create a mock URL, data URL, partial node, or revision. Existing URL images can still be inserted through `insertImageUrl()` after HTTP(S)/same-origin root-relative validation; credential-bearing and non-HTTP(S) URLs are rejected.

`apiVersion`, `schemaVersion`, and the minimum host adapter version follow SemVer. Compatible majors may be used; incompatible majors and adapters below `1.0.0` fail before mount. `WEditorMountOptions.profile` is retained as a deprecated redundant field through `1.x` and is scheduled for removal in `2.0.0`, with migration metadata exposed by `DEPRECATED_PUBLIC_FIELDS`.

The browser ESM entry and IIFE API factory import the same `publicEntry` source and therefore share function identities, versions, profiles, and capability constants. They are not separate behavior implementations.
