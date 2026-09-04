# Desktop Client Specification

## Purpose

定义复用共享编辑器能力的 Windows x64 桌面客户端、Tauri 技术验证、窗口与文件生命周期、Data Root 集成、安装/卸载、签名和手动升级行为。

## Requirements

### Requirement: Tauri must pass a product-representative spike
完整 Desktop 实施前，候选 Tauri 2 宿主 SHALL 在 Windows WebView2 中验证共享 Editor/Renderer、Library 数据库、Data Root 选择/迁移、Import、Save/recovery、完整 draw.io、关闭保护、NSIS/MSI 构建和卸载数据保留。仅打开空窗口 SHALL NOT 构成通过；若核心项失败，团队 SHALL 先修复 spike，只有确证路线不适合时才评估 Electron。

#### Scenario: Spike meets all gates
- **WHEN** 候选桌面宿主完成规定的真实操作和安装生命周期
- **THEN** 每项产生可复现证据，Desktop 全量实现才可继续

#### Scenario: Spike exposes a blocker
- **WHEN** WebView2、权限、资源、数据库、安装器或生命周期核心项失败
- **THEN** 后续依赖任务停止，失败被诊断和处置，不以空壳构建成功绕过

### Requirement: Desktop preserves the complete shared workspace
Desktop SHALL 使用共享运行时和 Vue UI 提供当前完整工作区、Source/Visual/Preview、命令、主题、文章/目录侧栏和现有内容能力；不得复制一份 Desktop 专属内容实现或因包装为桌面而删减功能。

#### Scenario: Compare Desktop and Web shared behavior
- **WHEN** 相同 fixture 和命令在 Desktop 与 Web Editor 执行
- **THEN** Markdown authority、结构、格式、undo 和 Final 结果满足共享 parity，只有显式平台壳行为不同

### Requirement: Desktop shell routes persistent information by task ownership
Desktop SHALL 使用紧凑的 platform shell。常驻顶栏信息区 SHALL 只显示当前 Library/Data Root 状态与 Reader 入口。Settings SHALL 通过一个紧凑、可键盘访问的应用导航入口打开同窗口居中模态弹窗；弹窗 SHALL 只包含“数据迁移”和“关于与更新”，不得展示 Data Root 状态/刷新、卸载数据选项或偏好设置。主题与行距继续由共享工作区工具栏提供，卸载安全 backend 不在普通 Settings 暴露。Settings 内容 SHALL NOT 作为可叠加的常驻横栏占据编辑器上方。文章目录 SHALL 在 Library 内按最后更新时间分组。save/dirty、draft/autosave、synchronization 和 error 状态 SHALL 位于编辑器底部状态栏并保持实时可感知。产品身份 SHALL 通过原生窗口标题或不形成独立横栏的紧凑 chrome 保留，不得单独占用常驻工作区高度。

#### Scenario: Show the ready Desktop workspace
- **WHEN** Desktop 完成 Library bootstrap 且没有打开二级目的地
- **THEN** 编辑器上方只有一个紧凑顶栏信息区，显示当前 Library/Data Root 状态与 Reader；品牌、Data Root 管理、Settings 摘要、Updates、最近项和文档状态均不形成额外常驻横栏

#### Scenario: Open Desktop Settings
- **WHEN** 用户通过紧凑且可键盘访问的应用导航入口打开 Settings
- **THEN** 系统在当前 Desktop 窗口内打开带遮罩的居中 modal dialog，焦点进入弹窗并限制在其中；弹窗只显示“数据迁移”的目标父目录输入/原生目录选择/迁移动作和“关于与更新”的版本信息，不显示当前 Data Root、状态、刷新、卸载数据选项或偏好设置；Escape、关闭按钮或允许的遮罩关闭后焦点返回 Settings 入口

#### Scenario: Review recent Library activity
- **WHEN** 用户创建、打开或导入文章并查看最近活动
- **THEN** Library 文章目录按本地最后更新时间日期倒序分组，取代单独的“最近文章与导入”折叠区，不额外占用编辑器上方的常驻空间

