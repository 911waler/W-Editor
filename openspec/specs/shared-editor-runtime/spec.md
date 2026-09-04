# Shared Editor Runtime Specification

## Purpose

定义 Desktop 与 Web 必须共同消费的编辑、Markdown 权威、渲染、命令、设置和内容兼容行为，确保同一产品功能只实现一次且不会在两个发行目标之间漂移。

## Requirements

### Requirement: Markdown remains the sole content authority
系统 SHALL 继续以版本化 Markdown 作为文章正文的唯一持久权威；Visual 投影、编辑器内部 JSON、DOM、projection 元数据和原生 undo history SHALL 能够丢弃并从 Markdown 重新建立，且不得与 Markdown 共同决定正文内容。

#### Scenario: Rebuild an article in either target
- **WHEN** Desktop 或 Web 使用相同版本的运行时打开同一 canonical Markdown
- **THEN** 系统重建相同的正文结构、格式语义和可编辑内容，而不要求读取 Tiptap JSON sidecar

#### Scenario: Persist a visual edit
- **WHEN** 用户在 Visual 中完成一个受支持的内容修改
- **THEN** 系统把修改提交到 Markdown authority，并且下一次 Source、Visual、Final Preview 或 Reader 重建均使用该 Markdown

### Requirement: Current editor capabilities are frozen across targets
系统 SHALL 建立基于 `39dddc3` 产品基线的功能、命令、组件、Markdown 和视觉行为清单；除 OpenSpec 明确延期或声明为平台专属的能力外，Desktop 与 Web Editor SHALL 共同提供清单中的现有内容能力，内部重构不得静默删除、替换或改变其结果。

#### Scenario: Shared feature changes once
- **WHEN** 一个共享公式、表格、颜色、代码、命令或 Renderer 功能被修改
- **THEN** Web 与 Desktop 从同一共享实现和同一 commit 获得该修改，并通过跨目标行为测试

#### Scenario: Platform-specific capability is reviewed
- **WHEN** 一个能力只适用于文件系统、安装器、认证或网络宿主
- **THEN** 对应 capability spec 和发布 manifest 显式标记该平台差异，且不把它实现为另一份内容语义

### Requirement: Unknown and untouched source is preserved
系统 SHALL 保留未识别 raw Markdown，并通过 checked patch 尽量逐字保留未修改 source span、行尾、连续空段和表格 delimiter；被实际修改的节点 MAY 按版本化 canonical serializer 规范化，但 SHALL 保持语义和无关内容不变。

#### Scenario: Unknown source crosses modes
- **WHEN** 文档含有当前 codec 不认识的 block 或 inline source，并在 Source、Visual、Preview 之间切换
- **THEN** 该 source 保持可见、可导出且不被投影过程删除或改写

#### Scenario: Modify one supported node
- **WHEN** Visual 只修改一个受支持节点
- **THEN** 系统只提交经 revision 和旧子串校验的必要范围，未修改范围保持原始字节与行尾策略

### Requirement: Editing history lasts for the mounted document session
Source 与 Visual SHALL 保留各自原生 undo/redo history；保存、自动保存和模式切换 SHALL NOT 清空当前文档 history。显式加载另一文档或用户确认的外部 replace SHALL 建立新的 history 边界，且系统 SHALL NOT 承诺跨页面销毁、重启、设备或编辑器版本恢复原生 undo 栈。

#### Scenario: Save without losing undo
- **WHEN** 用户编辑后执行手动保存或一次成功自动保存
- **THEN** 用户仍可在当前挂载实例中撤销和重做保存前的内容事件

#### Scenario: Replace the document
- **WHEN** 宿主请求替换有未保存内容的当前文档
- **THEN** 系统先走显式 dirty/flush/确认合同，接受替换后为新文档建立独立 history

#### Scenario: Confirm an approximately 1 MiB Markdown import
- **WHEN** 用户在 Visual 或 Preview 中确认导入至少 1 MiB 的 Markdown 文件
- **THEN** 系统在提交 replacement 前切换到 Source，避免为即将卸载的 Visual 构建一次大型投影；确认、pre-destructive checkpoint、单次 revision、Markdown authority、autosave 和后续 Visual/Preview 往返合同保持不变

