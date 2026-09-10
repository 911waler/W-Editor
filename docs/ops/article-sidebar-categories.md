# NWU 文章侧栏调整（2026-09-10）

分支：`codex/image-editing`，延续已验收的图片能力。

- 共享侧栏改为纵向弹性布局，文章列表独立滚动，底部“新建文章 / 导入 Markdown”保持可见；大纲使用自己的滚动区域。
- NWU 适配器保留现有目录 API 的 `group`，加载和新建时从元数据专栏映射标签。顺序与 NWU 专栏一致，没有分类的文章归入“其他”。编辑元数据并发布成功后立即重新归类，保持选中文章；首次加载发现专栏变化也立即更新分组。
- PlaygroundApp 接受可选 `articleGroupLabels` 和 `articleGroupOverrides`。没有宿主专栏配置时仍使用原有日期分组；Windows 共用固定底部的布局，但不会凭空获得 NWU 专栏。
- 不修改文章正文、存储协议或 NWU 权限后端。

验证：articleCategoryGroups、adapter、articleCatalog 共 21 项通过；appShell 原有 84 项通过；typecheck、lint 通过。Playwright 以 80 篇文章验证 1280×900、1280×500 两种尺寸，检查专栏顺序、无日期分组、滚动前后按钮位置不变，以及导入文件选择器可打开，2 项通过。构建过程同时验证原版 Web、editor-web 和 nwu-host 构建。Windows 实机打包与验收仍待后续执行。

部署证据、资源提交号及回滚入口记录在 NWU 分支的 `docs/ops/2026-09-10-article-sidebar-rollout.md`。

## 专栏层级与折叠（后续调整）

专栏使用有底色的标题按钮、加粗标签、方向箭头和文章计数；文章缩进且使用较轻字重。每个专栏独立折叠，默认展开，在当前编辑器会话内保留折叠状态（刷新后恢复默认）。使用原生按钮、aria-expanded/aria-controls 与 hidden，支持鼠标、Enter/Space 和键盘焦点；收起内容不参与键盘导航。底部操作区不变。

本次验证：专栏单元 2 项、既有日期/侧栏/大纲回归 4 项、80 文章双高度浏览器 2 项通过；包含独立折叠、Space 展开、计数与固定按钮。已查看浏览器侧栏截图。typecheck、lint 和 Web 构建通过。

## 管理员动态专栏接入

NWU bootstrap新增有序 `categoryOrder`。侧栏分组与笔记属性下拉框共用该顺序，接纳管理员新增的专栏；缺省顺序时兼容旧宿主配置。管理入口、专栏事务、删除迁移和权限在NWU `codex/nwu-category-management` 实现。编辑器已打开时刷新接收新配置。80篇文章双高度浏览器回归使用自定义专栏及非默认顺序，通过2项；typecheck/lint及构建通过。
