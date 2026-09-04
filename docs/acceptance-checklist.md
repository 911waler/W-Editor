# W-Editor first-round acceptance checklist

This checklist is the handoff contract for the frozen W-Editor product baseline. A checked automated row means the named gate produced passing evidence; it does not mean the user accepted the editor.

## Acceptance policy

- Tasks 1.1–18.8 and every mandatory automated gate must pass before the editor is handed to the user.
- The production application remains running while the user completes the full hands-on pass below, including a real Chinese IME and the pinned same-origin draw.io flow.
- Findings are classified as a defect, an in-scope clarification, or a new capability. Defects and approved in-scope clarifications invalidate and rerun affected evidence and the whole user pass.
- The change must not be archived, merged, or committed as accepted during this implementation run. Task 18.9 stays open until the user explicitly confirms the complete first-round editor. Archive or commit requires a later, separately authorized action.

## Requirement-derived checks

Evidence paths are stable targets that later tasks must make executable. The requirement title is copied exactly from the seven delta specifications.

| Requirement ID | Requirement | Automated evidence | Hands-on check |
| --- | --- | --- | --- |
| `EWS-01` | Executable independent web workspace | `e2e/workspace.spec.ts`; production build; system smoke | Open the served production app without a backend and confirm catalog, toolbar, editor, preview, fixtures, and exports are usable. |
| `EWS-02` | Mutually exclusive workspace modes | `e2e/workspace.spec.ts` mode cases | Switch source → visual → preview repeatedly and confirm exactly one current, correctly focused surface. |
| `EWS-03` | W-Editor owns the command surface | `tests/commands/registry.spec.ts`; `e2e/toolbar-matrix.spec.ts` | Confirm one W-Editor toolbar changes behavior by mode and no Cherry/Tiptap product toolbar appears. |
| `EWS-06` | Primary toolbar remains available during page scrolling | sticky/responsive component tests; production page/internal-scroll E2E; strict pixel cases | At desktop and narrow widths, scroll the page past the toolbar and exercise internal editor scroll; verify main/right controls remain at viewport top, header scrolls away, mode/status remain non-sticky, and open overlays stay anchored, unclipped, and keyboard reachable. |
| `EWS-04` | Continuous Word-like document canvas | `e2e/structured-editing.spec.ts`; visual snapshots | Read and edit a multi-block document on wide and narrow viewports; confirm one continuous sheet without paragraph cards or fake pages. |
| `EWS-05` | Observable workspace state | `tests/services/workspace-state.spec.ts`; `e2e/failure-journeys.spec.ts` | Observe mode, sync, autosave, manual dirty, and actionable failure/retry states while editing. |
| `MCP-01` | Markdown is the sole content authority | `tests/core/document-session.spec.ts`; `tests/codecs/round-trip.spec.ts` | Edit in both modes, inspect source after each flush, reload, and confirm Markdown alone restores the document. |
| `MCP-11` | Active-surface edits converge through the Markdown authority | split-identity and synchronization unit/adapter tests; production Source/Visual convergence E2E | Use real Enter and continued typing in Visual, then Source edits and mode activation; verify unique identities, bounded accepted revisions, exact Source/Visual/Final convergence, truthful failure/Retry, raw export, undo, reload, and clean diagnostics. |
| `MCP-02` | Untouched Markdown remains lexically intact | `tests/codecs/round-trip.spec.ts`; join E2E | Apply one inline change and one block join in a lexically varied file; diff only the declared safe ranges. |
| `MCP-03` | Known syntax round-trips through registered codecs | codec fixture matrix; Cherry oracle | Open every toolbar syntax in visual mode without editing, return to source, and compare source and preview. |
| `MCP-04` | Unknown or unadapted syntax is lossless and visible | `tests/codecs/raw.spec.ts`; raw-node E2E | Confirm unknown inline/block characters remain visible; apply and cancel local raw edits and re-open source. |
| `MCP-05` | Visual changes use bounded synchronization | fake-time sync tests; authority E2E seam | Type continuously, observe pending then current authority, and confirm no duplicate reflected revision. |
| `MCP-06` | Lifecycle operations force a current revision | lifecycle/composition unit and E2E cases | Type then immediately preview, save, export, or switch; confirm the latest completed text is used. |
| `MCP-07` | Mode conversion is an atomic transaction | mode failure matrix; `e2e/failure-journeys.spec.ts` | Trigger each deterministic conversion failure and confirm current mode, selection, source, and recovery action remain available. |
| `MCP-08` | Local node failures do not masquerade as global conversion failures | raw/Mermaid/media failure cases | Load incomplete/raw, invalid Mermaid, and unavailable media together; confirm only affected nodes degrade. |
| `MCP-09` | Mode histories have explicit boundaries | history integration tests; checkpoint E2E | Undo within each activation, switch modes, verify undo cannot cross, then explicitly restore a checkpoint and undo that restore. |
| `MCP-10` | Final output is rendered safely by Cherry | Cherry oracle and sanitizer suites; preview E2E | Preview representative syntax and unsafe raw HTML; confirm Cherry meaning remains while scripts/events/unsafe URLs do not execute. |
| `SVE-01` | Ordinary blocks form one editing surface | Tiptap integration tests; real-browser editing E2E | Use arrows, Shift-selection, typing, copy, and deletion across paragraph/heading boundaries. |
| `SVE-08` | Enter and Shift+Enter retain distinct Tiptap and Markdown semantics | codec/adapter split and hard-break tests; real-key production E2E; scoped pixel comparison | Press Enter and Shift+Enter with real keys in controlled paragraphs; verify paragraph versus hard-break DOM, caret, unique identity, exact Markdown bytes, reference rhythm, one-step undo, and reload. |
| `SVE-09` | Real selection and focus drive formatting commands | selection/shortcut/command-result tests; pointer and physical-key production E2E | Form pointer and immediate keyboard selections, apply Italic through toolbar and Ctrl+I without waits, then invoke a no-change command; verify focus, exact mark/Markdown, truthful feedback, undo, and diagnostics. |
| `SVE-02` | Backspace and Delete merge compatible text blocks symmetrically | join unit/integration/E2E matrix | Join compatible blocks in both directions, inspect caret/source, undo once, and test adjacent atomic/raw nodes. |
| `SVE-03` | Directly structured content remains directly editable | codec/command matrices; structured E2E | Directly edit mixed marks, headings, lists, links, breaks, formulas, alignment, and ordinary tables; in the actual Welcome mixed-mark chain verify adjacent Ruby keeps its exact base/annotation in Visual and Final without literal braces or an authority rewrite. |
| `SVE-10` | Lists use native editing semantics and an approved hanging indent | list adapter/component geometry and accessibility tests; production real-input and pixel E2E | Insert ordered, unordered, nested, and task lists from the toolbar; immediately type and use Enter for non-empty split and empty exit; verify focus, marker/checkbox/text anchors, horizontal task layout, keyboard/SR semantics, exact Markdown, undo, reload, desktop, and narrow states. |
| `SVE-11` | Quote creation uses toolbar and mode-appropriate contextual controls | text-style toolbar, block-handle/input-rule, and Source-bubble tests; production keyboard/pointer E2E | Use Text style → Quote in Source or Visual; in Visual also use the six-dot handle, its keyboard equivalent, and `> `; in Source retain the selection bubble and direct Markdown; verify focus, exact blockquote source/Final, undo/reload, and the compact `>` icon. |
| `SVE-04` | Semantic nodes are navigable document objects | NodeView tests; semantic navigation E2E | Select, arrow past, and open each semantic node without focus traps or nested-editor leakage. |
| `SVE-05` | Dedicated editors commit one transaction | editor-host tests; semantic apply/cancel E2E | Change a draft then cancel/decline close; apply a valid change and confirm exactly one undo reverses it. |
| `SVE-06` | Visual undo and redo contain user intent | visual history integration suite plus rapid long-article Chromium matrix | Edit, wait for sync/autosave/preview work, then undo/redo and confirm one user action per step without loops. Preload an older article-end edit, rapidly press Enter ten times in paragraph 49, then verify ten undo and ten redo operations each change one break, retain exact unrelated Markdown, and keep the matching caret/viewport local. |
| `SVE-07` | Complex controls do not fragment ordinary presentation | shell/NodeView E2E and visual checks | Move hover/selection across the sheet and confirm controls appear only for the relevant complex node. |
| `CTS-12` | Toolbar and component parity follow frozen reference ownership plus accepted user overrides | 80-command/component validators; reference manifest; DOM/geometry/behavior/pixel suites | Reconcile all 80 command rows and every associated component row against the frozen owners, the accepted Text style Quote override, and the non-command whole-app Theme menu, including group/order/location, DOM/geometry, tokens, selection/caret, keyboard/focus, contextual UI, states, accessibility/responsive behavior, Markdown/Final outcomes, and approved exceptions. |
| `CTS-01` | Text and heading commands match the Cherry top toolbar | command fixture matrix; toolbar E2E | Run all text/heading rows in the command checklist in source and visual modes using real selection/focus; inspect active state, exact changed transaction, Source/Final, undo, and reload. |
| `CTS-02` | List and panel commands match the Cherry top toolbar | list/panel codecs; toolbar E2E | Create all three lists and all five panel variants; edit and preview each. |
| `CTS-03` | Layout and disclosure commands match the Cherry top toolbar | compound codec tests; toolbar and pixel E2E | Apply four alignments including single/final-line Justify; insert/edit columns, tabs, Accordion, and every Timeline state; verify errors, exact Source/Final, undo, reload, and reference presentation. |
| `CTS-04` | Formula and drawing commands match the Cherry top toolbar | formula picker/render and draw.io suites | Use the one formula picker for Inline and Block with keyboard/templates/symbols/invalid Retry, then complete/close the pinned local draw.io flow; verify focus, exact Markdown/Final, undo, reload, and diagnostics. |
| `CTS-05` | Insert menu matches the Cherry top toolbar | insert command matrix E2E | Open Insert in each mode, verify every item and disabled reason, exercise the accessible 9-by-9 Table picker and heading-derived TOC, then apply/cancel every dialog family. |
| `CTS-06` | Mermaid menu matches the Cherry top toolbar | parameterized six-type unit/E2E suites | Insert and edit all six starters; make one invalid and confirm only its preview reports an error. |
| `CTS-07` | Chart-table menu matches the Cherry top toolbar | parameterized eight-type unit/E2E suites | Insert all eight starters; verify real Visual/Final charts, hover/focus edit access and double-click; edit data/title/type against the draft-only live preview, then verify Apply/Cancel, source, undo and reload. |
| `CTS-08` | Search and workspace utilities match the Cherry top toolbar | utilities unit/E2E suite | Open the non-modal editor-adjacent search bar without a backdrop or editor focus loss; search a long Source/Visual/Preview document, verify every visible match and the stronger active match, navigate with centered scrolling, continue editing while the bar remains open, and use checked replace/replace-all where allowed. Record a real physical shortcut including conflicts, persistence and reset; change mode/fullscreen/language; and inspect counts without unintended content revisions. |
| `CTS-09` | Export commands match the Cherry right toolbar | export unit/E2E suite | Export Markdown, HTML, Word, PDF, and long screenshot; compare PDF text wrapping and inline/block formula geometry with the canonical desktop Final Preview, then verify each download, opaque remote-image placeholder/notice, and genuine PDF/capture encoding, taint, and oversize failures. |
| `CTS-10` | Commands are mode-aware and centrally described | registry contracts; matrix reconciliation | Inspect active/disabled/explanation state across source, visual, and preview and compare equivalent Cherry meaning. |
| `CTS-11` | Product toolbar scope is explicit and complete | matrix validator; exclusion E2E | Confirm all in-scope rows are reachable and demo smile/help plus mobile/copy/theme/code-theme controls are absent. |
| `LDL-01` | Local documents are isolated by document identity | repository suite; startup E2E | Edit each fixed article, reload, and confirm content/status never leak between IDs. |
| `LDL-02` | Article panel performs real switching with bounded first-round scope | catalog/panel/outline unit and E2E cases | Collapse, resize, switch `Articles` / `Outline`, and switch articles; inspect status/recovery fields, navigate H1–H5 in Source/Visual/Final, verify the no-heading state, and confirm no fake create/rename/delete/search/sort/group/history controls. |
| `LDL-03` | Autosave provides recovery rather than a named version | fake-time autosave suite; reload E2E | Type continuously, observe save states/recovery, inject storage failure, and verify no manual version or binary storage. |
| `LDL-04` | Startup restores the last active recoverable document | recovery startup E2E | Reload valid state, then load corrupt and unknown envelopes; export raw before explicit clear/reset. |
| `LDL-05` | Article switching protects unflushed work and preserves manual dirty state | switch coordinator tests; E2E | Switch after safe autosave without prompt; inject each flush failure and confirm switch blocks without clearing dirty state. |
| `LDL-06` | Save semantics have three distinct layers | repository/manual-save/export suites | Compare autosave, Save version, and Markdown download effects on recovery, checkpoint, and dirty state. |
| `LDL-07` | Import and destructive replacement have explicit recovery protection | destructive coordinator tests/E2E | Cancel, fail, and confirm import/clear/reset; restore the prior content and inspect independent checkpoint overwrite. |
| `LDL-08` | Checkpoint restoration creates a new recoverable revision | checkpoint integration/E2E | Restore each checkpoint, observe autosave/revision increase, then undo to the replaced current content. |
| `LDL-09` | Same-document multi-tab writes are intentionally last-writer-wins | repository contract test and documentation check | Open two tabs, write the same ID in sequence, and confirm documented last-successful-write behavior without conflict claims. |
| `ECI-01` | Complex content uses a consistent semantic-node contract | semantic-node unit/E2E matrix | Inspect typed identity, preserved data, preview/error, keyboard selection, and edit action for each complex family. |
| `ECI-02` | Ordinary tables use Cherry insertion, Tiptap Visual editing, and Cherry final rendering | accessible 9-by-9 picker plus Tiptap table unit/integration/E2E and pixel suite | Choose dimensions by pointer/keyboard/SR, edit cells, use grouped overlay/handle menus to add/delete/move/duplicate rows and columns, align and one-time sort, verify deferred advanced actions remain absent, exact pipe Markdown, Cherry Final, undo, and reload. |
| `ECI-03` | Code blocks are directly editable in Visual | direct-code adapter/component tests; real-browser code and optional-editor E2E | Type/select/newline/undo directly in code, change language, copy, use context actions, verify safe fences and highlighting, then Apply/Cancel/fail/Retry the optional advanced editor and check Source/Final/reload. |
| `ECI-10` | Code folding is session-only presentation state | code session-state/export tests; Visual/Final production E2E | Fold and expand code in Visual and Final; prove default expanded in a new session and zero Markdown, revision, autosave content, undo, or export effect. |
| `ECI-04` | Mermaid diagrams use source editing and rendered preview | Mermaid suite | Apply valid/invalid source, retain exact invalid text, navigate, reload, edit again, and preview final output. |
| `ECI-05` | Chart tables expose data and chart configuration | chart-table suite | Confirm a real Visual chart and accessible backing data; change cells/title/type against the draft-only live preview, then Apply once or Cancel and verify revision/undo behavior. |
| `ECI-06` | Cherry compound syntax has an explicit editing route | compound codec/editor suites | For each construct, use its declared direct or dedicated route and attempt an invalid container shape. |
| `ECI-11` | Formula, timeline, and TOC have dedicated Visual representations | formula/Timeline/TOC component and production Source/Visual/Final suites | Verify Inline/Block formulas render and edit, every Timeline state matches Cherry-specific Visual presentation, and TOC derives/live-updates from empty, duplicate, Unicode, added, renamed, removed, and reordered headings with working anchors and Final links. |
| `ECI-07` | Media and attachment input works without a production backend | mock upload contract; media E2E | Insert URL and local fixture variants; cancel/fail uploads and inspect storage for URLs/metadata only. |
| `ECI-08` | Draw.io uses Cherry's self-hosted static integration behind a controlled bridge | protocol/static-resource suites; fake iframe E2E | Reject hostile origin/window/request/payload, complete/close the fake flow, then repeat create/edit/Apply/Close against the pinned local editor with external networking disabled. |
| `ECI-09` | Embedded content remains safe and degradable | sanitizer and fallback E2E | Break external assets/previews and attempt article script injection; confirm usable fallbacks and no execution. |
| `RV-01` | Toolchain and upstream packages are reproducible | frozen clean install and dependency audit | Inspect recorded versions and run the delivered start command without sibling source repositories or a backend. |
| `RV-02` | Automated completion gates are mandatory | Task 18.4/18.5 gate report | Review exit codes and evidence for typecheck, lint, Vitest, Playwright, build, browser smoke, and strict OpenSpec. |
| `RV-03` | Browser tests exercise the built application | Playwright webServer/readiness/process assertions | Observe that E2E serves `dist`, uses visible UI and isolated storage, and leaves no preview process behind. |
| `RV-13` | Reference parity uses frozen pixel and behavioral evidence | baseline-manifest integrity test; strict bundled-Chromium scoped screenshots; independent behavior assertions | Review source/date/browser/viewport/DPR/fonts/theme/locale/fixture/time/region/mask/tolerance/owner/exception metadata, compare scoped W-Editor states in bundled Chromium, and confirm Chrome/Edge are behavior-only smoke targets. |
| `RV-04` | Every public toolbar command has an outcome test | registry-driven `e2e/toolbar-matrix.spec.ts` | Complete every stable-ID row below and compare the stated command-specific outcome. |
| `RV-05` | Core editing journeys are tested as user behavior | production-app journey suites | Repeat the highest-risk editing, failure, lifecycle, and recovery journeys through visible UI. |
| `RV-06` | Browser diagnostics are part of automated assertions | diagnostic harness self-tests and E2E attachments | Trigger a controlled console/page/request error and confirm the test fails with attached diagnostic. |
| `RV-07` | Chrome and Edge receive real smoke verification | `tests/fixtures/acceptance/system-browser-smoke.json` | Review detected stable Chrome/Edge versions and repeat compact edit/preview/reload flow if desired. |
| `RV-08` | IME and representative document behavior are verified proportionately | composition E2E; long smoke; 1 MB diagnostic report | Type Chinese with a real IME through lifecycle actions; edit/save/reload the representative long file; review diagnostic-only 1 MB timing. |
| `RV-09` | External integrations are deterministic in verification | upload/fake draw.io fixtures and E2E | Run fixture upload and local draw.io flows offline and confirm validation matches runtime contracts. |
| `RV-10` | Manual acceptance is a release gate | this checklist; Task 18.9 remains open | Complete this entire checklist and explicitly report acceptance or consolidated findings. |
| `RV-14` | First-round acceptance findings are fully traceable | `docs/user-acceptance-remediation-matrix.md`; focused UA suites; affected-gate reports | Complete the `UA-001`–`UA-020` route below, verify each row's focused and invalidated full gates, then repeat this whole checklist; do not close Task 18.9 from isolated UA checks. |
| `RV-11` | Trial feedback updates the correct specification layer | Task 18.7 finding log | Review every finding classification before any in-scope fix or new-change work begins. |
| `RV-12` | Future website integration triggers compatibility planning | browser-readiness guidance and compatibility-readiness test | Confirm future website work is instructed to assess audience analytics, engines, mobile, and accessibility. |

