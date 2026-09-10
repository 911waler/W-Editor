# W-Editor 图片编辑能力完善 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本次默认在当前任务逐项执行，不自动启动其他任务。

**Goal:** 修复旧图片与行内图片显示，支持同行多图、八点缩放和左中右对齐，使设置在编辑、保存、刷新和发布阅读中保持一致。

**Architecture:** 普通图片采用共享的行内图片节点，Markdown 解析与序列化由 editor-core 定义，Vue/Tiptap 节点及操作由 editor-vue 实现，共享工作区负责菜单接线。NWU 继续提供身份、上传、保存和发布，Windows 继续使用同一共享编辑器及自身桌面适配。保留原版应用、现有渲染链路和 draw.io 专用节点。

**Tech Stack:** 当前锁定的 Vue 3.5.41、Tiptap 3.30.2、Cherry Markdown 0.11.9、TypeScript 6.0.2、Vitest、Playwright；本机 Node 24 / pnpm 11。

**Spec:** 本任务中用户提出并要求制定计划的四项需求：图片正确显示、同行多图、八点缩放、图片对齐；已核实的问题见 `/home/waler/lab-password-manager-worktrees/nwu-original-web-header/docs/architecture/cherry-markdown-image-upload-reference.md` 的“编辑区图片问题复现”。以下“交互契约”是本计划采用的具体实现设计。

## 执行结果（2026-09-10）

Tasks 1–6 的本轮 Linux/Web 实施和部署已完成。下方复选框保留原始计划；最终执行结果以本节与部署记录为准，用户验收和 Windows 后续工作仍单独标记。

| 项目 | 实际结果 |
| --- | --- |
| 图片解析与序列化 | 旧根相对无扩展名地址、图文混排、元数据保留、合法撇号地址通过回归 |
| 多图与缩放 | 同行/自动换行、八点手柄、比例锁定、精确尺寸、取消、reset、undo、readonly 控件移除 |
| 段落对齐 | 左/中/右及共享只读呈现；图片选择不开放 justify，嵌套不支持上下文禁用 |
| NWU 实际链路 | 合成账户真实上传两图，尺寸/居中/保存/刷新/发布/阅读通过；旧路径图片可加载 |
| 最终测试 | 1032 单元通过，1 个原版已存在的配置断言失败；覆盖的 22 个浏览器用例通过（分轮），NWU67通过；typecheck/lint/Web及桌面前端构建通过 |
| Web 部署 | 18003 已部署运行代码 `85d1f00c1b2c8b5fbbb11d997bd8c6face0ac055`，48笔记及265媒体文件内容哈希保持；现有笔记7张图全部加载 |
| 分支 | W-Editor `codex/image-editing`；NWU 维护记录 `codex/nwu-image-editing`，记录提交 `0349ebf` |
| 后续 | 用户验收待进行；未 push/合并；Windows 实机、安装包和发布未执行 |

部署、备份、回滚和测试限制详见 NWU 工作区 `/home/waler/lab-password-manager-worktrees/nwu-image-editing/docs/ops/2026-09-10-image-editing-rollout.md`；Windows 清单见 `docs/ops/image-editing-windows-handoff.md`。本节之后的提交仅更新计划执行记录，已部署资源仍追溯到上述运行代码提交。

## Global Constraints

