mod release_versions {
    include!(concat!(env!("OUT_DIR"), "/release_versions.rs"));
}

mod storage;

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicU64, Ordering},
};

use serde::Serialize;
use tauri::{Emitter, Manager, State, WindowEvent};

#[derive(Clone, Default)]
struct CloseState {
    dirty: Arc<AtomicBool>,
}

#[derive(Clone, Default)]
struct SingleInstanceState {
    count: Arc<AtomicU64>,
    last_args: Arc<Mutex<Vec<String>>>,
    last_cwd: Arc<Mutex<String>>,
}

#[derive(Clone, Default)]
struct StartupArgsState {
    args: Arc<Mutex<Vec<String>>>,
}

#[derive(Clone, Default)]
struct UninstallState {
    confirmation_token: Arc<Mutex<Option<String>>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowCloseResult {
    pub state: String,
    pub dirty: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SingleInstanceResult {
    pub forwarded_count: u64,
    pub last_args: Vec<String>,
    pub last_cwd: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopReleaseInfo {
    pub product_name: String,
    pub version: String,
    pub update_mode: String,
    pub automatic_update: bool,
    pub signed: bool,
    pub download_url: Option<String>,
}

#[derive(Clone, Debug)]
struct ImportSession {
    source_path: String,
    markdown: String,
}

#[derive(Default)]
struct ImportState {
    sessions: Mutex<HashMap<String, ImportSession>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSessionResult {
    pub session_id: String,
    pub source_path: String,
    pub markdown: String,
    pub document_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCommitResult {
    pub session_id: String,
    pub source_path: String,
    pub markdown: String,
    pub document_id: Option<String>,
    pub version_id: Option<String>,
    pub created: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCloseResult {
    pub session_id: String,
    pub source_path: String,
    pub created: bool,
    pub closed: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSpikeProbe {
    pub resource_root: String,
    pub shell_access: bool,
    pub filesystem_access: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SeedDocumentResult {
    seed_key: String,
    title: String,
    markdown: String,
    markdown_bytes: usize,
}

#[tauri::command]
fn desktop_spike_probe(app: tauri::AppHandle) -> Result<DesktopSpikeProbe, String> {
    let resource_root = app.path().resource_dir().map_err(|error| {
        format!("Unable to resolve the managed application resource root: {error}")
    })?;
    Ok(DesktopSpikeProbe {
        resource_root: resource_root.to_string_lossy().into_owned(),
        shell_access: false,
        filesystem_access: false,
    })
}

#[tauri::command]
fn desktop_release_info() -> DesktopReleaseInfo {
    DesktopReleaseInfo {
        product_name: "W-Editor Desktop".into(),
        version: release_versions::PRODUCT_VERSION.into(),
        update_mode: "manual".into(),
        automatic_update: false,
        signed: false,
        download_url: None,
    }
}

#[tauri::command]
fn data_root_status(app: tauri::AppHandle) -> Result<storage::DataRootStatus, String> {
    storage::data_root_status(&app)
}

#[tauri::command]
fn select_data_root(
    app: tauri::AppHandle,
    parent_path: String,
) -> Result<storage::DataRootStatus, String> {
    storage::select_data_root(&app, &parent_path)
}

#[tauri::command]
fn data_root_manifest(app: tauri::AppHandle) -> Result<storage::DataRootManifest, String> {
    storage::data_root_manifest(&app)
}

#[tauri::command]
fn data_root_health_check(app: tauri::AppHandle) -> Result<storage::DataRootStatus, String> {
    storage::data_root_health_check(&app)
}

#[tauri::command]
fn data_root_migrate(
    app: tauri::AppHandle,
    destination_parent: String,
) -> Result<storage::DataRootMigrationResult, String> {
    storage::migrate_data_root(&app, destination_parent)
}

#[tauri::command]
fn migrate_data_root(
    app: tauri::AppHandle,
    destination_parent: String,
) -> Result<storage::DataRootMigrationResult, String> {
    storage::migrate_data_root(&app, destination_parent)
}

#[tauri::command]
fn library_save_markdown(
    app: tauri::AppHandle,
    document_id: String,
    title: String,
    markdown: String,
    requested_revision: Option<i64>,
) -> Result<storage::LibrarySaveResult, String> {
    storage::save_markdown(&app, document_id, title, markdown, requested_revision)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn library_save_version(
    app: tauri::AppHandle,
    input: Option<storage::SaveVersionInput>,
    document_id: Option<String>,
    title: Option<String>,
    markdown: Option<String>,
    requested_revision: Option<i64>,
    kind: Option<String>,
    label: Option<String>,
    protected: Option<bool>,
    seed_key: Option<String>,
) -> Result<storage::LibrarySaveResult, String> {
    let input = input.unwrap_or(storage::SaveVersionInput {
        document_id: document_id.ok_or_else(|| "documentId is required.".to_string())?,
        title: title.ok_or_else(|| "title is required.".to_string())?,
        markdown: markdown.ok_or_else(|| "markdown is required.".to_string())?,
        requested_revision,
        kind,
        label,
        protected,
        seed_key,
    });
    storage::save_version(&app, input)
}

#[tauri::command]
fn library_load_markdown(
    app: tauri::AppHandle,
    document_id: String,
) -> Result<storage::LibraryDocumentResult, String> {
    storage::load_markdown(&app, document_id)
}

#[tauri::command]
fn library_create_article(
    app: tauri::AppHandle,
    input: Option<storage::ArticleCreateInput>,
    document_id: Option<String>,
    title: Option<String>,
    markdown: Option<String>,
    seed_key: Option<String>,
) -> Result<storage::LibraryDocumentResult, String> {
    let input = input.unwrap_or(storage::ArticleCreateInput {
        document_id,
        title: title.ok_or_else(|| "title is required.".to_string())?,
        markdown: markdown.ok_or_else(|| "markdown is required.".to_string())?,
        seed_key,
    });
    storage::create_article(&app, input)
}

#[tauri::command]
fn library_get_article(
    app: tauri::AppHandle,
    document_id: String,
    include_deleted: Option<bool>,
) -> Result<storage::LibraryDocumentResult, String> {
    storage::load_article(&app, document_id, include_deleted.unwrap_or(false))
}

#[tauri::command]
fn library_list_articles(
    app: tauri::AppHandle,
    include_deleted: Option<bool>,
) -> Result<Vec<storage::LibraryDocumentResult>, String> {
    storage::list_articles(&app, include_deleted.unwrap_or(false))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn library_update_article(
    app: tauri::AppHandle,
    input: Option<storage::SaveVersionInput>,
    document_id: Option<String>,
    title: Option<String>,
    markdown: Option<String>,
    requested_revision: Option<i64>,
    kind: Option<String>,
    label: Option<String>,
    protected: Option<bool>,
    seed_key: Option<String>,
) -> Result<storage::LibrarySaveResult, String> {
    let input = input.unwrap_or(storage::SaveVersionInput {
        document_id: document_id.ok_or_else(|| "documentId is required.".to_string())?,
        title: title.ok_or_else(|| "title is required.".to_string())?,
        markdown: markdown.ok_or_else(|| "markdown is required.".to_string())?,
        requested_revision,
        kind,
        label,
        protected,
        seed_key,
    });
    storage::save_version(&app, input)
}

#[tauri::command]
fn library_delete_article(
    app: tauri::AppHandle,
    document_id: String,
) -> Result<storage::LibraryDocumentResult, String> {
    storage::delete_article(&app, document_id)
}

#[tauri::command]
fn library_restore_article(
    app: tauri::AppHandle,
    document_id: String,
) -> Result<storage::LibraryDocumentResult, String> {
    storage::restore_article(&app, document_id)
}

#[tauri::command]
fn library_schema_status(app: tauri::AppHandle) -> Result<storage::LibrarySchemaResult, String> {
    storage::library_schema_status(&app)
}

#[tauri::command]
fn library_recovery_status(
    app: tauri::AppHandle,
) -> Result<storage::LibraryRecoveryStatus, String> {
    storage::recovery_status(&app)
}

#[tauri::command]
fn library_export_recovery(
    app: tauri::AppHandle,
    destination_path: String,
) -> Result<storage::LibraryRecoveryExportResult, String> {
    storage::export_recovery_database(&app, destination_path)
}

#[tauri::command]
fn library_read_only_export(
    app: tauri::AppHandle,
    destination_path: String,
) -> Result<storage::LibraryRecoveryExportResult, String> {
    storage::export_recovery_database(&app, destination_path)
}

#[tauri::command]
fn library_list_versions(
    app: tauri::AppHandle,
    document_id: String,
) -> Result<Vec<storage::ArticleVersionResult>, String> {
    storage::list_versions(&app, document_id)
}

#[tauri::command]
fn library_get_version(
    app: tauri::AppHandle,
    version_id: String,
) -> Result<storage::ArticleVersionResult, String> {
    storage::get_version(&app, version_id)
}

#[tauri::command]
fn library_delete_version(app: tauri::AppHandle, version_id: String) -> Result<bool, String> {
    storage::delete_version(&app, version_id)
}

#[tauri::command]
fn library_prune_versions(
    app: tauri::AppHandle,
    document_id: String,
) -> Result<storage::VersionCleanupResult, String> {
    storage::prune_versions(&app, document_id)
}

#[tauri::command]
fn library_export_markdown(
    app: tauri::AppHandle,
    document_id: String,
    destination_path: String,
) -> Result<storage::SnapshotExportResult, String> {
    storage::export_markdown(&app, document_id, destination_path)
}

#[tauri::command]
fn library_save_as(
    app: tauri::AppHandle,
    document_id: String,
    destination_path: String,
) -> Result<storage::SnapshotExportResult, String> {
    storage::export_markdown(&app, document_id, destination_path)
}

#[tauri::command]
fn export_write_file(
    app: tauri::AppHandle,
    destination_path: String,
    bytes: Vec<u8>,
) -> Result<storage::FileExportResult, String> {
    storage::write_export_file(&app, destination_path, bytes)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn library_put_asset(
    app: tauri::AppHandle,
    input: Option<storage::AssetPutInput>,
    hash: Option<String>,
    media_type: Option<String>,
    data: Option<Vec<u8>>,
    data_base64: Option<String>,
    data_url: Option<String>,
    article_id: Option<String>,
    role: Option<String>,
) -> Result<storage::AssetResult, String> {
    let input = input.unwrap_or(storage::AssetPutInput {
        hash,
        media_type,
        data,
        data_base64,
        data_url,
        article_id,
        role,
    });
    storage::put_asset(&app, input)
}

#[tauri::command]
fn library_link_asset(
    app: tauri::AppHandle,
    document_id: String,
    hash: String,
    role: String,
) -> Result<bool, String> {
    storage::link_asset(&app, document_id, hash, role)
}

#[tauri::command]
fn library_unlink_asset(
    app: tauri::AppHandle,
    document_id: String,
    hash: String,
    role: String,
) -> Result<bool, String> {
    storage::unlink_asset(&app, document_id, hash, role)
}

#[tauri::command]
fn library_list_asset_refs(
    app: tauri::AppHandle,
    document_id: String,
) -> Result<Vec<storage::AssetResult>, String> {
    storage::list_asset_refs(&app, document_id)
}

#[tauri::command]
fn library_seed_catalog() -> Vec<storage::SeedInfo> {
    storage::seed_catalog()
}

#[tauri::command]
fn library_seed_get(seed_key: String) -> Result<SeedDocumentResult, String> {
    let (title, markdown) = storage::seed_get(seed_key.clone())?;
    Ok(SeedDocumentResult {
        seed_key,
        title: title.into(),
        markdown: markdown.into(),
        markdown_bytes: markdown.len(),
    })
}

#[tauri::command]
fn library_seed_materialize(
    app: tauri::AppHandle,
    seed_key: String,
    title: Option<String>,
    markdown: Option<String>,
) -> Result<storage::SeedMaterializeResult, String> {
    storage::materialize_seed(&app, seed_key, title, markdown)
}

#[tauri::command]
fn library_seed_reset(
    app: tauri::AppHandle,
    seed_key: String,
) -> Result<storage::SeedMaterializeResult, String> {
    storage::materialize_seed(&app, seed_key, None, None)
}

#[tauri::command]
fn recovery_save_draft(
    app: tauri::AppHandle,
    document_id: String,
    base_revision: i64,
    markdown: String,
) -> Result<storage::RecoveryDraftResult, String> {
    storage::save_recovery_draft(
        &app,
        storage::RecoveryDraftInput {
            document_id,
            base_revision,
            markdown,
        },
    )
}

#[tauri::command]
fn recovery_load_draft(
    app: tauri::AppHandle,
    document_id: String,
) -> Result<Option<storage::RecoveryDraftResult>, String> {
    storage::load_recovery_draft(&app, document_id)
}

#[tauri::command]
fn recovery_clear_draft(app: tauri::AppHandle, document_id: String) -> Result<bool, String> {
    storage::clear_recovery_draft(&app, document_id)
}

#[tauri::command]
fn recovery_discard_draft(app: tauri::AppHandle, document_id: String) -> Result<bool, String> {
    storage::clear_recovery_draft(&app, document_id)
}

#[tauri::command]
fn recovery_export_draft(
    app: tauri::AppHandle,
    document_id: String,
    destination_path: String,
) -> Result<storage::SnapshotExportResult, String> {
    storage::export_recovery_draft(&app, document_id, destination_path)
}

#[tauri::command]
fn recovery_cleanup_drafts(app: tauri::AppHandle) -> Result<usize, String> {
    storage::cleanup_expired_drafts(&app)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn workspace_save_state(
    app: tauri::AppHandle,
    input: Option<storage::WorkspaceStateInput>,
    document_id: Option<String>,
    mode: Option<String>,
    source_anchor: Option<serde_json::Value>,
    selection: Option<serde_json::Value>,
    scroll: Option<serde_json::Value>,
    sidebar: Option<serde_json::Value>,
) -> Result<storage::WorkspaceStateResult, String> {
    let input = input.unwrap_or(storage::WorkspaceStateInput {
        document_id: document_id.ok_or_else(|| "documentId is required.".to_string())?,
        mode: mode.ok_or_else(|| "mode is required.".to_string())?,
        source_anchor,
        selection,
        scroll,
        sidebar,
    });
    storage::save_workspace_state(&app, input)
}

#[tauri::command]
fn workspace_load_state(
    app: tauri::AppHandle,
    document_id: String,
) -> Result<Option<storage::WorkspaceStateResult>, String> {
    storage::load_workspace_state(&app, document_id)
}

#[tauri::command]
fn workspace_restore_state(
    app: tauri::AppHandle,
    document_id: String,
    source_length: Option<i64>,
) -> Result<Option<storage::WorkspaceStateResult>, String> {
    storage::restore_workspace_state(&app, document_id, source_length)
}

#[tauri::command]
fn workspace_clear_state(app: tauri::AppHandle, document_id: String) -> Result<bool, String> {
    storage::clear_workspace_state(&app, document_id)
}

#[tauri::command]
fn settings_get(app: tauri::AppHandle) -> Result<storage::SettingsResult, String> {
    storage::get_settings(&app)
}

#[tauri::command]
fn settings_set_user_override(
    app: tauri::AppHandle,
    input: Option<storage::SettingsOverrideInput>,
    key: Option<String>,
    value: Option<serde_json::Value>,
) -> Result<storage::SettingsResult, String> {
    let input = input.unwrap_or(storage::SettingsOverrideInput {
        key: key.ok_or_else(|| "key is required.".to_string())?,
        value: value.ok_or_else(|| "value is required.".to_string())?,
    });
    storage::set_user_override(&app, input)
}

#[tauri::command]
fn settings_clear_user_override(
    app: tauri::AppHandle,
    key: String,
) -> Result<storage::SettingsResult, String> {
    storage::clear_user_override(&app, key)
}

#[tauri::command]
fn settings_reset(app: tauri::AppHandle) -> Result<storage::SettingsResult, String> {
    storage::reset_user_settings(&app)
}

#[tauri::command]
fn settings_set_distribution_defaults(
    app: tauri::AppHandle,
    value: serde_json::Value,
) -> Result<storage::SettingsResult, String> {
    storage::set_distribution_defaults(&app, value)
}

#[tauri::command]
fn settings_export_raw(
    app: tauri::AppHandle,
    destination_path: String,
) -> Result<storage::SnapshotExportResult, String> {
    storage::export_raw_settings(&app, destination_path)
}

#[tauri::command]
fn backup_create(
    app: tauri::AppHandle,
    input: Option<storage::BackupCreateInput>,
    kind: Option<String>,
    protected: Option<bool>,
    label: Option<String>,
) -> Result<storage::BackupResult, String> {
    let input = input.unwrap_or(storage::BackupCreateInput {
        kind,
        protected,
        label,
    });
    storage::create_backup(&app, input)
}

#[tauri::command]
fn backup_list(app: tauri::AppHandle) -> Result<Vec<storage::BackupManifest>, String> {
    storage::list_backups(&app)
}

#[tauri::command]
fn backup_verify(
    app: tauri::AppHandle,
    backup_id: String,
) -> Result<storage::BackupVerificationResult, String> {
    storage::verify_backup(&app, backup_id)
}

#[tauri::command]
fn backup_retention_preview(
    app: tauri::AppHandle,
) -> Result<storage::BackupRetentionPreview, String> {
    storage::retention_preview(&app)
}

#[tauri::command]
fn backup_cleanup(app: tauri::AppHandle) -> Result<storage::BackupRetentionPreview, String> {
    storage::cleanup_backups(&app)
}

#[tauri::command]
fn backup_usage(app: tauri::AppHandle) -> Result<storage::BackupUsageResult, String> {
    storage::backup_usage(&app)
}

#[tauri::command]
fn backup_gc(
    app: tauri::AppHandle,
    preview: Option<bool>,
) -> Result<storage::BackupGcResult, String> {
    storage::gc_backups(&app, preview.unwrap_or(false))
}

#[tauri::command]
fn backup_restore(
    app: tauri::AppHandle,
    backup_id: String,
) -> Result<storage::BackupRestoreResult, String> {
    storage::restore_backup(&app, backup_id)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn backup_set_retention(
    app: tauri::AppHandle,
    policy: Option<storage::RetentionPolicy>,
    daily: Option<usize>,
    weekly: Option<usize>,
    monthly: Option<usize>,
    draft_days: Option<i64>,
    temp_days: Option<i64>,
    log_files: Option<usize>,
    log_max_bytes: Option<u64>,
) -> Result<storage::SettingsResult, String> {
    let mut policy = policy.unwrap_or_default();
    if let Some(value) = daily {
        policy.daily = value;
    }
    if let Some(value) = weekly {
        policy.weekly = value;
    }
    if let Some(value) = monthly {
        policy.monthly = value;
    }
    if let Some(value) = draft_days {
        policy.draft_days = value;
    }
    if let Some(value) = temp_days {
        policy.temp_days = value;
    }
    if let Some(value) = log_files {
        policy.log_files = value;
    }
    if let Some(value) = log_max_bytes {
        policy.log_max_bytes = value;
    }
    storage::set_retention_policy(&app, policy)
}

#[tauri::command]
fn temp_create(
    app: tauri::AppHandle,
    input: Option<storage::TempCreateInput>,
    temp_type: Option<String>,
    session_id: Option<String>,
    operation: Option<String>,
) -> Result<storage::TempEntryResult, String> {
    let input = input.unwrap_or(storage::TempCreateInput {
        temp_type: temp_type.ok_or_else(|| "tempType is required.".to_string())?,
        session_id,
        operation,
    });
    storage::create_temp_entry(&app, input)
}

#[tauri::command]
fn temp_lock(
    app: tauri::AppHandle,
    temp_type: String,
    session_id: String,
) -> Result<storage::TempEntryResult, String> {
    storage::acquire_temp_lock(&app, temp_type, session_id)
}

#[tauri::command]
fn temp_unlock(
    app: tauri::AppHandle,
    temp_type: String,
    session_id: String,
) -> Result<bool, String> {
    storage::release_temp_lock(&app, temp_type, session_id)
}

#[tauri::command]
fn temp_list(app: tauri::AppHandle) -> Result<Vec<storage::TempEntryResult>, String> {
    storage::list_temp_entries(&app)
}

#[tauri::command]
fn temp_cleanup(
    app: tauri::AppHandle,
    manual: Option<bool>,
) -> Result<storage::TempCleanupResult, String> {
    storage::cleanup_temp_entries(&app, manual.unwrap_or(false))
}

#[tauri::command]
fn temp_usage(app: tauri::AppHandle) -> Result<storage::BackupUsageResult, String> {
    storage::temp_usage(&app)
}

#[tauri::command]
fn diagnostic_preview(app: tauri::AppHandle) -> Result<storage::DiagnosticPreviewResult, String> {
    storage::diagnostic_preview(&app)
}

#[tauri::command]
fn diagnostic_export(
    app: tauri::AppHandle,
    destination_path: String,
    include_logs: Option<bool>,
    include_manifest: Option<bool>,
) -> Result<storage::DiagnosticExportResult, String> {
    storage::export_diagnostics(&app, destination_path, include_logs, include_manifest)
}

#[tauri::command]
fn log_status(app: tauri::AppHandle) -> Result<storage::LogStatusResult, String> {
    storage::log_status(&app)
}

#[tauri::command]
fn fault_injection_set(kind: String, enabled: bool) -> Result<Vec<String>, String> {
    if !cfg!(debug_assertions) {
        return Err("Fault injection is available only in debug/test builds.".into());
    }
    storage::set_fault(&kind, enabled)?;
    storage::fault_status()
}

#[tauri::command]
fn fault_injection_status() -> Result<Vec<String>, String> {
    storage::fault_status()
}

#[tauri::command]
fn fault_injection_clear() -> Result<Vec<String>, String> {
    if !cfg!(debug_assertions) {
        return Err("Fault injection is available only in debug/test builds.".into());
    }
    storage::clear_faults()?;
    storage::fault_status()
}

#[tauri::command]
fn set_window_dirty(state: State<'_, CloseState>, dirty: bool) -> WindowCloseResult {
    state.dirty.store(dirty, Ordering::SeqCst);
    WindowCloseResult {
        state: if dirty { "dirty" } else { "clean" }.into(),
        dirty,
    }
}

#[tauri::command]
fn request_window_close(
    window: tauri::Window,
    state: State<'_, CloseState>,
) -> Result<WindowCloseResult, String> {
    let dirty = state.dirty.load(Ordering::SeqCst);
    if dirty {
        let _ = window.emit("desktop-close-blocked", "unsaved-content");
        return Ok(WindowCloseResult {
            state: "blocked".into(),
            dirty: true,
        });
    }
    window
        .close()
        .map_err(|error| format!("Unable to close the Desktop window: {error}"))?;
    Ok(WindowCloseResult {
        state: "allowed".into(),
        dirty: false,
    })
}

#[tauri::command]
fn single_instance_status(state: State<'_, SingleInstanceState>) -> SingleInstanceResult {
    SingleInstanceResult {
        forwarded_count: state.count.load(Ordering::SeqCst),
        last_args: state
            .last_args
            .lock()
            .map(|args| args.clone())
            .unwrap_or_default(),
        last_cwd: state
            .last_cwd
            .lock()
            .map(|cwd| cwd.clone())
            .unwrap_or_default(),
    }
}

#[tauri::command]
fn startup_file_requests(state: State<'_, StartupArgsState>) -> Vec<String> {
    state
        .args
        .lock()
        .map(|mut args| std::mem::take(&mut *args))
        .unwrap_or_default()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UninstallPreviewResult {
    preview: storage::UninstallDataPreview,
    confirmation_token: String,
}

#[tauri::command]
fn uninstall_data_preview(
    app: tauri::AppHandle,
    state: State<'_, UninstallState>,
) -> Result<UninstallPreviewResult, String> {
    let preview = storage::uninstall_data_preview(&app)?;
    let token = storage::unique_id("uninstall-confirm");
    *state
        .confirmation_token
        .lock()
        .map_err(|_| "The uninstall confirmation state is unavailable.".to_string())? =
        Some(token.clone());
    Ok(UninstallPreviewResult {
        preview,
        confirmation_token: token,
    })
}

#[tauri::command]
fn uninstall_data_cleanup(
    app: tauri::AppHandle,
    scope: String,
    confirmation_token: String,
    state: State<'_, UninstallState>,
) -> Result<storage::UninstallDataCleanupResult, String> {
    let mut expected = state
        .confirmation_token
        .lock()
        .map_err(|_| "The uninstall confirmation state is unavailable.".to_string())?;
    if expected.as_deref() != Some(confirmation_token.as_str()) {
        return Err("UNINSTALL_CONFIRMATION_INVALID: request a fresh preview and confirm the displayed Data Root.".into());
    }
    let result = storage::uninstall_data_cleanup(&app, &scope)?;
    *expected = None;
    Ok(result)
}

fn supported_import_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "md" | "markdown" | "txt"
            )
        })
}

#[tauri::command]
fn import_markdown_start(
    path: String,
    state: State<'_, ImportState>,
) -> Result<ImportSessionResult, String> {
    let source = std::path::PathBuf::from(&path);
    if !source.is_absolute() || !supported_import_path(&source) {
        return Err("Only absolute .md, .markdown, and .txt files can be imported.".into());
    }
    let markdown = fs::read_to_string(&source)
        .map_err(|error| format!("Unable to read the Markdown import: {error}"))?;
    let session_id = storage::unique_id("import");
    state
        .sessions
        .lock()
        .map_err(|_| "The Markdown import session store is unavailable.".to_string())?
        .insert(
            session_id.clone(),
            ImportSession {
                source_path: path.clone(),
                markdown: markdown.clone(),
            },
        );
    Ok(ImportSessionResult {
        session_id,
        source_path: path,
        markdown,
        document_id: None,
    })
}

#[tauri::command]
fn import_markdown_commit(
    app: tauri::AppHandle,
    session_id: String,
    title: Option<String>,
    markdown: String,
    save: Option<bool>,
    state: State<'_, ImportState>,
) -> Result<ImportCommitResult, String> {
    let session = state
        .sessions
        .lock()
        .map_err(|_| "The Markdown import session store is unavailable.".to_string())?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "The Markdown import session no longer exists.".to_string())?;
    if !save.unwrap_or(false) && markdown == session.markdown {
        return Ok(ImportCommitResult {
            session_id,
            source_path: session.source_path,
            markdown,
            document_id: None,
            version_id: None,
            created: false,
        });
    }
    let document_id = format!("library-{session_id}");
    let article_title = if title.as_deref().unwrap_or_default().trim().is_empty() {
        Path::new(&session.source_path)
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("Imported Markdown")
            .to_string()
    } else {
        title.unwrap_or_default()
    };
    let saved = storage::save_version(
        &app,
        storage::SaveVersionInput {
            document_id: document_id.clone(),
            title: article_title,
            markdown: markdown.clone(),
            requested_revision: None,
            kind: Some("import".into()),
            label: None,
            protected: None,
            seed_key: None,
        },
    )?;
    state
        .sessions
        .lock()
        .map_err(|_| "The Markdown import session store is unavailable.".to_string())?
        .remove(&session_id);
    Ok(ImportCommitResult {
        session_id,
        source_path: session.source_path,
        markdown,
        document_id: Some(document_id),
        version_id: Some(saved.version_id),
        created: true,
    })
}

#[tauri::command]
fn import_markdown_close(
    session_id: String,
    state: State<'_, ImportState>,
) -> Result<ImportCloseResult, String> {
    let session = state
        .sessions
        .lock()
        .map_err(|_| "The Markdown import session store is unavailable.".to_string())?
        .remove(&session_id)
        .ok_or_else(|| "The Markdown import session no longer exists.".to_string())?;
    Ok(ImportCloseResult {
        session_id,
        source_path: session.source_path,
        created: false,
        closed: true,
    })
}

pub fn run() {
    let close_state = CloseState::default();
    let single_instance_state = SingleInstanceState::default();
    let single_instance_callback_state = single_instance_state.clone();
    let startup_args_state = StartupArgsState {
        args: Arc::new(Mutex::new(std::env::args().skip(1).collect())),
    };
    let uninstall_state = UninstallState::default();
    tauri::Builder::default()
        .manage(close_state.clone())
        .manage(ImportState::default())
        .manage(single_instance_state)
        .manage(startup_args_state)
        .manage(uninstall_state)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(move |app, args, cwd| {
            single_instance_callback_state
                .count
                .fetch_add(1, Ordering::SeqCst);
            if let Ok(mut last_args) = single_instance_callback_state.last_args.lock() {
                *last_args = args.clone();
            }
            if let Ok(mut last_cwd) = single_instance_callback_state.last_cwd.lock() {
                *last_cwd = cwd.clone();
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            let _ = app.emit(
                "desktop-file-request",
                serde_json::json!({ "args": args, "cwd": cwd }),
            );
        }))
        .setup(move |app| {
            storage::startup_maintenance(app.handle());
            if let Some(window) = app.get_webview_window("main") {
                let close_state = close_state.clone();
                let event_window = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event
                        && close_state.dirty.load(Ordering::SeqCst)
                    {
                        api.prevent_close();
                        let _ = event_window.emit("desktop-close-blocked", "unsaved-content");
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop_spike_probe,
            desktop_release_info,
            data_root_status,
            select_data_root,
            data_root_manifest,
            data_root_health_check,
            data_root_migrate,
            migrate_data_root,
            library_save_markdown,
            library_save_version,
            library_load_markdown,
            library_create_article,
            library_get_article,
            library_list_articles,
            library_update_article,
            library_delete_article,
            library_restore_article,
            library_schema_status,
            library_recovery_status,
            library_export_recovery,
            library_read_only_export,
            library_list_versions,
            library_get_version,
            library_delete_version,
            library_prune_versions,
            library_export_markdown,
            library_save_as,
            export_write_file,
            library_put_asset,
            library_link_asset,
            library_unlink_asset,
            library_list_asset_refs,
            library_seed_catalog,
            library_seed_get,
            library_seed_materialize,
            library_seed_reset,
            import_markdown_start,
            import_markdown_commit,
            import_markdown_close,
            recovery_save_draft,
            recovery_load_draft,
            recovery_clear_draft,
            recovery_discard_draft,
            recovery_export_draft,
            recovery_cleanup_drafts,
            workspace_save_state,
            workspace_load_state,
            workspace_restore_state,
            workspace_clear_state,
            settings_get,
            settings_set_user_override,
            settings_clear_user_override,
            settings_reset,
            settings_set_distribution_defaults,
            settings_export_raw,
            backup_create,
            backup_list,
            backup_verify,
            backup_retention_preview,
            backup_cleanup,
            backup_usage,
            backup_gc,
            backup_restore,
            backup_set_retention,
            temp_create,
            temp_lock,
            temp_unlock,
            temp_list,
            temp_cleanup,
            temp_usage,
            diagnostic_preview,
            diagnostic_export,
            log_status,
            fault_injection_set,
            fault_injection_status,
            fault_injection_clear,
            set_window_dirty,
            request_window_close,
            single_instance_status,
            startup_file_requests,
            uninstall_data_preview,
            uninstall_data_cleanup
        ])
        .run(tauri::generate_context!())
        .expect("failed to run W-Editor Desktop");
}
