# Bibliography formatting sources and licenses

The application uses **citeproc-js 2.4.63**, by Frank Bennett (Copyright 2009–2019),
from https://github.com/Juris-M/citeproc-js, distributed as npm `citeproc`.
The unmodified processor is dual-licensed **CPAL-1.0-or-later OR AGPL-3.0-or-later**,
not BSD or MIT. See `CITEPROC-LICENSE` (the exact npm notice), `CPAL-1.0.txt`, and
`AGPL-3.0-or-later.txt`. Keep its notice and attribution in distribution license bundles.
Display attribution to citeproc-js / Frank Bennett in the bibliography UI or credits.

Official CSL styles: https://github.com/citation-style-language/styles
Pinned commit: `000d75db98c9716f4c5489ac56bbd979d33b9c69`.

- `apa.csl`: American Psychological Association 7th edition.
- `modern-language-association.csl`: Modern Language Association 9th edition.
- `china-national-standard-gb-t-7714-2025-numeric.csl`: GB/T 7714—2025 numeric.

Official CSL locales: https://github.com/citation-style-language/locales
Pinned commit: `a89adece41013402236e2c9020972d7e931fbab8`.

- `locales-en-US.xml`
- `locales-zh-CN.xml`

Styles and locales are **CC BY-SA 3.0**. Original author/translator credits and
rights notices are preserved inside every XML file. See `CC-BY-SA-3.0.txt` and
`STYLES-README.md` for license and upstream documentation.

All downloaded XML assets are unmodified. At runtime the exact GB/T bibliography
`citation-number` instruction is removed before processor initialization so the
application can supply its own stable numeric labels. This adaptation is also
CC BY-SA 3.0. No number is stripped from rendered text, and no handwritten
formatting rules replace the CSL definitions. APA/MLA apply to individual
bibliography entries; application order and numeric in-text markers remain intact.

Incomplete metadata (no title) falls back to the user's original text. Plain mode
always uses that text. Original source fields are never replaced by formatted text.
