# W-Editor toolbar command matrix

This is the frozen public inventory for the first-round W-Editor toolbar. Stable IDs are the join key used by the command registry, localized labels, shortcuts, fixtures, unit coverage, and the production-app Playwright matrix. `S` means source mode, `V` means visual mode, and `P` means final preview. A content command is always disabled in `P`; application commands declare their own preview behavior.

The reference-ownership, DOM/geometry, visual-token, selection/caret, keyboard/focus, contextual-UI, state, accessibility/responsive, Markdown/Final, and approved-exception dimensions for these same 80 stable IDs and all associated component families are frozen in `docs/toolbar-component-parity-matrix.md`.

## Text and headings

The `text-style` menu uses a `+` trigger and contains Strike, Underline, Subscript, Superscript, Ruby/Pinyin, and Quote. The Strike item keeps its strikethrough icon.

| Stable ID | Cherry control | Cherry-compatible source or outcome | S strategy | V strategy | P | Required outcome evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `text.bold` | bold | `**text**` | checked selection replacement | direct mark | disabled | exact range, active state, preview, reload, undo |
| `text.italic` | italic | `*text*` | checked selection replacement | direct mark | disabled | exact range, active state, preview, reload, undo |
| `text.strike` | strikethrough | `~~text~~` | checked selection replacement | direct mark | disabled | exact range, active state, preview, reload, undo |
| `text.underline` | underline | `++text++` | checked selection replacement | direct mark | disabled | exact range, active state, preview, reload, undo |
| `text.subscript` | sub | `~text~` | checked selection replacement | direct mark | disabled | exact range, active state, preview, reload, undo |
| `text.superscript` | sup | `^text^` | checked selection replacement | direct mark | disabled | exact range, active state, preview, reload, undo |
| `text.ruby` | ruby | ` { base \| annotation } ` | checked selection replacement | direct mark + picker | disabled | exact range, annotation render, reload, undo |
| `block.quote` | text-style/quote | `> text` | checked selection quote replacement | direct blockquote transform | disabled | exact block, toolbar/context parity, preview, reload, undo |
| `text.size` | size | `!<px> text!` | checked selection replacement | direct text-style mark + picker | disabled | selected size, exact range, preview, undo |
| `text.color` | color/text | `!!<color> text!!` | checked selection replacement | direct text-style mark + picker | disabled | selected color, exact range, preview, undo |
| `text.background` | color/background | `!!!<color> text!!!` | checked selection replacement | direct highlight mark + picker | disabled | selected color, exact range, preview, undo |
| `block.h1` | header/H1 | `# heading` | checked line replacement | direct heading level 1 | disabled | active level, preview, exact line, undo |
| `block.h2` | header/H2 | `## heading` | checked line replacement | direct heading level 2 | disabled | active level, preview, exact line, undo |
| `block.h3` | header/H3 | `### heading` | checked line replacement | direct heading level 3 | disabled | active level, preview, exact line, undo |
| `block.h4` | header/H4 | `#### heading` | checked line replacement | direct heading level 4 | disabled | active level, preview, exact line, undo |
| `block.h5` | header/H5 | `##### heading` | checked line replacement | direct heading level 5 | disabled | active level, preview, exact line, undo |

H6 is deliberately absent from the agreed top-toolbar surface.

## Lists, panels, layout, and disclosure

One `list` icon menu contains Ordered, Unordered, and Task lists in that order. Panel retains its five variants, two-column, multi-column, and Tabs entries. Timeline and Accordion are the Layout and disclosure section of the combined Draw (`mermaid`) menu.

