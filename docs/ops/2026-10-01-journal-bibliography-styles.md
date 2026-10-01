# Journal bibliography styles and portable document preference

## Symptom

The reference panel offered only the existing general bibliography formats. A style chosen before adding the first reference could not be retained in Markdown, and journal bibliography styles were unavailable across editor, reader and exports.

## Confirmed cause

The style choice existed only on individual reference payloads, while the available CSL catalog did not include journal formats. The renderer and export paths also needed explicit coordination with lazily loaded CSL assets.

## Changes

- Added six pinned journal style IDs and local CSL assets, searchable style selection, and representative formatting previews.
- Persist document-wide choice as a validated first-line Markdown comment and a hidden visual node. Applying a style updates the preference and all references in one history transaction, including documents without references.
- Refresh cold reader and fallback bibliography output after local style loading; wait for styles before exports and produce one bibliography in exported content.
- Imported only the journal feature delta from the NWU source snapshot after its `c69ce28` planning baseline. Retained this repository's independent `articleSwitchPolicy` behavior and existing standalone draft/export controls.

This is a local source synchronization in `/tmp/w-editor-sync-20260930`. No GitHub push, production deployment, desktop installer update or user-data migration is included. Roll back source to the preceding local commit `b29617b` if necessary; retain user documents separately.

## Verification

- `pnpm run typecheck`: passed.
- Seven focused test files passed, 32 tests total: document style projection/history, CSL formatting, reference presentation, file export, journal UI flow, asynchronous formatting state, and style picker.
- `git diff --check`: passed.
- Source delta applied as patches rather than whole-file replacement; independent article-switch policy remains present.

## Remaining work

No known unresolved issue within the verified journal feature. Production deployment, GitHub publication and desktop runtime/build verification were not performed and are outside this synchronization.