- 本轮先完成 Linux 开发、共享代码检查和 7B12 平行 Web 部署；Windows 实机测试、安装包构建与发布另行进行，不宣称已经验证。
- W-Editor 基线为 `264884f4a074827e70a23a84f72a9a7273f00c71`，当前工作区 `/home/waler/lab-password-manager-worktrees/W-Editor-original-web`，分支 `codex/nwu-web-adapter`。
- 当前 NWU 页眉工作区为 `/home/waler/lab-password-manager-worktrees/nwu-original-web-header`，分支 `codex/nwu-editor-header`；执行前重新检查 HEAD、状态与运行服务代码指针。
- 实施时新建 W-Editor 分支 `codex/image-editing` 和隔离工作区；需要 NWU 业务修改时另建 NWU 分支 `codex/nwu-image-editing`。名称已存在时先检查并复用匹配工作，不覆盖。
- 当前未提交的 `tests/adapters/image-display-diagnostic.spec.ts` 是已运行的诊断测试，4 失败、1 通过；实施时转入新工作区并转化为回归测试，不丢失本计划和原有改动。
- 不切换到另一套编辑器；继续使用 `src/main.ts → src/ui/App.vue → apps/playground/src/PlaygroundApp.vue` 和共享 editor-core/editor-vue。
- 不升级依赖，不修改插件缓存，不将 NWU 服务器地址、权限或业务规则写进通用编辑器。
- 本轮不做图库、去重、对象存储迁移、批量改写历史正文或自动清理旧图片。
- 保持 SVG/XML 校验、上传失败重试、draw.io PNG/XML 对应关系、会话和保存冲突保护。
- 部署范围仅 `http://10.15.21.142:18003`；不修改正式 HTTPS，不把用户笔记当作写入测试数据。
- 本计划阶段不实现业务代码、不部署、不 push。实施完成后记录提交号和验收证据；GitHub 同步作为明确的交付步骤执行。

## 交互契约

1. **显示与排版：** 普通图片作为段落内的独立对象，支持文字前后插图及同段多图；按正文顺序排列，宽度不足自动换行。普通单图也采用此模型，避免两套图片编辑行为。draw.io 继续优先识别为专用节点。
2. **地址：** 支持现有安全 HTTP(S)、受限 raster data URL，以及旧 NWU 使用的站点根相对路径 `/static/…`；保留无扩展名图片地址。拒绝脚本协议、协议相对地址 `//…`、控制字符和反斜杠变体。解析允许根相对路径不代表桌面端能访问 NWU 登录资源；桌面端保留来源地址，缺少来源上下文时显示明确的不可用状态。
3. **八点缩放：** 选中图片显示四角、四边中点；默认锁定比例，可解除。锁定时按原图或当前有效比例调整；解锁后四角调整宽高、左右点调整宽、上下点调整高。拖动中仅预览，松开提交一次可撤销修改；Escape 或 pointercancel 取消。提供精确宽高输入和恢复原始尺寸，键盘用户无需拖拽也能操作。
4. **尺寸：** 新尺寸以正整数像素持久化，交互范围 16–4096 px；无指定尺寸时按固有尺寸并限制在内容宽度内。容器变窄只影响显示，不静默改写已保存尺寸；不裁剪或重编码原图。
5. **对齐：** 左、中、右对齐作用于当前图片所在段落；纯图片段落中的多图作为一组对齐。图文混排时段落整体对齐，不引入自由浮动或文字环绕。表格、列表等嵌套上下文先沿用既有容器规则；不能安全序列化的操作明确禁用。
6. **正文格式：** 普通图片仍使用 Markdown。尺寸采用 Cherry 已有属性形式 `![说明](地址){width=320 height=180}`；对齐复用已有 `::: center` 等段落容器。执行第一项任务时用锁定版本验证读写结果；新图片属性只写 width/height，既有无法解析的扩展保留原文，不静默删除。
7. **状态一致性：** 撤销/重做、Source/Visual/Preview 切换、服务器保存、刷新、发布阅读及导出渲染都保留图片顺序、地址和尺寸；只读区域不显示编辑手柄。

## 文件分工

