# Compact toolbar menus and host save entry

## Symptom

The text-format menu looked like a direct strikethrough command. Three list buttons, two drawing menus, timeline and accordion controls occupied separate toolbar slots. NWU also exposed duplicate preview and manual-save controls alongside its existing mode selector and top Save button.

## Cause

Toolbar descriptors and slots registered those commands separately. The text-format trigger reused the strikethrough icon. NWU top Save and the toolbar manual-save action both reach the same manual checkpoint and host `saveManual` path; standalone editors still need their own save entry.

## Change

- Sync the upstream-only patch from NWU commit `08edc5c`, based on `e198a0b`, onto W-Editor `6a9da29`.
- Use `+` for the text-format menu; group ordered, unordered and task lists under one list trigger.
- Group timeline, accordion, Mermaid diagrams and data charts under Draw. Keep existing command IDs and editing behavior.
- Remove the duplicate toolbar preview control. Keep Source, Visual and Preview mode controls.
- Add optional `hideToolbarManualSave`, defaulting to visible. Enable it only in the NWU host; retain top Save and Ctrl/Cmd+S.
- Update toolbar contracts and existing unit/browser test selectors. Preserve W-Editor's `articleSwitchPolicy: 'save-discard'` difference when applying the host-prop hunk.
- Retain the earlier reference-free body count (`8dc8b8e`) and Visual host-entry default (`6a9da29`) as direct ancestors, without replacing their source files.

## Verification

Using the installed Node.js 24 runtime, without dependency installation:

- 21 tests pass across toolbar commands, toolbar component parity, document statistics and NWU persistence.
- Five focused UI tests pass: compact toolbar menus; standalone manual save plus hidden-button Ctrl+S; Preview through mode controls; announcement top Save; live reference-free body counts across modes.
- Vue/TypeScript checking and changed-file ESLint pass.
- Toolbar matrix validation passes for 80 public commands and five explicit exclusions; `git diff --check` passes.
- The complete unit/browser suites and standalone Windows runtime were not rerun for this synchronization. NWU deployment and browser verification are tracked separately in the host repository.

## Remaining limitations

The NWU source-change record reports seven failures in its earlier expanded app-shell run: five timeouts (Markdown download, preview-command disabling, shortcut settings, line spacing and preview rendering) plus HTML-export call-count and search-focus assertion failures. Their relationship to this toolbar change was not established; this synchronization does not claim they are resolved. Two additional Source-mode timeline/accordion redo assertions also failed on a byte-verified original baseline, confirming those two failures predate the toolbar change. No additional issue was found in this repository's focused verification.

## Deployment and rollback

This commit updates the existing W-Editor PR branch, without merging `main` or deploying a standalone application. NWU publishes its separate frontend build. Revert this toolbar-sync commit to restore the prior toolbar; no schema or user-data migration is involved.