## Mandatory cross-cutting hands-on routes

These routes do not replace the requirement or command rows. They ensure the repaired product is exercised through the browser boundaries that the first acceptance pass disproved.

| Route ID | Required hands-on route |
| --- | --- |
| `X-01` | With a real Chinese IME, compose and commit text in Source and Visual; request preview, manual save, article switch, and page leave around composition; verify no intermediate text becomes authoritative and completed text commits exactly once. |
| `X-02` | Establish Source → Visual → Final and Visual → Source → Final convergence using ordinary text, Enter, Shift+Enter, marks, lists, table, code, formula, Timeline, and TOC; verify exact authoritative revision, truthful pending/failed/synchronized states, raw export, Retry, undo, and reload. |
| `X-03` | Use real pointer selection, keyboard selection, physical keydown, immediate toolbar-to-key input, DOM focus, caret, and selection; direct registry dispatch, numeric-only selections, test-only helpers, and arbitrary sleeps do not satisfy this route. |
| `X-04` | At 1440×1000 and 768×900, verify the continuous sheet, list/task geometry, toolbar grouping/overflow, viewport sticky behavior, scrolling header, non-sticky mode/status, and unclipped anchored overlays. |
| `X-05` | In Source and Visual, create and edit new/existing Panel and code nodes; cover valid Apply, validation, serialization, stale-selection, revision, planning and transaction failures, invalid-then-retry, Cancel and dirty close; verify draft, pending/error state, exact revision/undo/Markdown, focus and diagnostics. |
| `X-06` | Load unknown/incomplete syntax and corrupt/unsupported local envelopes; verify visible lossless raw nodes, local raw editing, raw envelope download before reset, Source availability, exact Markdown export, and no automatic overwrite. |
| `X-07` | For every content family, verify one user action produces the declared revision/undo step, hydration/autosave/presentation state does not pollute history, mode activation creates a boundary, and reload reconstructs only from Markdown/local envelopes. |
| `X-08` | Run keyboard-only and screen-reader routes for toolbar/menu/picker/dialog, list/task, Quote, Table, TOC and shortcut recorder; verify accessible names, state announcements, focus containment/return and responsive reachability. |
| `X-09` | Complete the pinned local draw.io create/edit/Apply/Close path after the deterministic fake-iframe suite; verify no external request, exact allowed origin/window/request handling, preserved Markdown on failure, and visible quota/recovery behavior. |

