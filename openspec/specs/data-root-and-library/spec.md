# Data Root and Library Specification

## Purpose

定义 Desktop 单用户文章库、可选择并可迁移的数据根、版本与草稿、设置、资产、备份、日志和临时文件的持久化、恢复、容量与安全行为。

## Requirements

### Requirement: Desktop uses a selectable single-user Data Root
Desktop SHALL 允许用户通过操作系统原生目录选择窗口选择 Data Root 的父位置，并在其中保存单用户 Library 数据库、版本、草稿、受管资产、设置、日志、备份、manifest 和 `tmp/`。手工路径输入 MAY 作为辅助方式保留，但 SHALL NOT 成为首次配置或迁移的唯一选择路径。原生目录选择只提供候选父路径，系统仍 SHALL 使用既有受管根标记、路径规范化、写入探针和健康检查验证后才创建、切换或写入。系统 SHALL NOT 把这些临时文件改写到系统 cache/temp；`tmp/` SHALL 明确为可清理的非权威数据。

#### Scenario: Choose a Data Root on first use
- **WHEN** Desktop 尚无有效位置配置
- **THEN** 系统提供可键盘访问的“选择文件夹”按钮，打开单选原生目录窗口；用户选择父位置并确认使用后，系统创建并验证受管目录结构，验证通过后才启用 Library 写入

#### Scenario: Cancel the first-use folder picker
- **WHEN** 用户打开首次配置目录窗口后取消或关闭窗口
- **THEN** 当前路径输入、locator、Data Root 和 Library 状态保持不变，系统不创建目录、不产生错误式 revision，也不猜测其他路径

#### Scenario: Data Root becomes unavailable
- **WHEN** 已配置位置丢失、只读或验证失败
- **THEN** 系统进入可诊断的只读/恢复流程，保留内存内容并禁止写入其他猜测路径

### Requirement: Library article Markdown is transactional authority
Library SHALL 使用版本化、事务式单用户数据库；每篇文章的当前 Markdown SHALL 是正文唯一权威，历史 SHALL 保存完整 Markdown snapshots。数据库 SHALL NOT 以 Tiptap JSON、DOM 或 undo 代替 Markdown。

#### Scenario: Save a library article
- **WHEN** 用户手动保存一个 dirty Library Article
- **THEN** 当前 Markdown、元数据和新不可变版本在一个可恢复事务中提交，并返回新本地 revision/versionId

#### Scenario: Save transaction fails
- **WHEN** 数据库或文件事务失败
- **THEN** 旧正式版本保持可用，内存正文和恢复草稿保留，系统显示可重试错误

### Requirement: External Markdown import is one-way
选择 `.md`、`.markdown` 或 `.txt` SHALL 创建临时 import session。第一次有效内容修改或主动保存 SHALL 原子创建新的 Library Article/documentId；之后保存只进入 Library，不再关联或回写原文件。未修改关闭 SHALL NOT 创建库内文章。

#### Scenario: Close an untouched import
- **WHEN** 用户打开外部 Markdown 后未修改也未保存即关闭
- **THEN** Library 不新增文章，原文件保持不变

#### Scenario: Edit an imported file
- **WHEN** 临时 import session 接受第一次内容修改
- **THEN** 系统创建独立 Library Article，后续 history、draft 和保存均使用新 documentId，原文件不再同步

### Requirement: Built-in examples remain resettable seeds
三篇现有示例 SHALL 继续可用作可重置 seed。用户首次修改 seed SHALL 形成用户自己的 Library Article/version；模板内容仍可用于显式重置，新建和导入文章 SHALL 使用独立 documentId。

#### Scenario: Modify a seed article
- **WHEN** 用户修改并保存一个内置示例
- **THEN** 用户内容和历史进入独立 Library 记录，原 seed 仍可被显式重新创建

### Requirement: Manual versions and recovery drafts have separate lifecycles
手动保存或发布 SHALL 生成不可变文章版本；bounded autosave SHALL 只更新恢复草稿。原生 undo SHALL 仅存于当前实例。较新的恢复草稿 SHALL 提示恢复、丢弃或导出，且不得静默覆盖正式内容。

#### Scenario: Autosave a dirty article
- **WHEN** Library Article 达到 autosave 条件
- **THEN** 系统更新对应恢复草稿和 base revision，不生成永久历史版本

#### Scenario: Manual save follows a draft
- **WHEN** 用户手动保存包含恢复草稿内容的文章
- **THEN** 系统生成不可变版本，并清理或标记草稿已合并

### Requirement: Stable workspace state can be restored
系统 SHALL 按文档保存最后模式、稳定 source offset/selection、scroll 和侧栏等可恢复状态，但 SHALL NOT 持久化原生 undo、DOM、弹窗、hover 或临时 fold。

