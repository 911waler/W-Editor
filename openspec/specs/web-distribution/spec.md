# Web Distribution Specification

## Purpose

定义可在 Linux Flask/Jinja 等无前端构建链宿主中独立部署、低耦合升级、快速回退且与 Desktop 共享编辑与渲染能力的版本化 Web 发行物。

## Requirements

### Requirement: One distribution provides ESM and IIFE entries
每个 Web Distribution SHALL 从同一源码和 commit 生成自包含 browser ESM 与 IIFE 全局入口；两者 SHALL 暴露相同 Mount API、API/schema version、profiles 和行为，并分别通过宿主合同测试。

#### Scenario: Load without a bundler
- **WHEN** Flask/Jinja 页面通过普通 `<script>` 引用 IIFE 入口
- **THEN** 宿主可使用与 ESM 相同的 Editor/Renderer 公共 API，无需安装 Node、Vue 或其他运行依赖

#### Scenario: Load as a browser module
- **WHEN** 页面通过 `<script type="module">` 导入 ESM 入口
- **THEN** 导出的公共 API、版本和 capability manifest 与 IIFE 一致

### Requirement: Runtime dependencies are self-contained and same-origin
Web Distribution SHALL 自包含其锁定的 Vue、Tiptap、Cherry、CodeMirror、KaTeX 及其他运行依赖，所有必需 JS、CSS、字体和功能资源 SHALL 能由同源静态路径提供；正式运行 SHALL NOT 依赖公共 CDN。

#### Scenario: Host runs without internet access
- **WHEN** 宿主服务器可提供发行目录但客户端不能访问公共互联网
- **THEN** Editor、Reader、公式、图标和已声明功能仍可加载，外部文章 URL 资源除外

### Requirement: Distribution has a complete versioned manifest
发行目录 SHALL 包含 product/API/schema/dialect versions、Git commit、入口、chunks、CSS、字体、draw.io、许可证、hash 和兼容要求的 manifest。任何入口引用的文件 SHALL 出现在 manifest 且通过 hash 校验。

#### Scenario: Verify the distribution closure
- **WHEN** 发布验证读取 manifest 并遍历全部引用
- **THEN** 每个资源存在、hash 匹配、路径不逃逸发行根，且没有测试专用 seam

### Requirement: CSS and DOM are isolated from the host
Web Editor/Reader SHALL 通过实例根作用域、处理后的 Cherry/KaTeX/vendor CSS、专属 overlay 容器、唯一 ID 和实例事件隔离宿主。发行样式 SHALL NOT 修改宿主的 `html`、`body`、`#app` 或无作用域通用元素。

#### Scenario: Embed in a hostile-style host page
- **WHEN** 宿主对 button、input、table、pre、body 和 CSS variables 定义冲突样式
- **THEN** W-Editor 仍满足冻结视觉/交互合同，宿主页面未被 W-Editor 样式改写

#### Scenario: Destroy an instance
- **WHEN** 宿主销毁 Editor 或 Reader
- **THEN** 该实例 DOM、overlay、event listener、observer 和临时资源全部释放，其他实例与宿主保持可用

#### Scenario: Embed through an iframe document
- **WHEN** ESM 或 IIFE 宿主把 Editor/Reader 挂载到 iframe 的元素并同时在父页面保留其他实例
- **THEN** 每个实例只在自身 `ownerDocument` 创建、水合和清理 DOM/资源，父页面、iframe 和其他实例均不出现跨 realm 节点或 listener 残留

### Requirement: Assets work at root and reverse-proxy subpaths
发行物 SHALL 使用显式 `assetBaseUrl` 或等价资源定位合同，支持站点根路径和反向代理子路径；缓存 key SHALL 包含版本，禁止新旧版本资源混用。

#### Scenario: Deploy below a subpath
- **WHEN** 发行物位于 `/static/vendor/w-editor/1.0.0/` 等子路径
- **THEN** JS chunks、CSS、字体、draw.io bridge 和所有相对资源均从该版本根加载，不请求域名根硬编码路径

### Requirement: Complete draw.io bundle is shipped and lazy-loaded
Web Distribution SHALL 始终包含并默认启用与 Desktop 相同版本的完整 draw.io bundle，但运行时 SHALL 只在用户打开 draw.io 编辑器时加载大资源。资源或 CSP 失败 SHALL 显示可操作错误，且不得修改 Markdown。

#### Scenario: Open draw.io for the first time
- **WHEN** 用户调用 draw.io 命令
- **THEN** 系统从当前发行版本的 asset root 懒加载 bridge 和闭包资源，并完成 ready/load/save 协议

#### Scenario: Read an article without draw.io interaction
- **WHEN** Reader 展示普通文章且用户未打开 draw.io
- **THEN** 页面不初始化 draw.io 编辑运行时，但现有 draw.io PNG 预览仍可显示

### Requirement: Web versions upgrade by verified atomic switching
宿主 SHALL 能并存部署新旧版本目录，先验证 API compatibility、宿主合同、旧文章和 Renderer smoke，再原子切换一个版本指针；失败时 SHALL 立即回退旧目录。浏览器 SHALL NOT 混用两个版本的缓存资源。

#### Scenario: Upgrade succeeds
- **WHEN** 新发行目录通过全部兼容和 smoke 门禁
- **THEN** 宿主原子切换至新版本，旧目录继续保留到回退窗口结束

#### Scenario: Upgrade fails verification
- **WHEN** 新版本的 API、旧文章、资源或 Renderer 验证失败
- **THEN** 当前版本指针不改变，生产页面继续使用旧目录

### Requirement: Mock NWU host validates the real consumption shape
仓库 SHALL 提供无前端框架的本地宿主，模拟 Jinja 注入、same-origin session、FormData/JSON 保存、CSRF、revision conflict、登录失效、设置、图片占位、Reader 和子路径部署。模拟结果 SHALL 明确不等同于真实 NWU 生产验收。

#### Scenario: Exercise the reference host journey
- **WHEN** 测试在模拟宿主中加载文章、编辑、autosave、手动保存、重开和 Reader
- **THEN** canonical Markdown、revision、草稿、错误状态和 Reader 结果满足公共宿主合同

#### Scenario: Persist host settings and recovery state
- **WHEN** 模拟宿主通过 SettingsStore、draftAdapter 和 workspaceAdapter 保存用户设置、恢复草稿及稳定 workspace state 后重开文章
- **THEN** 设置按三层优先级恢复，较新草稿只在明确恢复/丢弃/导出选择后生效，workspace 只恢复稳定 mode/source offset/selection/scroll/侧栏且不持久化 undo、DOM 或临时 UI

### Requirement: Reference NWU integration produces a real-repository handoff
当前 change MAY 在落后的本地 NWU 副本中实施隔离 reference adapter 以验证合同，但 SHALL 产出真实仓库接入交接文档，并 SHALL NOT 把副本验证声明为真实 NWU 实施、部署或生产验收。

#### Scenario: Hand off to a future NWU task
- **WHEN** 未来 Codex 准备修改真实 NWU 仓库
- **THEN** 交接文档要求先重新调查版本差异，并提供 API、数据库、Jinja、权限、CSRF、资产、兼容、staging、回退和未验证清单