## Public command hands-on matrix

For every row, automated evidence is the stable-ID case in `e2e/toolbar-matrix.spec.ts` plus the matching unit/codec family named in `docs/toolbar-command-matrix.md`. During hands-on acceptance, invoke the command from visible UI in every applicable mode, verify the command-specific source/application outcome and disabled explanation, then verify preview, persistence, and undo wherever the source matrix requires them.

| Acceptance ID | Stable command ID | Hands-on focus |
| --- | --- | --- |
| `CMD-001` | `text.bold` | Exact bold range and active state. |
| `CMD-002` | `text.italic` | Exact italic range and active state. |
| `CMD-003` | `text.strike` | Exact strike range and active state. |
| `CMD-004` | `text.underline` | Exact underline range and active state. |
| `CMD-005` | `text.subscript` | Exact subscript range and active state. |
| `CMD-006` | `text.superscript` | Exact superscript range and active state. |
| `CMD-007` | `text.ruby` | Cherry-referenced base/annotation or pinyin picker, keyboard/focus, rendering, exact source, cancel, undo, reload, and Final. |
| `CMD-080` | `block.quote` | Compact `>` entry in the Text style menu plus contextual `Turn into → Quote`, exact blockquote Markdown, cancel, undo, and reload. |
| `CMD-008` | `text.size` | Size picker value, source, and active state. |
| `CMD-009` | `text.color` | Text-color picker, source, and active state. |
| `CMD-010` | `text.background` | Background picker, source, and active state. |
| `CMD-011` | `block.h1` | H1 source/visual active state. |
| `CMD-012` | `block.h2` | H2 source/visual active state. |
| `CMD-013` | `block.h3` | H3 source/visual active state. |
| `CMD-014` | `block.h4` | H4 source/visual active state. |
| `CMD-015` | `block.h5` | H5 source/visual active state and H6 absence. |
| `CMD-016` | `list.ordered` | Cherry hanging indent, toolbar focus, immediate real Enter, non-empty split, empty exit, nesting, exact Markdown, undo, reload, desktop/narrow and keyboard/SR. |
| `CMD-017` | `list.unordered` | Cherry hanging indent, toolbar focus, immediate real Enter, non-empty split, empty exit, nesting, exact Markdown, undo, reload, desktop/narrow and keyboard/SR. |
| `CMD-018` | `list.task` | Marker-free horizontal checkbox/content row, immediate caret/typing, check state, hanging indent, Enter split/exit, exact Markdown, undo, reload and keyboard/SR. |
| `CMD-019` | `panel.primary` | Cherry Panel parity plus valid Apply, every deterministic failure, invalid Retry, cancel/dirty close, exact revision/undo/Markdown, focus and diagnostics. |
| `CMD-020` | `panel.info` | Info typed preview and apply/cancel. |
| `CMD-021` | `panel.warning` | Warning typed preview and apply/cancel. |
| `CMD-022` | `panel.danger` | Danger typed preview and apply/cancel. |
| `CMD-023` | `panel.success` | Success typed preview and apply/cancel. |
| `CMD-024` | `align.left` | Compatible range and left preview. |
| `CMD-025` | `align.center` | Compatible range and centered preview. |
| `CMD-026` | `align.right` | Compatible range and right preview. |
| `CMD-027` | `align.justify` | Single-line and multiline Chinese/English final-line fill in Visual/Final, literal Source round-trip, computed pixels, undo and reload. |
| `CMD-028` | `layout.two-column` | Starter, edit route, and exact container patch. |
| `CMD-029` | `layout.multi-column` | Starter, extra columns, and validation. |
| `CMD-030` | `layout.tabs` | Starter, disclosure behavior, apply/cancel. |
| `CMD-031` | `layout.accordion` | Cherry component hierarchy/tokens, keyboard disclosure, starter, validation, apply/cancel, exact Source/Final, undo and reload. |
| `CMD-032` | `layout.timeline` | Every Cherry state and pixel hierarchy, editing/local error, apply/cancel, exact Source/Final, undo and reload. |
| `CMD-033` | `insert.image` | URL/upload success, edit, fallback, cancel/fail. |
| `CMD-034` | `insert.audio` | URL/upload success, edit, fallback, cancel/fail. |
| `CMD-035` | `insert.video` | URL/upload success, edit, fallback, cancel/fail. |
| `CMD-036` | `insert.link` | URL validation, active state, edit, cancel. |
| `CMD-037` | `insert.horizontal-rule` | Exact insertion, preview, undo. |
| `CMD-038` | `insert.hard-break` | Exact break semantics, preview, undo. |
| `CMD-039` | `insert.code-block` | Direct Visual typing/selection/newline/language/highlight/copy/context/native undo/safe fences, optional CodeMirror lifecycle, Visual/Final fold with zero content effect, Source/Final and reload. |
| `CMD-040` | `insert.inline-code` | Tiptap Visual editing DOM/style/selection, mixed marks, exact delimiters, Cherry Final, computed pixels, undo and reload. |
| `CMD-041` | `insert.formula` | One Cherry-style keyboard picker for Inline and Block, templates/symbols, invalid Retry, visible Visual math, exact source forms, Final, undo and reload. |
| `CMD-042` | `insert.toc` | Empty and populated Visual TOC, live add/rename/remove/reorder, duplicate/Unicode anchors, keyboard navigation, exact Source, Cherry Final links and reload. |
| `CMD-043` | `insert.table` | Accessible Cherry 9-by-9 choice/cancel plus Tiptap cell/overlay/handle/grouped-menu operations, add/delete/move/duplicate, alignment, one-time sort, absent advanced actions, exact pipe Markdown, Final, undo and reload. |
| `CMD-044` | `insert.pdf` | URL/upload card, edit, reload, cancel/fail. |
| `CMD-045` | `insert.word` | URL/upload card, edit, reload, cancel/fail. |
| `CMD-046` | `insert.file` | URL/upload card, edit, reload, cancel/fail. |
| `CMD-047` | `insert.drawio` | Hostile rejection, online apply/cancel/edit/quota. |
| `CMD-048` | `mermaid.flowchart` | Starter, source edit, invalid local error. |
| `CMD-049` | `mermaid.sequence` | Starter, source edit, invalid local error. |
| `CMD-050` | `mermaid.state` | Starter, source edit, invalid local error. |
| `CMD-051` | `mermaid.class` | Starter, source edit, invalid local error. |
| `CMD-052` | `mermaid.pie` | Starter, source edit, invalid local error. |
| `CMD-053` | `mermaid.gantt` | Starter, source edit, invalid local error. |
| `CMD-054` | `chart.line` | Type/title/data apply and preview. |
| `CMD-055` | `chart.bar` | Type/title/data apply and preview. |
| `CMD-056` | `chart.radar` | Type/title/data apply and preview. |
| `CMD-057` | `chart.map` | Type/title/data apply and preview. |
| `CMD-058` | `chart.heatmap` | Type/title/data apply and preview. |
| `CMD-059` | `chart.scatter` | Type/title/data apply and preview. |
| `CMD-060` | `chart.pie` | Type/title/data apply and preview. |
| `CMD-061` | `chart.sankey` | Type/title/data apply and preview. |
| `CMD-062` | `history.undo` | Active-mode single intent; no boundary traversal. |
| `CMD-063` | `history.redo` | Active-mode single intent; no boundary traversal. |
| `CMD-064` | `document.manual-save` | Flush, latest checkpoint, dirty becomes clean. |
| `CMD-065` | `search.replace` | Navigation, checked replace, cancel, preview safety. |
| `CMD-066` | `settings.shortcuts` | Armed physical keydown recording, modifier normalization/keycaps, reserved/duplicate conflicts, acceptance, immediate routing, persistence/reload, reset, focus/keyboard access and zero content revision. |
| `CMD-067` | `mode.source` | Atomic activation, checkpoint, one surface. |
| `CMD-068` | `mode.visual` | Atomic activation, checkpoint, one surface. |
| `CMD-069` | `mode.preview` | Flushed read-only Cherry output. |
| `CMD-070` | `application.fullscreen` | Enter/exit/failure/cleanup without revision. |
| `CMD-071` | `language.zh` | Chinese labels; IDs/source unchanged. |
| `CMD-072` | `language.en` | English labels; IDs/source unchanged. |
| `CMD-073` | `language.ru` | Russian labels; IDs/source unchanged. |
| `CMD-074` | `document.word-count` | Current flushed counts without revision. |
| `CMD-075` | `export.markdown` | Exact Markdown bytes; save states unchanged. |
| `CMD-076` | `export.html` | Safe standalone HTML or visible failure. |
| `CMD-077` | `export.word` | Word-compatible result or visible failure. |
| `CMD-078` | `export.pdf` | Valid `.pdf` download from the same formula-aware rendered HTML and canonical desktop layout as Final Preview, with visible opaque-image substitution/notice when needed, or genuine visible failure without mutation. |
| `CMD-079` | `export.screenshot` | Settled PNG with visible opaque-image substitution/notice when needed, or genuine taint/oversize failure. |

