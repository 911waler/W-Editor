# Formula clipboard content preservation

## Symptom

Copying and pasting an inline formula, a block formula, or a paragraph containing a formula can fail visual synchronization with `Formula content must be non-empty.` The pasted formula loses its LaTeX content.

## Cause

Both formula node types are atomic. Their clipboard HTML previously serialized LaTeX as wrapper text, while the `content` attribute neither serialized nor parsed that value. ProseMirror does not infer an atomic node's attributes from child text, so HTML parsing restored the default empty `content` and Markdown serialization rejected it.

## Fix

The shared formula attributes now serialize and parse LaTeX using `data-formula-content`. DOM APIs escape the attribute, preserving quotes, angle brackets, ampersands, backslashes and line breaks. Older clipboard HTML is supported by recovering text from formula wrappers without child elements. Rendered KaTeX trees are not concatenated into source text. Formula validation and safe rendering remain unchanged.

This is a source-level port of the formula fix used by the NWU integration. Its separate pasted-image recovery fix belongs to that host's adapter, which is absent from this repository; it is not part of this change. Existing upstream Markdown syntax is preserved, including its single-line inline-formula restriction.

## Verification

- Before the fix, all 11 new clipboard tests reproduced the same empty-formula error through the real Tiptap adapter and ProseMirror DOM copy/paste handlers.
- After the fix, 9 related test files and 66 tests passed. Coverage includes both formula modes, legacy clipboard wrappers, special characters, multiline block formulas, same-document and cross-editor copying, complete paragraphs, subsequent typing, Markdown commits, undo/redo and reopening.
- Type checking and the production Vite build passed.
- The existing formula-codec test prints a Cherry preview cleanup timer warning both before and after the change; both runs exited successfully. This change does not modify that preview lifecycle.
- Independent code review found no blocking issues.

The automated clipboard tests use JSDOM browser-event substitutes; they do not claim operating-system clipboard or every browser compatibility coverage. No known remaining issue was found within the tested scope. Existing release installers are not rebuilt by this source patch.
