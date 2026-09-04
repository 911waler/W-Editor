# Desktop Data Root / Library（阶段 7）

本文档记录 `dual-target-release` Tasks 7.1–7.16 的实现边界。它不实现第 8 阶段的完整 Desktop UI、安装器产品化或发布流程。

## 冻结的数据根

Desktop 只从应用配置目录读取一个最小 `data-root.json` locator。locator 只包含 `schemaVersion`、受验证的 `root`、`health` 和可选 `rootId`；正文、草稿、日志、备份和临时数据不写入 locator 所在目录。

选定根的固定名称为 `W-EditorData`，且不能位于系统 cache/temp。根内的固定耐久目录和临时目录为：

```text
W-EditorData/
  library.db
  root.marker
  manifest.json
  assets/sha256/<sha256>
  backups/
    blobs/
    manifests/<backup-id>.json
    snapshots/<backup-id>.db.gz
  logs/app.log[.N]
  settings/
  tmp/{webview,extract,update,migration,restore,asset,backup,lock}/<session>/
```

`root.marker` 必须以 `w-editor-data-root` 开头并声明 `schemaVersion=1`。`manifest.json` 必须声明根类型、固定目录、临时目录、耐久文件集合和禁止位置。所有受管路径都经过绝对路径、root marker、manifest、symlink 和 canonical containment 校验；locator 写入使用同目录临时文件、flush、备份和 rename，失败时恢复旧 locator。

Data Root 状态只允许进入 `unconfigured`、`ready`、`unavailable` 或 `read_only`；根丢失、manifest/marker 损坏或写探针失败时不会猜测其他路径。

## SQLite authority

当前 `databaseSchemaVersion` 为 `2`。数据库启用 `PRAGMA foreign_keys=ON`、WAL、busy timeout，并在写入、迁移、备份和恢复边界使用事务/写屏障。schema v1 会先生成受保护的迁移备份，再在 forward-only 事务中增加 v2 字段和表；未知或过新 schema 不会自动降级。

v2 的正文和恢复模型是：

```text
schema_meta(key, value)
articles(id, title, markdown, revision, seed_key, created_at, updated_at, deleted_at)
article_versions(id, article_id, revision, markdown, kind, label, protected, created_at)
recovery_drafts(article_id, base_revision, markdown, updated_at, expires_at, state)
workspace_state(article_id, mode, source_anchor_json, selection_json, scroll_json, sidebar_json, updated_at)
settings(key, value_json, schema_version, updated_at)
assets(hash, media_type, size, storage_key, created_at)
article_asset_refs(article_id, asset_hash, role, created_at)
audit_events(id, event_type, document_id, details_json, created_at)
```

`articles.markdown` 和 `article_versions.markdown` 是唯一正文权威与完整快照。数据库不包含 Tiptap JSON、DOM、projection 或 undo history。Article 删除是 `deleted_at` 软删除；恢复不会创建新的正文版本。手动保存/发布在一个事务中更新当前 Markdown 并创建不可变版本，autosave 只写 `recovery_drafts`。

普通版本自动保留最近 50 个，`publish` 或 `protected` 版本不参与数量清理。清理会记录 `audit_events`。恢复草稿默认 30 天，可显式恢复、丢弃或导出；成功手动保存会清理已合并草稿。workspace 只持久化 source anchor/selection、mode、scroll 和 sidebar，非法位置只做安全回退，不改变正文。

## Import、seed、settings 和资产

外部 `.md`、`.markdown`、`.txt` 先进入 memory-only import session。未修改关闭不创建数据库；第一次有效修改或主动保存使用新的 Library `documentId`，随后不再关联或回写原文件。三篇 seed（`welcome`、`formatting-gallery`、`product-notes`）以只读模板提供；materialize/reset 每次生成独立文章 ID，不混入模板或既有用户历史。

Desktop SettingsStore 保存用户覆盖，解析顺序为产品默认 < 分发默认 < 用户覆盖。未知 schema 的原始设置保留在数据库并可 raw export，恢复默认是显式清除用户覆盖。资产按 SHA-256 存入 `assets/sha256`，文章引用通过 `article_asset_refs`，未引用且未被保留备份引用的 blob 才可由 reachability GC 预览/清理。

## Backup、迁移、tmp 和诊断

备份使用 SQLite Online Backup API 生成一致快照，再 gzip 压缩；manifest 记录压缩/未压缩 hash、schema、CAS 引用和保护状态。自动策略默认为 daily 7、weekly 8、monthly 12；manual/migration/restore 备份受保护。清理先提供释放空间预览，再删除旧自动 manifest/snapshot，最后按所有保留 manifest 与当前文章引用计算 CAS reachability。

Data Root 迁移先取得 `tmp/lock/write.lock`，在新父目录建立 staging，复制耐久文件、用 SQLite backup API 复制数据库、生成 copy manifest、校验 hash/integrity/health 后 atomic replace locator；旧根始终保留。`tmp/` 不进入耐久备份。tmp session 使用 `marker.json` 和 lock，启动会清理超过 7 天且没有活跃锁/事务状态的孤儿项。

日志位于根内 `logs/`，按大小滚动并有文件数上限；只记录事件、计数和错误类别。诊断预览/导出默认只包含环境、根 manifest 和脱敏日志，排除正文、草稿、cookie、凭据、完整绝对路径、资产和 tmp。

阶段 7 还提供仅用于 debug/验证的 fault-injection IPC，可模拟数据库、磁盘满、权限、写屏障、迁移/恢复中断、manifest 和 WAL 失败；正式功能仍 fail-closed，故障不会被吞成成功。