## Named parity component hands-on matrix

These rows make the component-level parity contract independently checkable; completing a command row does not implicitly complete its associated component. Compare each row with `docs/toolbar-component-parity-matrix.md`, including every documented approved exception.

| Component ID | Hands-on focus |
| --- | --- |
| `component.toolbar` | Compare frozen group/order/location, DOM ownership, geometry, tokens, desktop/narrow overflow, sticky/overlay behavior, keyboard/focus, active/disabled states, accessible names, and every command outcome. |
| `component.appearance-theme` | Switch all eight Cherry-aligned themes across the shell, Source, Visual, Final, status and dialogs; verify labels plus swatches, keyboard menu/focus return, persistence and storage failure feedback, responsive anchoring, and zero Markdown/revision/autosave/undo/export mutation. |
| `component.text-marks` | Verify selection/caret preservation, toolbar and physical shortcuts, mixed-mark active states, adjacent compound size/color/background ranges including legacy source, exact Markdown, delimiter-free Visual/Cherry Final output, undo and reload. |
| `component.heading` | Verify H1–H5 order and states, keyboard/focus, exact heading source, Visual/Final geometry, undo/reload, and intentional H6 top-toolbar exclusion. |
| `component.ruby-pinyin` | Compare Cherry-owned base/annotation and pinyin picker hierarchy, tokens and states; verify keyboard/focus, apply/cancel, exact source, Visual/Final output, undo and reload. |
| `component.font-size-picker` | Compare picker ownership, geometry, tokens, values and selected state; verify keyboard/focus, exact source, responsive reachability and Final output. |
| `component.color-picker` | Compare text/background ownership, palette geometry/tokens and active state; verify keyboard/focus, adjacent text-color/background combinations, canonical exact source after an edit, responsive placement, reload, and delimiter-free Final output. |
| `component.list` | Compare Cherry hanging-indent geometry and tokens; verify toolbar-to-caret focus, Enter split/exit, nesting, keyboard/SR semantics, exact Markdown, undo/reload and narrow layout. |
| `component.task-list` | Verify horizontal checkbox/content layout without a duplicate marker, marker reset on Enter, caret/typing, checked state, keyboard/SR semantics, exact Markdown, undo/reload and narrow layout. |
| `component.panel` | Compare Cherry panel types, hierarchy and tokens; cover new/existing valid Apply, all deterministic failures, Retry, Cancel/dirty close, focus, exact revision/undo/Markdown and Final. |
| `component.alignment` | Verify compatible selections and states for left/center/right/justify, including forced last-line Chinese/English geometry in Visual/Final, literal Source, undo and reload. |
| `component.columns` | Compare layout starter and controls; verify keyboard/focus, column validation, exact container patches, Final geometry, cancel, undo/reload and responsive behavior. |
| `component.tabs` | Compare tab hierarchy/tokens and disclosure states; verify keyboard/focus, edit/apply/cancel, exact source, Final behavior, undo/reload and responsive reachability. |
| `component.accordion` | Compare Cherry hierarchy, tokens and disclosure states; verify keyboard/focus, edit/validation/apply/cancel, exact source, Final behavior, undo and reload. |
| `component.timeline` | Compare every frozen Cherry state and pixel hierarchy; verify keyboard/focus, edit/local error/apply/cancel, exact source, Final output, undo and reload. |
| `component.media` | Verify image/audio/video URL and upload flows, edit/apply/cancel/failure states, focus, safe fallback, exact source, Final output, undo/reload and responsive geometry. |
| `component.link` | Verify current selection ownership, URL validation, active/edit/cancel states, keyboard/focus, exact Markdown, Final link, undo and reload. |
| `component.simple-insert` | Verify hard-break and horizontal-rule ownership, geometry, focus, exact source semantics, Visual/Final output and one-step undo. |
| `component.code-block` | Compare direct Tiptap editing and optional advanced editor lifecycles; verify language/highlight/copy/context/fold states, safe fences, exact source, Final output, native undo and reload. |
| `component.inline-code` | Compare Tiptap-referenced Visual DOM/tokens; verify real selection, mixed marks, keyboard/focus, exact delimiters, Cherry Final output, undo and reload. |
| `component.formula` | Compare the Cherry-style unified inline/block picker, templates/symbols, geometry/tokens and states; verify keyboard/focus, invalid Retry, exact source, Visual/Final math, undo and reload. |
| `component.inline-formula` | Verify direct inline formula selection/editing, delimiters, caret/keyboard behavior, Visual math, Cherry Final output, cancel, undo and reload. |
| `component.toc` | Verify empty/populated Visual states, heading-derived live updates, duplicate/Unicode anchors, keyboard navigation, exact Source marker, Cherry Final links and reload. |
| `component.table` | Compare Cherry 9-by-9 insertion and Tiptap ordinary-table interaction; verify keyboard/SR access, operations, one-time sort, documented disabled actions, exact pipe Markdown, unspecified `---` versus explicit-left `:---`, column-marker movement, byte-exact undo/redo, Final and reload. |
| `component.attachment` | Verify PDF/Word/file URL/upload cards, edit/apply/cancel/failure, keyboard/focus, safe metadata, exact source, Final output and reload. |
| `component.drawio` | Verify deterministic fake and pinned local create/edit/Apply/Close, origin/window/request rejection, focus, quota/failure recovery, exact Markdown and unchanged content on failure. |
| `component.mermaid` | Verify every starter, source editing, local invalid state, keyboard/focus, exact fenced source, safe Final output, undo and reload. |
| `component.chart-table` | Verify every chart type, real Visual/Final rendering, title/data editing with draft-only live preview, visible edit control, double-click, validation/apply/cancel, keyboard/focus, exact source, undo and reload. |
| `component.history` | Verify active-mode undo/redo states and focus, one user intent per step, no hydration/presentation pollution, mode boundaries and restore-as-one-transaction behavior. |
| `component.manual-save` | Verify forced flush, pending/saved/failed states, latest checkpoint, dirty-to-clean transition, keyboard/focus and zero unintended content revision. |
| `component.search-replace` | Verify real selection, navigation, checked replacement, invalid/stale failure, cancel, keyboard/focus, exact Markdown, preview safety and undo. |
| `component.shortcut-settings` | Verify armed physical keydown capture, normalized keycaps, conflicts, immediate routing, persistence/reload/reset, keyboard/focus and zero content revision. |
| `component.mode-controls` | Verify Source/Visual/Final order and states, atomic two-phase activation, failure preservation, focus return, exactly one active surface, checkpoints, undo boundary and convergence. |
| `component.source-surface` | Verify Cherry edit-only ownership, real selection/caret/IME/history/search, exact source, sticky/resize behavior, hydration acknowledgement and visible recovery. |
| `component.visual-surface` | Verify one Tiptap surface, continuous caret/selection/navigation, direct ordinary editing, semantic contextual UI, failure/retry, convergence, undo/reload and responsive sheet geometry. |
| `component.preview-surface` | Verify flushed read-only Cherry ownership, safe DOM, no hidden mutation, source-revision identity, responsive rendering and visible render failure recovery. |
| `component.quote` | Verify the Visual six-dot `Turn into → Quote` route, keyboard-equivalent menu and `> ` input rule plus Source selection bubble/direct Markdown, focus, exact source, Final and undo. |
| `component.fullscreen` | Verify enter/exit/failure/cleanup, keyboard/focus, responsive geometry, overlay anchoring and zero content revision. |
| `component.locale-picker` | Verify Chinese/English/Russian labels and selected state, keyboard/focus, responsive reachability, stable command IDs and unchanged Markdown. |
| `component.word-count` | Verify flushed revision ownership, deterministic counts, keyboard/focus, pending/error state and zero content revision; confirm the non-command line-spacing control is immediately to its left. |
| `component.export-menu` | Verify exact Markdown, safe HTML/Word, downloadable PDF and long screenshot outcomes, opaque remote-image placeholder/notice, genuine capture/encoding/taint/oversize failures, keyboard/focus, asset settling, and unchanged save/content state. |

