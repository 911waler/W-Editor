# Host Contracts Specification

## Purpose

定义 Web Editor、Reader 和外部宿主之间稳定、版本化、低耦合的挂载、保存、设置、上传、扩展、错误、草稿与 workspace 合同，使 NWU-911 等宿主无需访问编辑器内部实现。

## Requirements

### Requirement: Editor mount owns a document session behind a public API
`mountWEditor` SHALL 接收容器、初始 document snapshot、资源配置和宿主 adapters，返回可聚焦、flush、save、受保护替换和 destroy 的实例。实例 SHALL 在会话内拥有 Markdown 与 history，并通过不可变事件通知宿主；宿主 SHALL NOT 需要访问 Tiptap、CodeMirror 或内部 session 对象。

#### Scenario: Mount an editor
- **WHEN** 宿主用有效容器、documentId、Markdown 和配置调用 Mount API
- **THEN** 系统返回可用实例，加载对应 Source/Visual/Preview，并发出带 API/schema version 的 ready 状态

#### Scenario: Mount with invalid input
- **WHEN** 宿主缺少必需 documentId、Markdown 或有效容器
- **THEN** Mount API 以稳定公共错误拒绝，不留下半挂载 DOM、全局事件或资源

### Requirement: Renderer mount exposes explicit capability profiles
`mountWRenderer` SHALL 接收 canonical Markdown、资源配置和 `reader` 或 `author-preview` profile，并返回可更新 Markdown 和 destroy 的实例。独立 Renderer SHALL 使用与 Visual 相同的 Tiptap schema、extensions、NodeViews 和 presentation CSS 建立只读投影；缺少 Tiptap 映射的 Cherry 扩展只能作为显式、原子、经清洗且不重复内容的 fallback。Reader SHALL 为只读；作者修改权限 SHALL 由宿主服务端路由决定，而不是只靠前端隐藏控件。

#### Scenario: Unauthorized user views an article
- **WHEN** 宿主为无编辑权限用户挂载 `reader`
- **THEN** 用户只能使用阅读交互，系统不暴露正文修改入口或可调用的作者编辑事件

#### Scenario: Author opens the edit page
- **WHEN** 宿主服务端确认作者或管理员权限并导航至独立编辑页
- **THEN** 编辑页挂载 Editor 和 `author-preview`，保存接口仍执行服务端授权校验

#### Scenario: Mount a standalone reader from canonical Markdown
- **WHEN** 宿主调用 `mountWRenderer` 展示一篇文章
- **THEN** 系统从 canonical Markdown 建立独立的只读 Tiptap presentation，使用与 Visual/应用内 Preview 相同的内容 DOM/CSS 合同，并且不创建可编辑正文或第二内容权威

### Requirement: Public events are immutable and instance-scoped
Editor SHALL 以不可变 snapshot 发出 `onChange`、`onSaveStateChange` 和 `onError` 等事件。事件、DOM ID、overlay 和全局监听 SHALL 归属实例；首期同一页面 SHALL 支持一个 Editor 和多个 Reader 而互不干扰。

#### Scenario: Multiple readers coexist
- **WHEN** 一个页面挂载一个 Editor 和多个 Reader
- **THEN** 任一实例更新、主题、overlay、销毁或错误不改变其他实例的内容和生命周期

#### Scenario: Mount inside a foreign document
- **WHEN** 宿主把 Editor 或 Reader 挂载到 iframe 或其他具有不同 `Document`/`Window` realm 的有效容器
- **THEN** 所有创建节点、临时 Renderer host、overlay、clipboard 和 listener 使用该容器的 `ownerDocument`/`defaultView`，销毁时不访问或改变父页面及其他 realm

#### Scenario: Host mutates an event object
- **WHEN** 宿主尝试改变收到的 snapshot
- **THEN** 编辑器内部 authority 和下一事件不受该外部修改影响

### Requirement: External document replacement is protected
宿主只能通过显式 `setDocument` 或 `replaceDocument` 替换当前内容。系统 SHALL 在替换前处理 composition、pending synchronization、dirty state 和 history 边界；未经确认不得静默覆盖本地未保存 Markdown。

#### Scenario: Replace a clean document
- **WHEN** 宿主替换一个已 flush 且无未保存修改的文档
- **THEN** 系统原子切换 documentId、Markdown、serverRevision 和 history 边界

#### Scenario: Replace a dirty document
- **WHEN** 宿主在当前文档有未保存修改时请求替换
- **THEN** 系统拒绝或进入明确确认/导出/保存流程，并保留本地内容直到选择完成

### Requirement: SaveAdapter carries canonical Markdown and opaque revision
保存请求 SHALL 包含 documentId、canonical Markdown、baseServerRevision、保存类型/来源和必要宿主元数据；成功响应 SHALL 返回新的 opaque serverRevision、savedAt、手动保存/发布时的 versionId 以及草稿/恢复状态。HTTP、JSON/FormData、路由、session 和 CSRF SHALL 由宿主 adapter 实现。

#### Scenario: Successful manual save
- **WHEN** 用户手动保存且 baseServerRevision 匹配服务端
- **THEN** Adapter 返回新 revision、时间和 versionId，系统标记保存成功但不清空当前 undo history

#### Scenario: Authentication or CSRF failure
- **WHEN** 宿主返回登录失效或 CSRF 校验失败
- **THEN** 系统分别报告稳定错误类别，保留本地 Markdown，并提供宿主可处理的重新登录或重试入口

