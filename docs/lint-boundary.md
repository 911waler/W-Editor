# Repository lint boundary

The repository lint gate is strict for authored JavaScript, TypeScript, Vue, and validation-script sources. It does not treat generated bundles or vendored third-party code as authored project code.

`pnpm run lint` names the authored roots explicitly: `src`, `packages`, `apps`, `examples`, `tests`, `e2e`, and `scripts`, plus the root configuration files. The ESLint flat config also globally ignores:

- every workspace `dist/` tree;
- every Rust/Cargo `target/` tree;
- every `.tmp/` tree produced by browser/build diagnostics;
- `public/vendor/`, which is checked through dependency, provenance, and asset-closure gates instead of project lint.

The boundary is protected by `tests/workspace/lintBoundary.spec.ts`. It asserts that representative generated/vendor files are ignored while editor-web, editor-vue host, tests, and validation scripts remain linted. No generated or vendor files are deleted or modified by this boundary.

Third-party resources remain subject to their existing runtime-dependency, static-asset, license, and provenance checks. This separation prevents minified/generated syntax from exhausting the lint process or drowning authored-source findings while preserving strict lint coverage for repository-owned code.
