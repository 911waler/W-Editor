# W-Editor Web Distribution

`@w-editor/editor-web` 的 Web Distribution 是可直接放进 Flask/Jinja 等静态目录的自包含浏览器发行物。当前包版本为 `0.1.0`，Web API、schema 和 Markdown dialect 版本均为 `1.0.0`。本 README 描述的是仓库内可复核的发行合同；它不代表真实 NWU-911 已集成、部署或完成用户人工验收。

## 发行闭包

从 `packages/editor-web/dist/` 复制整个目录，不能只复制一个入口文件。目录至少包含：

```text
editor.es.js          # ESM：Editor + Renderer public API
renderer.es.js        # ESM：Renderer public API
w-editor.global.js    # IIFE：window.WEditor
w-editor.css
chunks/
types/
drawio/
manifest.json
```

运行时依赖 Vue、Tiptap、Cherry Markdown、CodeMirror、KaTeX 及声明的图形/导出能力已随包闭包；正式页面不需要 npm、Vite、Vue 或公共 CDN。所有 JS、CSS、字体和 draw.io 资源必须从部署版本的同源静态根提供。许可证和 provenance 清单见 [`docs/web-distribution-licenses.md`](../../docs/web-distribution-licenses.md)，构建包中的原始 draw.io 文件见 `dist/drawio/LICENSE` 与 `dist/drawio/PROVENANCE.md`。

每个发行目录的 `manifest.json` 是完整文件闭包的机器可读入口，记录入口、chunks、CSS、字体、draw.io、许可证、API/schema/dialect version、Git commit 和 SHA-256。不要手工编辑 manifest 或只根据源码目录判断发行物完整性。

## ESM 集成

入口页面可直接导入 ESM。`assetBaseUrl` 应指向同一发行版本根；使用版本化静态路径时不要从站点根硬编码 `/packages/...`：

```html
<link rel="stylesheet" href="/static/vendor/w-editor/0.1.0/w-editor.css">
<script type="module">
  import { mountWEditor, mountWRenderer } from '/static/vendor/w-editor/0.1.0/editor.es.js'

  const assetBaseUrl = new URL('/static/vendor/w-editor/0.1.0/', document.baseURI).href
  const editor = mountWEditor(document.querySelector('#editor'), {
    assetBaseUrl,
    document: {
      documentId: window.NWU_BOOTSTRAP.documentId,
      markdown: window.NWU_BOOTSTRAP.markdown,
      serverRevision: window.NWU_BOOTSTRAP.serverRevision,
    },
    hostAdapterVersion: '1.0.0',
    userId: window.NWU_BOOTSTRAP.userId,
    saveAdapter: window.nwuSaveAdapter,
  })

  const reader = mountWRenderer(document.querySelector('#reader'), {
    assetBaseUrl,
    markdown: window.NWU_BOOTSTRAP.markdown,
    profile: 'reader',
  })
</script>
```

宿主负责 session、权限、CSRF、FormData/JSON 和 SaveAdapter；不要把 cookie、凭据或 NWU 路由写入共享包。`userId` 与 `documentId` 是 draft/workspace 隔离键；配置 recovery adapter 时必须提供非空 `userId`。Reader 是只读 profile，Editor 的 `onChange` 结果仍以 canonical Markdown 为权威。

## IIFE 集成

没有前端构建链的 Jinja 页面可使用同一发行目录的 IIFE：

```html
<link rel="stylesheet" href="/static/vendor/w-editor/0.1.0/w-editor.css">
<script src="/static/vendor/w-editor/0.1.0/w-editor.global.js"></script>
<script>
  const api = window.WEditor
  const reader = api.mountWRenderer(document.querySelector('#reader'), {
    assetBaseUrl: new URL('/static/vendor/w-editor/0.1.0/', document.baseURI).href,
    markdown: window.NWU_BOOTSTRAP.markdown,
    profile: 'reader',
  })
</script>
```

