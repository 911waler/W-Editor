# Task 1 report: image parsing, URL, and Markdown contract

## Implementation

- Added `images.ts` with the required `ImageDimensions`, `InlineImageModel`, `parseInlineImageAt`, `serializeImage`, and `normalizeImageUrl` exports.
- The parser scans exactly one image token, handles escaped alt/destination characters and balanced URL parentheses, accepts optional titles, preserves byte-exact `source`/`sourceSpan`, recognizes positive width/height metadata, and leaves unknown extensions in `source` for fallback.
- URL normalization accepts HTTP(S), supported raster data URLs, and site-root-relative legacy paths without requiring a filename extension. It rejects credentials, script/other protocols, protocol-relative URLs, control characters, and backslashes.
- `serializeImage` validates positive integer dimensions. Its optional `source` input preserves titles and unknown metadata while updating name, URL, width, or height; unchanged values return the original source byte-for-byte.
- `media.ts` delegates image safety and parsing to the shared image contract. Audio/video behavior remains unchanged. The block compatibility parser accepts an image only when one image token occupies the complete line.
- Exported the image contract from the codec barrel.

## TDD evidence

- RED: `pnpm exec vitest run tests/codecs/images.spec.ts tests/codecs/media.spec.ts` produced 8 expected failures: the three new exports were absent, legacy root-relative media was rejected, and the first alignment selector characterized the wrong class.
- A second RED cycle for source-preserving serialization failed with `![old](/a.png){width=100}` instead of retaining the title and unknown metadata.
- GREEN: the required target command passes 14/14 tests across 2 files.
- Type check: `pnpm --filter @w-editor/editor-core typecheck` exits 0.
- All pnpm commands used `/opt/nwu911/bin/pnpm11` with the inherited `ml`/`module` function variables unset as requested.

## Verified pinned renderer behavior

Cherry Markdown 0.11.9 renders `{width=320 height=180}` as literal `width="320"` and `height="180"` attributes on the image. A `::: center` image group renders under `.cherry-text-align__center` and retains both images.

## Interfaces for Task 2

`serializeImage` accepts `SerializableImage`, which is the required name/url/width/height pick plus optional `source?: string`. Task 2 should pass the original source during edits so titles and unknown attributes survive changes.

## Concerns

The parser intentionally reports width/height as null when an extension contains unknown keys, preserving the complete extension in `source`. Callers that edit such images must pass `source` to `serializeImage`; otherwise only the newly supplied width/height fields can be emitted.