#### Scenario: Reopen a library article
- **WHEN** 用户再次打开已保存 workspace state 的文章
- **THEN** 系统从 Markdown 重建内容并尽量恢复稳定模式和位置；无法映射的位置安全回退而不改变正文

### Requirement: Settings have durable product-site-user semantics
Desktop SHALL 保存用户覆盖设置并保留产品默认/分发默认/用户覆盖层级。schema version 不兼容时 SHALL 保留可导出原始设置并使用安全默认，而不是删除未知值。

#### Scenario: Reset desktop preferences
- **WHEN** 用户恢复默认主题、行距或快捷键
- **THEN** 系统清除个人覆盖并使用当前分发默认值

### Requirement: Data Root migration is staged and reversible
迁移 SHALL 在单实例锁下暂停写入，复制到新根 staging，验证数据库、manifest、文件和 hash，原子切换位置指针，并用新根执行健康检查。失败 SHALL 自动回滚；旧根永久删除需要用户后续确认。

#### Scenario: Choose a migration destination
- **WHEN** 用户在 Settings 中为 Data Root 迁移选择新的父位置
- **THEN** 系统提供单选原生目录窗口并把成功选择的路径填入迁移目标；取消选择保持原目标不变，真正迁移仍须由用户单独确认并进入既有受保护迁移生命周期

#### Scenario: Migration succeeds
- **WHEN** 新根完整复制并通过所有验证
- **THEN** 应用原子使用新根，旧根标记为可回滚/待清理而不是立即删除

#### Scenario: Migration fails
- **WHEN** 复制、hash、数据库或新根启动验证失败
- **THEN** 位置指针恢复旧根，旧数据继续可用，staging 保留或清理按失败状态记录

### Requirement: Schema migration is forward-only and protected
数据库 SHALL 使用明确 schema version，只执行版本化事务式向前迁移。迁移前 SHALL 创建受保护备份；失败 SHALL 回滚。系统 SHALL NOT 自动执行有损降级；无法读取时 SHALL 提供恢复/导出模式。

#### Scenario: Upgrade the schema
- **WHEN** 新版本打开可迁移的旧 schema
- **THEN** 系统先备份，再在事务中迁移并验证，成功后才允许正常写入

### Requirement: Backups are deduplicated, bounded and verifiable
备份 SHALL 使用压缩数据库快照、内容寻址 blob 去重和 manifest 引用。默认 SHALL 保留最近 7 个每日、8 个每周、12 个每月自动备份；手动备份 SHALL 不自动删除。普通文章版本默认保留最近 50 个，显式发布/标记版本 SHALL 不按数量自动删除；未合并草稿默认保留 30 天。所有默认值 SHALL 可配置。

#### Scenario: Create an incremental backup
- **WHEN** 上次备份后只有部分文章或资产变化
- **THEN** 新备份只新增数据库快照和新 blob，manifest 复用已有 hash，不完整复制全部资产

#### Scenario: Clean old backups
- **WHEN** 保留策略需要删除旧自动备份
- **THEN** 系统先显示预计释放空间，保护手动/迁移备份，删除后留下可审计结果

#### Scenario: Restore a backup
- **WHEN** 用户选择恢复点
- **THEN** 系统在切换前验证 manifest、hash 和数据库，并提供失败回滚

### Requirement: Temporary data stays inside Data Root and is safely cleaned
临时文件 SHALL 位于 `tmp/<type>/<session>`，活跃锁保护在用项，迁移/update staging SHALL 按事务状态保留或回滚。系统默认 SHALL 清理超过 7 天的孤儿项，并允许用户查看占用和手动清理；`tmp/` SHALL 不进入耐久备份。

#### Scenario: Startup finds abandoned temp data
- **WHEN** 启动扫描到超过保留期且无活跃锁/事务的临时项
- **THEN** 系统有界清理并记录摘要，不触碰正式文章、备份或活跃 staging

### Requirement: Logs are structured, bounded and private
日志 SHALL 位于 Data Root `logs/`，有大小/保留上限，并默认排除正文、草稿、cookie、凭据、完整资产 URL 和敏感绝对路径。诊断包 SHALL 允许用户预览并选择导出内容。

#### Scenario: Export diagnostics
- **WHEN** 用户请求诊断包
- **THEN** 系统显示将包含的脱敏日志、环境和 manifest 信息，未经选择不附加正文或草稿

### Requirement: Uninstall never silently deletes user data
卸载默认 SHALL 保留 Data Root。卸载流程 SHALL 允许用户选择保留全部、仅清理 `tmp/` 或删除耐久 Data Root；删除耐久数据前 MUST 显示实际路径与占用并再次确认。

#### Scenario: Uninstall with default choices
- **WHEN** 用户未明确选择删除数据
- **THEN** 应用文件被移除但 Library、文章、历史、资产和备份保持可重新发现和验证