#### Scenario: Keep destructive recovery actions out of the daily Library surface
- **WHEN** 用户在左侧文章工作区浏览或切换文章
- **THEN** 可见 Library DOM 和键盘顺序不提供“清空”“重置”“恢复模式检查点”“恢复替换检查点”四个按钮；底层 checkpoint/lifecycle 数据与窗口关闭保护仍可由内部服务保留，不因移除普通 UI 而删除或改写正文

#### Scenario: Open Settings from the toolbar
- **WHEN** 用户在顶部工具栏导出按钮右侧点击齿轮 Settings 入口或通过键盘聚焦后激活
- **THEN** 入口不显示可见文字，仅以齿轮图标呈现，并提供当前 locale 的无障碍名称和悬停提示；它打开同一居中 Settings modal，关闭后焦点返回该齿轮，且齿轮位于导出与全屏分隔线之间

### Requirement: Desktop article catalog groups compact rows by last update date
Desktop Library 文章目录 SHALL 使用现有成功持久化后的 `lastUpdated`，按本地日期倒序分组；当天分组 SHALL 显示当前 locale 的“今天”，其他有效日期 SHALL 显示固定 `YYYY/MM/DD`，无有效时间 SHALL 置于最后的“未更新”分组。每组内 SHALL 按时间倒序排列，当前文章 SHALL 保持可见活动态。

#### Scenario: Render a dated article row
- **WHEN** Library Article 有有效 `lastUpdated`
- **THEN** 对应行只显示文章标题和本地 24 小时制 `HH:mm`，标题可截断但完整值可访问；不得显示路径、文件数、自动保存、检查点或“更新于”等额外可见文字

#### Scenario: Render an article without a valid update time
- **WHEN** Library Article 没有有效 `lastUpdated`
- **THEN** 文章进入列表末尾的“未更新”分组并显示 `--:--`，系统不得以当前时间伪造更新时间

#### Scenario: Reorder after a successful persistence update
- **WHEN** 文章完成一次成功 autosave draft 或 manual save 并更新 `lastUpdated`
- **THEN** 行在不改变 documentId、活动文章、Markdown 或 history 的情况下移动到正确日期组和时间位置；仅有未保存编辑时分组和时间保持上次成功持久化结果

#### Scenario: Observe live document state
- **WHEN** save/dirty、draft/autosave、synchronization 或 error 状态发生变化
- **THEN** 编辑器底部状态栏更新对应状态并以可访问方式通知必要变化，状态不得被隐藏进 Settings 或重新放到编辑器上方

### Requirement: Desktop platform shell shares the workspace locale
Desktop platform shell SHALL 与共享工作区使用同一个当前 locale，并完整覆盖中文、英文和俄文平台壳文案。首次启动且没有用户语言覆盖时 SHALL 使用中文。顶栏、Reader 入口、Library 扩展、Settings、Data Root 首次配置与迁移、底部状态栏、关闭/迁移生命周期对话框和平台壳空状态 SHALL NOT 保留与当前 locale 不一致的硬编码英文。路径、版本、错误 code 和用户内容等数据值 MAY 保持原值。

#### Scenario: Start Desktop with default language
- **WHEN** 用户首次启动 Desktop 且没有已保存的语言覆盖
- **THEN** 共享工作区与全部 Desktop platform shell 文案均以中文显示，Settings 中的标签、按钮、状态值和说明不得回退为英文

#### Scenario: Switch the shared workspace language
- **WHEN** 用户在共享工作区把语言切换为中文、英文或俄文
- **THEN** 当前挂载的 Desktop platform shell 和已打开 Settings destination 在同一会话内立即切换到相同 locale，不重建文章、不改变 Markdown/revision/history/scroll，也不关闭当前 Settings destination

### Requirement: Desktop imports external Markdown into the library
Desktop SHALL 允许选择 `.md`、`.markdown` 和 `.txt`，按照单向临时 import session 合同进入 Library。Desktop SHALL 提供导出/另存 Library snapshot，但 SHALL NOT 在导入后自动回写或监视原文件。

#### Scenario: Save an imported document
- **WHEN** 用户在临时 import session 首次修改或主动保存
- **THEN** Desktop 原子创建 Library Article，后续窗口标题、dirty、history、draft 和保存均使用 library documentId