## UA-001–UA-020 reacceptance route

The full reproduction, approved decision, non-goals, focused regression, invalidated gates and disposition live in `docs/user-acceptance-remediation-matrix.md`; these concise routes are mandatory hands-on rechecks and do not close a finding on their own.

| UA ID | Mandatory hands-on recheck |
| --- | --- |
| `UA-001` | In Visual, press real Enter and continue typing immediately; verify unique projection identity, bounded acknowledged convergence, Source/Final content, selection, one-step undo, reload, diagnostics and controlled paragraph rhythm. |
| `UA-002` | Compare real Enter with Shift+Enter; verify paragraph versus hard-break DOM, exact `\n\n` versus two-spaces-plus-`\n` source, no caret sentinel serialization, Source activation, undo and reload. |
| `UA-003` | Form one pointer selection and one immediate keyboard selection, invoke toolbar Italic and physical `Ctrl+I`, and verify focus, exact `<em>`/Markdown, truthful feedback and undo without sleeps/helpers. |
| `UA-004` | Inspect ordered, unordered and nested lists at desktop/narrow widths for Cherry hanging indents, caret alignment, exact Markdown, undo and reload. |
| `UA-005` | Create a list from the toolbar, type immediately, split a non-empty item and exit an empty item with real Enter; verify focus/caret, Markdown, undo and reload. |
| `UA-006` | Create and edit a task list; verify horizontal checkbox/content layout, no duplicate marker, marker reset, immediate caret/typing, SR semantics, Markdown, undo and reload. |
| `UA-007` | At desktop and narrow widths, compare the complete toolbar with the frozen Cherry reference and accepted user overrides: verify the exact principal order and menu ownership for all 80 stable commands, including Text style Quote, plus the non-command Theme menu and its eight labeled radio choices; Cherry `ch-icon` glyph shapes; 48px row, `4px 24px` padding, 38×38 controls, 14px icons, 2×21 separators and spacing; text controls; normal/hover/checked/disabled states; keyboard/focus/picker anchoring; responsive overflow; Markdown/Final outcomes; and only the documented W-Editor extensions. |
| `UA-008` | Scroll long content at desktop/narrow widths; verify only the toolbar is viewport-sticky, the global header scrolls, mode/status are non-sticky, and menus/popovers/tooltips stay correctly anchored and unclipped. |
| `UA-009` | Without claiming the historical cause, exercise new/existing Panel valid Apply, every deterministic failure, invalid Retry, Cancel/dirty close, focus, exact revision/undo/Markdown and diagnostics in Source/Visual. |
| `UA-010` | Apply Justify to single-line and final-line Chinese/English fixtures; compare computed fill in Visual/Final, literal Source, selection/focus, undo and reload. |
| `UA-011` | Exercise every Timeline state against the frozen reference; verify keyboard/focus, edit/local error/apply/cancel, exact Source/Final, undo and reload. |
| `UA-012` | Without claiming the historical cause, exercise new/existing code-node valid Apply, all deterministic failures, invalid Retry, Cancel/dirty close, focus, exact revision/undo/Markdown and diagnostics in Source/Visual. |
| `UA-013` | Directly edit Visual code with selection, lines, language, highlight, copy and context actions; verify native undo, safe fences, optional advanced editor, exact Source/Final and reload. |
| `UA-014` | Toggle default-expanded Visual/Final code folding and verify zero Markdown, revision, autosave, undo, export or cross-session content effect. |
| `UA-015` | Edit inline code directly in Visual with real selection and mixed marks; compare Tiptap Visual DOM/pixels, exact delimiters, Cherry Final output, undo and reload. |
| `UA-016` | Use the one Formula command to switch Inline/Block, choose templates/symbols, keyboard through the picker, retry invalid input, and verify Visual math, exact `$…$`/`$$…$$`, Final, undo and reload. |
| `UA-017` | Insert TOC before/after headings and then add, rename, remove and reorder headings; verify empty state, live items, anchors/navigation, exact Source marker, Final links and reload. |
| `UA-018` | Choose minimum and 9-by-9 boundaries by pointer and keyboard, cancel once, then verify selected columns/data rows plus one header row, exact pipe Markdown, focus, one revision and one-step undo. |
| `UA-019` | Edit and select table cells; use grouped handle menus to add/delete/move/duplicate rows/columns, align and sort once; verify deferred non-authoritative actions remain absent, keyboard/SR access, exact Markdown, Final, undo and reload. |
| `UA-020` | Arm the shortcut recorder and press physical combinations; verify normalized modifiers/keycaps, reserved/duplicate conflicts, acceptance, immediate routing, persistence/reload, reset, focus/keyboard access and zero content revision. |

