# Bundled China map provenance

`china.json` is derived from CherryMarkdown `0.11.9`'s own map asset:

- Repository: `https://github.com/Tencent/cherry-markdown`
- Tag: `cherry-markdown@0.11.9`
- Commit: `9eba3371cce07c8ffcc422ccde1abdb961559f80`
- Source path: `packages/cherry-markdown/src/addons/advance/maps/china.json`
- Original SHA-256: `99ADFEDED5223848BBE37A0A12F8023E11EE12161C7800521C27DB42FDEAC275`
- License: Apache License 2.0, as declared by CherryMarkdown

W-Editor rounds coordinates to three decimal places and applies Ramer-Douglas-Peucker simplification with a `0.03` degree tolerance. Feature names and properties remain unchanged. This keeps the existing `chart.map` Markdown source stable while making the default preview self-contained instead of depending on the public Aliyun endpoint.