#### Scenario: Choose a native export destination
- **WHEN** 用户在 Desktop 导出 Markdown、HTML、Word、PDF 或长截图
- **THEN** 应用先打开 Tauri 原生保存对话框并以当前文件名/扩展名作为默认值；确认后仅将文件写入用户选定路径，取消时不写入；Web 下载行为不受影响

### Requirement: Window lifecycle protects unsaved work
窗口关闭、退出、打开其他文章、Data Root 迁移和升级 SHALL 等待 composition/synchronization，检查 dirty、pending save 和恢复草稿，并提供保存、保留草稿、导出或取消。进程 SHALL 使用单实例锁协调二次启动和文件导入请求。

#### Scenario: Close with unsaved changes
- **WHEN** 用户关闭包含未保存修改的窗口
- **THEN** 系统阻止退出并提供明确选择；取消后窗口和内容保持不变

#### Scenario: Second instance starts
- **WHEN** 用户在应用已运行时再次启动或打开文件
- **THEN** 请求转交现有实例处理，不并发写同一 Data Root

### Requirement: Desktop uses the selected Data Root exclusively
Desktop 耐久数据、受控临时数据和日志 SHALL 使用已验证 Data Root；不得静默回退到其他 AppData 或系统 cache/temp。Data Root 错误 SHALL 进入显式只读/恢复流程。

#### Scenario: Data Root is read-only
- **WHEN** 应用无法在当前根写入事务探针
- **THEN** Desktop 禁止 Library/save 写入，保留内存内容，并提供重试、选择其他根或导出路径

### Requirement: Complete draw.io resources ship in the desktop bundle
Desktop SHALL 包含与 Web 相同版本、同一 manifest 的完整 draw.io bundle，默认启用并在打开时懒加载。构建验证 SHALL 证明资源进入实际安装产物，而不仅是源码配置了相对 URL。

#### Scenario: Draw.io works after installed launch
- **WHEN** 用户从已安装的 Desktop 创建、编辑、应用、取消并重开 draw.io
- **THEN** 所有资源从安装闭包加载，Markdown 行为与 Web 一致，没有外部网络依赖

### Requirement: Windows installers are equivalent and data-safe
每个正式 Windows x64 版本 SHALL 生成同 commit、同功能的 NSIS Setup EXE 与 MSI。首期 SHALL NOT 声称提供 portable 或 AppX/MSIX。安装、修复、升级和卸载 SHALL 遵守 Data Root 数据保留选择。

#### Scenario: Install both package formats
- **WHEN** EXE 与 MSI 分别安装到干净环境
- **THEN** 两者报告相同产品版本/commit，启动相同共享功能，并能发现或选择 Data Root

#### Scenario: Uninstall and reinstall
- **WHEN** 用户以默认保留数据卸载后重装
- **THEN** 应用可重新选择、验证并打开原 Data Root，文章和历史未被安装器删除

### Requirement: Public Windows releases are signed
开发和内部预览包 MAY 明确标记为未签名；公开正式 EXE/MSI MUST 使用有效 Windows 代码签名并在 manifest 记录签名验证。证书或签名环境不可用时，产物 SHALL NOT 被标记为正式公开发行。

#### Scenario: Signing is unavailable
- **WHEN** 构建环境没有有效签名身份
- **THEN** 系统只能产生明确标识的测试产物，正式发布门禁失败

### Requirement: First release uses manual update
Desktop SHALL 显示当前产品版本和手动更新入口，但首期 SHALL NOT 自动下载、替换或回滚应用。自动更新属于后续独立 change；手动安装新版本 SHALL 先验证 schema/Data Root 兼容和备份要求。

#### Scenario: User checks for an update
- **WHEN** 用户打开更新信息
- **THEN** 应用提供版本和受信下载/说明入口，不在后台静默替换程序或数据

### Requirement: Desktop security relies on the OS without custom encryption
首期 SHALL 依赖操作系统用户权限、单实例和脱敏日志保护 Data Root，SHALL NOT 自创文章密码或应用层加密协议。公开诊断和日志 SHALL 遵守数据最小化。

#### Scenario: Inspect desktop logs
- **WHEN** 用户或支持人员查看日志
- **THEN** 日志不包含文章正文、草稿、cookie、凭据或可直接利用的敏感路径
