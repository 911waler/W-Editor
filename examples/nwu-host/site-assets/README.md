# Optional NWU page assets

These assets accompany the bootstrap-based full application described in [the adapter contract](../../../src/nwu/README.md); the existing mock host example uses the separate low-level Web mount API.

- `theme.js`: copied from the NWU host theme controller as of 2026-10-20, with unused catch bindings removed for lint. It maintains `html[data-theme]`, the `nwu911-theme` storage preference, optional `[data-theme-toggle]` buttons, and reader text contrast. The required reader contrast CSS is included in `src/ui/reader.css`.
- `original-web-shell.css`: the deployed full-height page and modal stacking rules. Apply `nwu-editor-page` to the body; its direct children are an optional `.topbar` and `#app`.

Serve these files at host-controlled URLs, include the CSS in the page head, and load the theme script with `defer`. Do not load a second theme controller if the surrounding site already supplies it. The host must inject safely encoded bootstrap JSON and enforce the API permissions; these files contain no server, credentials, production data, or site navigation.

Without a bootstrap script, the full application retains standalone behavior and its local appearance preference. These host assets are optional and are not injected into standalone builds.