## User result

### FU-001–FU-010 mandatory follow-up rechecks

| Follow-up ID | Mandatory hands-on recheck |
| --- | --- |
| `FU-001` | Insert and reload representative Chart-table types in Visual; confirm a real chart is the default, the right edit action appears on hover/focus/selection, double-click opens the same editor, draft changes update the live preview without changing Source, Cancel is a no-op, and Apply produces one undoable Markdown change reflected in Final. |
| `FU-002` | Choose Export → Export PDF in the rebuilt application; confirm `welcome.pdf` downloads without any popup, opens as a valid PDF containing the current rendered revision, and reports a visible error without changing content if capture fails. |
| `FU-003` | Add a remote image that displays but rejects CORS reads, choose PDF and long-screenshot export, and confirm both files download with a visible placeholder plus localized omission count while Source remains byte-for-byte unchanged; then trigger a genuine capture-limit failure and confirm it still blocks the artifact visibly. |
| `FU-004` | In Final Preview, record paragraph wrapping plus inline/block formula geometry; export PDF and confirm the same content, typography, line wrapping, colors, and formula layout are retained. Treat page pagination/margins, hidden interactive controls, and opaque-image placeholders as the documented export-only differences. |
| `FU-005` | In the actual `Welcome to W-Editor` article, inspect the existing chain of three adjacent text colors followed by two adjacent backgrounds; confirm Visual and Final preserve all five one-character ranges without `!` delimiters or cross-range grouping and Source remains byte-identical. Then switch modes, reload, undo, and repeat once with a legacy color-over-background source sequence. |
| `FU-006` | In the actual `Welcome to W-Editor` article, inspect the Ruby/pinyin immediately following the mixed rich-mark prefix; confirm Visual and Final both show base `啊` with annotation `a`, Final exposes no `{ 啊 | a }`, and Source remains byte-identical. Switch the left panel between `文章` and `目录`, navigate representative H1–H5 headings in Source/Visual/Final, and confirm catalog/recovery actions remain available only under `文章`. |
| `FU-007` | In Chinese, confirm the left heading tab and panel title read `目录`, titles retain H1–H5 indentation but show no visible H1–H5 prefix. Disconnect external network access, insert a draw.io diagram, confirm the local editor and shape resources load, Apply produces a rendered PNG plus editable mxfile source in one undoable transaction, reopen and edit it, then confirm Close is a no-op and no request targets diagrams.net. |
| `FU-008` | In a long article, type ten separately undoable edits and perform ten `Ctrl+Z` followed by ten `Ctrl+Shift+Z` operations in both Source and Visual. Repeat with 20+ pre-existing consecutive empty paragraphs beside an ordinary table; use Enter, Backspace, Delete and a selected-text deletion; verify exactly one separator per step, exact empty-paragraph count, unchanged table/other content, local visible caret/range, and byte-exact `---`/`:---` table delimiters through edit/undo/redo. |
| `FU-009` | In Source and Visual, place the caret at a known non-default position, open Search and confirm the query input is focused. Close once without typing and once after a no-match query; confirm the exact opening caret returns. Repeat with a successful query and confirm the active match remains selected. On desktop and narrow widths, confirm smaller sheet margins, ordinary paragraphs using the available width, and visible localized start/end markers immediately around Visual editable content; verify Source, Final, Markdown, revision, autosave, undo, and exports are unchanged by the markers. |
| `FU-010` | In Visual, hover an ordinary paragraph and confirm Add is on the left, the six-dot handle is immediately on its right, both controls stay inside the paper, and neither overlaps text at desktop or narrow widths. Open Final Preview and confirm no `最终 Cherry 预览` heading is present. Open the new line-spacing button immediately left of 字数统计, select each spacing option with pointer and keyboard, reload, and confirm Source/Visual/Final text flow changes while Markdown, revision, autosave, checkpoints, undo, and exports remain unchanged. |