### Requirement: Save conflicts never silently overwrite
若服务端拒绝过期 baseServerRevision，系统 SHALL 报告显式冲突、保留当前本地 Markdown，并提供重新加载、导出/另存或经授权确认覆盖的路径。本 change SHALL NOT 自动 merge 或实现实时协同。

#### Scenario: Stale revision conflicts
- **WHEN** 另一标签页或用户已产生更新版本
- **THEN** 当前保存失败为 conflict，正式正文不被当前请求覆盖，本地内容继续可导出和编辑

### Requirement: Shared autosave state uses host persistence
共享运行时 SHALL 提供有界防抖/最大等待的 autosave、flush、retry 和可观察状态；宿主 SHALL 能决定是否启用和间隔，并通过 SaveAdapter 持久化。Autosave SHALL 更新恢复草稿而不是制造永久文章版本。

#### Scenario: Autosave succeeds
- **WHEN** 编辑达到宿主配置的 autosave 条件且没有 composition/pending patch
- **THEN** 系统 flush 最新 Markdown，更新恢复草稿状态，不创建手动 versionId

#### Scenario: Autosave response attempts to create a permanent version
- **WHEN** SaveAdapter 对 `autosave-draft` 响应返回 `versionId`
- **THEN** 系统以稳定合同错误拒绝该响应，不更新已保存状态或 serverRevision，并保留当前 Markdown、dirty 状态和 history

#### Scenario: Autosave fails
- **WHEN** 网络、权限或持久化失败
- **THEN** 系统显示可重试失败状态、保留内存正文和当前 history，且不得误报已保存

### Requirement: Draft and workspace state is bounded and reconstructible
宿主合同 SHALL 能按用户/文档交换最新恢复草稿、baseServerRevision、最后模式、稳定 source offset/selection、scroll 和侧栏状态。合同 SHALL NOT 要求保存原生 undo、DOM、Tiptap JSON、弹窗、hover 或临时 fold。

#### Scenario: Reopen with a newer recovery draft
- **WHEN** 用户重开文章且其个人恢复草稿比正式版本新
- **THEN** 系统提示恢复、丢弃或导出，并且不在无选择时覆盖正式内容

### Requirement: UploadAdapter has an explicit unavailable state
若宿主未配置真实 UploadAdapter，本地文件入口 SHALL 明确禁用或显示“宿主未配置上传”，且选择文件 SHALL NOT 写入 mock URL、data URL、document revision 或部分媒体节点。已有 URL 图片显示和 URL 插入 SHALL 继续可用。

#### Scenario: Local upload is unavailable
- **WHEN** 用户在没有 UploadAdapter 的 Web Editor 中访问本地图片入口
- **THEN** 系统说明能力未配置，Markdown 和 revision 保持不变

#### Scenario: URL image is used
- **WHEN** 用户提供受支持的绝对 HTTP(S) 或同源 root-relative 图片 URL
- **THEN** 系统按宿主 base 解析并插入 URL 图片，拒绝带用户名或密码的 URL

### Requirement: SettingsStore supports three precedence layers
公共设置合同 SHALL 支持产品默认、站点/分发默认和用户覆盖三层优先级，并支持恢复站点默认。宿主可以把用户设置保存到站点数据库或本地存储，但 SHALL NOT 要求每个用户单独数据库文件。Mount SHALL 立即应用产品/分发默认值，完成同步或异步宿主设置解析后再发出 ready；解析失败 SHALL 保留安全默认、报告稳定设置错误且不得改变 Markdown。

#### Scenario: Reset user settings
- **WHEN** 用户清除个人主题、行距或快捷键覆盖
- **THEN** 系统立即使用当前站点默认值，并保留产品默认作为最终 fallback

#### Scenario: Resolve and subscribe to host settings
- **WHEN** 宿主提供同步或异步 SettingsStore 并在挂载后更新或清除用户覆盖
- **THEN** Editor/Reader 按产品、站点和用户顺序应用主题、行距及已支持偏好，发出 ready 后继续实时响应设置变化，并在 destroy 时取消订阅

#### Scenario: Host settings are unavailable
- **WHEN** SettingsStore 初始读取拒绝或返回不可用结果
- **THEN** 实例保留产品/分发默认值、报告 `SETTINGS_UNAVAILABLE` 且不写入未授权全局 key、不修改正文或 revision

### Requirement: Renderer extensions remain inside the safety boundary
公共 Renderer extension hook SHALL 能为宿主添加受控增强，但扩展输出 MUST 经过声明的安全、权限和 sanitizer 边界，且不得改变 Markdown authority。NWU 的 `<!-- script: ... -->` 下载增强 SHALL 通过该 hook 连接宿主脚本库，而不是硬编码进共享运行时。

#### Scenario: NWU script extension renders
- **WHEN** NWU 宿主识别受支持的 script 注释并确认用户下载权限
- **THEN** Reader 显示受权下载链接，Desktop/通用 Web 在未加载插件时仍无损保留原始 Markdown

### Requirement: Public host contracts are versioned
Mount API、adapter 类型、事件、manifest 和 profiles SHALL 声明 API/schema version 并遵循 SemVer。破坏性变更 MUST 提升 major，提供迁移说明和弃用期；发行 manifest SHALL 声明最低兼容宿主 adapter 版本。

#### Scenario: Host loads an incompatible major
- **WHEN** Web Distribution 检测到宿主 adapter 不满足最低版本
- **THEN** 系统在挂载前报告兼容错误，不以未知字段静默运行