ESM 和 IIFE 从同一个 `publicEntry` 导出源生成，API、版本、profile 和行为合同相同。宿主应在页面销毁或导航时调用 `destroy()` 并处理返回的状态，不要把按钮存在或脚本加载成功当作保存成功。

## 根路径、反向代理和 CSP

`assetBaseUrl` 支持站点根和反向代理子路径。例如版本目录可部署为：

```text
/static/vendor/w-editor/0.1.0/
/blog/assets/editor/0.1.0/
```

chunks、CSS、字体、draw.io bridge 和其余相对资源都必须从同一版本根解析。生产 CSP 至少应允许同源 `script-src`、`style-src`、字体、图片和所需 iframe；不应为了 W-Editor 加入公共 CDN。CSP 或资源缺失时 draw.io 应显示可操作错误，不能静默修改 Markdown。已有 draw.io PNG 可由 Reader 展示；只有用户首次打开 draw.io 编辑器时才初始化完整 vendor runtime。

## 构建、验证和升级/回退

在仓库根目录执行：

```text
pnpm --filter @w-editor/editor-web build
pnpm run verify:web-manifest
pnpm run verify:seam:absent
pnpm exec vitest run tests/web/webVersionSwitching.spec.ts
pnpm exec playwright test e2e/web-version-switching.spec.ts
```

升级时保留旧目录，按以下顺序操作：

1. 从同一 Git commit 构建完整 `dist`，并为新版本建立独立目录，例如 `/static/vendor/w-editor/1.1.0/`。
2. 运行 manifest 文件/hash 闭包验证、API/schema/host adapter 兼容性检查、旧文章 Reader smoke 和真实 Renderer/Reader 合同回归。
3. 只有全部检查通过后，才通过原子版本指针切换到新目录；旧目录在回退窗口结束前继续保留。
4. 任一检查失败时不改变当前指针，继续使用旧目录。已经切换后发现失败时，把指针原子地切回旧版本，再调查失败原因。
5. 浏览器资源 URL 必须包含版本根；不要让两个版本共享可变的无版本 chunk/CSS/cache key。

仓库中的 `scripts/web-version-switching.mjs` 和对应 Vitest/Playwright 测试是本地演练与验证 helper，不是已经连接生产发布系统的部署脚本。它们验证 `inspectWebVersion`、`versionedAssetUrl` 和 `createAtomicVersionPointer` 的兼容、原子切换和失败回退语义。

## 已知限制与未执行项

- 当前只完成仓库内 Web Distribution 和 framework-free mock NWU host 合同；未读取或修改真实 NWU-911 生产仓库，未执行真实网站集成、发布或部署。
- 当前严格像素候选使用 Playwright bundled Chromium `151.0.7922.34`、1560×1200、DPR 1、固定字体和四类 fixture；ESM/IIFE 的异步 Mermaid 差异保留在批准候选中，未放宽断言。候选与冻结 baseline 不可互相覆盖。
- Firefox、WebKit/Safari、iOS、Android、真实 NWU 代理和真实网站无障碍矩阵尚未执行；不能用当前 Chromium/Chrome/Edge 结果代替这些覆盖。
- Vite 大于 500 kB chunk 警告和少量 Cherry jsdom teardown 异步诊断是已记录的非阻断风险，仍需后续按真实功能边界优化/清理。
- `search-dialog-layout` 时序风险已单独记录，不能通过放宽断言消除。
- 该包当前不是已签名的 formal release；缺少 Desktop/NSIS/MSI、签名和真实 NWU 验收时不得标记统一正式版本。

## 相关验证入口

- 无 bundler、离线和双入口示例：[`examples/web-consumer/README.md`](../../examples/web-consumer/README.md)
- Host public contracts：[`docs/web-host-contracts.md`](../../docs/web-host-contracts.md)
- 当前行为规格：[`openspec/specs/`](../../openspec/specs/)
