# NWU-911 future schema and API reference draft

## Status and boundary

本文件仅供真实 NWU 当前仓库重新调查与独立设计参考，不是迁移脚本、可部署接口或生产验收。当前 `dual-target-release` change 不修改真实 NWU 数据库；以下内容不得声明已实施。未来工作必须先建立真实仓库 OpenSpec，核对当前代码、数据库、迁移工具、权限模型、流量和备份策略后重新决定。

Markdown 继续是文章正文唯一权威。Tiptap JSON、DOM、selection、原生 undo、Renderer HTML 和缓存都不得成为第二正文权威。`serverRevision` 是服务端生成并按不透明字符串处理的并发令牌，不与 W-Editor 会话内数字 revision 混用。

## 概念数据模型

建议在真实 schema 复核后，以现有 `blog_posts` 为迁移入口，而不是机械替换旧表：

```text
articles(
  id, author_user_id, title, markdown, visibility, category,
  server_revision, created_at, updated_at, deleted_at
)

article_versions(
  id, article_id, server_revision, markdown, metadata_json,
  kind, created_by_user_id, created_at, protected
)

recovery_drafts(
  user_id, article_id, base_server_revision, markdown,
  local_revision, updated_at, expires_at
)

workspace_state(
  user_id, article_id, mode, source_anchor_json, selection_json,
  scroll_json, sidebar_json, updated_at
)

user_preferences(
  user_id, key, value_json, schema_version, updated_at
)

assets(
  content_hash, media_type, byte_size, storage_key,
  created_by_user_id, created_at, quarantine_state
)

article_asset_refs(
  article_id, content_hash, role, source_url, created_at
)
```

关键约束：

- `articles.server_revision` 每次正式写入原子更新；比较和更新必须在同一事务完成。
- `article_versions` 只由 `manual-save` 或 `publish` 创建不可变快照；`autosave-draft` 不创建永久 versionId。
- `recovery_drafts`、`workspace_state` 和 `user_preferences` 都按用户隔离；不得只按 articleId 存储。
- workspace 只保存可重建状态，不保存 undo、DOM、Tiptap JSON、弹窗、hover 或临时 fold。
- `content-addressed assets` 用内容 hash 标识受管 blob，`article_asset_refs` 表示 Markdown 引用关系；资产表不保存正文语义，也不引入图片 width/height/align 第二权威。
- 旧图片 URL 在完成资源迁移、引用重写、hash 验证和回退验证前保持可读。

## API 草案

以下路由名仅表示责任，不是对真实 NWU 路由的承诺：

```text
GET  /api/articles/{id}/editor
POST /api/articles/{id}/save
GET  /api/articles/{id}/draft
PUT  /api/articles/{id}/draft
DELETE /api/articles/{id}/draft
GET  /api/articles/{id}/workspace
PUT  /api/articles/{id}/workspace
GET  /api/preferences/w-editor
PATCH /api/preferences/w-editor
POST /api/assets
GET  /api/assets/{hash}
```

`GET editor` 返回 canonical Markdown、opaque `serverRevision`、允许编辑的服务端判定、可见性元数据和当前用户标识。Jinja 只能用 `tojson` 或等价安全 JSON 注入，不拼接可执行脚本。

保存请求概念映射：

```json
{
  "documentId": "opaque article id",
  "markdown": "canonical Markdown",
  "baseServerRevision": "opaque token",
  "saveKind": "autosave-draft | manual-save | publish",
  "origin": "user | autosave | recovery",
  "overwrite": false,
  "metadata": {
    "title": "host-owned title",
    "visibility": "public | selected | private",
    "category": "host-owned category"
  }
}
```

成功的 `manual-save`/`publish` 返回新 `serverRevision`、`savedAt` 和不可变 `versionId`。成功的 `autosave-draft` 返回草稿状态但不得返回永久 `versionId`，也不得推进正式文章 revision。过期 base 返回 `REVISION_CONFLICT` 并保持本地 Markdown，不自动 merge；明确覆盖仍需服务端再次验证权限并记录审计。

## 安全与错误合同

- 所有读写继续使用 same-origin session；不得把 Cookie 或凭据交给 W-Editor 包。
- 所有状态改变请求验证 CSRF；JSON 与 FormData 使用真实框架支持的统一策略，不能只靠 `X-Requested-With`。
- 文章查看按真实 NWU 的登录与 visibility 规则决定；Editor 路由和保存 API 都独立验证作者/管理员权限。
- 稳定错误必须区分 `AUTH_REQUIRED`、`AUTHORIZATION_DENIED`、`CSRF_REJECTED`、`REVISION_CONFLICT` 和普通持久化失败。
- script extension 只解析受支持注释，通过公开脚本 allowlist 和服务端下载授权生成同源 URL；扩展输出仍经过 W-Editor sanitizer。
- 资产上传验证媒体类型、大小、解码结果、隔离/扫描状态、配额和内容 hash；带凭据 URL、路径逃逸和未授权引用必须拒绝。

## 迁移与验收门禁

1. 只读盘点当前表、索引、外键、迁移框架、备份/恢复时间和数据规模。
2. 对重复/缺失 article identity、旧 visibility、图片 URL、script 注释和 Markdown 方言建立脱敏报告。
3. 在 staging 复制生产形状数据，先回填 revision/version，再启用双写或受控转换；每步保留回退点。
4. 用旧页面与 W-Editor 双轨读取同一 canonical Markdown，比较权限、Reader、保存、版本、草稿、资产和回退。
5. 只有真实仓库测试、staging 数据迁移、浏览器/无障碍矩阵、CSP/proxy/cache 和用户验收全部通过，才讨论生产切换。

真实仓库的技术栈、表名、迁移工具或安全中间件若与本草案不一致，以重新调查和新的 OpenSpec 为准，禁止机械应用本文件的 SQL、路由或旧副本 patch。
