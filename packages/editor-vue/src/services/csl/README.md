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

## Bundled journal catalog (version 1)

The `journals/` files are unmodified from the official CSL styles repository,
validated branch `v1.0.2`, commit `20af0514b2c754b2dc766a31617b31f5b3eee8de`.
See `journals/provenance.json` for exact paths and independent-parent resolution.
Nature and Science are independent. Physical Review B and Physical Review Letters
resolve to `american-physics-society`; Physics Letters A to `elsevier-with-titles`;
Journal of Materiomics to `elsevier-vancouver`. Catalog titles and ISSNs are copied
from these pinned files. Search aliases PRB / Phys. Rev. B and PRL / Phys. Rev. Lett.
are verified against https://journals.aps.org/prb/ and https://journals.aps.org/prl/
(accessed 2026-10-01); alias sources are also recorded in provenance.json.

All author/contributor metadata and CC BY-SA 3.0 notices remain intact; the adjacent
`CC-BY-SA-3.0.txt` applies to these files too. Attribution: Citation Style Language
project, https://citationstyles.org/. The runtime bibliography XML adaptation removes
only `text` elements for `citation-number` within `bibliography`, also CC BY-SA 3.0.
No leading numbers are removed from rendered strings.

The application retains numeric in-text citations and its own bibliography order.
This catalog supports individual-entry bibliography formatting only: the selected
numeric styles have no bibliography disambiguation or subsequent-author substitution.
It does not claim to enforce an entire journal submission template. Unknown journal
abbreviations are not inferred; missing metadata (especially title) falls back to
original user text. Embedded local chunks load lazily without a remote style request;
exports await loading and synchronous export helpers reject an unready style.
