# Reference-free body count

## Symptom

The existing top-right count measures Markdown source, so encoded citation metadata affects it. Authors need an additional prose count that excludes bibliography content.

## Cause

`calculateDocumentStatistics` tokenizes the complete Markdown snapshot, including self-contained reference URLs. The generated bibliography itself is outside the editable document.

## Change

Keep the original count and add a separate body count from the current editor projection. Count Han characters individually and other words/numbers by token; exclude citation nodes, metadata, formatting, punctuation, code, formulas and generated bibliography/TOC. Include prose in headings, lists, tables, panels, columns, disclosures and timelines. Provide localized help and wrapping for narrow screens. Reuse the repaired RGB parser without modifying paste or serialization.

## Verification

- 12 statistics tests and 20 RGB/formatting regression tests pass.
- Two focused app-shell tests pass, covering original statistics, live body counts, three modes, three locales and content/revision preservation.
- Type checking and changed-file ESLint pass. The entire test suite was not rerun.
- NWU integration release build and WebVPN entry checks pass. Chromium against local and production release resources verifies reference exclusion, mode switches, save/reload, narrow-screen layout and the existing RGB paste repair without console/page errors or failed requests. Synthetic documents use local browser storage only.
- NWU frontend deployed with the current backend/schema retained. Deployment backup and rollback instructions remain in the host repository.

## Remaining limitations

Manually typed bibliography paragraphs remain ordinary prose. Source fragments displayed literally by the current projection are counted as visible text. Standalone Windows runtime validation remains outstanding. No other known issues.