| 位置 | 责任 |
| --- | --- |
| 新增 `packages/editor-core/src/codecs/images.ts` | 单张图片 token、URL/尺寸规范、尺寸序列化 |
| `packages/editor-core/src/codecs/media.ts`、`inlineMarks.ts`、`ordinaryBlocks.ts`、`index.ts` | 防止多图吞并；普通图片转行内节点；保留 audio/video 与 draw.io |
| 新增 `packages/editor-vue/src/adapters/imageNode.ts`、`imageResize.ts` | Tiptap 图片节点、八点交互及独立几何计算 |
| `packages/editor-vue/src/adapters/tiptapVisualSchema.ts` | 注册共享节点，避免把实现继续堆入大型文件 |
| `ordinaryBlockSerialization.ts`、`tiptapVisualAdapter.ts` | 图片写回 Markdown、选中与对齐、事务接入 |
| `packages/editor-vue/src/ui/VisualEditorSurface.vue`、`MediaEditorHost.vue`、`styles.css` | 插入/编辑接线、尺寸控件、响应式排版 |
| `packages/editor-vue/src/services/uiLocalization.ts` | 遵循现有语言键机制增加图片操作文案 |
| `packages/editor-vue/src/rendering/tiptapPresentation.ts` | 新节点在只读呈现中使用相同尺寸与排版，保留未知语法的原有 fallback |
| `apps/playground/src/PlaygroundApp.vue` | 原有图片菜单接入，不新增平行编辑区 |
| NWU `app.py`、`w_editor_host/` | 仅在验收发现资源响应或保存契约问题时做必要修复 |

## Task 1：建立图片解析、地址与正文格式契约

**Files:** 新增 `images.ts`、`tests/codecs/images.spec.ts`；修改 `media.ts`、`index.ts`、`tests/codecs/media.spec.ts`。

**Interfaces:** 定义并导出以下接口，后续任务使用相同字段名：

```ts
export interface ImageDimensions { readonly width: number | null; readonly height: number | null }
export interface InlineImageModel extends ImageDimensions {
  readonly name: string
  readonly url: string
  readonly source: string
  readonly sourceSpan: Readonly<{ from: number; to: number }>
}
export function parseInlineImageAt(markdown: string, offset: number): InlineImageModel | null
export function serializeImage(model: Pick<InlineImageModel, 'name' | 'url' | 'width' | 'height'>): string
export function normalizeImageUrl(value: string): string | null
```

- [ ] 先补解析回归测试，覆盖旧地址、同行两图、空 alt、转义字符、括号 URL、CRLF、无扩展名、可选 title，以及代码跨度中的图片文本。代表断言：

```ts
const source = '![甲](/static/blog-images/1/png-4) ![乙](https://example.test/b.png)'
const first = parseInlineImageAt(source, 0)
expect(first?.url).toBe('/static/blog-images/1/png-4')
expect(first?.sourceSpan.to).toBe(source.indexOf(' ![乙]'))
expect(serializeImage({ name: '甲', url: '/a.png', width: 320, height: 180 }))
  .toBe('![甲](/a.png){width=320 height=180}')
expect(normalizeImageUrl('javascript:alert(1)')).toBeNull()
expect(normalizeImageUrl('//other.test/a.png')).toBeNull()
```

- [ ] 运行 `pnpm exec vitest run tests/codecs/images.spec.ts tests/codecs/media.spec.ts`，确认新增用例暴露当前问题。
- [ ] 实现单 token 扫描：从 `![` 起识别成对括号及转义，精确返回结束位置；不使用会跨图片吞并的整行贪婪捕获。未知扩展保留原文供现有 fallback 使用。
- [ ] 统一安全 URL 与尺寸检查；`parseMediaAt` 保持对 audio/video 的既有支持，普通图片兼容调用必须严格验证只含一个 token。
- [ ] 在同一测试文件中经 `CherryRenderAdapter` 渲染尺寸语法，检查产生的 img 宽高确为 320/180；验证对齐容器与图片组合，不以最新版 Cherry 文档替代锁定依赖行为。
- [ ] 复跑上述测试并提交 `fix: parse image tokens and preserve safe legacy paths`。

## Task 2：贯通行内图片节点、同行多图和保存序列化

**Files:** `inlineMarks.ts`、`ordinaryBlocks.ts`、`tiptapVisualSchema.ts`、`ordinaryBlockSerialization.ts`、`VisualEditorSurface.vue`、`PlaygroundApp.vue`；新增 `imageNode.ts`、`tests/adapters/inlineImageEditing.spec.ts`；更新现有媒体测试。