### Requirement: Visual, author preview, reader and PDF share one Tiptap presentation
系统 SHALL 使用同一 Tiptap schema、extensions、NodeViews、presentation CSS、公式重建和异步水合能力提供 Visual、`author-preview`、`reader` 与 PDF 内容呈现。应用内 `author-preview` SHALL 复用当前 Visual 已挂载的同一 Tiptap Editor 实例，并通过只读状态切换禁止正文编辑，而不是把 Markdown 交给第二套主 Renderer 重新解释；独立 `reader` SHALL 从 canonical Markdown 创建同一 presentation factory 的只读实例；PDF SHALL 在水合稳定后捕获同源只读 presentation DOM。缺少 Tiptap 映射的 Cherry 扩展 MAY 作为显式原子 fallback，但必须经现有安全边界清洗、不得重复或改写正文、不得改变 Markdown authority。

#### Scenario: Switch Visual to author preview
- **WHEN** 用户从 Visual 切换到应用内 Preview
- **THEN** 系统先完成 composition/pending synchronization，再把同一 Tiptap presentation 切换为只读并隐藏 caret、selection、handles、占位提示、插入按钮和编辑动作；正文节点、NodeViews、CSS 和已水合内容保持与切换前相同

#### Scenario: Return from author preview to Visual
- **WHEN** 用户从只读 Preview 返回 Visual
- **THEN** 系统恢复同一实例的可编辑状态以及有效 selection、history 和可映射滚动位置，模式往返本身不修改 Markdown、revision 或 undo depth

#### Scenario: Render an article for a reader
- **WHEN** Reader 与 Final Preview 使用相同 Markdown、运行时版本、主题、字体、viewport 和资源条件
- **THEN** 两者使用同一只读 Tiptap presentation factory，具有一致的内容语义、关键 DOM 和受控像素基线，Reader 不出现编辑按钮

#### Scenario: Verify parity with executable evidence
- **WHEN** 固定 capability fixtures 进入 Reader 与 Final Preview，并等待公式、图表、Mermaid 和代码增强等异步水合完成
- **THEN** 门禁实际比较规范化内容语义与关键 DOM，并对代表性普通、公式/代码、异步图形和复杂布局 fixtures 比较受控像素；描述性矩阵或非空字段本身不得作为通过证据

#### Scenario: Export the read-only presentation to PDF
- **WHEN** 用户从相同 Markdown、主题、字体、viewport 和资源条件导出 PDF
- **THEN** PDF 流程等待同一只读 Tiptap presentation 完成字体与异步内容水合后捕获其 DOM，只允许分页、纸张边距和明确打印 chrome 造成差异，不得切回另一套正文 Renderer

#### Scenario: Render an unsupported Cherry extension
- **WHEN** canonical Markdown 包含尚无 Tiptap/static mapping 的 Cherry 扩展
- **THEN** presentation 在对应 source span 只挂载一个经清洗的原子 fallback，保留完整可见内容和稳定几何；不得同时显示 Tiptap 占位与 Cherry 副本，也不得让 fallback 修改 Markdown authority

#### Scenario: Compare Visual with final rendering
- **WHEN** 相同 Markdown 在相同主题、字体资源和 viewport 下同时投影到 Visual、Final Preview、Reader 和 PDF
- **THEN** 文本、结构、格式字段、列表层级以及文章内容的排版 token、computed style、文字/块几何和代表性受控像素一致；系统只排除编辑态 caret、selection、handles、占位提示、插入按钮和其他编辑 chrome，不得以编辑 DOM 不同为理由放宽文章内容所见即所得

#### Scenario: Collapse a document-wide Visual selection
- **WHEN** 文档真实长度超过 Visual viewport，用户全选正文后按 Left 或 Right
- **THEN** selection 分别折叠到文章开头或末尾，承载 Visual 的实际滚动容器同步滚动，使新 caret 位于可见视野；门禁不得以短文档或错误的祖先滚动容器代替该行为

#### Scenario: Preserve nested task-list presentation
- **WHEN** 用户在 Visual 对相邻任务项使用 Tab 形成一层或多层子任务并进入 Final Preview、Reader 或 PDF
- **THEN** 各输出保留相同父子结构、层级数量和可见缩进，render-only 方言兼容不得改写 Markdown authority 或 fenced/raw 内容

