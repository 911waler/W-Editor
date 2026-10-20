# NWU data adapter for the original Web application

The entry remains `src/main.ts` → `src/ui/App.vue` → `apps/playground/src/PlaygroundApp.vue`. Without bootstrap JSON the original standalone application runs unchanged. The NWU branch provides article data and persistence props; it does not mount the host/workspace renderer distribution.

Page contract:

```json
{"userId":"7","csrfToken":"session token","initialDocumentId":null,"readonly":false,"apiBase":"/api/blog-editor","blogListUrl":"/blogs","categories":{"other":"其他"}}
```

Emit this as safely JSON-encoded text in `script[type=application/json]#nwu-editor-bootstrap`. A new page creates a durable draft and updates the browser address with its identity. A reader page sets `readonly:true` and supplies `readerDocument:{documentId,title,markdown}` after the server checks visibility. Reader pages make no editable API requests and never restore an editor cache.

Build with Node 24 / pnpm 11 using the frozen lockfile:

```
pnpm exec vite build --base=/w-editor/web/assets/
```

Serve the **whole** `dist` directory under `/w-editor/web/assets/`, including `drawio-bridge.html`, `vendor/`, and generated `assets/`. Extract script/link resources from `dist/index.html` into the authenticated page. Both nested draw.io URLs use the Vite base. HTTP LAN deployments install an RFC4122 `crypto.randomUUID` fallback using `crypto.getRandomValues` before mounting the original application.

The adapter consumes the existing `/documents`, `/documents/:id/save`, `/state/:id`, and `/assets` contracts. Save calls serialize and retain server revision checks; an unchanged uncertain request reuses its operation ID. Local recovery records are user/API/document scoped, explicit private-copy recovery only, and never override server authority automatically. Canonical server drafts are restored only when their base revision matches the loaded document. Successful identity conversion is mapped to the existing open runtime until reload; recovery keys follow the canonical identity. Divergent server drafts and conflict edits are protected recovery records, retained even after a successful stale-base autosave.

Uploads use multipart `file`, `kind` (`image`, `attachment`, `drawio`), and `csrfToken`. Draw.io additionally sends `xml`; the returned durable PNG URL is inserted through the original draw.io command and codec while preserving encoded XML. Imported inline images/draw.io are uploaded before persistence. The shared draw.io codec also retains original PNG data URL support for standalone use.

The original manual checkpoint and lifecycle flush methods wait for IME and Visual synchronization. NWU Save and Publish call those methods. Server save failure leaves current editor content and a scoped recovery record intact. Metadata provides title, category, visibility, and allowed usernames. Its explicit Save-and-Publish action applies permission changes; ordinary Save remains nonpublishing. Reader presentation uses the existing `TiptapReaderPresentation`.

Workspace sidebar and mode restore only from a same-user, same-document server state record. The requested document ID and freshly fetched server Markdown always override cached active IDs or bodies. Original latest manual, pre-mode-switch, and pre-destructive-replacement checkpoints persist separately in user/API/canonical-document scoped browser storage; live document envelopes are seeded from server content and never from cached autosave. Checkpoint keys and remembered server layout migrate on draft promotion.

## History, references and permissions

The optional host history dialog uses `GET /documents/:id/history?cursor=...` and `GET /documents/:id/history/:versionId`. Responses follow `DocumentHistoryPage` and `DocumentHistorySnapshot` from `packages/editor-vue/src/services/documentHistory.ts`. The host must authorize both requests; restoring re-fetches the selected version, then creates a private note or unpublished announcement copy. It never overwrites the original. Recovery also preserves historical reference identities, copies the reference library and notes, and reports partial copy failures without repeating document creation. Tutorials do not expose this history dialog.

The adapter also consumes reference-library/reference-notes endpoints and optional DOI lookup. The `group` visibility choice requires server-side group membership and asset authorization. These services, authentication, publishing and authorization belong to the host; this frontend repository does not include the NWU Python server. Standalone mode uses its existing local reference and upload services, while server history and DOI lookup require an implementing host.

## Host theme and WebVPN builds

Hosted editing follows `document.documentElement.dataset.theme` (`light`/`dark`) without replacing the active document or its selection. Reader skin selection remains available. The standalone editor keeps its own appearance preference.

[Optional host assets](../../examples/nwu-host/site-assets/README.md) include the production theme controller and editor page layout/stacking styles. The theme controller also maintains reader text contrast against actual backgrounds. A host that already supplies these assets should keep one copy. Site navigation, announcements and backend rendering are separate host responsibilities.

For the full application behind WebVPN, use the [portable WebVPN build](../../docs/webvpn-build.md). It preserves the deployed classic-script entries and asynchronous CSS loader. The lower-level `@w-editor/editor-web` mount API is a separate distribution and does not contain the complete Playground toolbar and dialogs.

## Optional lifecycle policy and desktop handoff

The NWU host passes `articleSwitchPolicy: "save-discard"` to the shared Playground and supplies its canonical saved-text baseline. This enables Cancel / Discard changes / Save changes for hosted article switching. Without this explicit policy, standalone Web and Desktop retain Keep draft and Export and continue. The frontend adapter is optional and requires the host API contract above; no server or credentials are included. Windows desktop runtime integration and installer validation are deferred; see [the sync record](../../docs/ops/2026-09-30-nwu-editor-sync.md).