| Stable ID | Cherry control | Cherry-compatible source or outcome | S strategy | V strategy | P | Required outcome evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `list.ordered` | ol | `1. item` | checked block replacement | direct ordered list | disabled | split/join, exact safe unit, preview, undo |
| `list.unordered` | ul | `- item` | checked block replacement | direct bullet list | disabled | split/join, exact safe unit, preview, undo |
| `list.task` | checklist | `- [ ] item` | checked block replacement | direct task list | disabled | checkbox/edit, preview, persistence, undo |
| `panel.primary` | panel/tips | `::: primary Title\nBody\n:::` | checked container replacement | semantic editor | disabled | typed preview, apply/cancel, exact unit, undo |
| `panel.info` | panel/info | `::: info Title\nBody\n:::` | checked container replacement | semantic editor | disabled | typed preview, apply/cancel, exact unit, undo |
| `panel.warning` | panel/warning | `::: warning Title\nBody\n:::` | checked container replacement | semantic editor | disabled | typed preview, apply/cancel, exact unit, undo |
| `panel.danger` | panel/danger | `::: danger Title\nBody\n:::` | checked container replacement | semantic editor | disabled | typed preview, apply/cancel, exact unit, undo |
| `panel.success` | panel/success | `::: success Title\nBody\n:::` | checked container replacement | semantic editor | disabled | typed preview, apply/cancel, exact unit, undo |
| `align.left` | align/left | Cherry left-alignment container | checked block replacement | direct block attribute | disabled | selection compatibility, Cherry DOM, undo |
| `align.center` | align/center | Cherry center-alignment container | checked block replacement | direct block attribute | disabled | selection compatibility, Cherry DOM, undo |
| `align.right` | align/right | Cherry right-alignment container | checked block replacement | direct block attribute | disabled | selection compatibility, Cherry DOM, undo |
| `align.justify` | align/justify | Cherry justified-alignment container | checked block replacement | direct block attribute | disabled | selection compatibility, Cherry DOM, undo |
| `layout.two-column` | panel/2cols | `::: 2cols Title` with `::` column separator | checked container insertion | semantic editor | disabled | starter, edit route, byte-stable view, undo |
| `layout.multi-column` | panel/cols | `::: cols Title` with repeated `::` separators | checked container insertion | semantic editor | disabled | starter, validation, exact unit, undo |
| `layout.tabs` | panel/tabs | `::: tabs` with `:: label` sections | checked container insertion | semantic editor | disabled | starter, apply/cancel, final disclosure UI |
| `layout.accordion` | detail | `+++ Title\nBody\n+++` | checked container insertion | semantic editor | disabled | starter, apply/cancel, final disclosure UI |
| `layout.timeline` | timeline | `::: timeline Title\nBody\n:::` | checked container insertion | semantic editor | disabled | starter, local validation, final preview, undo |

## Insert menu

| Stable ID | Cherry control | Cherry-compatible source or outcome | S strategy | V strategy | P | Required outcome evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `insert.image` | image | Cherry image source with serializable URL/metadata | URL/upload dialog | semantic media node | disabled | apply/cancel/failure, reload, preview, undo |
| `insert.audio` | audio | Cherry audio source with serializable URL/metadata | URL/upload dialog | semantic media node | disabled | apply/cancel/failure, reload, preview, undo |
| `insert.video` | video | Cherry video source with serializable URL/metadata | URL/upload dialog | semantic media node | disabled | apply/cancel/failure, reload, preview, undo |
| `insert.link` | link | `[label](url)` | checked selection/dialog | direct link mark/dialog | disabled | validation, apply/cancel, preview, undo |
| `insert.horizontal-rule` | hr | `---` | checked line insertion | direct horizontal rule | disabled | exact insertion, preview, undo |
| `insert.hard-break` | br | two trailing spaces plus newline | checked insertion | direct hard break | disabled | exact insertion, preview, undo |
| `insert.code-block` | code | fenced code block | checked block insertion | static semantic preview + CodeMirror dialog | disabled | copy, apply/cancel, fence safety, undo |
| `insert.inline-code` | inlineCode | `` `code` `` | checked selection replacement | direct inline-code mark | disabled | exact range, preview, undo |
| `insert.formula` | formula | Cherry-compatible formula source | checked dialog replacement | direct only when lossless, otherwise semantic editor | disabled | render, apply/cancel, exact unit, undo |
| `insert.toc` | toc | `[[toc]]` | checked block insertion | direct/semantic TOC node | disabled | heading-derived preview, reload, undo |
| `insert.table` | table | GFM table with alignment row | checked block insertion | direct table/cell controls | disabled | cells, rows/columns, alignment, preview, undo |
| `insert.pdf` | pdf | Cherry PDF attachment source with URL metadata | URL/upload dialog | typed attachment card | disabled | apply/cancel/failure, reload, export, undo |
| `insert.word` | word | Cherry Word attachment source with URL metadata | URL/upload dialog | typed attachment card | disabled | apply/cancel/failure, reload, export, undo |
| `insert.file` | file | Cherry arbitrary-file source with URL metadata | URL/upload dialog | typed attachment card | disabled | apply/cancel/failure, reload, export, undo |
| `insert.drawio` | drawIo | Cherry PNG data plus encoded XML form | draw.io dialog | semantic diagram node/dialog | disabled | origin/window/request validation, apply/cancel, quota, undo |
| `insert.reference` | reference | Reference citation link and bibliography entry | captured-cursor dialog insertion | captured-cursor dialog insertion | disabled | add, cancel, citation, bibliography, undo |

