# 图片编辑分支与 Windows 交接

本轮开发日期：2026-09-10。源码仓库：https://github.com/911waler/W-Editor 。工作分支 `codex/image-editing`，从原版 NWU Web 接入提交 `264884f4a074827e70a23a84f72a9a7273f00c71` 分出。本轮只保留本地分支；没有 push、合并主分支或发布 Windows 安装包。

## 共享能力

- `packages/editor-core/src/codecs/images.ts` 定义安全地址、图片 token、尺寸与原文往返。普通图片使用共享 `inlineImage` 节点；同一段落可包含文字和多图，空间不足自动换行。
- `packages/editor-vue/src/adapters/imageNode.ts` / `imageResize.ts` 提供八点缩放、精确宽高、默认比例锁定、原始尺寸、取消及单次撤销。交互尺寸 16–4096 px；响应式显示不修改保存值。
- 左、中、右对齐作用于图片所在段落。嵌套表格/列表中不支持的对齐操作保持禁用。只读呈现不挂载编辑控件。
- 尺寸持久化为 `{width=240 height=120}`，对齐使用既有 `::: center` 等容器。未修改的 title/未知扩展保留原文；draw.io 保留专用节点与 PNG/XML 关系。

Web 和 Windows 均经共享 PlaygroundApp/editor-core/editor-vue 使用这些能力，无需复制一套 Windows 图片组件。NWU 上传、权限和保存发布仍由 NWU 适配与后端负责。根相对地址需要所属站点上下文；Windows 独立打开含 NWU 私有地址的 Markdown，不代表能绕过站点登录读取图片。

## Linux 已执行

Node 24.20.0 / pnpm 11.19.0，使用既有 `pnpm-lock.yaml`，没有依赖升级。根目录 typecheck/lint、图片与媒体单元及浏览器回归；桌面 `build:frontend` 包含桌面 typecheck，构建通过。最终完整证据与部署提交号记录在 NWU 分支 `codex/nwu-image-editing` 的 `docs/ops/2026-09-10-image-editing-rollout.md`。

完整单元测试中的 `desktopInstallerConfig.spec.ts` 有一项基线失败：旧断言只接受不含 editor-web/nwu-host 构建步骤的 `build:e2e` 字符串；原版分支同样失败，本轮没有修改该流程。不要把它描述成图片功能失败或全套测试全绿。

## Windows 待执行

1. 经用户确认后将本地功能分支 push 到 GitHub。Windows 已有克隆则 fetch/checkout/pull；首次使用才 clone。核对验收的准确提交号和锁文件。
2. 使用兼容的 Node 24、固定 pnpm 11.19.0、Tauri 所需 Rust/MSVC/WebView2；执行 frozen-lockfile 安装、typecheck、test 和桌面 frontend 构建。
3. Windows WebView2 实测：同行两图和文字混排；八方向拖动、反向拖动、比例锁定/解锁、精确值、reset、Escape/pointercancel、单次 undo/redo；100%/150%/200% DPI 与窄窗口；键盘焦点和只读模式；保存关闭重开。
4. 回归普通图片、公式、Mermaid、表格、附件、draw.io 保存 PNG/XML 和再次编辑；验证本地文档/导入/导出与桌面文件适配。
5. 通过后按仓库桌面发布流程构建安装包，验证安装、升级、卸载与签名。安装包作为 Release 产物，不混入源码提交。
6. 仅在 Windows 验收产生源码或配置修复时新增提交并 push；单纯打包不需要为了“同步”再改源码。保留提交号、构建工具版本和验收记录。

Windows 实机、安装包及发布状态：**未执行**。
