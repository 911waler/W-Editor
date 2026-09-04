# W-Editor Web Distribution 许可证与 provenance 清单

本文档是当前 `packages/editor-web/dist/` 的人工可读许可证索引。它不替代各上游项目随包发布的完整通知，也不构成法律意见。发布或再分发时必须保留 `manifest.json` 声明的文件、`drawio/LICENSE`、`drawio/PROVENANCE.md` 和资源树中的上游 notices。

## 发行包声明

当前 Web Distribution manifest 的 `licenses` 字段为：

- `drawio/LICENSE`
- `drawio/PROVENANCE.md`

这两个文件必须存在于 `packages/editor-web/dist/`，并由 `pnpm run verify:web-manifest` 校验路径、大小和 SHA-256。`PROVENANCE.md` 记录 Cherry Markdown `0.11.9` draw.io/mxGraph 静态资源的来源、固定 commit、保留的上游路径以及 W-Editor 对消息边界的最小适配。

## 随 Web bundle 闭包的主要运行时

版本来自仓库锁定依赖和本次发行输入；许可证字段来自本地已安装包的 package metadata。完整传递依赖的通知仍以其随包文件和上游发布说明为准。

| 组件 | 锁定版本 | 许可证 | 备注 |
| --- | --- | --- | --- |
| W-Editor shared/editor-web | `0.1.0` | 本仓库项目许可 | 入口、适配器合同和 scoped CSS |
| Vue | `3.5.41` | MIT | 随包 runtime |
| Tiptap（含 `@tiptap/pm` 及扩展） | `3.30.2` | MIT | Visual 编辑 runtime |
| `cherry-markdown`（Cherry Markdown） | `0.11.9` | Apache-2.0 | Markdown/Final/上游 draw.io provenance |
| CodeMirror（含 `@codemirror/state` / `view`） | `6.0.2` / `6.7.1` / `6.43.9` | MIT | Source 编辑 runtime |
| KaTeX | `0.16.47` | MIT | 公式字体和渲染 |
| Mermaid | `11.17.0` | MIT | Mermaid 图形 chunks |
| ECharts | `6.1.0` | Apache-2.0 | 图表 chunks |
| jsPDF | `4.2.1` | MIT | 导出 chunks |
| DOMPurify | `3.4.14` | MPL-2.0 OR Apache-2.0 | 安全清洗依赖 |
| highlight.js | `11.12.0` | BSD-3-Clause | 代码高亮依赖 |
| html-to-image | `1.11.13` | MIT | 图片导出依赖 |

## 审计规则

1. 以 `packages/editor-web/dist/manifest.json` 的 `files`、`licenses`、`drawio` 和 `contentSha256` 为当前发行物边界；不要用 `node_modules` 是否存在代替构建产物检查。
2. 构建、升级或回退后运行 `pnpm run verify:web-manifest`，确认每个入口引用的文件都在 manifest 且 hash 匹配，draw.io 闭包仍超过已登记的完整文件数量，测试 seam 缺席。
3. 发现上游版本或许可证变化时，先更新依赖/manifest/provenance 证据，再重新运行 Web Distribution 和 parity 门禁；不能通过手工改旧报告计数或删除 notice 解决差异。
4. 当前清单不声称已完成真实 NWU 生产集成、正式签名发布或用户人工验收。
