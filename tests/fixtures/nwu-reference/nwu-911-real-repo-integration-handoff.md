# NWU-911 real repository integration handoff

## 1. Scope boundary

This handoff is dated 2026-08-29 and closes only W-Editor task 10 reference work. It distinguishes four non-interchangeable environments:

| Environment | What was available | What it proves | What it does not prove |
| --- | --- | --- | --- |
| 落后 NWU 副本 | `G:/NWU-911系统/lab-password-manager-source`, a non-Git historical directory | Safe route/template/syntax facts and an isolated template patch check | 真实 NWU 当前仓库 behavior, deployment, current DB, staging, or production |
| 模拟宿主 | `examples/nwu-host` in W-Editor | Public API, FormData/JSON, session, CSRF, permissions, drafts/workspace, Reader and extension contracts | Any real NWU server or user journey |
| 真实 NWU 当前仓库 | Not available in this task | Nothing yet | All implementation and migration claims remain unverified |
| 生产环境 | Not accessed | Nothing | No deployment, traffic, data migration, browser support or production acceptance |

落后副本不等于真实实现。Reference patch 和模拟宿主都不能替代真实仓库、staging 或生产环境证据。

## 2. Known lagging-copy facts and version differences

The historical copy appears to be Flask 3 + SQLite + Jinja. `blog_posts.content` is Markdown `TEXT`; blog pages require login; `public` means visible to authenticated users, while author/admin and selected/private checks add restrictions. The edit page uses a large custom Source/editable-preview implementation, FormData save, `credentials: 'same-origin'`, `X-Requested-With`, JSON preview, image upload and MathJax. It recognizes image attributes, safe span styles, alignment HTML, code, formulas, headings/TOC and `<!-- script: NAME -->` comments.

Observed gaps relative to the W-Editor host contract include no confirmed opaque `serverRevision`, no immutable article version response, no confirmed per-user recovery/workspace/preferences schema, no explicit blog save/preview CSRF check in the inspected slice, legacy image attributes that W-Editor preserves but does not apply, and a legacy script-link path that needs permission re-evaluation. These are lagging-copy observations, not assertions about the current repository.

Before editing the real repository, record its repository root, branch/commit, dirty status, deployment topology, Python/Flask/Jinja/SQLite or replacement versions, migration framework, current W-Editor version if any, and the current Web Distribution manifest/API/schema/dialect/minimum-adapter versions. Do not read or copy credentials, Cookies, sessions, user rows or production content during that inventory.

## 3. Real-repository investigation gate

The future task must stop before implementation until it has:

1. located and identity-checked the real repository without pull/reset/cleanup;
2. compared current routes, templates, DB schema/migrations, permissions and static asset layout against this handoff;
3. inspected sanitized browser/device analytics, critical editor/Reader journeys and accessibility policy;
4. recorded current CSP, reverse proxy/subpath, cache/CDN, session, CSRF and upload controls;
5. sampled article syntax only through an approved, redacted process with no real user data copied to W-Editor;
6. created an independent NWU OpenSpec with explicit migration, staging, rollback and acceptance tasks.

Any material difference supersedes the reference adapter. 禁止机械应用旧 patch；do not cherry-pick or paste it into the real repository.

## 4. API and Jinja integration

- Deploy the complete immutable Web Distribution directory, not individual JS files. Use its manifest hashes and `assetBaseUrl`.
- Jinja must inject Markdown and metadata with `tojson` or an equivalent safe JSON serializer. Never interpolate article text into executable JavaScript or HTML attributes.
- Use `mountWEditor` only after the server has authorized the edit page; use `mountWRenderer(..., { profile: 'reader' })` on read pages.
- The API/SaveAdapter must carry canonical Markdown, opaque base `serverRevision`, saveKind and host metadata. `autosave-draft` must not create permanent `versionId`; `manual-save`/`publish` must.
- Keep `AUTH_REQUIRED`, `AUTHORIZATION_DENIED`, `CSRF_REJECTED`, `REVISION_CONFLICT` and persistence failures distinct and observable.
- A local upload adapter must call an actual authorized endpoint. If unavailable, keep local upload explicitly disabled while root-relative/HTTP(S) image URLs remain usable.

## 5. DB and migration

Use [the reference schema/API draft](./nwu-911-future-schema-api-draft.md) only as a question list. Reconcile it with the current DB and migration tool before choosing table names or constraints. Preserve Markdown as the only正文 authority; do not persist Tiptap JSON, DOM, Renderer HTML or undo as competing content.

The real OpenSpec must cover transactional article revision checks, immutable article versions, per-user drafts/workspace/preferences, content-addressed assets and refs, indexes/foreign keys, backups, migration failure rollback, old URL readability and data retention. Create a protected backup before schema changes and rehearse restore against a production-shaped staging copy.

## 6. 权限, auth and CSRF

- Preserve the actual meaning of visibility. The lagging copy indicates `public` is still login-gated, not internet-anonymous.
- Reader access is decided server-side before template render. Author/admin edit routes and every save/publish/upload/visibility endpoint independently re-check authorization.
- Frontend hidden controls are presentation only and never authorization.
- Same-origin session requests must explicitly use the site's intended credential policy.
- Every state-changing FormData or JSON request must use the real framework's CSRF mechanism. `X-Requested-With` is not a CSRF defense.
- Test expired login, valid login/invalid CSRF, valid CSRF/denied permission, stale revision and approved overwrite as separate cases.

## 7. CSP, cache, proxy, assets and extensions