`insert.formula` and `insert.drawio` are single public identities even when reachable from more than one menu location.

## Draw menu: Mermaid section

The single Draw menu is labeled `画图` in Chinese and retains the `mermaid` menu ID. Its sections are Layout and disclosure (`布局与展开`: Accordion, Timeline), Mermaid drawings, and Charts (`图表`). All existing command IDs and editors remain unchanged; Charts has no separate top-level menu.

| Stable ID | Reference variant | Source/outcome | S strategy | V strategy | P | Required outcome evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `mermaid.flowchart` | graph/flow | fenced `mermaid` flowchart starter | checked insertion | semantic source + preview | disabled | starter, apply/cancel, invalid-local error, reload |
| `mermaid.sequence` | graph/sequence | fenced `mermaid` sequence starter | checked insertion | semantic source + preview | disabled | starter, apply/cancel, invalid-local error, reload |
| `mermaid.state` | graph/state | fenced `mermaid` state starter | checked insertion | semantic source + preview | disabled | starter, apply/cancel, invalid-local error, reload |
| `mermaid.class` | graph/class | fenced `mermaid` class starter | checked insertion | semantic source + preview | disabled | starter, apply/cancel, invalid-local error, reload |
| `mermaid.pie` | graph/pie | fenced `mermaid` pie starter | checked insertion | semantic source + preview | disabled | starter, apply/cancel, invalid-local error, reload |
| `mermaid.gantt` | graph/gantt | fenced `mermaid` Gantt starter | checked insertion | semantic source + preview | disabled | starter, apply/cancel, invalid-local error, reload |

## Draw menu: Charts section

| Stable ID | Reference variant | Source/outcome | S strategy | V strategy | P | Required outcome evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `chart.line` | proTable/line | Cherry chart table with line type/title/data | checked insertion | semantic table form + preview | disabled | type-specific source, apply, preview, undo |
| `chart.bar` | proTable/bar | Cherry chart table with bar type/title/data | checked insertion | semantic table form + preview | disabled | type-specific source, apply, preview, undo |
| `chart.radar` | proTable/radar | Cherry chart table with radar type/title/data | checked insertion | semantic table form + preview | disabled | type-specific source, apply, preview, undo |
| `chart.map` | proTable/map | Cherry chart table with map type/title/data | checked insertion | semantic table form + preview | disabled | type-specific source, apply, preview, undo |
| `chart.heatmap` | proTable/heatmap | Cherry chart table with heatmap type/title/data | checked insertion | semantic table form + preview | disabled | type-specific source, apply, preview, undo |
| `chart.scatter` | proTable/scatter | Cherry chart table with scatter type/title/data | checked insertion | semantic table form + preview | disabled | type-specific source, apply, preview, undo |
| `chart.pie` | proTable/pie | Cherry chart table with pie type/title/data | checked insertion | semantic table form + preview | disabled | type-specific source, apply, preview, undo |
| `chart.sankey` | proTable/sankey | Cherry chart table with Sankey type/title/data | checked insertion | semantic table form + preview | disabled | type-specific source, apply, preview, undo |

