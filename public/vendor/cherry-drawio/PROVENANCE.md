# Cherry draw.io/mxGraph static bundle provenance

- Upstream: `Tencent/cherry-markdown`
- Upstream tag: `cherry-markdown@0.11.9`
- Pinned commit: `9eba3371cce07c8ffcc422ccde1abdb961559f80`
- Upstream paths: `examples/drawio_demo.html`, `examples/assets/scripts/drawio-demo.js`, `examples/assets/drawio_lib/**`, and `examples/assets/mxgraph/**`
- Retrieved: 2026-08-25 using a sparse checkout of the official GitHub repository
- License: see the unmodified upstream `LICENSE` copied beside this file and the per-file notices retained in the resource tree

W-Editor keeps the upstream page and static resource layout. The local `assets/scripts/drawio-demo.js` is derived from the upstream example script and changes only the integration boundary needed by W-Editor: messages require the exact same origin and parent window, and both the existing W-Editor `<mxfile>` representation and Cherry's `<mxGraphModel>` editor payload are accepted. W-Editor's outer bridge remains responsible for request correlation, payload validation, explicit Apply, and conversion back to the existing Cherry-compatible Markdown representation.
