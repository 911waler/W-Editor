# Frozen parity reference baseline

The machine-checked manifest is `tests/fixtures/parity/reference-baseline-manifest.json`. It joins eight reviewed PNG reference assets with two deterministic W-Editor fixture inputs. Blocking comparison uses the locally stored files; the remote URLs are consulted only during an explicit reviewed refresh.

The current product-local freeze is `tests/fixtures/parity/visual-reference-manifest.json`. It covers the current workspace, toolbar, editor surface, and status region in all eight W-Editor themes, plus behavior snapshots for the 80-command inventory, three modes, four line-spacing choices, fonts, and the Welcome seed. These local captures do not replace the reviewed upstream assets and are not runtime inputs.

Playwright bundled Chromium 151.0.7922.34 at DPR 1 is the strict pixel-canonical engine. Installed Chrome and Edge remain behavior-smoke targets and are not expected to produce pixel-identical output. Every screenshot records its own viewport, locale, theme, computed font families, fixture, animation/time controls, scoped region, masks, tolerance, owner, and initial review evidence.

## Capture and refresh rule

The initial captures were produced after Scrapling 0.4.12 confirmed HTTP 200 access to the official Cherry full example, Tiptap Notion-like template, and Tiptap Table Node documentation. `scripts/capture-parity-references.mjs` then used the canonical bundled Chromium engine for rendering and screenshot capture. It refuses to run without `--review-evidence` and refuses to replace existing files unless `--replace-reviewed` is also supplied.

An asset replacement is allowed only when the upstream reference or approved product contract changed and the review evidence explains that change. A test mismatch is not review evidence. After a reviewed refresh, update the manifest metadata and SHA-256 values through an ordinary reviewed source diff, then rerun the manifest, documentation, pixel, behavior, and every downstream affected gate.

The SHA-256 fields are proportionate to this frozen-binary boundary: PNG diffs show that a binary changed but cannot prove that the reviewed manifest and local asset still refer to the same bytes. The hashes prevent an accidental or unreviewed screenshot replacement from silently inheriting old capture metadata; they do not protect product content or add a second application integrity system.

## Copyright and dependency boundary

The Tiptap Notion-like asset is a scoped black-box screenshot of the public demonstration, including its own placeholder watermark. No Start/Pro template source, React implementation, private Cherry component, or paid package was copied. The assets are reference evidence only and are never runtime or build inputs.