## History, workspace utilities, and right-toolbar exports

| Stable ID | Reference/product control | Application outcome | S | V | P | Required outcome evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `history.undo` | undo | undo one native user-intent step in the active activation | source history | visual history | disabled | no mode-boundary traversal or feedback loop |
| `history.redo` | redo | redo one native user-intent step in the active activation | source history | visual history | disabled | no mode-boundary traversal or feedback loop |
| `document.manual-save` | customSave / Save version; NWU host Save button | flush and replace the latest manual checkpoint; NWU also persists the server document and revision | enabled | enabled | enabled | dirty becomes clean; autosave/export meaning unchanged |
| `search.replace` | search | active-adapter match navigation and checked replacement | source adapter | visual adapter | search-only/no mutation | matches, cancel, exact replacements, no hidden mutation |
| `settings.shortcuts` | shortcutKey | edit shortcut mappings by stable command ID | enabled | enabled | enabled | mapping changes, no content revision |
| `mode.source` | W-Editor mode control | two-phase activation of source mode | active | enabled | enabled | one surface, checkpoint, failure preservation |
| `mode.visual` | W-Editor mode control | two-phase activation of visual mode | enabled | active | enabled | one surface, checkpoint, failure preservation |
| `mode.preview` | mode control; no top-toolbar alias | flush and activate read-only final preview | enabled | enabled | active | exact flushed revision, no hidden mutation |
| `application.fullscreen` | fullScreen | enter/exit browser fullscreen | enabled | enabled | enabled | state/failure/cleanup, no content revision |
| `language.zh` | changeLocale/zh-CN | set toolbar presentation to Chinese | enabled | enabled | enabled | localized labels, stable IDs/source unchanged |
| `language.en` | changeLocale/en-US | set toolbar presentation to English | enabled | enabled | enabled | localized labels, stable IDs/source unchanged |
| `language.ru` | changeLocale/ru-RU | set toolbar presentation to Russian | enabled | enabled | enabled | localized labels, stable IDs/source unchanged |
| `document.word-count` | wordCount | report statistics from the flushed revision | enabled | enabled | enabled | values advance with revision; no content revision |
| `export.markdown` | export/Markdown | exact authoritative Markdown download | enabled | enabled | enabled | exact bytes; save states unchanged |
| `export.html` | export/HTML | safe standalone Cherry-rendered HTML | enabled | enabled | enabled | same revision, sanitization, visible failure |
| `export.pdf` | export/PDF | downloadable PDF from the safe rendered export document | enabled | enabled | enabled | valid `.pdf` download with opaque-image substitution/notice when needed, or visible genuine capture/encoding failure; no mutation |
| `export.screenshot` | export/long screenshot | settled long PNG capture of safe rendered output | enabled | enabled | enabled | success with opaque-image substitution/notice when needed, or genuine taint/oversize failure; no mutation |

The NWU host hides the duplicate Save version toolbar button because its top Save button invokes the same manual-checkpoint save. Standalone and desktop editors keep the toolbar button; the command and Ctrl/Cmd+S binding remain available in all hosts. Preview remains in the Source/Visual/Preview mode controls, without a duplicate eye icon in the toolbar.

## Explicit exclusions

The following reviewed Cherry example controls are not W-Editor public commands in this change and must remain absent from registry output and the product DOM:

| Excluded reference control | Reason |
| --- | --- |
| demo smile custom menu (`customMenuAName`) | demonstration-only custom menu |
| demo help custom menu (`customMenuBName`) | demonstration-only custom menu |
| sidebar mobile preview (`mobilePreview`) | non-top sidebar feature |
| sidebar copy (`copy`) | non-top sidebar feature; code-block copy remains contextual |
| sidebar theme (`theme`) | non-top sidebar feature |
| sidebar code theme (`codeTheme`) | non-top sidebar feature |

The fixed article panel is product navigation, not a transplanted Cherry sidebar. It exposes only the catalog behavior defined by the local-document-lifecycle specification.