**Interfaces:** 新 Tiptap 节点名 `inlineImage`，attrs 为 `name/url/width/height/source`；`inline: true`、`group: 'inline'`、`atom: true`。图片逻辑独立于 audio/video 的 semanticBlock；事务继续走现有 patch planner 与同步确认机制。

- [ ] 把诊断测试转为正式回归，沿用真实 `TiptapVisualAdapter` 挂载，不只测正则。断言用户截图文本产生一个 img，同行两图产生两个独立 img。
- [ ] 增加“修改图片前后文字并保存”的回归：图片仍存在、URL 不变、非目标段落原文不变；覆盖插入两图、替换一图、删除一图及撤销。
- [ ] 执行 `pnpm exec vitest run tests/adapters/image-display-diagnostic.spec.ts tests/adapters/inlineImageEditing.spec.ts`，记录失败。
- [ ] 在普通行内解析器中先识别完整图片，再处理链接；代码范围不得递归当图片解析。将普通单图和多图均投影为段落内节点，保持 draw.io 专用识别优先。
- [ ] 注册共享图片节点，使用 DOM 属性设置 src/alt，保留可识别的失败状态和原 URL。插入图片走当前光标处的行内节点路径，不再强制创建独占行 semanticBlock。
- [ ] 在普通块序列化中增加节点分支：

```ts
if (child.type.name === 'inlineImage') {
  source += serializeImage({
    name: String(child.attrs['name'] ?? ''),
    url: String(child.attrs['url'] ?? ''),
    width: child.attrs['width'] as number | null,
    height: child.attrs['height'] as number | null,
  })
  return
}
```

- [ ] 对已解析但未改动的 title/扩展保留原始 source；仅在图片属性实际改变时生成规范源码，避免触碰相邻正文。测试覆盖该区别。
- [ ] 修正测试中“普通图片必须是 semanticBlock”的旧断言，保留 audio/video 与附件语义节点的回归。
- [ ] 运行媒体、上传、序列化和新增节点测试，通过后提交 `feat: support inline images in the shared editor`。

## Task 3：八点缩放、精确尺寸与响应式布局

**Files:** 新增 `imageResize.ts`、`tests/adapters/imageResize.spec.ts`；修改 `imageNode.ts`、`MediaEditorHost.vue`、`styles.css`、`uiLocalization.ts`；新增 `e2e/image-editing.spec.ts`。

**Interfaces:** 几何计算独立于 DOM，固定输入初始矩形及总位移，避免逐帧累计误差：

```ts
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
export interface ResizeInput {
  readonly width: number; readonly height: number
  readonly dx: number; readonly dy: number
  readonly handle: ResizeHandle; readonly lockAspectRatio: boolean
}
export function resizedImageDimensions(input: ResizeInput): { width: number; height: number }
```

- [ ] 几何测试先覆盖锁定/解锁比例、八个方向、反向拖动及 16–4096 边界；示例：

```ts
expect(resizedImageDimensions({ width: 200, height: 100, dx: 40, dy: 0,
  handle: 'e', lockAspectRatio: true })).toEqual({ width: 240, height: 120 })
expect(resizedImageDimensions({ width: 200, height: 100, dx: 40, dy: 0,
  handle: 'e', lockAspectRatio: false })).toEqual({ width: 240, height: 100 })
```

- [ ] 运行 `pnpm exec vitest run tests/adapters/imageResize.spec.ts`，确认失败，再实现计算函数。
- [ ] NodeView 使用 pointer capture；pointerdown 保存初始尺寸，pointermove 只更新预览，pointerup 以一个事务写入节点，Escape/pointercancel 恢复。销毁节点时解除监听和捕获。
- [ ] 增加有标签的宽、高、比例锁定和恢复按钮，沿用现有多语言机制。加载失败时禁用依赖固有比例的操作，并保留地址编辑/替换入口。
- [ ] 图片包装器使用行内布局与内容宽度限制，允许图片之间换行；选中边框和手柄不改变文档占位尺寸。窄屏自动缩放显示，不回写模型宽高。
- [ ] 在 E2E 中经真实 Source 输入双图、切换 Visual、点击图片、拖拽手柄；检查手柄数为 8、松开后 Source 尺寸改变、一次撤销恢复、重新载入尺寸不丢失。
- [ ] 用 390/800/1280 px 视口核对同行/换行和无横向溢出；复跑单位与交互测试后提交 `feat: add image resizing and responsive inline layout`。