- [ ] All 74 requirement-derived checks completed in one full pass.
- [ ] All 80 public command checks completed in one full pass.
- [ ] All 40 named parity component checks completed against the frozen matrix and every approved exception.
- [ ] All nine cross-cutting routes completed, including real Chinese IME; Source/Visual/Final convergence; real selection/focus/physical keydown; responsive/sticky states; lifecycle failures; raw export; undo/reload; keyboard/SR; and the pinned same-origin draw.io editor with external networking disabled.
- [ ] Every `UA-001`–`UA-020` focused automated regression and mandatory hands-on recheck passed, with invalidated full gates rerun and remediation dispositions updated.
- [ ] Lockfile/dependency, typecheck, lint, all Vitest, full bundled-Chromium Playwright, strict pixels, build, production-seam absence, representative/diagnostic document, stable Chrome/Edge smoke, documentation and strict OpenSpec gates passed from the earliest affected layer.
- [ ] The complete agent pure-production hands-on trial passed across all requirement families, commands, components, recovery paths, integrations, persistence, imports, exports and failure states.
- [ ] Findings were consolidated and classified; any changed verification input invalidated old evidence and triggered reruns from the earliest affected gate.
- [ ] User explicitly confirms the whole first-round editor. Only this confirmation permits Task 18.9 to be completed in a later authorized action.
