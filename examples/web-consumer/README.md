# Web Distribution 集成示例

本目录演示不使用 npm/Vite 的静态宿主如何消费 `packages/editor-web/dist/`。它们是可复制的 Flask/Jinja 静态页面形状，不是已经接入真实 NWU-911 的生产页面。

## 示例页面

| 页面 | 用途 |
| --- | --- |
| `esm.html` | 同源 ESM Editor + Reader + 手动保存 + destroy |
| `iife.html` | `window.WEditor` IIFE 与 ESM 相同的消费合同 |
| `offline-esm.html` | 无公共网络下的 ESM、公式、代码和 Mermaid |
| `offline-iife.html` | 无公共网络下的 IIFE、公式、代码和 Mermaid |
| `subpath-esm.html` | 反向代理子路径下的 ESM 与 `assetBaseUrl` |
| `subpath-iife.html` | 反向代理子路径下的 IIFE 与 `assetBaseUrl` |
| `parity-esm.html` / `parity-iife.html` | Reader/Final 语义与受控像素候选生成输入 |

对应的 `*-runner.js` 只负责页面状态、真实 mount/save/Reader/destroy 结果和资源请求记录；它们不复制 W-Editor 的 command、codec 或 Renderer 行为。

## 静态部署形状

把完整 `packages/editor-web/dist/` 复制到宿主的版本化静态目录，例如：

```text
static/vendor/w-editor/0.1.0/
  editor.es.js
  renderer.es.js
  w-editor.global.js
  w-editor.css
  chunks/
  types/
  drawio/
  manifest.json
```

页面从该版本根加载入口和 CSS。不要从站点根拼接 `/packages/editor-web/dist`，也不要把 Vue、Cherry、Tiptap、CodeMirror、KaTeX 或 Mermaid 改成公共 CDN peer。`manifest.json` 的所有文件、大小和 SHA-256 必须在复制后保持一致。

## ESM 与 IIFE

ESM 页使用：

```js
import * as api from './editor.es.js'

const assetBaseUrl = new URL('./', import.meta.url).href
const editor = api.mountWEditor(document.querySelector('[data-consumer-editor]'), {
  assetBaseUrl,
  document: { documentId: 'article-1', markdown: '# Article' },
  saveAdapter,
})
const reader = api.mountWRenderer(document.querySelector('[data-consumer-reader]'), {
  assetBaseUrl,
  markdown: editor.snapshot().markdown,
  profile: 'reader',
})
```

IIFE 页先加载 `w-editor.global.js`，然后使用 `window.WEditor.mountWEditor` 或 `window.WEditor.mountWRenderer`。两个页面都必须验证 API version、实际正文、保存响应、Reader 结果和 `destroy()`，不能只检查全局变量或入口 HTTP 200。

## Jinja、保存和安全边界

Jinja 可以把 `documentId`、canonical Markdown、`serverRevision` 和登录后的 `userId` 注入 JSON bootstrap；FormData/JSON、`X-Requested-With`、CSRF、auth expiry 和 revision conflict 由宿主实现的 SaveAdapter 负责。保存失败要保留本地 Markdown，并向用户提供 retry/reload/export/authorized-overwrite 等明确动作。

Reader 只消费 canonical Markdown，不能获得作者事件。draftAdapter/workspaceAdapter 按 `(userId, documentId)` 隔离；autosave 只写恢复草稿，不创建永久 versionId，manual save 才创建 version。SettingsStore 仍遵守产品默认 < 站点/分发默认 < 用户覆盖。

宿主应使用同源且版本化的 `assetBaseUrl`，配合 `script-src 'self'` 等 CSP。CSP/resource failure 必须可见且 fail-closed；draw.io 只在首次打开时加载 bridge 和完整本地资源，未打开时 Reader 不初始化大 runtime。

## 根路径、子路径和离线检查

至少运行以下验证：

```text
pnpm exec playwright test e2e/web-distribution-offline.spec.ts
pnpm exec playwright test e2e/web-distribution-subpath.spec.ts
pnpm exec playwright test e2e/web-version-switching.spec.ts
pnpm run verify:web-manifest
```

离线页会阻止公共网络请求；子路径页会检查 chunks、CSS、字体、bridge 和所有资源 URL；版本切换页会同时提供旧/新目录并检查缓存根不混用。静态服务器若缺少任何 manifest 文件，应返回失败并阻止切换，不应退回到另一个版本的同名资源。

## 升级、回退和限制

先把新 `dist` 放进独立版本目录，运行 manifest/hash、API compatibility、旧文章 smoke 和 Renderer/Reader 回归；验证通过后原子更新版本指针。失败时保持旧指针与旧目录，或从新版本原子切回旧版本。不要覆盖旧目录来“升级”，也不要删除回退窗口内仍可能被浏览器缓存引用的资源。

这些示例尚未覆盖真实 NWU 仓库、真实 Flask 权限数据库、生产 CSP、Firefox/WebKit/Safari/iOS/Android 或真实无障碍矩阵。当前仍保留大 chunk、Cherry jsdom teardown 和 `search-dialog-layout` 时序风险；这些限制不通过放宽像素/行为断言消除。