## Task 4：段落图片对齐及只读呈现一致性

**Files:** `tiptapVisualAdapter.ts`、`imageNode.ts`、`VisualEditorSurface.vue`、`PlaygroundApp.vue`、`tiptapPresentation.ts`；修改 `tests/adapters/tiptapAlignment.spec.ts`、`tests/services/tiptapPresentation.spec.ts`、`e2e/image-editing.spec.ts`。

**Interfaces:** 继续使用现有 `applyAlignment('align.left' | 'align.center' | 'align.right')`。当 NodeSelection 指向 inlineImage 时，将作用范围定位到其可序列化的所属段落，再执行既有 alignment 容器事务；多图不引入新分组类型。

- [ ] 补失败测试：选中单图居中、选中双图中的一张使同段整组居中、左/右切换、移除对齐、撤销；嵌套上下文不可安全处理时命令不可用且不修改正文。
- [ ] 实现 NodeSelection 到段落范围的转换；不通过纯 CSS 或 localStorage 记录对齐。
- [ ] 核对 Source 输出，例如：

```markdown
::: center
![甲](/a.png){width=240 height=120} ![乙](/b.png){width=240 height=120}
:::
```

- [ ] 在共享 presentation 中渲染已支持的 inlineImage 节点，避免被“所有图片转 Cherry fallback”的旧规则重新替换；对未知图片扩展仍保留既有 fallback。
- [ ] 对 Source/Visual/Preview、阅读页和导出渲染逐一检查宽高与对齐。只读实例无手柄、无尺寸工具栏，不响应修改操作。
- [ ] 运行 `pnpm exec vitest run tests/adapters/tiptapAlignment.spec.ts tests/services/tiptapPresentation.spec.ts` 和图片 E2E，提交 `feat: persist image paragraph alignment across presentations`。

## Task 5：NWU 接入及共享应用回归

**Files:** W-Editor `tests/nwu/adapter.spec.ts`、`tests/nwu/persistence.spec.ts`、`e2e/nwu-mock-host.spec.ts`；NWU 必要时修改资源响应与对应测试，并更新 `docs/architecture/w-editor-nwu-integration.md`。

**Interfaces:** 沿用 `/api/blog-editor/assets` 上传契约与现有保存、发布接口，不新增数据库 schema。

- [ ] 用合成账户/笔记在独立测试环境跑“旧图片加载 → 上传两图 → 缩放 → 对齐 → 保存 → 刷新 → 发布 → 阅读”，真实点击页面按钮。
- [ ] 检查旧无扩展名 PNG 的浏览器加载与自然尺寸。此前 HTTP 返回 octet-stream；若真实浏览器加载失败，再修正 NWU 响应 MIME 并先写后端回归，不批量重命名历史文件。
- [ ] 核对新资产权限、上传失败后的重试、未保存草稿、保存冲突，以及图文内容没有被正文转换意外改写。
- [ ] 回归公式、Mermaid、图表、表格、任务框、附件和 draw.io，尤其检查 PNG/XML 可重编辑关系未丢失。
- [ ] 执行 W-Editor `pnpm run typecheck`、`pnpm run lint`、`pnpm run test:unit`；E2E 至少包含 `image-editing.spec.ts`、`media-attachments-drawio.spec.ts`、`alignment-enter-exit.spec.ts`、`nwu-mock-host.spec.ts`。已有失败与新回归分别记录，不把已知失败写成全绿。
- [ ] 执行 `pnpm --filter @w-editor/desktop run typecheck` 和 `pnpm --filter @w-editor/desktop run build:frontend`，检查桌面入口仍能使用共享代码；这不替代 Windows WebView2 实机验收。
- [ ] 涉及 NWU 代码时运行对应 pytest 与受影响页面/资产回归；所有 Python/Node 子进程清除本机损坏的 Lmod 导出函数。
- [ ] 提交接入测试和维护记录，写清本轮实际完成的测试范围。

