# W-Editor upstream baseline

W-Editor is an independent browser application. Its reproducible implementation baseline is:

| Concern | Required constraint | Product boundary |
| --- | --- | --- |
| Node.js | `>=24` | Runtime and tooling baseline |
| Package manager | `pnpm@11.19.0` | The only supported package manager |
| Cherry Markdown | `cherry-markdown@0.11.9` | Published package for source editing and final rendering |
| Tiptap | all `@tiptap/*` packages at `3.30.2` | Published packages for the structured visual projection |
| CodeMirror | major version 6 (`codemirror@6.0.2`) | Dedicated raw/code source dialogs only |
| Vue | `vue@3.5.41` | Application presentation and composition root |
| TypeScript | `typescript@6.0.2`, strict mode | Framework-neutral contracts and Vue application code; compatible with the pinned lint parser |
| Vite | `vite@8.2.2` with `@vitejs/plugin-vue@6.0.8` | Development and optimized production builds |

The sibling Cherry Markdown and Tiptap source repositories are reference-only evidence for syntax, public behavior, fixtures, and compatibility investigation. They are not runtime inputs, workspace packages, linked dependencies, aliases, copied source, or build inputs. Production and test code must resolve editor libraries from published packages recorded in `package.json` and `pnpm-lock.yaml`.

If a required capability cannot be implemented through a stable published entry point, implementation stops at that dependency task with reproducible evidence. Changing to a private upstream import, source checkout, patch, or fork requires a separate explicit OpenSpec dependency decision.

The published Cherry 0.11.9 declaration bundle contains unresolved source aliases and case-colliding declaration paths on Windows. W-Editor therefore keeps strict checking for all project/test code but enables TypeScript `skipLibCheck` for third-party declaration bodies. Runtime compatibility remains independently proved through the published ESM bundle and renderer-oracle tests; this setting does not substitute for the Task 5.1 public-capability proof.

## Cherry 0.11.9 published-capability proof

Task 5.1 is satisfied by the package's published `module` entry, `dist/cherry-markdown.esm.js`, and public Cherry/CodeMirror surfaces. The real-browser capability test proves all required behavior without importing any private upstream source:

- `editor.defaultModel: 'editOnly'` mounts the source surface and `destroy()` tears it down;
- `getCodeMirror()` supplies the public CodeMirror 6 `EditorView`, whose `state.doc`, selection, `contentDOM`, and native keymap provide exact value, source selection, composition lifecycle, and undo/redo;
- Cherry lifecycle callbacks observe real user edits;
- a detached `previewOnly` Cherry instance renders the exact supplied Markdown through `getHtml(false)`.

Cherry's top-level `getValue()` is backed by a render-cycle cache and can temporarily lag a direct CodeMirror transaction. The source adapter therefore reads immediate authority from the publicly returned `EditorView.state.doc` and uses Cherry's callbacks for committed user-edit notification. This is an observed timing contract, not a missing capability or a reason to access `cherry.editor` or any upstream private module.

## Tiptap 3.30.2 published-capability proof

Task 5.6 verifies the complete declared `@tiptap/*` dependency set against each installed published package manifest; all required packages resolve at `3.30.2`. A public-API capability test builds the planned schema from StarterKit plus the pinned mark, task-list, table, raw-node, and semantic-node extensions. It validates a mixed document containing H1-H5-compatible headings, styled ordinary text, tasks, a table, exact raw nodes, and an isolating semantic node.

The same proof creates and applies a transaction through `@tiptap/pm/state`, observes its step mapping, and round-trips W-Editor projection metadata together with `addToHistory: false`. These are the stable published surfaces required by the visual adapter; no sibling source checkout or private upstream module is used.
