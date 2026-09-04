# NWU reference integration validation report

## Result

Tasks `10.1–10.7` are complete for W-Editor-side NWU reference integration and handoff. The user-authorized package-boundary repair and the resumed final gate set passed. 落后 NWU 副本不等于真实实现；模拟宿主不等于真实 NWU 当前仓库；生产环境未验证。本阶段不进入 11.x。

未来 Codex 必须建立独立 NWU OpenSpec，先核对真实仓库和环境差异。禁止机械应用旧 patch，禁止把 `tests/fixtures/nwu-reference/reference-adapter.patch` 当作可部署变更或 cherry-pick 来源。

## Task evidence

| Task | RED/compatibility evidence | Implemented artifact | Current focused result |
| --- | --- | --- | --- |
| 10.1 | Mock lacked visibility, same-origin request metadata and script extension mapping | `examples/nwu-host`, `task-10-1-*.json` | FormData/JSON, XHR, session, CSRF/auth, visibility and safe extension tests pass |
| 10.2 | Sanitized compatibility fixture absent; legacy image attributes not applied | synthetic fixture, compatibility matrix, `task-10-2-*.json` | Exact Editor/save/reopen round-trip; Reader families pass; image attributes are preserved-not-applied |
| 10.3 | No repo-local isolated runner/patch | `tests/fixtures/nwu-reference`, verifier and historical task evidence | Temp-only patch check/apply, adapter syntax/behavior and original hash unchanged pass |
| 10.4 | Non-author could mount mock Editor | role/visibility/server authorization model and `task-10-4-*.json` | Reader/editor/save matrix and distinct auth/CSRF/permission errors pass |
| 10.5 | Future schema/API draft absent | `docs/nwu-911-future-schema-api-draft.md` | Documentation contract passes; nothing is implemented in NWU |
| 10.6 | Real-repository handoff absent | `docs/nwu-911-real-repo-integration-handoff.md` | Handoff and matrix documentation contract passes |
| 10.7 | Separate validation report absent, then package-boundary gate failed | this report, package-boundary RED/resolution and final verification evidence | Package-boundary repair, full affected gates, documentation and reference-only boundary pass |

## Reference-only boundary

- The only external input was a non-Git lagging directory. The isolated runner copied only two safe Jinja templates to a system-temp directory; it did not execute Flask or read `app.py`, a database, environment/config credentials, Cookies, session files, user rows, articles or resource files.
- The W-Editor mock host proves public contracts, not a real NWU server.
- The reference adapter intentionally has no SaveAdapter because the lagging route does not provide the required opaque revision and immutable version response. It does not fabricate successful persistence.
- No commit, archive, merge, rebase, push, pull, release, deployment, reset, revert, `git clean` or worktree cleanup was performed.

## Browser and accessibility decision

No NWU audience/browser analytics were available. Current local evidence covers Playwright Chromium and previously recorded standalone Chrome/Edge/WebView2/NVDA only. It does not cover a real NWU host.

- Chrome/Chromium: blocking real-host journeys remain未验证.
- Edge: blocking real-host journeys remain未验证.
- Firefox: blocking, but its Playwright executable was unavailable in this environment.
- WebKit/Safari: deferred with evidence pending audience/macOS data; no coverage claim.
- iOS Safari/webviews: deferred with evidence pending audience/device data; no coverage claim.
- Android Chrome/webviews: deferred with evidence; no Android SDK/device was available.
- Accessibility: keyboard/zoom/reflow/contrast/reduced motion and NVDA combinations are blocking on the real host; VoiceOver, TalkBack and other policy/audience combinations follow the platform decision.

The detailed disposition, journeys and promotion-or-approved-exclusion gates are in [the handoff](./nwu-911-real-repo-integration-handoff.md). Chromium, Chrome, Edge or WebView2 results must not be used to imply Firefox, WebKit/Safari, iOS or Android support.

## Known compatibility gap and remaining risk

Legacy `{width height align}` image attributes round-trip exactly but are not applied by the shared Reader. This is intentional under the current OpenSpec non-goal and must be redesigned or migrated in the real NWU change. Also未验证: current repository identity, current API/Jinja/DB, migrations, permissions, CSRF middleware, CSP, cache, proxy, assets, extensions, staging, production data shape, mobile/AT environments, rollout, rollback and user acceptance.

## Final gate record

The historical stop is recorded in `artifacts/nwu-reference/task-10-7-blocker.json`. After explicit user authorization, the repair kept `release/versions.json` as the only editable authority, generated an exact package-local projection for editor-web, made root/package typecheck fail on projection drift, updated release-version verification, and left the dependency gate strict. Focused evidence is in `task-10-7-package-boundary-red.json`, `task-10-7-package-boundary-resolution.json` and `task-10-7-release-version-verification.json`.

The complete resumed gate results are recorded in `artifacts/nwu-reference/task-10-7-current-verification.json`: lockfile, generated version consistency, typecheck, full lint, dependency/ownership/feature gates, Web and NWU production builds, Web manifest closure, isolated adapter, bundled-Chromium journeys, formal fail-closed fault injection, docs, OpenSpec strict and diff checks passed. Task 10.7 is complete.
