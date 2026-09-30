# NWU editor improvements and formula source copying

## Symptom

Copying visual editor text containing inline or display formulas preserved formula HTML for a rich-text round trip, but omitted the LaTeX from the clipboard's plain-text representation. The NWU-911 integration had also accumulated editor improvements that were absent from this repository's shared editor and original Web application.

## Confirmed cause

The two TipTap formula nodes supplied HTML serialization but no plain-text serialization. The NWU integration is a source snapshot rather than an automatically synchronized dependency. This synchronization compares the NWU snapshot to W-Editor baseline `6cec3b16866eec79ffd08d4369ab414e6bcfec72`.

## Changes

- Formula plain-text serialization writes inline `$...$` and display `$$` blocks, preserving the stored LaTeX exactly, including whitespace and TeX comments. HTML clipboard serialization is unchanged.
- Shared core and Vue improvements include image editing and resizing, image alignment, durable asset URLs, draw.io upload retry, formula rendering, continuation lists, HTTP-safe identifiers, outline presentation and Markdown import.
- The original Web application can optionally consume NWU bootstrap data through `src/nwu` and `src/ui/App.vue`. Without bootstrap data, the ordinary Playground remains the entry. These files describe an optional frontend host contract; they do not provide the NWU Python backend or credentials.
- Host hooks support article categories, titles, loading, server persistence, reader pages, and canonical saved-text baselines. `articleSwitchPolicy="save-discard"` enables the NWU three-action dirty-document dialog. The default policy retains the existing standalone Cancel / Keep draft / Export and continue / Save choices.
- Review fixes protect edits made while discard persistence is pending, including buffered visual/IME edits, and percent-encode whitespace in accepted root-relative image URLs without double encoding existing escapes.
- Existing upstream-only documentation and installer artifacts remain intact. NWU deployment records, source-snapshot markers, and historical agent planning artifacts are not imported.

The desktop application and its tests are unchanged. Shared reader styles also remain in the existing desktop stylesheet until the later desktop integration; this duplication is intentional during the handoff.

## Verification

- Shared changed-area regression suite: 22 files, 157 tests passed before the final formula edge-case expansion.
- NWU frontend, article policy, generic application shell, checkpoint and clipboard suite: 16 files, 166 tests passed before the final formula edge-case expansion.
- TypeScript typecheck passed.
- Direct workspace dependency, code ownership, Web entry facade and feature-manifest gates passed. The feature manifest contains 80 commands, 41 components and 12 shared fixtures.
- The Vitest wrappers around these four gates could not spawn child Node processes in the restricted execution sandbox (`EPERM`). The same gate scripts were therefore executed directly; no validator was weakened.

- Final review regression suite: 5 files, 46 tests passed, including 18 formula clipboard cases, 16 image codec cases, delayed-discard races, host policy and NWU persistence.
- Changed-source ESLint passed after formatting two imported Vue templates. Typecheck was repeated after the review fixes.
- Chromium browser coverage: all 19 selected scenarios passed across the initial and corrected-test runs. The 14 standalone composition/recovery and image-editing scenarios passed first; the five NWU sidebar/discard/reader scenarios passed after updating stale tests to select the intended Articles tab, expect only the active category expanded, and locate numbered headings. The actual content, dirty-state, export, layout and reload assertions remain in place.
- The NWU discard browser scenario was repeated after the final buffered-edit synchronization fix and passed (1/1).
- Web Vite build passed with the existing large-chunk advisory. Browser tests use only a localhost preview and synthetic API responses; no production documents or Windows desktop runtime were used.
- Independent review reproduced and then verified fixes for both committed and buffered edits during discard, plus the image URL round trip (3/3 passed). No remaining actionable P1/P2 was found in the reviewed shared/Web changes.

## Remaining work and Windows handoff

Windows desktop integration, real desktop runtime testing, file associations, installer regeneration and signing are deferred by request. The retained installer binaries predate this synchronization and do not contain these changes. On Windows, build from the synchronized shared packages, check standalone draft/export and clipboard behavior, then run the existing desktop lifecycle/installer tests before producing new installers.

No production deployment is part of this upstream source synchronization. Rollback uses the preceding Git revision; keep any newer user data separate from source rollback.
