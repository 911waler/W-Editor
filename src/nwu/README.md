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

Workspace sidebar and mode restore only from a same-user, same-document server state record. The requested document ID and freshly fetched server Markdown always override cached active IDs or bodies. Original latest manual, pre-mode-switch, and pre-destructive-replacement checkpoints persist separately in user/API/canonical-document scoped browser storage; live document envelopes are seeded from server content and never from cached autosave. Checkpoint keys and remembered server layout migrate on draft promotion. This preserves the original checkpoint model without adding a version-management UI.