## Task 6：Web 构建、平行部署和后续 Windows 交接

**Files:** NWU `scripts/build-w-editor-web.sh`（使用，非预设修改）；新增 NWU `docs/ops/2026-09-10-image-editing-rollout.md`（实际实施日不同则按实际日期命名）；W-Editor 新增 `docs/ops/image-editing-windows-handoff.md`。

- [ ] 在隔离工作区提交已验证代码，记录 W-Editor 和 NWU 的完整提交号；构建必须能追溯到源码。以新的独立目录调用现有构建脚本：

```bash
env -u 'BASH_FUNC_ml%%' -u 'BASH_FUNC_module%%' \
  scripts/build-w-editor-web.sh \
  /home/waler/lab-password-manager-worktrees/W-Editor-image-editing \
  /home/waler/.local/state/nwu911-parallel/image-editing-candidate/web
```

- [ ] 新工作区路径与脚本输入一致；候选输出目录若已存在先确认来源，不覆盖既有验收产物。验证构建基址 `/w-editor/web/assets/`、动态 chunks、字体、vendor、draw.io、LICENSE 与 source-commit.txt。
- [ ] 解析当前服务配置和 code-current，创建本次独立 rollout 目录；停止平行服务后做 SQLite 一致性备份、媒体备份和配置快照，记录旧 Web 路径及代码指针。
- [ ] 若仅改 W-Editor，保留 NWU 页眉代码指针，仅切换完整 Web 构建配置；若需要 NWU 改动则切换到隔离验证后的新代码指针，同时补齐必要静态文件链接。
- [ ] 重启 `systemctl --user restart nwu911-parallel.service`；检查 18003、图片 HTTP、构建标识及数据库摘要。正式 HTTPS 不切换。
- [ ] 在平行系统交付专用验收页或由用户选择测试笔记，核验四项能力和保存发布。自动化写入测试继续放在隔离环境；对现有用户笔记只读检查。
- [ ] 写本次回滚脚本：恢复切换前的 Web 配置和必要代码指针，保留切换后新增正文与媒体，不直接使用旧页眉 rollout 的回滚脚本。
- [ ] 写 Windows 交接清单：仓库、分支、提交号、锁文件与工具版本，图片样例、八方向拖拽、不同 DPI、键盘操作、保存重开、安装升级和发布检查；Windows 状态标为“未执行”。
- [ ] 验收后报告可推送的源码提交；GitHub push、Windows clone/pull、Windows 安装包发布按用户确认的交付流程执行。安装包进入 Release，不混入源码提交。

## 完成标准与计划自检

- [ ] 四项用户需求分别对应 Tasks 1–4；数据持久化及旧内容兼容由 Tasks 2、4、5 验证。
- [ ] 截图用例由 0 个 img 变为 1 个正确图片；同行双图始终为两个独立节点，不串地址。
- [ ] 八个手柄、精确尺寸、比例锁定、取消、单次撤销均有测试；图片宽高不会因切模式或刷新丢失。
- [ ] 三种对齐、窄屏换行、只读和导出一致性均有证据；现有页眉、图表、公式、draw.io 和保存发布保持可用。
- [ ] 未把 Linux 桌面前端构建结果称为 Windows 验收；GitHub 上代码、Web 构建和未来 Windows 安装包能追溯到明确版本。
- [ ] 本文接口命名统一为 `inlineImage`、`InlineImageModel`、`parseInlineImageAt`、`serializeImage`、`normalizeImageUrl`、`resizedImageDimensions`；不在后续任务引入未定义的替代名称。

计划自检已覆盖全部用户需求。本文是实施计划，所有执行复选框初始保持未完成。