#### Scenario: Preserve adjacent and compound inline marks
- **WHEN** 斜体与粗体、下划线、删除线、颜色、背景、字号或相邻斜体片段组合使用
- **THEN** Visual、Final Preview、Reader 与 PDF 对每个文本片段保留相同 mark 集和可见斜体，不显示残留 `*` delimiter，也不把组合标记静默降级为普通文本

### Requirement: Author preview task controls edit Markdown authority
系统 SHALL 在 `author-preview` 中把任务列表呈现为可键盘和指针操作的复选框；每次勾选 SHALL 通过可校验 checked patch 更新对应 Markdown task marker，并参加当前挂载文档的 undo、autosave、模式切换和 reload。`reader`、静态输出和 PDF SHALL 保持不可修改正文的只读语义。

#### Scenario: Toggle an author-preview task
- **WHEN** 作者在 Final Preview 勾选或取消任意层级的任务项
- **THEN** 仅对应的 `[ ]`/`[x]` marker 改变，revision 增加一次，重新进入 Visual/Source/Preview 或重载后状态一致，并可用一次 undo 恢复

#### Scenario: Preserve the Preview viewport while toggling tasks
- **WHEN** 作者在可滚动长文档的 `author-preview` 中连续勾选或取消可见任务框，期间没有执行鼠标滚轮、触控板、键盘滚动或导航命令
- **THEN** 承载 Preview 的真实滚动容器 `scrollTop` 与当前可见内容锚点保持不变；checked patch、整文档 hydration、浏览器 scroll anchoring、焦点恢复和 autosave 不得把视口拉向文档 selection、首尾或另一任务项
- **AND** 门禁使用原生指针点击真实 Preview 控件，逐次断言滚动值和后续内容锚点几何，而不是以目标仍可见、最终焦点正确或错误不出现代替视口稳定

#### Scenario: Render the same task for a reader
- **WHEN** 相同 Markdown 进入 Reader、静态 HTML 或 PDF
- **THEN** 输出保留 checked/unchecked 可见状态与层级，但不暴露会修改正文的可操作控件，也不因 disabled 表单控件降低内容可读性

### Requirement: Settings use layered injectable ownership
共享 UI SHALL 采用“产品源码默认值 < 站点/分发默认值 < 用户覆盖值”的确定性优先级，并通过可注入设置存储读取和保存主题、行距、快捷键及相关偏好。没有持久设置存储时 SHALL 使用会话内存默认值，而不是写入未授权的全局 key。

#### Scenario: User overrides a site default
- **WHEN** 站点默认主题与用户个人主题同时存在
- **THEN** 系统使用用户覆盖值，用户执行恢复默认后回到当前站点默认值

#### Scenario: No settings store is configured
- **WHEN** 宿主没有提供持久设置存储
- **THEN** 编辑器仍使用产品/分发默认值正常运行，并把设置变更限制在当前会话

### Requirement: draw.io content remains portable Markdown
系统 SHALL 保持当前 draw.io Markdown 格式：PNG data URL 与 URI 编码的 mxfile XML 同时属于 Markdown authority。Desktop 与 Web SHALL 使用同一登记版本的 draw.io 资源语义，不得要求数据库 sidecar 才能重开编辑。

#### Scenario: Reopen a draw.io diagram
- **WHEN** 任一目标打开含现有 draw.io Markdown 的文档
- **THEN** 系统显示 PNG 预览，并可从同一 Markdown 恢复 mxfile XML 进入编辑器

#### Scenario: Cancel a diagram edit
- **WHEN** 用户打开 draw.io 后取消而未应用
- **THEN** Markdown、revision、autosave 内容和 undo history 均不改变

### Requirement: Image dimensions are not added by this change
本 change SHALL 保持现有图片内容合同：URL、名称和当前支持的媒体语义进入 Markdown，普通图片显示尺寸由固有尺寸和响应式样式决定。本 change SHALL NOT 通过数据库 sidecar 或隐藏节点属性新增持久 width、height 或 align 权威。

#### Scenario: Open an existing image
- **WHEN** 文档含有现有 URL 图片但没有尺寸属性
- **THEN** Desktop、Visual、Final 与 Reader 按当前自然/响应式规则展示，不需要辅助尺寸文件
