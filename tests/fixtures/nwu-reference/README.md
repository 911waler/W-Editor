# Lagging NWU copy reference adapter

This directory contains reviewable, reference-only artifacts derived from safe template-shape facts in an external historical non-Git directory. It contains no database row, real article, credential, Cookie, session file, authentication material, or production configuration.

The verification runner copies only `templates/blog_edit.html` and `templates/blog_view.html` to a new system-temp directory, checks and applies `reference-adapter.patch` there, checks `nwu-reference-adapter.js` syntax and markers, confirms the original template hashes are unchanged, and removes only the verified temp directory. It never edits the historical source directory.

Run from the W-Editor repository root:

```text
node scripts/verify-nwu-reference-adapter.mjs --source="<path-to-lagging-nwu-copy>"
```

The adapter proves only the template/IIFE consumption shape: canonical Markdown originates in the existing textarea or a Jinja `tojson` bootstrap, Editor changes synchronize the legacy form field, and the view page mounts the public `reader` profile. It deliberately does not fabricate a `SaveAdapter`, opaque `serverRevision`, permanent `versionId`, CSRF protection, draft persistence, or authorization response that the lagging copy does not provide.

This is not the current real NWU repository, a deployable patch, staging evidence, or production acceptance. A future real-repository task must re-investigate its code and create an independent NWU OpenSpec; it must not mechanically apply this patch.
