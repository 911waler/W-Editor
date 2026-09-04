# Undo/redo history contract

This contract applies to the pinned W-Editor baseline: Cherry Markdown `0.11.9`, CodeMirror commands `6.11.0`, Tiptap `3.30.2`, and ProseMirror history `1.5.0`.

## Capacity

| Surface | W-Editor configuration | Guaranteed recent content events | Exact behavior in the pinned implementation |
| --- | --- | --- | --- |
| Visual (Tiptap/ProseMirror) | `depth: 100`, `newGroupDelay: 500` | 100 | ProseMirror prunes in batches only after the overflow exceeds 20. The stack can therefore contain at most 120 events; adding event 121 prunes it back to 100. |
| Source (Cherry/CodeMirror) | Cherry installs `history()` without overrides, so CodeMirror uses `minDepth: 100`, `newGroupDelay: 500` | At least 100 | `minDepth` is deliberately not a strict maximum. The pinned branch can reach 120 events; the next event batch-prunes it to 102. |

The product guarantee is “the latest 100 content events remain undoable”, not “the counter is always exactly 100”. The 20-event implementation buffer is version-specific and must be rechecked when either native history dependency changes.

History belongs to one uninterrupted activation of one editor surface. Source and Visual histories are independent; switching mode destroys the old surface and begins a new history segment. History is not persisted across an application reload.

## What counts as one step

Visual mode uses native ProseMirror history with these W-Editor boundaries:

- Each plain Enter or Shift+Enter starts a new history event. Ten consecutive paragraph breaks therefore require ten undo commands and can be restored with ten redo commands.
- Adjacent typing or deletion within 500 ms may coalesce into one event, matching Tiptap/ProseMirror. A time gap over 500 ms or a non-adjacent change starts a new event.
- Structural toolbar and dedicated-editor commits use explicit history boundaries and are one accepted event. A command that changes nothing creates no event.
- The final Enter in a run may coalesce with immediately continued typing in its new paragraph until the next boundary; the next Enter always closes the preceding event.
- Caret movement, selection synchronization, projection hydration/identity reconciliation, autosave, preview rendering, and other reflected state use `addToHistory: false` and are not content steps.

Source mode follows Cherry's native CodeMirror history:

- Adjacent `input.type` and `delete` transactions within 500 ms may coalesce; non-adjacent changes always start another event.
- Paste, drop, and other non-joinable user events form their own native event under CodeMirror's event rules.
- Selection movement alone is not a standard Ctrl+Z content step. Reflected authority hydration is excluded from history.

For both surfaces, a new content edit after undo clears the redo branch, as required by the native histories.

## Selection and viewport

Undo restores the selection that belonged to the state before the event. Redo restores the selection produced by that event. W-Editor keeps the corresponding caret or range visible and must not substitute a stale selection from another article position.

This means an undo of a genuine older edit at the article end may correctly move to that edit. It must not happen while undoing a newer run elsewhere: after ten paragraph breaks in paragraph 49, exactly ten undo operations remain local to that run; an older article-end event is not reached until a later undo.

The Visual synchronization patch for removing empty paragraphs includes the owned paragraph separators in one bounded safe unit. It must never represent those removals as zero-width no-op patches or rewrite unrelated article content.

Any number of consecutive empty paragraphs is valid independent content. Existing and newly inserted empty paragraphs keep distinct runtime identities even when their Markdown source spans are zero-width. Enter adds one separator, Backspace/Delete removes one, and undo/redo reverses exactly one; acknowledgement must reconcile identities with metadata-only transactions and must not replace the whole document merely because source-derived IDs shifted. Ordinary-table history additionally preserves the lexical distinction between unspecified `---` and explicit-left `:---`; unrelated cell edits retain the original marker and undo restores it byte-for-byte.

The same one-separator rule applies when the empty paragraph is between unlike mapped blocks, such as a semantic success panel and a fenced code block. Undo represents that restoration as one insertion at their existing paragraph boundary; it never appends a separator to the left block and prepends another to the right block. A table elsewhere in the article does not change this local ownership rule.

Range deletion follows the same ownership contract. When every affected projection entry is a removed zero-width empty paragraph, the planner includes one adjacent surviving block so the checked span owns two separators per removed paragraph instead of emitting zero-width no-op patches. Undo inserts the exact number of removed empty blocks and repeats the existing LF/CRLF separator by that count; redo removes the same range.

## Upstream definitions

- Cherry installs CodeMirror's `history()` and `historyKeymap` directly: [Cherry Editor source](https://github.com/Tencent/cherry-markdown/blob/9eba3371cce07c8ffcc422ccde1abdb961559f80/packages/cherry-markdown/src/Editor.js).
- CodeMirror defines `minDepth`, the 500 ms adjacency rule, history isolation, and batch pruning: [CodeMirror history source](https://github.com/codemirror/commands/blob/main/src/history.ts) and [reference manual](https://codemirror.net/docs/ref/#commands.history).
- Tiptap exposes `depth: 100` and `newGroupDelay: 500` and delegates to ProseMirror history: [Tiptap Undo/Redo source](https://github.com/ueberdosis/tiptap/blob/v3.30.2/packages/extensions/src/undo-redo/undo-redo.ts).
- ProseMirror defines an event as a group beginning with a selection bookmark, provides `closeHistory`, restores the event selection, scrolls it into view, and uses a 20-event pruning overflow: [ProseMirror history source](https://github.com/ProseMirror/prosemirror-history/blob/1.5.0/src/history.ts).