- CSP: inventory `script-src`, `style-src`, `font-src`, `img-src`, `frame-src`, `connect-src` and `worker-src`. Keep resources same-origin; do not loosen policy to a public CDN. draw.io needs an explicit same-origin iframe/resource decision.
- cache: deploy immutable version directories and a short/no-cache pointer. Never serve new HTML with stale JS/CSS/chunks or mix versions.
- proxy: test the real reverse-proxy prefix and generated `url_for` paths. `assetBaseUrl`, chunks, fonts, KaTeX and draw.io must remain below the selected version root.
- assets: verify existing images, uploads, root-relative URLs, permissions, MIME/size limits and rollback. Legacy width/height/align is currently preserved-not-applied and requires a real migration decision.
- extensions: resolve script comments only through an allowlist and a server-authorized download API; output goes through the shared sanitizer. Generic Web/Desktop must preserve the comment without enabling NWU behavior.

## 8. staging, 双轨 and 回退

1. Install the new distribution beside the old one; verify hashes, manifest, CSP and subpath before use.
2. In staging, run old Reader/editor and W-Editor 双轨 against cloned, redacted, production-shaped data. Compare exact Markdown, visibility, author/admin rules, versions, drafts, uploads, script links and error mapping.
3. Use a feature flag or route-level cohort; never overwrite the only production template in place.
4. Keep the old immutable Web directory and pointer available throughout the rollback window.
5. Roll back the asset pointer/templates independently from DB rollback. An older application must not write an unknown newer schema.
6. Rehearse DB backup restore, failed migration, stale cache, missing asset, auth expiry, CSRF failure and revision conflict before production cutover.

Production promotion requires automated gates, Agent trial, an approved user acceptance round, monitoring/rollback ownership and a separate deployment authorization.

## 9. Audience and browser evidence

Repository search on 2026-08-29 found no NWU audience/browser/device analytics. This absence is the evidence source for the risk decision below; current Chromium/Chrome/Edge/WebView2 results are product evidence, not audience evidence. Available local engines were Playwright Chromium only; Playwright Firefox and WebKit executables were absent. No Android SDK/emulator was configured. Windows NVDA was available. macOS Safari, iOS, Android devices, VoiceOver, TalkBack and JAWS were not exercised.

Existing standalone evidence records bundled Chromium `151.0.7922.34`, Chrome `152.0.7977.64`, Edge/WebView2 `152.0.4191.53`, WCAG automation/keyboard/zoom/reduced motion and a real Windows NVDA journey. None of it implies Firefox, WebKit/Safari, iOS or Android coverage for NWU.

### Real-site test matrix decision

| Environment | Disposition for the future real integration | Blocking journeys / rationale | Current status and evidence gate |
| --- | --- | --- | --- |
| Stable desktop Chrome/Chromium | blocking | login, public/selected/private Reader, author edit, save/autosave/conflict, upload, clipboard, fullscreen, print/export, subpath/CSP/cache, extension safety | Standalone evidence exists; real NWU host journey unverified and must rerun |
| Stable desktop Microsoft Edge | blocking | same journeys plus enterprise download/storage policies | Standalone evidence exists; real NWU host journey unverified and must rerun |
| Firefox | blocking | Reader and Editor smoke, selection/IME, save, upload, clipboard, print/export, focus and sanitizer | Engine unavailable locally; install/test in the real change before readiness |
| Desktop WebKit/Safari | deferred with evidence | macOS share and device availability are unknown; WebKit editing/download/storage can differ | No analytics or macOS environment. The real change must either promote to blocking and pass or document an owner-approved evidence-based exclusion before readiness |
| iOS Safari and relevant iOS webviews | deferred with evidence | touch selection, virtual keyboard/IME, viewport resize, Reader, file/upload and storage lifecycle depend on actual mobile audience | No analytics/device. Same promotion-or-evidence gate as above; desktop Chromium cannot substitute |
| Android Chrome and relevant Android webviews | deferred with evidence | touch selection, virtual keyboard/IME, Reader, file/upload/download and lifecycle persistence | No analytics/SDK/device. Same promotion-or-evidence gate as above |
| Accessibility environments | blocking core; platform AT deferred with corresponding platform | keyboard-only, 200%/400% zoom/reflow, contrast, reduced motion, error announcements; NVDA+Chrome/Edge and NVDA+Firefox. VoiceOver+Safari/iOS and TalkBack+Android follow their platform decisions; JAWS is reassessed from policy/audience data | Existing Windows NVDA is standalone only. All real-host combinations remain unverified |

Pass criteria are completed user results and preserved Markdown, not element presence. The future decision record must name evidence date/source, OS/device/browser/AT versions, findings, accepted limits, owner and reassessment date. No real-site integration-ready claim is allowed while a blocking row is untested or a deferred row lacks its required evidence/approval.

## 10. Unverified items and next ownership

Unverified: real repository identity and version, production/staging topology, current API/Jinja/DB schema, current permissions and CSRF middleware, user/device analytics, CSP/proxy/cache/CDN, upload storage/scanning, asset volume, script-library authorization, browser engines beyond current Chromium family, mobile behavior, platform assistive technology, data migration time, production rollback and user acceptance.

The next owner must create an 独立 NWU OpenSpec before any real change. The OpenSpec must reference this handoff as non-authoritative historical evidence, record differences, choose the final browser/accessibility matrix, and forbid mechanical reuse. The future Codex must not claim that the lagging copy, mock host, reference adapter or W-Editor release gates are a real implementation or production acceptance result.
