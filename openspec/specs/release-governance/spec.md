# Release Governance Specification

## Purpose

定义双目标方案从可信测试基线到正式版本的构建、功能一致性、浏览器/桌面、无障碍、性能、资源、签名、provenance 和发布阻断合同。

## Requirements

### Requirement: Verification baseline is repaired before feature implementation
实现双目标能力前，系统 SHALL 移除对已删除旧 OpenSpec change 的硬编码，并分类处置所有既有失败为产品缺陷、过期合同、行尾/fixture 或测试环境问题。产品缺陷 MUST 修复；过期合同只能有证据地替换并记录原因；团队 SHALL NOT 忽略或删除测试制造绿色。

#### Scenario: Establish a clean baseline
- **WHEN** baseline 阶段完成
- **THEN** OpenSpec、docs、unit、browser 和相关验证入口使用稳定路径，所有剩余非绿色结果有明确责任和停止条件

### Requirement: Shared capability inventory gates both targets
系统 SHALL 从当前产品基线建立现有命令、组件、Markdown、Renderer、视觉和交互 inventory，并在 Desktop/Web 上运行共同 fixture。共享能力只能位于 shared packages；平台例外 SHALL 在 spec 和 manifest 显式声明。

#### Scenario: A shared command is missing from one target
- **WHEN** parity 检测到一个应共享命令只在 Web 或 Desktop 可用
- **THEN** 正式发布门禁失败，不能以宿主差异豁免

#### Scenario: Human acceptance exposes a false-green fixture
- **WHEN** 人工验收以真实长文档、Visual Tab 缩进或组合行内格式复现缺陷，而旧自动测试使用短文档、直接注入非真实 Markdown 或只检查节点存在
- **THEN** 旧证据从最早受影响层失效，门禁改为执行真实用户路径并断言实际滚动容器、Markdown authority、computed style/几何和代表性像素后才能重新变绿

### Requirement: One commit produces the complete product release
每个正式产品版本 SHALL 从同一 Git commit、锁文件和产品版本生成 Web Distribution ZIP、Windows NSIS EXE、MSI、release manifest 和 SHA-256。任何必需产物缺失或版本/commit 不一致 SHALL 阻止正式发布。

#### Scenario: Desktop build lags behind Web
- **WHEN** Web 成功但 EXE/MSI 未生成或未通过验证
- **THEN** 该 commit 不得标记统一 W-Editor 正式版本

### Requirement: Release manifest records provenance and compatibility
manifest SHALL 记录产品、Web API/schema、Markdown dialect、数据库 schema 和 manifest versions、commit、工具链、全部文件/hash、签名、许可证/provenance、测试、性能、无障碍、已知限制和未执行环境，并声明最低宿主 adapter 版本。

#### Scenario: Audit a release
- **WHEN** 用户或未来自动化读取 manifest
- **THEN** 可确定每份产物来源、兼容性、完整性、验证证据和明确未覆盖范围

### Requirement: Browser and WebView2 matrix is enforced
首期 SHALL 验证 Playwright bundled Chromium、实际系统 Chrome、实际系统 Edge 和 Windows WebView2，并记录版本。bundled Chromium SHALL 承担严格可复现行为/受控像素；系统浏览器与 WebView2 SHALL 承担真实行为 smoke。Firefox/WebKit/Safari/iOS/Android SHALL 在真实 NWU 接入前依据受众另行冻结，不得被当前结果隐含声称覆盖。

#### Scenario: System browser is unavailable
- **WHEN** 门禁环境缺少必需 Chrome、Edge 或 WebView2
- **THEN** 系统报告未执行并阻止需要该矩阵的正式版本，不把缺失环境记为通过

### Requirement: Accessibility targets WCAG 2.2 AA
共享 Editor、Reader、公共 API 表面和 Desktop 壳 SHALL 以 WCAG 2.2 AA 为目标，覆盖真实键盘、focus、ARIA、缩放、reduced motion、自动检测和至少一条真实 Windows 屏幕阅读器路径。门禁 SHALL 验证结果而非仅检查元素存在。

#### Scenario: Keyboard-only editing journey
- **WHEN** 用户仅使用键盘完成模式切换、格式、保存、对话框和退出
- **THEN** focus 顺序、可见焦点、trap/return、状态和错误均可操作且不丢失内容

### Requirement: Performance budgets are measured before freezing
系统 SHALL 保留代表性长文档、约 1 MiB、首次可编辑、普通输入和生产渲染基线，并新增 Web Editor/Reader 冷启动、draw.io 懒加载、Desktop 启动和包体积测量。具体阈值 SHALL 基于受控基线写入 design/tasks；不得无证据放宽旧正确性门禁或设置不可验证目标。

#### Scenario: Refactor regresses shared input
- **WHEN** 双目标拆分使受控普通输入或长文档指标超过冻结预算
- **THEN** 对应阶段失败并诊断，不以包已构建为完成

### Requirement: Resource closures are verified in built artifacts
Web ZIP、EXE 和 MSI SHALL 分别验证 JS/CSS/字体/KaTeX/Cherry/draw.io 等资源闭包、hash、相对路径、离线可用性和测试 seam 缺席。源码目录存在资源 SHALL NOT 代替构建产物验证。

#### Scenario: Built desktop misses draw.io assets
- **WHEN** 安装产物的 manifest 或真实 smoke 找不到 draw.io 依赖
- **THEN** Desktop 构建失败并禁止发布，即使工具栏按钮存在

### Requirement: Provider-agnostic scripts precede CI claims
仓库 SHALL 首先提供本地可复现的构建、测试、签名接口和 manifest 脚本；未来 CI SHALL 调用同一脚本。没有远程仓库、凭据或签名环境时 SHALL 明确报告手动/本地状态，不得声称自动正式发布。

#### Scenario: Run release verification locally
- **WHEN** 开发者在受支持环境运行统一 release verification
- **THEN** 生成与未来 CI 相同结构的状态、manifest、hash 和未执行环境报告

### Requirement: Every implementation phase has evidence and rollback
实施 SHALL 按 baseline、shared runtime、host contracts、Web、Tauri spike、Data Root/Library、Desktop、release governance、NWU reference/handoff 的依赖顺序推进。每阶段 SHALL 先建立失败证据、完成范围内最小实现、重跑受影响门禁并记录回滚点；前置阶段失败 SHALL 阻止依赖阶段。

#### Scenario: Tauri spike fails a core gate
- **WHEN** spike 未通过 Data Root、draw.io、安装或窗口保护之一
- **THEN** Desktop 全量实现和统一发布阶段保持未开始，团队先处置路线问题

#### Scenario: Later work invalidates an earlier green result
- **WHEN** 后续阶段新增源码、入口、fixture、测试或构建产物，使已完成阶段的验证输入或代码所有权发生变化
- **THEN** 受影响旧结果立即标记为 historical/superseded，后续依赖任务停止，从最早受影响门禁重跑并生成新的当前证据；系统不得手工改写旧计数或让描述性记录替代可执行结果

### Requirement: NWU reference work ends in an auditable handoff
正式完成当前 change 前，系统 SHALL 产出面向真实 NWU 仓库的交接文档，明确落后副本的验证范围、API/数据库/Jinja/安全/资产/兼容映射、真实仓库重查、后续 OpenSpec、staging、回退和未验证项。文档 SHALL 禁止未来任务机械应用旧副本 patch。

#### Scenario: Review the current change for completion
- **WHEN** 所有 W-Editor 双目标门禁完成但 NWU 交接文档缺失或宣称生产已验证
- **THEN** 当前 change 不得视为完整完成
