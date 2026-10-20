# Synchronize the deployed editor with GitHub

## Symptoms

GitHub `main` remained at `668d88d7c70c3928b17d19dc35b3974989ce38bc` (the October 2 synchronization), while the deployed editor had improvements through October 20. Building the old GitHub source omitted formula tools, image and draw.io behavior, outline navigation and other changes already used in NWU.

## Cause and evidence

NWU maintains a customized source snapshot independently. Its original `source-commit.txt` identifies baseline `9ba19a2`, not all later changes. On October 21, the production HTTP source manifest matched the local 1392-entry manifest exactly; its NWU source commit was `a98ed1b15d0658f0df67c6ddb2e6d3fcaaac58a1`. The retained release archive also matched the published deployment SHA-256.

Comparison against the last synchronized NWU revision `08edc5c` identified 107 changed/new paths. An additional previously omitted history adapter and its tests were included. Existing GitHub-only lifecycle behavior, desktop reader styles, documentation and installer artifacts were retained.

## Changes

- Synchronize incremental input projection, source undo/redo, modal focus, reference navigation/repeated insertion, font-size and note-property presentation, and explicit HTTP(S)-only automatic links.
- Synchronize hard-break round trips, outline folding and actual heading-level indentation, dropped images, image sizing/alignment, draw.io editable clipboard data and frameless rendering.
- Synchronize formula mode conversion, special symbols/recent items, pasted TeX delimiters, line breaks/alignment, block numbering and stable cross references, including parsing, rendering, export and regression tests.
- Include optional NWU history recovery, reference/notes copying, group-visibility UI and host theme integration. Document the server contracts in `src/nwu/README.md`; retain standalone local services and draft/export choices.
- Include portable WebVPN build/install/verification tools and their tests, plus optional host theme and page-layout assets. No production Python configuration, credentials or documents are included.
- Fix an inherited formula-reference bug found during review: remove formulas inside opaque HTML before numbering visible candidates. Three new regression cases first failed with numbers 2/4 instead of 1/2, then passed. The same source fix and tests were returned to NWU; production deployment is separate.
- Adapt the theme test to repository-local assets, make intentionally discarded source-range values explicit for lint, and update an outdated installer test's E2E command expectation to match the existing package script. No package versions or lockfile changes were required.

## Validation

Validation results are recorded here before publishing the commit. The initial standalone lifecycle/adapter baseline passed 27 tests. Before implementation, transferred formula-numbering, formula-reference and outline tests failed on the old GitHub source, confirming the functional gap. The first broad run also exposed the external theme fixture and stale build-command assertion; distribution tests were started before their build was ready and one UI case timed out under concurrent builds. Final validation uses completed distribution builds.

- Complete unit suite: **281 files, 1673 tests passed** (`pnpm test --maxWorkers=4`, 236.69 s).
- Vue/TypeScript checks, strict changed-file ESLint, dependency direction, code ownership, Web entry facades and feature manifest checks passed (81 commands, 41 components, 13 shared fixtures).
- Selected Playwright Chromium suite: 19 scenarios passed initially; the remaining NWU discard scenario passed after its mock API supplied the required empty reference library and notes. All 20 selected scenarios passed across those runs. The fix also went back to the NWU source test.
- Real Chromium against a local WebVPN-compatible application: four checks passed for H1/H4/H2 indentation/folding, formula symbols and block numbers, cross-reference insertion/navigation, and image dimensions/alignment. No page errors or external requests. This smoke used the first sync build; the later opaque-HTML numbering correction is covered by its regression tests and final build.
- WebVPN regression tests: four Node tests and five Python tests passed; the classic entry verifier found two valid entries and four output hashes matched.
- NWU shared formula regressions: 30 tests passed; source manifest verification passed for all 1392 entries.
- Independent source and WebVPN review found no remaining blocking/P1/P2 issue after the formula-number fix. `git diff --check` passed.
- Final application/WebVPN build passed with two classic entries; independent Web library build and manifest verification passed (560 files, 355 draw.io files, dependency closure and no test seam). Existing Vite mixed-import/large-chunk warnings remain.

## Deployment and rollback

This is a source synchronization. It does not change NWU production services, databases or existing desktop installer binaries. Reverting the synchronization commit restores the previous GitHub source; deployments should continue to use complete, separately verified builds. The archived installers remain older binaries and must be rebuilt to contain the new shared code.

## Remaining scope

The complete standalone Web application and optional NWU frontend integration are synchronized. Authentication, permissions, publishing, DOI lookup and server history require the documented host services. Windows desktop execution/installer rebuild and a real WebVPN session are not claimed by Linux browser/unit/build verification.
