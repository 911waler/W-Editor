use std::collections::{BTreeMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{
    Mutex, OnceLock,
    atomic::{AtomicU64, Ordering},
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use flate2::{Compression, read::GzDecoder, write::GzEncoder};
use rusqlite::{Connection, OpenFlags, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use tauri::Manager;

pub const DATA_ROOT_SCHEMA_VERSION: u32 = crate::release_versions::DATA_ROOT_SCHEMA_VERSION;
pub const LIBRARY_SCHEMA_VERSION: i64 = crate::release_versions::LIBRARY_SCHEMA_VERSION;
pub const SETTINGS_SCHEMA_VERSION: i64 = crate::release_versions::SETTINGS_SCHEMA_VERSION;
pub const MARKDOWN_DIALECT_VERSION: &str = crate::release_versions::MARKDOWN_DIALECT_VERSION;
pub const DEFAULT_DRAFT_RETENTION_DAYS: i64 = 30;
pub const DEFAULT_TEMP_RETENTION_DAYS: i64 = 7;
pub const DEFAULT_LOG_RETENTION_FILES: usize = 5;
pub const DEFAULT_LOG_MAX_BYTES: u64 = 1024 * 1024;
pub const MAX_MARKDOWN_BYTES: usize = 50 * 1024 * 1024;
pub const MAX_JSON_BYTES: usize = 512 * 1024;

// Keep this public shape stable for the phase-6 IPC probes. New temporary types
// are deliberately nested below tmp without changing the legacy five entries.
pub const MANAGED_DIRECTORIES: [&str; 5] = ["assets", "backups", "logs", "settings", "tmp/webview"];
pub const TEMP_TYPES: [&str; 8] = [
    "webview",
    "extract",
    "update",
    "migration",
    "restore",
    "asset",
    "backup",
    "lock",
];

static ID_COUNTER: AtomicU64 = AtomicU64::new(0);
static FAULTS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn fault_store() -> &'static Mutex<HashSet<String>> {
    FAULTS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn fault_enabled(kind: &str) -> bool {
    fault_store()
        .lock()
        .map(|faults| faults.contains(kind))
        .unwrap_or(false)
}

pub fn set_fault(kind: &str, enabled: bool) -> Result<(), String> {
    let normalized = normalize_fault_kind(kind)?;
    let mut faults = fault_store()
        .lock()
        .map_err(|_| "Fault injection state is unavailable.".to_string())?;
    if enabled {
        faults.insert(normalized);
    } else {
        faults.remove(&normalized);
    }
    Ok(())
}

pub fn clear_faults() -> Result<(), String> {
    fault_store()
        .lock()
        .map_err(|_| "Fault injection state is unavailable.".to_string())?
        .clear();
    Ok(())
}

pub fn fault_status() -> Result<Vec<String>, String> {
    let mut faults = fault_store()
        .lock()
        .map_err(|_| "Fault injection state is unavailable.".to_string())?
        .iter()
        .cloned()
        .collect::<Vec<_>>();
    faults.sort();
    Ok(faults)
}

fn normalize_fault_kind(kind: &str) -> Result<String, String> {
    let normalized = kind.trim().to_ascii_lowercase().replace('_', "-");
    const ALLOWED: [&str; 9] = [
        "database",
        "disk-full",
        "permission",
        "write-barrier",
        "interrupt-migration",
        "interrupt-restore",
        "manifest",
        "wal",
        "second-instance",
    ];
    if ALLOWED.contains(&normalized.as_str()) {
        Ok(normalized)
    } else {
        Err(format!("Unsupported fault injection kind: {kind}"))
    }
}

fn fail_if_injected(kind: &str) -> Result<(), String> {
    if fault_enabled(kind) {
        Err(format!("Injected {kind} failure."))
    } else {
        Ok(())
    }
}

fn unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

pub fn now_string() -> String {
    format!("{:013}", unix_millis())
}

fn now_millis() -> i64 {
    unix_millis().min(i64::MAX as u128) as i64
}

fn new_id(prefix: &str) -> String {
    let counter = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{}-{counter}", unix_millis())
}

pub fn unique_id(prefix: &str) -> String {
    new_id(prefix)
}

pub fn root_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn path_has_control(value: &str) -> bool {
    value.chars().any(char::is_control)
}

fn normalized_path(path: &Path) -> String {
    let mut value = path.to_string_lossy().replace('\\', "/");
    while value.len() > 1 && value.ends_with('/') {
        value.pop();
    }
    value.to_ascii_lowercase()
}

fn lexical_normalize(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            _ => normalized.push(component.as_os_str()),
        }
    }
    normalized
}

fn path_is_within(path: &Path, parent: &Path) -> bool {
    let child = normalized_path(path);
    let base = normalized_path(parent);
    child == base || child.starts_with(&(base + "/"))
}

#[cfg(windows)]
fn move_file(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    unsafe extern "system" {
        fn MoveFileExW(
            lpExistingFileName: *const u16,
            lpNewFileName: *const u16,
            dwFlags: u32,
        ) -> i32;
    }
    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_COPY_ALLOWED: u32 = 0x2;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_COPY_ALLOWED | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn move_file(source: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(source, destination)
}

fn absolute_path(value: &str, label: &str) -> Result<PathBuf, String> {
    if value.trim().is_empty() || path_has_control(value) {
        return Err(format!("{label} must be a non-empty absolute path."));
    }
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(format!("{label} must be an absolute path."));
    }
    Ok(lexical_normalize(&path))
}

fn is_system_temp(path: &Path) -> bool {
    let mut candidates = vec![std::env::temp_dir()];
    for variable in ["TEMP", "TMP", "LOCALAPPDATA"] {
        if let Ok(value) = std::env::var(variable) {
            let candidate = PathBuf::from(value);
            candidates.push(if variable == "LOCALAPPDATA" {
                candidate.join("Temp")
            } else {
                candidate
            });
        }
    }
    candidates
        .iter()
        .filter(|candidate| candidate.is_absolute())
        .any(|candidate| path_is_within(path, candidate))
}

fn validate_data_root_path(path: &Path) -> Result<(), String> {
    if !path.is_absolute() || path_has_control(&root_string(path)) {
        return Err("The Data Root must be an absolute path without control characters.".into());
    }
    if path.file_name().and_then(|name| name.to_str()) != Some("W-EditorData") {
        return Err("The Data Root must be the managed W-EditorData directory.".into());
    }
    if is_system_temp(path) {
        return Err("The Data Root cannot be inside the system cache/temp directory.".into());
    }
    Ok(())
}

fn validate_external_destination(path: &Path) -> Result<PathBuf, String> {
    let value = absolute_path(&root_string(path), "The export destination")?;
    let parent = value
        .parent()
        .ok_or_else(|| "The export destination has no parent directory.".to_string())?;
    if !parent.exists() || !parent.is_dir() {
        return Err("The export destination parent is not an existing directory.".into());
    }
    let canonical_parent = fs::canonicalize(parent)
        .map_err(|error| format!("Unable to resolve the export destination parent: {error}"))?;
    if is_system_temp(&canonical_parent) {
        return Err(
            "The export destination cannot be inside the system cache/temp directory.".into(),
        );
    }
    Ok(canonical_parent.join(
        value
            .file_name()
            .ok_or_else(|| "The export destination has no file name.".to_string())?,
    ))
}

fn safe_component(value: &str, label: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || path_has_control(trimmed)
    {
        return Err(format!("{label} contains an unsafe path component."));
    }
    Ok(trimmed.to_string())
}

fn safe_join(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.trim().is_empty() {
        return Err("A relative path is required.".into());
    }
    let relative_path = Path::new(relative);
    if relative_path.is_absolute()
        || relative_path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("A managed path must be relative and cannot escape the Data Root.".into());
    }
    let root = fs::canonicalize(root)
        .map_err(|error| format!("Unable to resolve the Data Root for path validation: {error}"))?;
    let candidate = root.join(relative_path);
    if candidate.exists() {
        if fs::symlink_metadata(&candidate)
            .map_err(|error| format!("Unable to inspect managed path: {error}"))?
            .file_type()
            .is_symlink()
        {
            return Err("Symlinked managed paths are not allowed.".into());
        }
        let canonical = fs::canonicalize(&candidate)
            .map_err(|error| format!("Unable to resolve managed path: {error}"))?;
        if !path_is_within(&canonical, &root) {
            return Err("Managed path resolves outside the Data Root.".into());
        }
    } else if let Some(parent) = candidate.parent() {
        let existing_parent = parent
            .ancestors()
            .find(|ancestor| ancestor.exists())
            .ok_or_else(|| "Managed path has no existing parent.".to_string())?;
        let canonical_parent = fs::canonicalize(existing_parent)
            .map_err(|error| format!("Unable to resolve managed path parent: {error}"))?;
        if !path_is_within(&canonical_parent, &root) {
            return Err("Managed path parent resolves outside the Data Root.".into());
        }
    }
    Ok(candidate)
}

#[derive(Clone, Debug)]
pub struct RootPaths {
    pub root: PathBuf,
    pub locator_path: PathBuf,
}

impl RootPaths {
    pub fn database(&self) -> PathBuf {
        self.root.join("library.db")
    }

    pub fn backups(&self) -> PathBuf {
        self.root.join("backups")
    }

    pub fn assets(&self) -> PathBuf {
        self.root.join("assets")
    }

    pub fn tmp(&self) -> PathBuf {
        self.root.join("tmp")
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataRootLocator {
    pub schema_version: u32,
    pub root: String,
    pub health: String,
    #[serde(default)]
    pub root_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataRootManifest {
    pub schema_version: u32,
    pub root_type: String,
    #[serde(default)]
    pub root_id: String,
    #[serde(default)]
    pub managed_directories: Vec<String>,
    #[serde(default)]
    pub temp_directories: Vec<String>,
    #[serde(default)]
    pub durable_files: Vec<String>,
    #[serde(default)]
    pub prohibited_locations: Vec<String>,
    #[serde(default)]
    pub library_schema_version: i64,
    #[serde(default)]
    pub markdown_dialect_version: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub durable_file_hashes: BTreeMap<String, String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataRootStatus {
    pub state: String,
    pub root: Option<String>,
    pub locator_path: String,
    pub marker_valid: bool,
    pub manifest_valid: bool,
    pub safe_path_validation: bool,
    pub root_id: Option<String>,
    pub write_probe: bool,
    pub managed_directories: Vec<String>,
    pub temp_directories: Vec<String>,
    pub library_schema_version: i64,
    pub message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UninstallDataPreview {
    pub root: String,
    pub root_id: Option<String>,
    pub marker_valid: bool,
    pub manifest_valid: bool,
    pub total_bytes: u64,
    pub durable_bytes: u64,
    pub temporary_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UninstallDataCleanupResult {
    pub scope: String,
    pub root: String,
    pub durable_deleted: bool,
    pub locator_cleared: bool,
    pub removed_temporary_entries: Vec<String>,
    pub released_bytes: u64,
}

fn locator_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("data-root.json"))
        .map_err(|error| format!("Unable to resolve the application locator directory: {error}"))
}

fn root_marker_valid(root: &Path) -> bool {
    if root.is_dir()
        && fs::symlink_metadata(root)
            .map(|metadata| metadata.file_type().is_symlink())
            .unwrap_or(true)
    {
        return false;
    }
    let marker = root.join("root.marker");
    let Ok(contents) = fs::read_to_string(marker) else {
        return false;
    };
    let mut lines = contents.lines();
    lines.next() == Some("w-editor-data-root") && lines.any(|line| line.trim() == "schemaVersion=1")
}

fn read_manifest(root: &Path) -> Result<DataRootManifest, String> {
    let bytes = fs::read(root.join("manifest.json"))
        .map_err(|error| format!("Unable to read the Data Root manifest: {error}"))?;
    let manifest: DataRootManifest = serde_json::from_slice(&bytes)
        .map_err(|error| format!("The Data Root manifest is invalid: {error}"))?;
    if manifest.schema_version != DATA_ROOT_SCHEMA_VERSION
        || manifest.root_type != "w-editor-data-root"
        || !MANAGED_DIRECTORIES.iter().all(|directory| {
            manifest
                .managed_directories
                .iter()
                .any(|value| value == directory)
        })
    {
        return Err(
            "The Data Root manifest schema or managed directory set is unsupported.".into(),
        );
    }
    Ok(manifest)
}

fn manifest_is_valid(root: &Path) -> bool {
    read_manifest(root).is_ok() && managed_paths_are_safe(root)
}

fn managed_paths_are_safe(root: &Path) -> bool {
    let mut relatives = MANAGED_DIRECTORIES
        .iter()
        .map(|value| (*value).to_string())
        .collect::<Vec<_>>();
    relatives.extend(TEMP_TYPES.iter().map(|value| format!("tmp/{value}")));
    relatives.iter().all(|relative| {
        let path = root.join(relative);
        !path.exists() || safe_join(root, relative).is_ok()
    })
}

fn manifest_root_id(root: &Path) -> Option<String> {
    read_manifest(root)
        .ok()
        .and_then(|manifest| (!manifest.root_id.trim().is_empty()).then_some(manifest.root_id))
}

fn build_manifest(root_id: String, created_at: String) -> DataRootManifest {
    DataRootManifest {
        schema_version: DATA_ROOT_SCHEMA_VERSION,
        root_type: "w-editor-data-root".into(),
        root_id,
        managed_directories: MANAGED_DIRECTORIES
            .iter()
            .map(|value| (*value).into())
            .collect(),
        temp_directories: TEMP_TYPES
            .iter()
            .filter(|value| **value != "lock")
            .map(|value| format!("tmp/{value}"))
            .collect(),
        durable_files: vec![
            "library.db".into(),
            "root.marker".into(),
            "manifest.json".into(),
            "assets/**".into(),
            "backups/**".into(),
            "logs/**".into(),
            "settings/**".into(),
        ],
        prohibited_locations: vec![
            "system-cache".into(),
            "system-temp".into(),
            "unconfigured-path".into(),
        ],
        library_schema_version: LIBRARY_SCHEMA_VERSION,
        markdown_dialect_version: MARKDOWN_DIALECT_VERSION.into(),
        created_at: created_at.clone(),
        updated_at: created_at,
        durable_file_hashes: BTreeMap::new(),
    }
}

fn atomic_write(path: &Path, bytes: &[u8], label: &str) -> Result<(), String> {
    fail_if_injected("disk-full")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create {label} parent directory: {error}"))?;
    }
    if path.exists()
        && fs::symlink_metadata(path)
            .map_err(|error| format!("Unable to inspect {label}: {error}"))?
            .file_type()
            .is_symlink()
    {
        return Err(format!("Refusing to replace a symlinked {label}."));
    }
    let parent = path
        .parent()
        .ok_or_else(|| format!("The {label} path has no parent directory."))?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| format!("The {label} path has no valid file name."))?;
    let temporary = parent.join(format!(".{file_name}.tmp-{}", new_id("write")));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| format!("Unable to create temporary {label}: {error}"))?;
    if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("Unable to write temporary {label}: {error}"));
    }

    let backup = parent.join(format!(".{file_name}.bak"));
    let had_original = path.exists();
    if had_original {
        let _ = fs::remove_file(&backup);
        if let Err(error) = move_file(path, &backup) {
            let _ = fs::remove_file(&temporary);
            return Err(format!("Unable to stage the previous {label}: {error}"));
        }
    }
    match move_file(&temporary, path) {
        Ok(()) => {
            let _ = fs::remove_file(&backup);
            Ok(())
        }
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            if had_original {
                let _ = move_file(&backup, path);
            }
            Err(format!(
                "Unable to activate {label} from {} to {}: {error}",
                root_string(&temporary),
                root_string(path)
            ))
        }
    }
}

fn write_root_metadata(root: &Path) -> Result<(), String> {
    let root_id = manifest_root_id(root).unwrap_or_else(|| new_id("root"));
    let created_at = read_manifest(root)
        .ok()
        .map(|manifest| manifest.created_at)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(now_string);
    atomic_write(
        &root.join("root.marker"),
        format!("w-editor-data-root\nschemaVersion={DATA_ROOT_SCHEMA_VERSION}\nrootId={root_id}\n")
            .as_bytes(),
        "Data Root marker",
    )?;
    let manifest = build_manifest(root_id, created_at);
    let bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|error| format!("Unable to encode the Data Root manifest: {error}"))?;
    atomic_write(&root.join("manifest.json"), &bytes, "Data Root manifest")
}

fn ensure_managed_directories(root: &Path) -> Result<(), String> {
    fail_if_injected("permission")?;
    if root.exists()
        && fs::symlink_metadata(root)
            .map_err(|error| format!("Unable to inspect the Data Root: {error}"))?
            .file_type()
            .is_symlink()
    {
        return Err("A symlink cannot be used as the Data Root.".into());
    }
    fs::create_dir_all(root).map_err(|error| format!("Unable to create the Data Root: {error}"))?;
    let directories = [
        "assets",
        "backups",
        "backups/blobs",
        "backups/manifests",
        "backups/snapshots",
        "logs",
        "settings",
        "tmp/webview",
        "tmp/extract",
        "tmp/update",
        "tmp/migration",
        "tmp/restore",
        "tmp/asset",
        "tmp/backup",
        "tmp/lock",
    ];
    for directory in directories {
        fs::create_dir_all(root.join(directory)).map_err(|error| {
            format!("Unable to create managed Data Root directory {directory}: {error}")
        })?;
    }
    Ok(())
}

fn write_probe(root: &Path) -> Result<(), String> {
    fail_if_injected("permission")?;
    let directory = safe_join(root, "tmp/webview")?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Data Root write probe cannot create tmp/webview: {error}"))?;
    let probe = directory.join(format!(".write-probe-{}", new_id("probe")));
    atomic_write(&probe, b"w-editor-write-probe\n", "Data Root write probe")?;
    fs::remove_file(&probe)
        .map_err(|error| format!("Data Root write probe cleanup failed: {error}"))?;
    Ok(())
}

fn write_locator(
    path: &Path,
    root: &Path,
    health: &str,
    root_id: Option<String>,
) -> Result<(), String> {
    fail_if_injected("permission")?;
    let parent = path
        .parent()
        .ok_or_else(|| "The application locator path has no parent directory.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Unable to create the application locator directory: {error}"))?;
    let locator = DataRootLocator {
        schema_version: DATA_ROOT_SCHEMA_VERSION,
        root: root_string(root),
        health: health.to_string(),
        root_id,
    };
    let bytes = serde_json::to_vec_pretty(&locator)
        .map_err(|error| format!("Unable to encode the Data Root locator: {error}"))?;
    atomic_write(path, &bytes, "Data Root locator")
}

fn read_locator(path: &Path) -> Result<DataRootLocator, String> {
    let read_path = if path.is_file() {
        path.to_path_buf()
    } else {
        let backup = path
            .parent()
            .map(|parent| {
                parent.join(format!(
                    ".{}.bak",
                    path.file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or("locator")
                ))
            })
            .ok_or_else(|| "The Data Root locator has no parent directory.".to_string())?;
        if !backup.is_file() {
            return Err("The Data Root locator is missing.".into());
        }
        move_file(&backup, path).map_err(|error| {
            format!(
                "The Data Root locator is missing and its atomic backup could not be recovered: {error}"
            )
        })?;
        path.to_path_buf()
    };
    let bytes = fs::read(&read_path)
        .map_err(|error| format!("Unable to read the Data Root locator: {error}"))?;
    let locator: DataRootLocator = serde_json::from_slice(&bytes)
        .map_err(|error| format!("The Data Root locator is invalid: {error}"))?;
    if locator.schema_version != DATA_ROOT_SCHEMA_VERSION
        || locator.root.trim().is_empty()
        || path_has_control(&locator.root)
    {
        return Err("The Data Root locator schema or root is unsupported.".into());
    }
    let root = absolute_path(&locator.root, "The Data Root locator root")?;
    if root.exists() {
        validate_data_root_path(&root)?;
    } else if is_system_temp(&root) {
        return Err("The Data Root locator points into the system cache/temp directory.".into());
    }
    Ok(DataRootLocator {
        root: root_string(&root),
        ..locator
    })
}

fn status_for_root(
    locator_path: &Path,
    root: Option<PathBuf>,
    root_id: Option<String>,
    message: Option<String>,
) -> DataRootStatus {
    let root_string_value = root.as_deref().map(root_string);
    let marker_valid = root.as_deref().is_some_and(root_marker_valid);
    let manifest_valid = root.as_deref().is_some_and(manifest_is_valid);
    let safe_path_validation = marker_valid && manifest_valid;
    let managed_directories = root
        .as_deref()
        .map(|path| {
            MANAGED_DIRECTORIES
                .iter()
                .map(|directory| root_string(&path.join(directory)))
                .collect()
        })
        .unwrap_or_default();
    let temp_directories = root
        .as_deref()
        .map(|path| {
            TEMP_TYPES
                .iter()
                .map(|directory| root_string(&path.join("tmp").join(directory)))
                .collect()
        })
        .unwrap_or_default();
    let write_probe = safe_path_validation
        && root
            .as_deref()
            .is_some_and(|path| write_probe(path).is_ok());
    let library_schema_version = root
        .as_deref()
        .map(database_schema_version)
        .and_then(Result::ok)
        .flatten()
        .unwrap_or_default();
    let state = if root.is_none() {
        "unconfigured"
    } else if !safe_path_validation {
        "unavailable"
    } else if write_probe {
        "ready"
    } else {
        "read_only"
    };
    DataRootStatus {
        state: state.into(),
        root: root_string_value,
        locator_path: root_string(locator_path),
        marker_valid,
        manifest_valid,
        safe_path_validation,
        root_id: root_id.or_else(|| root.as_deref().and_then(manifest_root_id)),
        write_probe,
        managed_directories,
        temp_directories,
        library_schema_version,
        message: message.or_else(|| {
            (state == "read_only").then(|| {
                "The configured Data Root failed its write probe; choose another root or export recovery data.".into()
            })
        }),
    }
}

pub fn data_root_status(app: &tauri::AppHandle) -> Result<DataRootStatus, String> {
    let locator = locator_path(app)?;
    let locator_backup = locator
        .parent()
        .map(|parent| parent.join(".data-root.json.bak"));
    if !locator.is_file() && !locator_backup.as_deref().is_some_and(Path::is_file) {
        return Ok(status_for_root(&locator, None, None, None));
    }
    match read_locator(&locator) {
        Ok(locator_value) => {
            let root = PathBuf::from(locator_value.root);
            let message = if !root.exists() {
                Some("The configured Data Root is unavailable; select it again or choose another root.".into())
            } else if !root_marker_valid(&root) || !manifest_is_valid(&root) {
                Some("The configured Data Root marker or manifest is invalid; recovery/export is required.".into())
            } else {
                None
            };
            Ok(status_for_root(
                &locator,
                Some(root),
                locator_value.root_id,
                message,
            ))
        }
        Err(error) => Ok(status_for_root(&locator, None, None, Some(error))),
    }
}

fn managed_root(parent: &str) -> Result<PathBuf, String> {
    let parent = absolute_path(parent, "The Data Root parent")?;
    if is_system_temp(&parent) {
        return Err(
            "The Data Root parent cannot be inside the system cache/temp directory.".into(),
        );
    }
    if parent.exists() && !parent.is_dir() {
        return Err("The selected Data Root parent is not a directory.".into());
    }
    fs::create_dir_all(&parent)
        .map_err(|error| format!("Unable to create the selected Data Root parent: {error}"))?;
    let parent = fs::canonicalize(&parent)
        .map_err(|error| format!("Unable to resolve the selected Data Root parent: {error}"))?;
    let root = parent.join("W-EditorData");
    validate_data_root_path(&root)?;
    Ok(root)
}

pub fn select_data_root(
    app: &tauri::AppHandle,
    parent_path: &str,
) -> Result<DataRootStatus, String> {
    let root = managed_root(parent_path)?;
    if root.exists() && !root_marker_valid(&root) && !manifest_is_valid(&root) {
        let has_entries = fs::read_dir(&root)
            .map_err(|error| format!("Unable to inspect the selected Data Root: {error}"))?
            .next()
            .is_some();
        if has_entries {
            return Err("The selected W-EditorData directory is not an empty managed root.".into());
        }
    }
    ensure_managed_directories(&root)?;
    write_root_metadata(&root)?;
    write_probe(&root)?;
    let locator = locator_path(app)?;
    let root_id = manifest_root_id(&root);
    write_locator(&locator, &root, "ready", root_id.clone())?;
    Ok(status_for_root(&locator, Some(root), root_id, None))
}

pub fn root_paths(app: &tauri::AppHandle, require_write: bool) -> Result<RootPaths, String> {
    if require_write {
        fail_if_injected("permission")?;
    }
    let locator = locator_path(app)?;
    if !locator.is_file() {
        return Err(
            "DATA_ROOT_UNCONFIGURED: choose a Data Root before writing Library data.".into(),
        );
    }
    let locator_value = read_locator(&locator)?;
    let root = PathBuf::from(locator_value.root);
    if !root.exists() {
        return Err("DATA_ROOT_UNAVAILABLE: the configured Data Root is missing.".into());
    }
    if fs::symlink_metadata(&root)
        .map_err(|error| format!("Unable to inspect the configured Data Root: {error}"))?
        .file_type()
        .is_symlink()
    {
        return Err("DATA_ROOT_INVALID: a symlink cannot be used as the Data Root.".into());
    }
    if !root_marker_valid(&root) || !manifest_is_valid(&root) {
        return Err(
            "DATA_ROOT_INVALID: the configured Data Root marker or manifest is invalid.".into(),
        );
    }
    let root = fs::canonicalize(&root)
        .map_err(|error| format!("Unable to resolve the configured Data Root: {error}"))?;
    validate_data_root_path(&root)?;
    if require_write {
        write_probe(&root).map_err(|error| format!("DATA_ROOT_READ_ONLY: {error}"))?;
    }
    Ok(RootPaths {
        root,
        locator_path: locator,
    })
}

fn recovery_root_paths(app: &tauri::AppHandle) -> Result<RootPaths, String> {
    let locator = locator_path(app)?;
    if !locator.is_file() {
        return Err("DATA_ROOT_UNCONFIGURED: no Data Root locator is available.".into());
    }
    let locator_value = read_locator(&locator)?;
    let root = PathBuf::from(locator_value.root);
    if !root.is_dir() {
        return Err("DATA_ROOT_UNAVAILABLE: the configured Data Root is missing.".into());
    }
    if fs::symlink_metadata(&root)
        .map_err(|error| format!("Unable to inspect the recovery Data Root: {error}"))?
        .file_type()
        .is_symlink()
    {
        return Err(
            "DATA_ROOT_INVALID: a symlink cannot be used as the recovery Data Root.".into(),
        );
    }
    Ok(RootPaths {
        root: fs::canonicalize(root)
            .map_err(|error| format!("Unable to resolve the recovery Data Root: {error}"))?,
        locator_path: locator,
    })
}

pub struct WriteBarrier {
    path: PathBuf,
    _file: File,
}

impl Drop for WriteBarrier {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

pub fn acquire_write_barrier(root: &Path, operation: &str) -> Result<WriteBarrier, String> {
    fail_if_injected("write-barrier")?;
    let operation = safe_component(operation, "The write-barrier operation")?;
    let directory = safe_join(root, "tmp/lock")?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Unable to create the write-barrier directory: {error}"))?;
    let path = directory.join("write.lock");
    let mut file = match OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            return Err(
                "DATA_ROOT_BUSY: another instance or data operation holds the write barrier."
                    .into(),
            );
        }
        Err(error) => {
            return Err(format!(
                "Unable to acquire the Data Root write barrier: {error}"
            ));
        }
    };
    let marker = json!({
        "operation": operation,
        "pid": std::process::id(),
        "createdAt": now_string(),
    });
    file.write_all(marker.to_string().as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|error| {
            let _ = fs::remove_file(&path);
            format!("Unable to initialize the Data Root write barrier: {error}")
        })?;
    Ok(WriteBarrier { path, _file: file })
}

pub fn data_root_manifest(app: &tauri::AppHandle) -> Result<DataRootManifest, String> {
    let paths = root_paths(app, false)?;
    read_manifest(&paths.root)
}

pub fn data_root_health_check(app: &tauri::AppHandle) -> Result<DataRootStatus, String> {
    data_root_status(app)
}

pub fn uninstall_data_preview(app: &tauri::AppHandle) -> Result<UninstallDataPreview, String> {
    let paths = root_paths(app, false)?;
    if !root_marker_valid(&paths.root) || !manifest_is_valid(&paths.root) {
        return Err(
            "UNINSTALL_DATA_ROOT_INVALID: the Data Root marker or manifest is invalid.".into(),
        );
    }
    let total_bytes = directory_size(&paths.root, true)?;
    let durable_bytes = directory_size(&paths.root, false)?;
    let temporary_bytes = directory_size(&paths.tmp(), true)?;
    Ok(UninstallDataPreview {
        root: root_string(&paths.root),
        root_id: manifest_root_id(&paths.root),
        marker_valid: true,
        manifest_valid: true,
        total_bytes,
        durable_bytes,
        temporary_bytes,
    })
}

pub fn uninstall_data_cleanup(
    app: &tauri::AppHandle,
    scope: &str,
) -> Result<UninstallDataCleanupResult, String> {
    if !matches!(scope, "keep" | "tmp" | "durable") {
        return Err("UNINSTALL_SCOPE_INVALID: choose keep, tmp, or durable.".into());
    }
    let preview = uninstall_data_preview(app)?;
    if scope == "keep" {
        return Ok(UninstallDataCleanupResult {
            scope: scope.into(),
            root: preview.root,
            durable_deleted: false,
            locator_cleared: false,
            removed_temporary_entries: Vec::new(),
            released_bytes: 0,
        });
    }
    if scope == "tmp" {
        let temporary = cleanup_temp_entries(app, true)?;
        return Ok(UninstallDataCleanupResult {
            scope: scope.into(),
            root: preview.root,
            durable_deleted: false,
            locator_cleared: false,
            removed_temporary_entries: temporary.removed,
            released_bytes: temporary.released_bytes,
        });
    }

    let paths = root_paths(app, true)?;
    if !root_marker_valid(&paths.root) || !manifest_is_valid(&paths.root) {
        return Err(
            "UNINSTALL_DATA_ROOT_INVALID: the Data Root marker or manifest is invalid.".into(),
        );
    }
    let root = paths.root.clone();
    let locator = paths.locator_path.clone();
    let locator_bytes = fs::read(&locator).map_err(|error| {
        format!("Unable to read the Data Root locator before deletion: {error}")
    })?;
    let barrier = acquire_write_barrier(&root, "uninstall-durable")?;
    if !root_marker_valid(&root) || !manifest_is_valid(&root) {
        return Err(
            "UNINSTALL_DATA_ROOT_INVALID: the Data Root changed during deletion preflight.".into(),
        );
    }
    // Windows cannot remove the root while the marker lock file is open. The
    // single-instance helper has completed the final validation, so release the
    // barrier immediately before the intentionally user-confirmed root removal.
    drop(barrier);
    fs::remove_file(&locator).map_err(|error| {
        format!("UNINSTALL_LOCATOR_CLEAR_FAILED: durable data was not deleted because the locator could not be cleared: {error}")
    })?;
    if let Err(error) = fs::remove_dir_all(&root) {
        let restore = atomic_write(&locator, &locator_bytes, "Data Root locator recovery");
        return Err(match restore {
            Ok(()) => format!(
                "UNINSTALL_DATA_DELETE_FAILED: Data Root was retained and locator restored: {error}"
            ),
            Err(restore_error) => format!(
                "UNINSTALL_DATA_DELETE_FAILED: Data Root deletion failed and locator recovery also failed: {error}; {restore_error}"
            ),
        });
    }
    Ok(UninstallDataCleanupResult {
        scope: scope.into(),
        root: root_string(&root),
        durable_deleted: true,
        locator_cleared: true,
        removed_temporary_entries: Vec::new(),
        released_bytes: preview.total_bytes,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySaveResult {
    pub database_path: String,
    pub document_id: String,
    pub markdown: String,
    pub revision: i64,
    pub version_id: String,
    pub kind: String,
    pub protected: bool,
    pub draft_cleared: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryDocumentResult {
    pub database_path: String,
    pub document_id: String,
    pub title: String,
    pub markdown: String,
    pub revision: i64,
    pub seed_key: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySchemaResult {
    pub database_path: String,
    pub schema_version: i64,
    pub current_schema_version: i64,
    pub foreign_keys: bool,
    pub journal_mode: Option<String>,
    pub tables: Vec<String>,
    pub mode: String,
    pub read_only: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArticleVersionResult {
    pub id: String,
    pub article_id: String,
    pub revision: i64,
    pub markdown: String,
    pub kind: String,
    pub label: Option<String>,
    pub protected: bool,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionCleanupResult {
    pub document_id: String,
    pub removed_version_ids: Vec<String>,
    pub removed_count: usize,
    pub audit_event_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryDraftResult {
    pub database_path: String,
    pub document_id: String,
    pub base_revision: i64,
    pub markdown: String,
    pub updated_at: String,
    pub expires_at: String,
    pub state: String,
    pub newer_than_article: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStateResult {
    pub database_path: String,
    pub document_id: String,
    pub mode: String,
    pub source_anchor: Value,
    pub selection: Value,
    pub scroll: Value,
    pub sidebar: Value,
    pub updated_at: String,
    pub position_fallback: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsResult {
    pub database_path: String,
    pub schema_version: i64,
    pub product_defaults: Value,
    pub distribution_defaults: Value,
    pub user_overrides: Value,
    pub resolved: Value,
    pub incompatible_keys: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveVersionInput {
    pub document_id: String,
    pub title: String,
    pub markdown: String,
    pub requested_revision: Option<i64>,
    pub kind: Option<String>,
    pub label: Option<String>,
    pub protected: Option<bool>,
    pub seed_key: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArticleCreateInput {
    pub document_id: Option<String>,
    pub title: String,
    pub markdown: String,
    pub seed_key: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStateInput {
    pub document_id: String,
    pub mode: String,
    pub source_anchor: Option<Value>,
    pub selection: Option<Value>,
    pub scroll: Option<Value>,
    pub sidebar: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsOverrideInput {
    pub key: String,
    pub value: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryDraftInput {
    pub document_id: String,
    pub base_revision: i64,
    pub markdown: String,
}

pub struct LibraryHandle {
    pub connection: Connection,
    pub paths: RootPaths,
    pub _barrier: Option<WriteBarrier>,
}

fn table_names(connection: &Connection) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .map_err(|error| format!("Unable to read the Library table catalog: {error}"))?;
    statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("Unable to enumerate Library tables: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Unable to collect Library table catalog: {error}"))
}

fn table_exists(connection: &Connection, table: &str) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
            params![table],
            |row| row.get::<_, i64>(0),
        )
        .map(|value| value == 1)
        .map_err(|error| format!("Unable to inspect the Library schema: {error}"))
}

fn table_columns(connection: &Connection, table: &str) -> Result<HashSet<String>, String> {
    let sql = format!("PRAGMA table_info({})", quote_identifier(table));
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| format!("Unable to inspect Library table {table}: {error}"))?;
    statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("Unable to enumerate Library table {table}: {error}"))?
        .collect::<Result<HashSet<_>, _>>()
        .map_err(|error| format!("Unable to collect Library table {table}: {error}"))
}

fn quote_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn schema_meta_version(connection: &Connection) -> Result<Option<i64>, String> {
    if !table_exists(connection, "schema_meta")? {
        return Ok(None);
    }
    let value = connection
        .query_row(
            "SELECT value FROM schema_meta WHERE key = 'schemaVersion'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("Unable to read the Library schema version: {error}"))?;
    match value {
        Some(value) => value
            .parse::<i64>()
            .map(Some)
            .map_err(|error| format!("The Library schema version is invalid: {error}")),
        None => Ok(None),
    }
}

fn pragma_user_version(connection: &Connection) -> Result<i64, String> {
    connection
        .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
        .map_err(|error| format!("Unable to read SQLite user_version: {error}"))
}

fn database_schema_version(root: &Path) -> Result<Option<i64>, String> {
    let database = root.join("library.db");
    if !database.is_file() {
        return Ok(None);
    }
    validate_wal_sidecar(&database)?;
    let connection = Connection::open_with_flags(&database, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("Unable to inspect the Library database: {error}"))?;
    let version = schema_meta_version(&connection)?.or_else(|| {
        pragma_user_version(&connection)
            .ok()
            .filter(|value| *value > 0)
    });
    Ok(version)
}

fn validate_wal_sidecar(database: &Path) -> Result<(), String> {
    let wal = PathBuf::from(format!("{}-wal", root_string(database)));
    let metadata = match fs::metadata(&wal) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("Unable to inspect SQLite WAL sidecar: {error}")),
    };
    if metadata.len() == 0 {
        return Ok(());
    }
    if metadata.len() < 32 {
        return Err("LIBRARY_CORRUPT: SQLite WAL sidecar is truncated.".into());
    }
    let mut file =
        File::open(&wal).map_err(|error| format!("Unable to read SQLite WAL sidecar: {error}"))?;
    let mut header = [0_u8; 32];
    file.read_exact(&mut header)
        .map_err(|error| format!("Unable to read SQLite WAL header: {error}"))?;
    let magic = u32::from_be_bytes([header[0], header[1], header[2], header[3]]);
    if magic != 0x377f0682 && magic != 0x377f0683 {
        return Err("LIBRARY_CORRUPT: SQLite WAL sidecar has an invalid header.".into());
    }
    let page_size = u32::from_be_bytes([header[8], header[9], header[10], header[11]]);
    if !(512..=65_536).contains(&page_size) || !page_size.is_power_of_two() {
        return Err("LIBRARY_CORRUPT: SQLite WAL sidecar has an invalid page size.".into());
    }
    let frame_size = u64::from(page_size) + 24;
    if (metadata.len() - 32) % frame_size != 0 {
        return Err("LIBRARY_CORRUPT: SQLite WAL sidecar has an incomplete frame.".into());
    }
    Ok(())
}

fn configure_read(connection: &Connection) -> Result<(), String> {
    connection
        .busy_timeout(Duration::from_millis(2500))
        .map_err(|error| format!("Unable to configure the Library busy timeout: {error}"))?;
    connection
        .pragma_update(None, "foreign_keys", true)
        .map_err(|error| format!("Unable to enable Library foreign keys: {error}"))?;
    Ok(())
}

fn configure_write(connection: &Connection) -> Result<(), String> {
    configure_read(connection)?;
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(|error| format!("Unable to enable the Library WAL journal: {error}"))?;
    connection
        .pragma_update(None, "synchronous", "NORMAL")
        .map_err(|error| format!("Unable to configure Library synchronous mode: {error}"))?;
    Ok(())
}

const CREATE_SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  markdown TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  seed_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS article_versions (
  id TEXT PRIMARY KEY NOT NULL,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  markdown TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('manual-save', 'publish', 'import', 'seed-reset')),
  label TEXT,
  protected INTEGER NOT NULL DEFAULT 0 CHECK (protected IN (0, 1)),
  created_at TEXT NOT NULL,
  UNIQUE(article_id, revision)
);
CREATE TABLE IF NOT EXISTS recovery_drafts (
  article_id TEXT PRIMARY KEY NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
  markdown TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'merged', 'discarded'))
);
CREATE TABLE IF NOT EXISTS workspace_state (
  article_id TEXT PRIMARY KEY NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  source_anchor_json TEXT NOT NULL,
  selection_json TEXT NOT NULL,
  scroll_json TEXT NOT NULL,
  sidebar_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assets (
  hash TEXT PRIMARY KEY NOT NULL,
  media_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0),
  storage_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS article_asset_refs (
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  asset_hash TEXT NOT NULL REFERENCES assets(hash) ON DELETE RESTRICT,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(article_id, asset_hash, role)
);
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  event_type TEXT NOT NULL,
  document_id TEXT,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_articles_updated_at ON articles(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_versions_article_revision ON article_versions(article_id, revision DESC);
CREATE INDEX IF NOT EXISTS idx_versions_article_kind ON article_versions(article_id, kind, protected, revision DESC);
CREATE INDEX IF NOT EXISTS idx_drafts_expiry ON recovery_drafts(expires_at);
INSERT INTO schema_meta(key, value) VALUES ('schemaVersion', '2')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
INSERT INTO schema_meta(key, value) VALUES ('schemaName', 'w-editor-library')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
PRAGMA user_version = 2;
"#;

fn create_schema(connection: &mut Connection) -> Result<(), String> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Unable to begin Library schema transaction: {error}"))?;
    transaction
        .execute_batch(CREATE_SCHEMA_SQL)
        .map_err(|error| format!("Library schema creation rolled back: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Unable to commit Library schema creation: {error}"))
}

fn migrate_schema(connection: &mut Connection, from: i64) -> Result<(), String> {
    if from >= LIBRARY_SCHEMA_VERSION {
        return Ok(());
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Unable to begin Library migration transaction: {error}"))?;
    let result = (|| {
        if from == 1 {
            transaction.execute_batch(
                "ALTER TABLE articles ADD COLUMN seed_key TEXT;
                 ALTER TABLE articles ADD COLUMN deleted_at TEXT;
                 ALTER TABLE article_versions ADD COLUMN label TEXT;
                 ALTER TABLE article_versions ADD COLUMN protected INTEGER NOT NULL DEFAULT 0;
                 ALTER TABLE recovery_drafts ADD COLUMN expires_at TEXT NOT NULL DEFAULT '0';
                 ALTER TABLE recovery_drafts ADD COLUMN state TEXT NOT NULL DEFAULT 'active';
                 UPDATE recovery_drafts SET expires_at = CAST(CAST(updated_at AS INTEGER) + 2592000000 AS TEXT) WHERE expires_at = '0';
                 "
            ).map_err(|error| format!("Library schema v1→v2 migration failed: {error}"))?;
            transaction.execute_batch(
                "CREATE TABLE IF NOT EXISTS workspace_state (
                   article_id TEXT PRIMARY KEY NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
                   mode TEXT NOT NULL,
                   source_anchor_json TEXT NOT NULL,
                   selection_json TEXT NOT NULL,
                   scroll_json TEXT NOT NULL,
                   sidebar_json TEXT NOT NULL,
                   updated_at TEXT NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS settings (
                   key TEXT PRIMARY KEY NOT NULL,
                   value_json TEXT NOT NULL,
                   schema_version INTEGER NOT NULL,
                   updated_at TEXT NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS assets (
                   hash TEXT PRIMARY KEY NOT NULL,
                   media_type TEXT NOT NULL,
                   size INTEGER NOT NULL CHECK (size >= 0),
                   storage_key TEXT NOT NULL UNIQUE,
                   created_at TEXT NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS article_asset_refs (
                   article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
                   asset_hash TEXT NOT NULL REFERENCES assets(hash) ON DELETE RESTRICT,
                   role TEXT NOT NULL,
                   created_at TEXT NOT NULL,
                   PRIMARY KEY(article_id, asset_hash, role)
                 );
                 CREATE TABLE IF NOT EXISTS audit_events (
                   id TEXT PRIMARY KEY NOT NULL,
                   event_type TEXT NOT NULL,
                   document_id TEXT,
                   details_json TEXT NOT NULL,
                   created_at TEXT NOT NULL
                 );
                 CREATE INDEX IF NOT EXISTS idx_articles_updated_at ON articles(updated_at DESC);
                 CREATE INDEX IF NOT EXISTS idx_versions_article_revision ON article_versions(article_id, revision DESC);
                 CREATE INDEX IF NOT EXISTS idx_versions_article_kind ON article_versions(article_id, kind, protected, revision DESC);
                 CREATE INDEX IF NOT EXISTS idx_drafts_expiry ON recovery_drafts(expires_at);
                 UPDATE schema_meta SET value = '2' WHERE key = 'schemaVersion';
                 INSERT INTO schema_meta(key, value) VALUES ('schemaName', 'w-editor-library')
                   ON CONFLICT(key) DO UPDATE SET value = excluded.value;
                 PRAGMA user_version = 2;"
            ).map_err(|error| format!("Library schema v1→v2 table migration failed: {error}"))?;
        } else {
            return Err(format!(
                "No forward migration is registered from Library schema {from}."
            ));
        }
        Ok::<(), String>(())
    })();
    if let Err(error) = result {
        drop(transaction);
        return Err(format!(
            "Library migration transaction rolled back: {error}"
        ));
    }
    transaction
        .commit()
        .map_err(|error| format!("Library migration transaction rolled back at commit: {error}"))
}

fn validate_schema(connection: &Connection) -> Result<(), String> {
    let expected: [(&str, &[&str]); 10] = [
        ("schema_meta", &["key", "value"]),
        (
            "articles",
            &[
                "id",
                "title",
                "markdown",
                "revision",
                "seed_key",
                "created_at",
                "updated_at",
                "deleted_at",
            ],
        ),
        (
            "article_versions",
            &[
                "id",
                "article_id",
                "revision",
                "markdown",
                "kind",
                "label",
                "protected",
                "created_at",
            ],
        ),
        (
            "recovery_drafts",
            &[
                "article_id",
                "base_revision",
                "markdown",
                "updated_at",
                "expires_at",
                "state",
            ],
        ),
        (
            "workspace_state",
            &[
                "article_id",
                "mode",
                "source_anchor_json",
                "selection_json",
                "scroll_json",
                "sidebar_json",
                "updated_at",
            ],
        ),
        (
            "settings",
            &["key", "value_json", "schema_version", "updated_at"],
        ),
        (
            "assets",
            &["hash", "media_type", "size", "storage_key", "created_at"],
        ),
        (
            "article_asset_refs",
            &["article_id", "asset_hash", "role", "created_at"],
        ),
        (
            "audit_events",
            &[
                "id",
                "event_type",
                "document_id",
                "details_json",
                "created_at",
            ],
        ),
        ("sqlite_sequence", &[]),
    ];
    for (table, columns) in expected {
        if table == "sqlite_sequence" {
            continue;
        }
        if !table_exists(connection, table)? {
            return Err(format!("Library schema is missing required table {table}."));
        }
        let actual = table_columns(connection, table)?;
        if columns.iter().any(|column| !actual.contains(*column)) {
            return Err(format!(
                "Library schema table {table} is missing a required column."
            ));
        }
    }
    let foreign_keys = connection
        .query_row("PRAGMA foreign_keys", [], |row| row.get::<_, i64>(0))
        .map_err(|error| format!("Unable to read Library foreign-key state: {error}"))?;
    if foreign_keys != 1 {
        return Err("Library schema requires SQLite foreign_keys=ON.".into());
    }
    Ok(())
}

fn validate_legacy_schema(connection: &Connection) -> Result<(), String> {
    for table in [
        "schema_meta",
        "articles",
        "article_versions",
        "recovery_drafts",
    ] {
        if !table_exists(connection, table)? {
            return Err(format!(
                "Legacy Library schema is missing required table {table}."
            ));
        }
    }
    let article_columns = table_columns(connection, "articles")?;
    let version_columns = table_columns(connection, "article_versions")?;
    let draft_columns = table_columns(connection, "recovery_drafts")?;
    if !["id", "title", "markdown", "revision"]
        .iter()
        .all(|column| article_columns.contains(*column))
        || !["id", "article_id", "revision", "markdown", "kind"]
            .iter()
            .all(|column| version_columns.contains(*column))
        || !["article_id", "base_revision", "markdown"]
            .iter()
            .all(|column| draft_columns.contains(*column))
    {
        return Err("Legacy Library schema is incomplete.".into());
    }
    Ok(())
}

fn validate_supported_schema(connection: &Connection) -> Result<(), String> {
    let version = schema_meta_version(connection)?
        .or_else(|| {
            pragma_user_version(connection)
                .ok()
                .filter(|value| *value > 0)
        })
        .ok_or_else(|| "Library schema version is missing.".to_string())?;
    if version > LIBRARY_SCHEMA_VERSION {
        return Err(format!(
            "Library schema {version} is newer than supported schema {LIBRARY_SCHEMA_VERSION}."
        ));
    }
    if version == LIBRARY_SCHEMA_VERSION {
        validate_schema(connection)
    } else {
        validate_legacy_schema(connection)
    }
}

fn schema_state(connection: &Connection) -> Result<(Option<i64>, Vec<String>), String> {
    let tables = table_names(connection)?;
    if tables.is_empty() {
        return Ok((None, tables));
    }
    let version = schema_meta_version(connection)?.or_else(|| {
        pragma_user_version(connection)
            .ok()
            .filter(|value| *value > 0)
    });
    Ok((version, tables))
}

fn integrity_check(connection: &Connection) -> Result<(), String> {
    let result = connection
        .query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
        .map_err(|error| format!("SQLite integrity_check failed: {error}"))?;
    if !result.eq_ignore_ascii_case("ok") {
        return Err(format!("SQLite integrity_check reported: {result}"));
    }
    Ok(())
}

fn prepare_write_library(paths: &RootPaths, connection: &mut Connection) -> Result<(), String> {
    let (version, tables) = schema_state(connection)?;
    match version {
        None if tables.is_empty() => create_schema(connection)?,
        None => {
            return Err(
                "LIBRARY_UNKNOWN_SCHEMA: the database has no readable schema version.".into(),
            );
        }
        Some(version) if version > LIBRARY_SCHEMA_VERSION => {
            return Err(format!(
                "LIBRARY_FUTURE_SCHEMA: schema {version} is newer than supported schema {LIBRARY_SCHEMA_VERSION}; opened in read-only recovery mode only."
            ));
        }
        Some(version) if version < LIBRARY_SCHEMA_VERSION => {
            create_migration_backup(paths, connection, version)?;
            migrate_schema(connection, version)?;
        }
        Some(_) => {}
    }
    let final_version = schema_meta_version(connection)?.unwrap_or_default();
    if final_version != LIBRARY_SCHEMA_VERSION {
        return Err(format!(
            "LIBRARY_SCHEMA_UNSUPPORTED: expected schema {LIBRARY_SCHEMA_VERSION}, found {final_version}."
        ));
    }
    validate_schema(connection)?;
    integrity_check(connection)
}

pub fn open_library_write(app: &tauri::AppHandle) -> Result<LibraryHandle, String> {
    fail_if_injected("database")?;
    fail_if_injected("disk-full")?;
    let paths = root_paths(app, true)?;
    let barrier = acquire_write_barrier(&paths.root, "library")?;
    let database = paths.database();
    validate_wal_sidecar(&database)?;
    if database.is_file()
        && fs::metadata(&database)
            .map(|metadata| metadata.len() > 0)
            .unwrap_or(false)
    {
        let probe = Connection::open_with_flags(&database, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|error| {
                format!("Unable to inspect the existing Library before writing: {error}")
            })?;
        configure_read(&probe)?;
        let (version, tables) = schema_state(&probe)?;
        if version.is_none() && !tables.is_empty() {
            return Err("LIBRARY_UNKNOWN_SCHEMA: the database has no readable schema version; use recovery/export mode.".into());
        }
        if version.is_some_and(|version| version > LIBRARY_SCHEMA_VERSION) {
            return Err(format!(
                "LIBRARY_FUTURE_SCHEMA: the database is newer than supported schema {LIBRARY_SCHEMA_VERSION}; no write or downgrade is allowed."
            ));
        }
        if version.is_some_and(|version| version > 0) {
            validate_supported_schema(&probe).map_err(|error| {
                format!("LIBRARY_CORRUPT: refusing to write a damaged Library: {error}")
            })?;
            integrity_check(&probe).map_err(|error| {
                format!("LIBRARY_CORRUPT: refusing to write a damaged Library: {error}")
            })?;
        }
    }
    let mut connection = Connection::open(&database)
        .map_err(|error| format!("Unable to open the Library database: {error}"))?;
    if let Err(error) =
        configure_write(&connection).and_then(|_| prepare_write_library(&paths, &mut connection))
    {
        drop(connection);
        return Err(error);
    }
    Ok(LibraryHandle {
        connection,
        paths,
        _barrier: Some(barrier),
    })
}

pub fn open_library_read(app: &tauri::AppHandle) -> Result<LibraryHandle, String> {
    let paths = root_paths(app, false)?;
    if !paths.database().is_file() {
        return Err(
            "LIBRARY_UNINITIALIZED: the selected Data Root has no Library database.".into(),
        );
    }
    validate_wal_sidecar(&paths.database())?;
    let connection =
        Connection::open_with_flags(paths.database(), OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|error| format!("Unable to open the Library database read-only: {error}"))?;
    configure_read(&connection)?;
    let (version, tables) = schema_state(&connection)?;
    match version {
        Some(version) if version > LIBRARY_SCHEMA_VERSION => {
            return Err(format!(
                "LIBRARY_FUTURE_SCHEMA: schema {version} is newer than supported schema {LIBRARY_SCHEMA_VERSION}; use recovery/export mode."
            ));
        }
        Some(version) if version < LIBRARY_SCHEMA_VERSION => {
            drop(connection);
            drop(paths);
            let writable = open_library_write(app)?;
            drop(writable);
            return open_library_read(app);
        }
        None if tables.is_empty() => {
            return Err(
                "LIBRARY_UNINITIALIZED: the selected Data Root has no Library schema.".into(),
            );
        }
        None => {
            return Err(
                "LIBRARY_UNKNOWN_SCHEMA: the database has no readable schema version.".into(),
            );
        }
        Some(_) => {}
    }
    validate_schema(&connection)?;
    integrity_check(&connection)?;
    Ok(LibraryHandle {
        connection,
        paths,
        _barrier: None,
    })
}

pub fn library_schema_status(app: &tauri::AppHandle) -> Result<LibrarySchemaResult, String> {
    let paths = root_paths(app, false).or_else(|_| recovery_root_paths(app))?;
    if !paths.database().is_file() {
        return Ok(LibrarySchemaResult {
            database_path: root_string(&paths.database()),
            schema_version: 0,
            current_schema_version: LIBRARY_SCHEMA_VERSION,
            foreign_keys: false,
            journal_mode: None,
            tables: Vec::new(),
            mode: "uninitialized".into(),
            read_only: true,
            reason: Some("The Library database has not been created yet.".into()),
        });
    }
    if let Err(error) = validate_wal_sidecar(&paths.database()) {
        return Ok(LibrarySchemaResult {
            database_path: root_string(&paths.database()),
            schema_version: 0,
            current_schema_version: LIBRARY_SCHEMA_VERSION,
            foreign_keys: false,
            journal_mode: Some("wal-corrupt".into()),
            tables: Vec::new(),
            mode: "read_only_recovery".into(),
            read_only: true,
            reason: Some(error),
        });
    }
    let connection =
        match Connection::open_with_flags(paths.database(), OpenFlags::SQLITE_OPEN_READ_ONLY) {
            Ok(connection) => connection,
            Err(error) => {
                return Ok(LibrarySchemaResult {
                    database_path: root_string(&paths.database()),
                    schema_version: 0,
                    current_schema_version: LIBRARY_SCHEMA_VERSION,
                    foreign_keys: false,
                    journal_mode: None,
                    tables: Vec::new(),
                    mode: "read_only_recovery".into(),
                    read_only: true,
                    reason: Some(format!(
                        "Unable to open the database for recovery inspection: {error}"
                    )),
                });
            }
        };
    let foreign_keys = configure_read(&connection)
        .ok()
        .and_then(|_| {
            connection
                .query_row("PRAGMA foreign_keys", [], |row| row.get::<_, i64>(0))
                .ok()
        })
        .is_some_and(|value| value == 1);
    let journal_mode = connection
        .query_row("PRAGMA journal_mode", [], |row| row.get::<_, String>(0))
        .ok();
    let tables = table_names(&connection).unwrap_or_default();
    let schema_version = schema_meta_version(&connection)
        .ok()
        .flatten()
        .or_else(|| {
            pragma_user_version(&connection)
                .ok()
                .filter(|value| *value > 0)
        })
        .unwrap_or_default();
    let (mode, read_only, reason) = if schema_version > LIBRARY_SCHEMA_VERSION {
        (
            "read_only_recovery".into(),
            true,
            Some("The database schema is newer than this application; no automatic downgrade is allowed.".into()),
        )
    } else if schema_version < LIBRARY_SCHEMA_VERSION && schema_version > 0 {
        (
            "migration_available".into(),
            false,
            Some(
                "A forward migration will create a protected pre-migration backup before writing."
                    .into(),
            ),
        )
    } else if schema_version == LIBRARY_SCHEMA_VERSION && validate_schema(&connection).is_ok() {
        ("ready".into(), false, None)
    } else {
        (
            "read_only_recovery".into(),
            true,
            Some("The database schema is incomplete or damaged; use recovery/export mode.".into()),
        )
    };
    Ok(LibrarySchemaResult {
        database_path: root_string(&paths.database()),
        schema_version,
        current_schema_version: LIBRARY_SCHEMA_VERSION,
        foreign_keys,
        journal_mode,
        tables,
        mode,
        read_only,
        reason,
    })
}

fn validate_document_id(document_id: &str) -> Result<(), String> {
    let value = document_id.trim();
    if value.is_empty()
        || value.len() > 160
        || path_has_control(value)
        || value.contains('/')
        || value.contains('\\')
    {
        return Err("A document id must be a bounded, non-empty identifier.".into());
    }
    Ok(())
}

fn validate_title(title: &str) -> Result<(), String> {
    if title.trim().is_empty() || title.len() > 4 * 1024 || path_has_control(title) {
        return Err("Library article titles must be non-empty and bounded.".into());
    }
    Ok(())
}

fn validate_markdown(markdown: &str) -> Result<(), String> {
    if markdown.len() > MAX_MARKDOWN_BYTES {
        return Err(format!(
            "Markdown exceeds the {} byte Library limit.",
            MAX_MARKDOWN_BYTES
        ));
    }
    Ok(())
}

fn normalize_kind(kind: Option<&str>) -> Result<String, String> {
    let kind = kind.unwrap_or("manual-save").trim().to_ascii_lowercase();
    if matches!(
        kind.as_str(),
        "manual-save" | "publish" | "import" | "seed-reset"
    ) {
        Ok(kind)
    } else {
        Err(format!("Unsupported article version kind: {kind}"))
    }
}

fn insert_audit_event(
    transaction: &rusqlite::Transaction<'_>,
    event_type: &str,
    document_id: Option<&str>,
    details: Value,
) -> Result<String, String> {
    let id = new_id("audit");
    let details_json = serde_json::to_string(&details)
        .map_err(|error| format!("Unable to encode audit details: {error}"))?;
    transaction
        .execute(
            "INSERT INTO audit_events(id, event_type, document_id, details_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, event_type, document_id, details_json, now_string()],
        )
        .map_err(|error| format!("Unable to record the Library audit event: {error}"))?;
    Ok(id)
}

fn row_to_article(
    row: &rusqlite::Row<'_>,
    database_path: &Path,
) -> rusqlite::Result<LibraryDocumentResult> {
    Ok(LibraryDocumentResult {
        database_path: root_string(database_path),
        document_id: row.get(0)?,
        title: row.get(1)?,
        markdown: row.get(2)?,
        revision: row.get(3)?,
        seed_key: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        deleted_at: row.get(7)?,
    })
}

fn load_article_from_connection(
    connection: &Connection,
    database_path: &Path,
    document_id: &str,
    include_deleted: bool,
) -> Result<LibraryDocumentResult, String> {
    validate_document_id(document_id)?;
    let query = if include_deleted {
        "SELECT id, title, markdown, revision, seed_key, created_at, updated_at, deleted_at FROM articles WHERE id = ?1"
    } else {
        "SELECT id, title, markdown, revision, seed_key, created_at, updated_at, deleted_at FROM articles WHERE id = ?1 AND deleted_at IS NULL"
    };
    connection
        .query_row(query, params![document_id], |row| {
            row_to_article(row, database_path)
        })
        .optional()
        .map_err(|error| format!("Unable to load Library article: {error}"))?
        .ok_or_else(|| "ARTICLE_NOT_FOUND: the requested Library article does not exist.".into())
}

fn prune_ordinary_versions(
    transaction: &rusqlite::Transaction<'_>,
    document_id: &str,
) -> Result<Vec<String>, String> {
    let mut statement = transaction
        .prepare(
            "SELECT id FROM article_versions
             WHERE article_id = ?1 AND protected = 0 AND kind NOT IN ('publish')
             ORDER BY revision DESC, created_at DESC
             LIMIT -1 OFFSET 50",
        )
        .map_err(|error| format!("Unable to prepare version retention query: {error}"))?;
    let ids = statement
        .query_map(params![document_id], |row| row.get::<_, String>(0))
        .map_err(|error| format!("Unable to enumerate versions for retention: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Unable to collect versions for retention: {error}"))?;
    drop(statement);
    for id in &ids {
        transaction
            .execute(
                "DELETE FROM article_versions WHERE id = ?1 AND protected = 0",
                params![id],
            )
            .map_err(|error| format!("Unable to clean an ordinary Library version: {error}"))?;
    }
    Ok(ids)
}

fn save_version_with_handle(
    handle: &mut LibraryHandle,
    input: &SaveVersionInput,
) -> Result<LibrarySaveResult, String> {
    validate_document_id(&input.document_id)?;
    validate_title(&input.title)?;
    validate_markdown(&input.markdown)?;
    let kind = normalize_kind(input.kind.as_deref())?;
    let protected = input.protected.unwrap_or(false) || kind == "publish";
    let transaction = handle
        .connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Unable to begin the Library save transaction: {error}"))?;
    let current = transaction
        .query_row(
            "SELECT revision, deleted_at, seed_key FROM articles WHERE id = ?1",
            params![input.document_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("Unable to read the current Library article: {error}"))?;
    if current
        .as_ref()
        .is_some_and(|(_, deleted_at, _)| deleted_at.is_some())
    {
        return Err("ARTICLE_DELETED: restore the article before saving new content.".into());
    }
    let current_revision = current.as_ref().map(|value| value.0).unwrap_or(0);
    let revision = current_revision
        .checked_add(1)
        .ok_or_else(|| "Library article revision overflowed.".to_string())?;
    if let Some(requested) = input.requested_revision
        && requested != revision
    {
        return Err(format!(
            "Library revision {requested} is not the next revision {revision}; save transaction rolled back."
        ));
    }
    let now = now_string();
    let seed_key = input
        .seed_key
        .clone()
        .or_else(|| current.as_ref().and_then(|value| value.2.clone()));
    transaction
        .execute(
            "INSERT INTO articles(id, title, markdown, revision, seed_key, created_at, updated_at, deleted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, NULL)
             ON CONFLICT(id) DO UPDATE SET title = excluded.title, markdown = excluded.markdown,
               revision = excluded.revision, seed_key = COALESCE(excluded.seed_key, articles.seed_key),
               updated_at = excluded.updated_at, deleted_at = NULL",
            params![input.document_id, input.title, input.markdown, revision, seed_key, now],
        )
        .map_err(|error| format!("Unable to update the Library current article: {error}"))?;
    let version_id = format!("{}-{}", input.document_id, revision);
    transaction
        .execute(
            "INSERT INTO article_versions(id, article_id, revision, markdown, kind, label, protected, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![version_id, input.document_id, revision, input.markdown, kind, input.label, protected as i64, now],
        )
        .map_err(|error| format!("Library version transaction rolled back: {error}"))?;
    let removed = prune_ordinary_versions(&transaction, &input.document_id)?;
    let draft_cleared = transaction
        .execute(
            "DELETE FROM recovery_drafts WHERE article_id = ?1",
            params![input.document_id],
        )
        .map_err(|error| format!("Library draft cleanup transaction rolled back: {error}"))?
        > 0;
    if !removed.is_empty() {
        let _ = insert_audit_event(
            &transaction,
            "article_versions.pruned",
            Some(&input.document_id),
            json!({"removedCount": removed.len(), "retention": "ordinary-50"}),
        )?;
    }
    transaction
        .commit()
        .map_err(|error| format!("Unable to commit the Library save transaction: {error}"))?;
    append_log(
        &handle.paths,
        "info",
        "library.version.saved",
        json!({"operation": kind, "revision": revision, "protected": protected}),
    );
    Ok(LibrarySaveResult {
        database_path: root_string(&handle.paths.database()),
        document_id: input.document_id.clone(),
        markdown: input.markdown.clone(),
        revision,
        version_id,
        kind,
        protected,
        draft_cleared,
    })
}

pub fn save_markdown(
    app: &tauri::AppHandle,
    document_id: String,
    title: String,
    markdown: String,
    requested_revision: Option<i64>,
) -> Result<LibrarySaveResult, String> {
    let mut handle = open_library_write(app)?;
    save_version_with_handle(
        &mut handle,
        &SaveVersionInput {
            document_id,
            title,
            markdown,
            requested_revision,
            kind: None,
            label: None,
            protected: None,
            seed_key: None,
        },
    )
}

pub fn save_version(
    app: &tauri::AppHandle,
    input: SaveVersionInput,
) -> Result<LibrarySaveResult, String> {
    let mut handle = open_library_write(app)?;
    save_version_with_handle(&mut handle, &input)
}

pub fn create_article(
    app: &tauri::AppHandle,
    input: ArticleCreateInput,
) -> Result<LibraryDocumentResult, String> {
    let document_id = input.document_id.unwrap_or_else(|| new_id("article"));
    validate_document_id(&document_id)?;
    if let Ok(handle) = open_library_read(app) {
        let exists = handle
            .connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM articles WHERE id = ?1)",
                params![document_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|error| format!("Unable to check the new Library article id: {error}"))?
            == 1;
        if exists {
            return Err(
                "ARTICLE_EXISTS: the requested Library document id is already in use.".into(),
            );
        }
    }
    let result = save_version(
        app,
        SaveVersionInput {
            document_id: document_id.clone(),
            title: input.title,
            markdown: input.markdown,
            requested_revision: None,
            kind: Some("manual-save".into()),
            label: None,
            protected: None,
            seed_key: input.seed_key,
        },
    )?;
    load_article(app, result.document_id, false)
}

pub fn load_article(
    app: &tauri::AppHandle,
    document_id: String,
    include_deleted: bool,
) -> Result<LibraryDocumentResult, String> {
    let handle = open_library_read(app)?;
    load_article_from_connection(
        &handle.connection,
        &handle.paths.database(),
        &document_id,
        include_deleted,
    )
}

pub fn list_articles(
    app: &tauri::AppHandle,
    include_deleted: bool,
) -> Result<Vec<LibraryDocumentResult>, String> {
    let handle = open_library_read(app)?;
    let query = if include_deleted {
        "SELECT id, title, markdown, revision, seed_key, created_at, updated_at, deleted_at FROM articles ORDER BY updated_at DESC, id"
    } else {
        "SELECT id, title, markdown, revision, seed_key, created_at, updated_at, deleted_at FROM articles WHERE deleted_at IS NULL ORDER BY updated_at DESC, id"
    };
    let mut statement = handle
        .connection
        .prepare(query)
        .map_err(|error| format!("Unable to prepare the Library article list: {error}"))?;
    statement
        .query_map([], |row| row_to_article(row, &handle.paths.database()))
        .map_err(|error| format!("Unable to enumerate Library articles: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Unable to collect Library articles: {error}"))
}

pub fn delete_article(
    app: &tauri::AppHandle,
    document_id: String,
) -> Result<LibraryDocumentResult, String> {
    validate_document_id(&document_id)?;
    let mut handle = open_library_write(app)?;
    let transaction = handle
        .connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Unable to begin the article delete transaction: {error}"))?;
    let deleted_at = now_string();
    let changed = transaction
        .execute(
            "UPDATE articles SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
            params![document_id, deleted_at],
        )
        .map_err(|error| format!("Unable to soft-delete Library article: {error}"))?;
    if changed == 0 {
        return Err("ARTICLE_NOT_FOUND: the Library article is already deleted or missing.".into());
    }
    let _ = insert_audit_event(
        &transaction,
        "article.soft-deleted",
        Some(&document_id),
        json!({}),
    )?;
    transaction
        .commit()
        .map_err(|error| format!("Unable to commit the article delete transaction: {error}"))?;
    load_article_from_connection(
        &handle.connection,
        &handle.paths.database(),
        &document_id,
        true,
    )
}

pub fn restore_article(
    app: &tauri::AppHandle,
    document_id: String,
) -> Result<LibraryDocumentResult, String> {
    validate_document_id(&document_id)?;
    let mut handle = open_library_write(app)?;
    let transaction = handle
        .connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Unable to begin the article restore transaction: {error}"))?;
    let changed = transaction
        .execute(
            "UPDATE articles SET deleted_at = NULL, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NOT NULL",
            params![document_id, now_string()],
        )
        .map_err(|error| format!("Unable to restore Library article: {error}"))?;
    if changed == 0 {
        return Err("ARTICLE_NOT_FOUND: the deleted Library article does not exist.".into());
    }
    let _ = insert_audit_event(
        &transaction,
        "article.restored",
        Some(&document_id),
        json!({}),
    )?;
    transaction
        .commit()
        .map_err(|error| format!("Unable to commit the article restore transaction: {error}"))?;
    load_article_from_connection(
        &handle.connection,
        &handle.paths.database(),
        &document_id,
        true,
    )
}

fn row_to_version(row: &rusqlite::Row<'_>) -> rusqlite::Result<ArticleVersionResult> {
    Ok(ArticleVersionResult {
        id: row.get(0)?,
        article_id: row.get(1)?,
        revision: row.get(2)?,
        markdown: row.get(3)?,
        kind: row.get(4)?,
        label: row.get(5)?,
        protected: row.get::<_, i64>(6)? == 1,
        created_at: row.get(7)?,
    })
}

pub fn list_versions(
    app: &tauri::AppHandle,
    document_id: String,
) -> Result<Vec<ArticleVersionResult>, String> {
    validate_document_id(&document_id)?;
    let handle = open_library_read(app)?;
    let mut statement = handle
        .connection
        .prepare(
            "SELECT id, article_id, revision, markdown, kind, label, protected, created_at
             FROM article_versions WHERE article_id = ?1 ORDER BY revision DESC, created_at DESC",
        )
        .map_err(|error| format!("Unable to prepare the Library version list: {error}"))?;
    statement
        .query_map(params![document_id], row_to_version)
        .map_err(|error| format!("Unable to enumerate Library versions: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Unable to collect Library versions: {error}"))
}

pub fn get_version(
    app: &tauri::AppHandle,
    version_id: String,
) -> Result<ArticleVersionResult, String> {
    if version_id.trim().is_empty() || path_has_control(&version_id) {
        return Err("A version id is required.".into());
    }
    let handle = open_library_read(app)?;
    handle
        .connection
        .query_row(
            "SELECT id, article_id, revision, markdown, kind, label, protected, created_at
             FROM article_versions WHERE id = ?1",
            params![version_id],
            row_to_version,
        )
        .optional()
        .map_err(|error| format!("Unable to load Library version: {error}"))?
        .ok_or_else(|| "VERSION_NOT_FOUND: the requested immutable version does not exist.".into())
}

pub fn prune_versions(
    app: &tauri::AppHandle,
    document_id: String,
) -> Result<VersionCleanupResult, String> {
    validate_document_id(&document_id)?;
    let mut handle = open_library_write(app)?;
    let transaction = handle
        .connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Unable to begin version cleanup transaction: {error}"))?;
    let removed = prune_ordinary_versions(&transaction, &document_id)?;
    let audit_event_id = if removed.is_empty() {
        None
    } else {
        Some(insert_audit_event(
            &transaction,
            "article_versions.pruned",
            Some(&document_id),
            json!({"removedCount": removed.len(), "retention": "ordinary-50"}),
        )?)
    };
    transaction
        .commit()
        .map_err(|error| format!("Unable to commit version cleanup transaction: {error}"))?;
    Ok(VersionCleanupResult {
        document_id,
        removed_count: removed.len(),
        removed_version_ids: removed,
        audit_event_id,
    })
}

pub fn delete_version(app: &tauri::AppHandle, version_id: String) -> Result<bool, String> {
    if version_id.trim().is_empty() || path_has_control(&version_id) {
        return Err("A version id is required.".into());
    }
    let mut handle = open_library_write(app)?;
    let transaction = handle
        .connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Unable to begin version delete transaction: {error}"))?;
    let article_id = transaction
        .query_row(
            "SELECT article_id FROM article_versions WHERE id = ?1 AND protected = 0",
            params![version_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("Unable to inspect the Library version: {error}"))?;
    let Some(article_id) = article_id else {
        return Err(
            "VERSION_PROTECTED_OR_MISSING: protected versions cannot be deleted automatically."
                .into(),
        );
    };
    transaction
        .execute(
            "DELETE FROM article_versions WHERE id = ?1 AND protected = 0",
            params![version_id],
        )
        .map_err(|error| format!("Unable to delete the Library version: {error}"))?;
    let _ = insert_audit_event(
        &transaction,
        "article_version.deleted",
        Some(&article_id),
        json!({"versionId": version_id}),
    )?;
    transaction
        .commit()
        .map_err(|error| format!("Unable to commit version delete transaction: {error}"))?;
    Ok(true)
}

pub fn export_markdown(
    app: &tauri::AppHandle,
    document_id: String,
    destination_path: String,
) -> Result<SnapshotExportResult, String> {
    let article = load_article(app, document_id.clone(), false)?;
    let destination = validate_external_destination(Path::new(&destination_path))?;
    let bytes = article.markdown.as_bytes();
    atomic_write(&destination, bytes, "Markdown snapshot")?;
    let digest = sha256_bytes(bytes);
    append_log(
        &root_paths(app, false)?,
        "info",
        "library.snapshot.exported",
        json!({"operation": "explicit-export", "bytes": bytes.len()}),
    );
    Ok(SnapshotExportResult {
        document_id,
        destination_path: root_string(&destination),
        bytes: bytes.len() as u64,
        sha256: digest,
    })
}

pub fn write_export_file(
    app: &tauri::AppHandle,
    destination_path: String,
    bytes: Vec<u8>,
) -> Result<FileExportResult, String> {
    let destination = validate_external_destination(Path::new(&destination_path))?;
    atomic_write(&destination, &bytes, "exported file")?;
    let digest = sha256_bytes(&bytes);
    append_log(
        &root_paths(app, false)?,
        "info",
        "library.file.exported",
        json!({"operation": "native-save-dialog", "bytes": bytes.len()}),
    );
    Ok(FileExportResult {
        destination_path: root_string(&destination),
        bytes: bytes.len() as u64,
        sha256: digest,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileExportResult {
    pub destination_path: String,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotExportResult {
    pub document_id: String,
    pub destination_path: String,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeedInfo {
    pub seed_key: String,
    pub title: String,
    pub markdown_bytes: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeedMaterializeResult {
    pub seed_key: String,
    pub template_title: String,
    pub article: LibraryDocumentResult,
    pub resettable: bool,
}

const SEED_WELCOME: &str =
    include_str!("../../../../apps/playground/src/content/articles/welcome.md");
const SEED_FORMATTING_GALLERY: &str =
    include_str!("../../../../apps/playground/src/content/articles/formatting-gallery.md");
const SEED_PRODUCT_NOTES: &str =
    include_str!("../../../../apps/playground/src/content/articles/product-notes.md");

fn seed_definition(seed_key: &str) -> Option<(&'static str, &'static str)> {
    match seed_key {
        "welcome" => Some(("Welcome", SEED_WELCOME)),
        "formatting-gallery" => Some(("Formatting gallery", SEED_FORMATTING_GALLERY)),
        "product-notes" => Some(("Product notes", SEED_PRODUCT_NOTES)),
        _ => None,
    }
}

pub fn seed_catalog() -> Vec<SeedInfo> {
    ["welcome", "formatting-gallery", "product-notes"]
        .iter()
        .filter_map(|key| {
            seed_definition(key).map(|(title, markdown)| SeedInfo {
                seed_key: (*key).into(),
                title: title.into(),
                markdown_bytes: markdown.len(),
            })
        })
        .collect()
}

pub fn seed_get(seed_key: String) -> Result<(&'static str, &'static str), String> {
    seed_definition(&seed_key)
        .ok_or_else(|| "SEED_NOT_FOUND: the built-in seed does not exist.".into())
}

pub fn materialize_seed(
    app: &tauri::AppHandle,
    seed_key: String,
    title: Option<String>,
    markdown: Option<String>,
) -> Result<SeedMaterializeResult, String> {
    let (template_title, template_markdown) = seed_get(seed_key.clone())?;
    let document_id = new_id("article");
    let input = SaveVersionInput {
        document_id: document_id.clone(),
        title: title.unwrap_or_else(|| template_title.into()),
        markdown: markdown.unwrap_or_else(|| template_markdown.into()),
        requested_revision: None,
        kind: Some("seed-reset".into()),
        label: Some(format!("seed:{seed_key}")),
        protected: None,
        seed_key: Some(seed_key.clone()),
    };
    save_version(app, input)?;
    let article = load_article(app, document_id, false)?;
    Ok(SeedMaterializeResult {
        seed_key,
        template_title: template_title.into(),
        article,
        resettable: true,
    })
}

fn draft_expiry(days: i64) -> String {
    let millis = now_millis().saturating_add(days.saturating_mul(86_400_000));
    format!("{millis:013}")
}

fn draft_row(
    row: &rusqlite::Row<'_>,
    database_path: &Path,
    newer_than_article: bool,
) -> rusqlite::Result<RecoveryDraftResult> {
    Ok(RecoveryDraftResult {
        database_path: root_string(database_path),
        document_id: row.get(0)?,
        base_revision: row.get(1)?,
        markdown: row.get(2)?,
        updated_at: row.get(3)?,
        expires_at: row.get(4)?,
        state: row.get(5)?,
        newer_than_article,
    })
}

pub fn save_recovery_draft(
    app: &tauri::AppHandle,
    input: RecoveryDraftInput,
) -> Result<RecoveryDraftResult, String> {
    validate_document_id(&input.document_id)?;
    validate_markdown(&input.markdown)?;
    if input.base_revision < 0 {
        return Err("Recovery draft base revision cannot be negative.".into());
    }
    let mut handle = open_library_write(app)?;
    let draft_days = retention_policy_from_connection(&handle.connection).draft_days;
    let transaction = handle
        .connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Unable to begin recovery draft transaction: {error}"))?;
    let current_state = transaction
        .query_row(
            "SELECT revision, markdown FROM articles WHERE id = ?1",
            params![input.document_id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|error| format!("Unable to inspect the draft article: {error}"))?;
    let current_revision = match current_state.as_ref() {
        Some((revision, _)) => *revision,
        None => {
            let timestamp = now_string();
            transaction
                .execute(
                    "INSERT INTO articles(id, title, markdown, revision, seed_key, created_at, updated_at, deleted_at)
                     VALUES (?1, ?1, '', ?2, NULL, ?3, ?3, NULL)",
                    params![input.document_id, input.base_revision, timestamp],
                )
                .map_err(|error| format!("Unable to prepare the draft article: {error}"))?;
            input.base_revision
        }
    };
    if input.base_revision > current_revision {
        return Err("Recovery draft base revision is newer than the Library article.".into());
    }
    let updated_at = now_string();
    let expires_at = draft_expiry(draft_days);
    transaction
        .execute(
            "INSERT INTO recovery_drafts(article_id, base_revision, markdown, updated_at, expires_at, state)
             VALUES (?1, ?2, ?3, ?4, ?5, 'active')
             ON CONFLICT(article_id) DO UPDATE SET base_revision = excluded.base_revision,
               markdown = excluded.markdown, updated_at = excluded.updated_at,
               expires_at = excluded.expires_at, state = 'active'",
            params![input.document_id, input.base_revision, input.markdown, updated_at, expires_at],
        )
        .map_err(|error| format!("Unable to save the recovery draft: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Unable to commit recovery draft transaction: {error}"))?;
    let newer_than_article = current_state
        .as_ref()
        .is_none_or(|(revision, current_markdown)| {
            input.markdown != *current_markdown || input.base_revision > *revision
        });
    Ok(RecoveryDraftResult {
        database_path: root_string(&handle.paths.database()),
        document_id: input.document_id,
        base_revision: input.base_revision,
        markdown: input.markdown,
        updated_at,
        expires_at,
        state: "active".into(),
        newer_than_article,
    })
}

pub fn load_recovery_draft(
    app: &tauri::AppHandle,
    document_id: String,
) -> Result<Option<RecoveryDraftResult>, String> {
    validate_document_id(&document_id)?;
    let handle = open_library_read(app)?;
    handle
        .connection
        .query_row(
             "SELECT d.article_id, d.base_revision, d.markdown, d.updated_at, d.expires_at, d.state,
                    CASE WHEN d.markdown <> a.markdown OR d.base_revision >= a.revision THEN 1 ELSE 0 END
             FROM recovery_drafts d JOIN articles a ON a.id = d.article_id
             WHERE d.article_id = ?1 AND d.state = 'active' AND CAST(d.expires_at AS INTEGER) > ?2",
            params![document_id, now_millis()],
            |row| draft_row(row, &handle.paths.database(), row.get::<_, i64>(6)? == 1),
        )
        .optional()
        .map_err(|error| format!("Unable to load the recovery draft: {error}"))
}

pub fn clear_recovery_draft(app: &tauri::AppHandle, document_id: String) -> Result<bool, String> {
    validate_document_id(&document_id)?;
    let mut handle = open_library_write(app)?;
    let transaction = handle
        .connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Unable to begin recovery draft cleanup transaction: {error}"))?;
    let deleted = transaction
        .execute(
            "DELETE FROM recovery_drafts WHERE article_id = ?1",
            params![document_id],
        )
        .map_err(|error| format!("Unable to clear the recovery draft: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Unable to commit recovery draft cleanup transaction: {error}"))?;
    Ok(deleted > 0)
}

pub fn export_recovery_draft(
    app: &tauri::AppHandle,
    document_id: String,
    destination_path: String,
) -> Result<SnapshotExportResult, String> {
    let draft = load_recovery_draft(app, document_id.clone())?
        .ok_or_else(|| "DRAFT_NOT_FOUND: no active recovery draft exists.".to_string())?;
    let destination = validate_external_destination(Path::new(&destination_path))?;
    atomic_write(
        &destination,
        draft.markdown.as_bytes(),
        "recovery draft export",
    )?;
    Ok(SnapshotExportResult {
        document_id,
        destination_path: root_string(&destination),
        bytes: draft.markdown.len() as u64,
        sha256: sha256_bytes(draft.markdown.as_bytes()),
    })
}

pub fn cleanup_expired_drafts(app: &tauri::AppHandle) -> Result<usize, String> {
    let mut handle = open_library_write(app)?;
    let transaction = handle
        .connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Unable to begin expired draft cleanup transaction: {error}"))?;
    let count = transaction
        .execute(
            "DELETE FROM recovery_drafts WHERE state = 'active' AND CAST(expires_at AS INTEGER) <= ?1",
            params![now_millis()],
        )
        .map_err(|error| format!("Unable to clean expired recovery drafts: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Unable to commit expired draft cleanup transaction: {error}"))?;
    Ok(count)
}

fn validate_stable_value(value: &Value, label: &str) -> Result<(), String> {
    let encoded =
        serde_json::to_vec(value).map_err(|error| format!("Unable to encode {label}: {error}"))?;
    if encoded.len() > MAX_JSON_BYTES {
        return Err(format!(
            "{label} exceeds the bounded workspace state limit."
        ));
    }
    match value {
        Value::Object(object) => {
            for (key, child) in object {
                let normalized = key.to_ascii_lowercase();
                if [
                    "dom",
                    "html",
                    "undo",
                    "redo",
                    "tiptap",
                    "prosemirror",
                    "popup",
                    "hover",
                    "fold",
                ]
                .contains(&normalized.as_str())
                {
                    return Err(format!(
                        "{label} cannot persist transient editor state: {key}."
                    ));
                }
                validate_stable_value(child, label)?;
            }
        }
        Value::Array(items) => {
            for item in items {
                validate_stable_value(item, label)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn validate_workspace_input(
    input: &WorkspaceStateInput,
) -> Result<(Value, Value, Value, Value), String> {
    validate_document_id(&input.document_id)?;
    let mode = input.mode.trim().to_ascii_lowercase();
    if !matches!(mode.as_str(), "source" | "visual" | "preview" | "final") {
        return Err("Workspace mode must be source, visual, preview, or final.".into());
    }
    let source_anchor = input.source_anchor.clone().unwrap_or_else(|| json!({}));
    let selection = input.selection.clone().unwrap_or_else(|| json!({}));
    let scroll = input.scroll.clone().unwrap_or_else(|| json!({}));
    let sidebar = input.sidebar.clone().unwrap_or_else(|| json!({}));
    validate_stable_value(&source_anchor, "source anchor")?;
    validate_stable_value(&selection, "selection")?;
    validate_stable_value(&scroll, "scroll state")?;
    validate_stable_value(&sidebar, "sidebar state")?;
    Ok((source_anchor, selection, scroll, sidebar))
}

fn parse_json_column(value: String, label: &str) -> Result<Value, String> {
    serde_json::from_str(&value).map_err(|error| format!("Stored {label} is invalid: {error}"))
}

fn parse_json_column_safe(value: String, label: &str) -> (Value, bool) {
    match parse_json_column(value, label) {
        Ok(value) => (value, false),
        Err(_) => (json!({}), true),
    }
}

fn workspace_row(
    row: &rusqlite::Row<'_>,
    database_path: &Path,
    position_fallback: bool,
) -> rusqlite::Result<WorkspaceStateResult> {
    let source_anchor: String = row.get(2)?;
    let selection: String = row.get(3)?;
    let scroll: String = row.get(4)?;
    let sidebar: String = row.get(5)?;
    let (source_anchor, source_fallback) = parse_json_column_safe(source_anchor, "source anchor");
    let (selection, selection_fallback) = parse_json_column_safe(selection, "selection");
    let (scroll, scroll_fallback) = parse_json_column_safe(scroll, "scroll state");
    let (sidebar, sidebar_fallback) = parse_json_column_safe(sidebar, "sidebar state");
    Ok(WorkspaceStateResult {
        database_path: root_string(database_path),
        document_id: row.get(0)?,
        mode: row.get(1)?,
        source_anchor,
        selection,
        scroll,
        sidebar,
        updated_at: row.get(6)?,
        position_fallback: position_fallback
            || source_fallback
            || selection_fallback
            || scroll_fallback
            || sidebar_fallback,
    })
}

pub fn save_workspace_state(
    app: &tauri::AppHandle,
    input: WorkspaceStateInput,
) -> Result<WorkspaceStateResult, String> {
    let (source_anchor, selection, scroll, sidebar) = validate_workspace_input(&input)?;
    let mut handle = open_library_write(app)?;
    let transaction = handle
        .connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Unable to begin workspace state transaction: {error}"))?;
    let exists = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM articles WHERE id = ?1)",
            params![input.document_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| format!("Unable to inspect the workspace article: {error}"))?
        == 1;
    if !exists {
        return Err("ARTICLE_NOT_FOUND: workspace state requires a Library article.".into());
    }
    let source_anchor_json =
        serde_json::to_string(&source_anchor).map_err(|error| error.to_string())?;
    let selection_json = serde_json::to_string(&selection).map_err(|error| error.to_string())?;
    let scroll_json = serde_json::to_string(&scroll).map_err(|error| error.to_string())?;
    let sidebar_json = serde_json::to_string(&sidebar).map_err(|error| error.to_string())?;
    let updated_at = now_string();
    transaction
        .execute(
            "INSERT INTO workspace_state(article_id, mode, source_anchor_json, selection_json, scroll_json, sidebar_json, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(article_id) DO UPDATE SET mode = excluded.mode,
               source_anchor_json = excluded.source_anchor_json, selection_json = excluded.selection_json,
               scroll_json = excluded.scroll_json, sidebar_json = excluded.sidebar_json,
               updated_at = excluded.updated_at",
            params![input.document_id, input.mode.trim().to_ascii_lowercase(), source_anchor_json, selection_json, scroll_json, sidebar_json, updated_at],
        )
        .map_err(|error| format!("Unable to save workspace state: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Unable to commit workspace state transaction: {error}"))?;
    Ok(WorkspaceStateResult {
        database_path: root_string(&handle.paths.database()),
        document_id: input.document_id,
        mode: input.mode.trim().to_ascii_lowercase(),
        source_anchor,
        selection,
        scroll,
        sidebar,
        updated_at,
        position_fallback: false,
    })
}

pub fn load_workspace_state(
    app: &tauri::AppHandle,
    document_id: String,
) -> Result<Option<WorkspaceStateResult>, String> {
    validate_document_id(&document_id)?;
    let handle = open_library_read(app)?;
    handle
        .connection
        .query_row(
            "SELECT article_id, mode, source_anchor_json, selection_json, scroll_json, sidebar_json, updated_at
             FROM workspace_state WHERE article_id = ?1",
            params![document_id],
            |row| workspace_row(row, &handle.paths.database(), false),
        )
        .optional()
        .map_err(|error| format!("Unable to load workspace state: {error}"))
}

fn clamp_position_value(value: &mut Value, max_offset: i64, fallback: &mut bool) {
    match value {
        Value::Object(object) => {
            for (key, child) in object.iter_mut() {
                if matches!(key.as_str(), "offset" | "start" | "end") {
                    if let Some(number) = child.as_i64() {
                        let clamped = number.clamp(0, max_offset);
                        if clamped != number {
                            *fallback = true;
                            *child = Value::from(clamped);
                        }
                    } else if !child.is_null() {
                        *fallback = true;
                        *child = Value::from(0);
                    }
                }
                clamp_position_value(child, max_offset, fallback);
            }
        }
        Value::Array(items) => {
            for item in items {
                clamp_position_value(item, max_offset, fallback);
            }
        }
        _ => {}
    }
}

pub fn restore_workspace_state(
    app: &tauri::AppHandle,
    document_id: String,
    source_length: Option<i64>,
) -> Result<Option<WorkspaceStateResult>, String> {
    let mut state = load_workspace_state(app, document_id)?;
    if let Some(value) = state.as_mut() {
        let mut fallback = false;
        let max_offset = source_length.unwrap_or(i64::MAX).max(0);
        clamp_position_value(&mut value.source_anchor, max_offset, &mut fallback);
        clamp_position_value(&mut value.selection, max_offset, &mut fallback);
        value.position_fallback = fallback;
    }
    Ok(state)
}

pub fn clear_workspace_state(app: &tauri::AppHandle, document_id: String) -> Result<bool, String> {
    validate_document_id(&document_id)?;
    let handle = open_library_write(app)?;
    let deleted = handle
        .connection
        .execute(
            "DELETE FROM workspace_state WHERE article_id = ?1",
            params![document_id],
        )
        .map_err(|error| format!("Unable to clear workspace state: {error}"))?;
    Ok(deleted > 0)
}

const DISTRIBUTION_SETTINGS_KEY: &str = "__distribution_defaults__";

fn product_defaults() -> Value {
    json!({
        "theme": "default",
        "lineSpacing": "normal",
        "shortcuts": {
            "block.h1": "Mod-1",
            "block.h2": "Mod-2",
            "block.h3": "Mod-3",
            "block.h4": "Mod-4",
            "block.h5": "Mod-5",
            "document.manual-save": "Mod-s",
            "history.redo": "Mod-Shift-z",
            "history.undo": "Mod-z",
            "search.replace": "Mod-f",
            "text.bold": "Mod-b",
            "text.italic": "Mod-i"
        },
        "recentColors": []
    })
}

fn distribution_defaults() -> Value {
    json!({
        "theme": "default",
        "lineSpacing": "normal",
        "shortcuts": {},
        "recentColors": []
    })
}

fn merge_object_layers(layers: &[&Value]) -> Value {
    fn merge_value(target: &mut Value, incoming: &Value) {
        if let Value::Object(incoming_object) = incoming
            && let Some(target_object) = target.as_object_mut()
        {
            for (key, value) in incoming_object {
                let entry = target_object
                    .entry(key.clone())
                    .or_insert_with(|| json!({}));
                merge_value(entry, value);
            }
        } else {
            *target = incoming.clone();
        }
    }
    let mut result = Map::new();
    for layer in layers {
        if let Value::Object(object) = layer {
            for (key, value) in object {
                let entry = result.entry(key.clone()).or_insert_with(|| json!({}));
                merge_value(entry, value);
            }
        }
    }
    Value::Object(result)
}

fn validate_setting_key(key: &str) -> Result<(), String> {
    if key.trim().is_empty() || key.len() > 160 || path_has_control(key) || key.starts_with("__") {
        return Err("Settings keys are bounded and reserved keys are not user writable.".into());
    }
    Ok(())
}

fn settings_from_connection(
    connection: &Connection,
    database_path: &Path,
) -> Result<SettingsResult, String> {
    let mut user = Map::new();
    let mut incompatible_keys = Vec::new();
    let mut site = distribution_defaults();
    let mut statement = connection
        .prepare("SELECT key, value_json, schema_version FROM settings ORDER BY key")
        .map_err(|error| format!("Unable to read Desktop settings: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|error| format!("Unable to enumerate Desktop settings: {error}"))?;
    for row in rows {
        let (key, raw, schema_version) =
            row.map_err(|error| format!("Unable to read Desktop setting: {error}"))?;
        let parsed = serde_json::from_str::<Value>(&raw);
        if schema_version > SETTINGS_SCHEMA_VERSION || parsed.is_err() {
            incompatible_keys.push(key);
            continue;
        }
        let value = parsed.expect("checked above");
        if key == DISTRIBUTION_SETTINGS_KEY {
            if value.is_object() {
                site = value;
            } else {
                incompatible_keys.push(key);
            }
        } else if key == "__backup_retention__" {
            // Retention is an internal policy and is intentionally not exposed
            // as a user-visible preference layer.
        } else {
            user.insert(key, value);
        }
    }
    let product = product_defaults();
    let resolved = merge_object_layers(&[&product, &site, &Value::Object(user.clone())]);
    Ok(SettingsResult {
        database_path: root_string(database_path),
        schema_version: SETTINGS_SCHEMA_VERSION,
        product_defaults: product,
        distribution_defaults: site,
        user_overrides: Value::Object(user),
        resolved,
        incompatible_keys,
    })
}

pub fn get_settings(app: &tauri::AppHandle) -> Result<SettingsResult, String> {
    let paths = root_paths(app, false)?;
    if !paths.database().is_file() {
        let product = product_defaults();
        let distribution = distribution_defaults();
        return Ok(SettingsResult {
            database_path: root_string(&paths.database()),
            schema_version: SETTINGS_SCHEMA_VERSION,
            product_defaults: product.clone(),
            distribution_defaults: distribution.clone(),
            user_overrides: json!({}),
            resolved: merge_object_layers(&[&product, &distribution]),
            incompatible_keys: Vec::new(),
        });
    }
    let handle = open_library_read(app)?;
    settings_from_connection(&handle.connection, &handle.paths.database())
}

pub fn set_distribution_defaults(
    app: &tauri::AppHandle,
    value: Value,
) -> Result<SettingsResult, String> {
    validate_stable_value(&value, "distribution defaults")?;
    if !value.is_object() {
        return Err("Distribution defaults must be a JSON object.".into());
    }
    let mut handle = open_library_write(app)?;
    let transaction = handle
        .connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Unable to begin distribution settings transaction: {error}"))?;
    transaction
        .execute(
            "INSERT INTO settings(key, value_json, schema_version, updated_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
               schema_version = excluded.schema_version, updated_at = excluded.updated_at",
            params![DISTRIBUTION_SETTINGS_KEY, serde_json::to_string(&value).map_err(|error| error.to_string())?, SETTINGS_SCHEMA_VERSION, now_string()],
        )
        .map_err(|error| format!("Unable to save distribution defaults: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Unable to commit distribution settings transaction: {error}"))?;
    settings_from_connection(&handle.connection, &handle.paths.database())
}

pub fn set_retention_policy(
    app: &tauri::AppHandle,
    policy: RetentionPolicy,
) -> Result<SettingsResult, String> {
    let policy = normalize_retention_policy(policy);
    let mut handle = open_library_write(app)?;
    let transaction = handle
        .connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Unable to begin retention settings transaction: {error}"))?;
    let value = serde_json::to_string(&policy)
        .map_err(|error| format!("Unable to encode retention policy: {error}"))?;
    transaction
        .execute(
            "INSERT INTO settings(key, value_json, schema_version, updated_at) VALUES ('__backup_retention__', ?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
               schema_version = excluded.schema_version, updated_at = excluded.updated_at",
            params![value, SETTINGS_SCHEMA_VERSION, now_string()],
        )
        .map_err(|error| format!("Unable to save retention policy: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Unable to commit retention settings transaction: {error}"))?;
    settings_from_connection(&handle.connection, &handle.paths.database())
}

pub fn set_user_override(
    app: &tauri::AppHandle,
    input: SettingsOverrideInput,
) -> Result<SettingsResult, String> {
    validate_setting_key(&input.key)?;
    validate_stable_value(&input.value, "user setting")?;
    let mut handle = open_library_write(app)?;
    let transaction = handle
        .connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Unable to begin user settings transaction: {error}"))?;
    transaction
        .execute(
            "INSERT INTO settings(key, value_json, schema_version, updated_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
               schema_version = excluded.schema_version, updated_at = excluded.updated_at",
            params![input.key, serde_json::to_string(&input.value).map_err(|error| error.to_string())?, SETTINGS_SCHEMA_VERSION, now_string()],
        )
        .map_err(|error| format!("Unable to save user setting: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Unable to commit user settings transaction: {error}"))?;
    settings_from_connection(&handle.connection, &handle.paths.database())
}

pub fn clear_user_override(app: &tauri::AppHandle, key: String) -> Result<SettingsResult, String> {
    validate_setting_key(&key)?;
    let handle = open_library_write(app)?;
    handle
        .connection
        .execute("DELETE FROM settings WHERE key = ?1", params![key])
        .map_err(|error| format!("Unable to clear user setting: {error}"))?;
    settings_from_connection(&handle.connection, &handle.paths.database())
}

pub fn reset_user_settings(app: &tauri::AppHandle) -> Result<SettingsResult, String> {
    let handle = open_library_write(app)?;
    handle
        .connection
        .execute(
            "DELETE FROM settings WHERE key <> ?1",
            params![DISTRIBUTION_SETTINGS_KEY],
        )
        .map_err(|error| format!("Unable to reset user settings: {error}"))?;
    settings_from_connection(&handle.connection, &handle.paths.database())
}

pub fn export_raw_settings(
    app: &tauri::AppHandle,
    destination_path: String,
) -> Result<SnapshotExportResult, String> {
    let handle = open_library_read(app)?;
    let destination = validate_external_destination(Path::new(&destination_path))?;
    let mut statement = handle
        .connection
        .prepare("SELECT key, value_json, schema_version, updated_at FROM settings ORDER BY key")
        .map_err(|error| format!("Unable to prepare raw settings export: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok(json!({
                "key": row.get::<_, String>(0)?,
                "valueJson": row.get::<_, String>(1)?,
                "schemaVersion": row.get::<_, i64>(2)?,
                "updatedAt": row.get::<_, String>(3)?,
            }))
        })
        .map_err(|error| format!("Unable to enumerate raw settings: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Unable to collect raw settings: {error}"))?;
    let bytes = serde_json::to_vec_pretty(&json!({
        "schemaVersion": SETTINGS_SCHEMA_VERSION,
        "entries": rows,
        "note": "Raw settings are exported without deleting incompatible values.",
    }))
    .map_err(|error| format!("Unable to encode raw settings export: {error}"))?;
    atomic_write(&destination, &bytes, "raw settings export")?;
    Ok(SnapshotExportResult {
        document_id: "settings".into(),
        destination_path: root_string(&destination),
        bytes: bytes.len() as u64,
        sha256: sha256_bytes(&bytes),
    })
}

pub fn sha256_bytes(bytes: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(bytes);
    hex::encode(digest.finalize())
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file =
        File::open(path).map_err(|error| format!("Unable to read file for hashing: {error}"))?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| format!("Unable to hash file: {error}"))?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(hex::encode(digest.finalize()))
}

fn gzip_bytes(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(bytes)
        .map_err(|error| format!("Unable to compress the SQLite snapshot: {error}"))?;
    encoder
        .finish()
        .map_err(|error| format!("Unable to finish the SQLite snapshot compression: {error}"))
}

fn gunzip_bytes(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoder = GzDecoder::new(bytes);
    let mut output = Vec::new();
    decoder
        .read_to_end(&mut output)
        .map_err(|error| format!("Unable to decompress the SQLite snapshot: {error}"))?;
    Ok(output)
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupBlob {
    pub hash: String,
    pub media_type: String,
    pub size: u64,
    pub storage_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifest {
    pub manifest_version: u32,
    pub backup_id: String,
    pub kind: String,
    pub protected: bool,
    pub label: Option<String>,
    pub created_at: String,
    pub library_schema_version: i64,
    pub snapshot_path: String,
    pub snapshot_sha256: String,
    pub snapshot_bytes: u64,
    pub snapshot_uncompressed_sha256: String,
    pub blobs: Vec<BackupBlob>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub manifest: BackupManifest,
    pub manifest_path: String,
    pub total_bytes: u64,
    pub retention_deleted: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupVerificationResult {
    pub backup_id: String,
    pub valid: bool,
    pub snapshot_verified: bool,
    pub database_integrity: bool,
    pub blobs_verified: usize,
    pub missing_blobs: Vec<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRetentionPreview {
    pub policy: RetentionPolicy,
    pub candidates: Vec<BackupRetentionCandidate>,
    pub estimated_release_bytes: u64,
    pub deleted: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct RetentionPolicy {
    pub daily: usize,
    pub weekly: usize,
    pub monthly: usize,
    pub draft_days: i64,
    pub temp_days: i64,
    pub log_files: usize,
    pub log_max_bytes: u64,
}

impl Default for RetentionPolicy {
    fn default() -> Self {
        Self {
            daily: 7,
            weekly: 8,
            monthly: 12,
            draft_days: DEFAULT_DRAFT_RETENTION_DAYS,
            temp_days: DEFAULT_TEMP_RETENTION_DAYS,
            log_files: DEFAULT_LOG_RETENTION_FILES,
            log_max_bytes: DEFAULT_LOG_MAX_BYTES,
        }
    }
}

fn normalize_retention_policy(mut policy: RetentionPolicy) -> RetentionPolicy {
    policy.daily = policy.daily.min(365);
    policy.weekly = policy.weekly.min(365);
    policy.monthly = policy.monthly.min(365);
    policy.draft_days = policy.draft_days.clamp(1, 3650);
    policy.temp_days = policy.temp_days.clamp(1, 3650);
    policy.log_files = policy.log_files.clamp(1, 100);
    policy.log_max_bytes = policy.log_max_bytes.clamp(4096, 100 * 1024 * 1024);
    policy
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRetentionCandidate {
    pub backup_id: String,
    pub kind: String,
    pub manifest_path: String,
    pub snapshot_path: String,
    pub bytes: u64,
    pub protected: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct BackupCreateInput {
    pub kind: Option<String>,
    pub protected: Option<bool>,
    pub label: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupUsageResult {
    pub root: String,
    pub backup_bytes: u64,
    pub snapshot_bytes: u64,
    pub blob_bytes: u64,
    pub manifest_bytes: u64,
    pub backup_count: usize,
    pub protected_count: usize,
    pub temporary_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupGcResult {
    pub preview: bool,
    pub candidates: Vec<String>,
    pub deleted: Vec<String>,
    pub released_bytes: u64,
}

fn valid_hash(hash: &str) -> bool {
    hash.len() == 64 && hash.chars().all(|character| character.is_ascii_hexdigit())
}

fn backup_kind(kind: Option<&str>) -> Result<String, String> {
    let kind = kind.unwrap_or("daily").trim().to_ascii_lowercase();
    if matches!(
        kind.as_str(),
        "daily" | "weekly" | "monthly" | "manual" | "migration" | "restore"
    ) {
        Ok(kind)
    } else {
        Err(format!("Unsupported backup kind: {kind}"))
    }
}

fn backup_manifest_path(root: &Path, backup_id: &str) -> Result<PathBuf, String> {
    let id = safe_component(backup_id, "The backup id")?;
    safe_join(root, &format!("backups/manifests/{id}.json"))
}

fn backup_snapshot_path(root: &Path, backup_id: &str) -> Result<PathBuf, String> {
    let id = safe_component(backup_id, "The backup id")?;
    safe_join(root, &format!("backups/snapshots/{id}.db.gz"))
}

fn read_backup_manifest(root: &Path, backup_id: &str) -> Result<(BackupManifest, PathBuf), String> {
    let path = backup_manifest_path(root, backup_id)?;
    let bytes =
        fs::read(&path).map_err(|error| format!("Unable to read backup manifest: {error}"))?;
    let manifest: BackupManifest = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Backup manifest is invalid: {error}"))?;
    if manifest.manifest_version != 1
        || manifest.backup_id != backup_id
        || !valid_hash(&manifest.snapshot_sha256)
        || !valid_hash(&manifest.snapshot_uncompressed_sha256)
    {
        return Err("Backup manifest schema or hash is invalid.".into());
    }
    let expected_snapshot = format!("backups/snapshots/{backup_id}.db.gz");
    if manifest.snapshot_path != expected_snapshot {
        return Err("Backup manifest snapshot path is unsafe or does not match its id.".into());
    }
    for blob in &manifest.blobs {
        if !valid_hash(&blob.hash) || blob.storage_key != format!("assets/sha256/{0}", blob.hash) {
            return Err("Backup manifest contains an unsafe asset reference.".into());
        }
    }
    Ok((manifest, path))
}

fn list_backup_manifests(root: &Path) -> Result<Vec<(BackupManifest, PathBuf)>, String> {
    let directory = safe_join(root, "backups/manifests")?;
    let mut result = Vec::new();
    let entries = fs::read_dir(directory)
        .map_err(|error| format!("Unable to enumerate backup manifests: {error}"))?;
    for entry in entries {
        let entry =
            entry.map_err(|error| format!("Unable to enumerate backup manifests: {error}"))?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let id = path
            .file_stem()
            .and_then(|value| value.to_str())
            .ok_or_else(|| "Backup manifest has no valid id.".to_string())?;
        result.push(read_backup_manifest(root, id)?);
    }
    result.sort_by(|left, right| right.0.created_at.cmp(&left.0.created_at));
    Ok(result)
}

fn snapshot_asset_rows(connection: &Connection) -> Result<Vec<BackupBlob>, String> {
    if !table_exists(connection, "assets")? {
        return Ok(Vec::new());
    }
    let mut statement = connection
        .prepare("SELECT hash, media_type, size, storage_key FROM assets ORDER BY hash")
        .map_err(|error| format!("Unable to prepare backup asset list: {error}"))?;
    statement
        .query_map([], |row| {
            Ok(BackupBlob {
                hash: row.get(0)?,
                media_type: row.get(1)?,
                size: row.get::<_, i64>(2)?.max(0) as u64,
                storage_key: row.get(3)?,
            })
        })
        .map_err(|error| format!("Unable to enumerate backup assets: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Unable to collect backup assets: {error}"))
}

fn create_backup_manifest_from_connection(
    paths: &RootPaths,
    connection: &Connection,
    kind: &str,
    protected: bool,
    label: Option<String>,
    library_schema_version: i64,
) -> Result<(BackupManifest, PathBuf), String> {
    fail_if_injected("database")?;
    let kind = backup_kind(Some(kind))?;
    if fault_enabled("wal") {
        return Err("Injected WAL/checkpoint failure.".into());
    }
    connection
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
        .map_err(|error| format!("Unable to checkpoint SQLite WAL before backup: {error}"))?;
    let backup_id = new_id(&format!("backup-{kind}"));
    let temp_directory = safe_join(&paths.root, &format!("tmp/backup/{backup_id}"))?;
    fs::create_dir_all(&temp_directory)
        .map_err(|error| format!("Unable to create backup staging directory: {error}"))?;
    atomic_write(
        &temp_directory.join("marker.json"),
        json!({
            "markerVersion": 1,
            "tempType": "backup",
            "sessionId": backup_id.clone(),
            "state": "active",
            "operation": "sqlite-snapshot",
            "createdAt": now_string()
        })
        .to_string()
        .as_bytes(),
        "backup transaction marker",
    )?;
    let temp_database = temp_directory.join("library.db");
    connection
        .backup("main", &temp_database, None)
        .map_err(|error| format!("SQLite backup API failed: {error}"))?;
    let uncompressed = fs::read(&temp_database)
        .map_err(|error| format!("Unable to read SQLite backup snapshot: {error}"))?;
    let uncompressed_hash = sha256_bytes(&uncompressed);
    let compressed = gzip_bytes(&uncompressed)?;
    let snapshot_path = backup_snapshot_path(&paths.root, &backup_id)?;
    atomic_write(&snapshot_path, &compressed, "compressed SQLite snapshot")?;
    let snapshot_hash = sha256_file(&snapshot_path)?;
    let blobs = snapshot_asset_rows(connection)?;
    for blob in &blobs {
        if !valid_hash(&blob.hash) {
            return Err("Library asset hash is invalid; backup aborted.".into());
        }
        let path = safe_join(&paths.root, &blob.storage_key)?;
        if !path.is_file() || sha256_file(&path)? != blob.hash {
            return Err(format!(
                "Library asset {} is missing or corrupt; backup aborted.",
                blob.hash
            ));
        }
    }
    let snapshot_relative = format!("backups/snapshots/{backup_id}.db.gz");
    let manifest = BackupManifest {
        manifest_version: 1,
        backup_id: backup_id.clone(),
        kind,
        protected,
        label,
        created_at: now_string(),
        library_schema_version,
        snapshot_path: snapshot_relative,
        snapshot_sha256: snapshot_hash,
        snapshot_bytes: compressed.len() as u64,
        snapshot_uncompressed_sha256: uncompressed_hash,
        blobs,
    };
    let manifest_path = backup_manifest_path(&paths.root, &backup_id)?;
    let bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|error| format!("Unable to encode backup manifest: {error}"))?;
    atomic_write(&manifest_path, &bytes, "backup manifest")?;
    let _ = fs::remove_dir_all(&temp_directory);
    Ok((manifest, manifest_path))
}

fn retention_policy_from_connection(connection: &Connection) -> RetentionPolicy {
    let mut policy = RetentionPolicy::default();
    let Ok(raw) = connection
        .query_row(
            "SELECT value_json FROM settings WHERE key = '__backup_retention__' AND schema_version <= ?1",
            params![SETTINGS_SCHEMA_VERSION],
            |row| row.get::<_, String>(0),
        )
    else {
        return policy;
    };
    if let Ok(value) = serde_json::from_str::<RetentionPolicy>(&raw) {
        policy = value;
    }
    normalize_retention_policy(policy)
}

fn retention_policy_for_root(root: &Path) -> RetentionPolicy {
    let database = root.join("library.db");
    Connection::open_with_flags(database, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .ok()
        .map(|connection| retention_policy_from_connection(&connection))
        .unwrap_or_default()
}

fn backup_candidate_bytes(root: &Path, manifest: &BackupManifest, manifest_path: &Path) -> u64 {
    let snapshot = backup_snapshot_path(root, &manifest.backup_id)
        .ok()
        .and_then(|path| fs::metadata(path).ok().map(|metadata| metadata.len()))
        .unwrap_or(0);
    snapshot
        + fs::metadata(manifest_path)
            .map(|metadata| metadata.len())
            .unwrap_or(0)
}

fn retention_candidates(
    root: &Path,
    policy: &RetentionPolicy,
) -> Result<Vec<BackupRetentionCandidate>, String> {
    let manifests = list_backup_manifests(root)?;
    let mut candidates = Vec::new();
    for kind in ["daily", "weekly", "monthly"] {
        let limit = match kind {
            "daily" => policy.daily,
            "weekly" => policy.weekly,
            _ => policy.monthly,
        };
        let mut automatic = manifests
            .iter()
            .filter(|(manifest, _)| manifest.kind == kind && !manifest.protected)
            .collect::<Vec<_>>();
        automatic.sort_by(|left, right| right.0.created_at.cmp(&left.0.created_at));
        for (manifest, path) in automatic.into_iter().skip(limit) {
            candidates.push(BackupRetentionCandidate {
                backup_id: manifest.backup_id.clone(),
                kind: manifest.kind.clone(),
                manifest_path: root_string(path),
                snapshot_path: root_string(&backup_snapshot_path(root, &manifest.backup_id)?),
                bytes: backup_candidate_bytes(root, manifest, path),
                protected: manifest.protected,
            });
        }
    }
    Ok(candidates)
}

fn apply_retention(root: &Path, policy: &RetentionPolicy) -> Result<Vec<String>, String> {
    let candidates = retention_candidates(root, policy)?;
    let mut deleted = Vec::new();
    for candidate in candidates {
        let manifest_path = PathBuf::from(&candidate.manifest_path);
        let snapshot_path = PathBuf::from(&candidate.snapshot_path);
        if !candidate.protected {
            if manifest_path.exists() {
                fs::remove_file(&manifest_path).map_err(|error| {
                    format!("Unable to remove retained backup manifest: {error}")
                })?;
            }
            if snapshot_path.exists() {
                fs::remove_file(&snapshot_path).map_err(|error| {
                    format!("Unable to remove retained backup snapshot: {error}")
                })?;
            }
            deleted.push(candidate.backup_id);
        }
    }
    Ok(deleted)
}

pub fn create_backup(
    app: &tauri::AppHandle,
    input: BackupCreateInput,
) -> Result<BackupResult, String> {
    let handle = open_library_write(app)?;
    let kind = backup_kind(input.kind.as_deref())?;
    let protected = input
        .protected
        .unwrap_or(kind == "manual" || kind == "migration" || kind == "restore");
    let (manifest, manifest_path) = create_backup_manifest_from_connection(
        &handle.paths,
        &handle.connection,
        &kind,
        protected,
        input.label,
        LIBRARY_SCHEMA_VERSION,
    )?;
    let policy = retention_policy_from_connection(&handle.connection);
    let retention_deleted = apply_retention(&handle.paths.root, &policy)?;
    Ok(BackupResult {
        total_bytes: manifest.snapshot_bytes
            + manifest.blobs.iter().map(|blob| blob.size).sum::<u64>(),
        manifest,
        manifest_path: root_string(&manifest_path),
        retention_deleted,
    })
}

pub fn create_migration_backup(
    paths: &RootPaths,
    connection: &Connection,
    from_schema: i64,
) -> Result<(), String> {
    let (manifest, _) = create_backup_manifest_from_connection(
        paths,
        connection,
        "migration",
        true,
        Some(format!("pre-migration-schema-{from_schema}")),
        from_schema,
    )?;
    append_log(
        paths,
        "info",
        "library.migration.backup-created",
        json!({"backupId": manifest.backup_id, "fromSchema": from_schema}),
    );
    Ok(())
}

pub fn list_backups(app: &tauri::AppHandle) -> Result<Vec<BackupManifest>, String> {
    let paths = root_paths(app, false)?;
    list_backup_manifests(&paths.root)
        .map(|items| items.into_iter().map(|(manifest, _)| manifest).collect())
}

fn verify_backup_at_root(root: &Path, backup_id: &str) -> Result<BackupVerificationResult, String> {
    let (manifest, _) = read_backup_manifest(root, backup_id)?;
    let snapshot = backup_snapshot_path(root, backup_id)?;
    let mut result = BackupVerificationResult {
        backup_id: backup_id.into(),
        valid: false,
        snapshot_verified: false,
        database_integrity: false,
        blobs_verified: 0,
        missing_blobs: Vec::new(),
        reason: None,
    };
    let compressed =
        fs::read(&snapshot).map_err(|error| format!("Unable to read backup snapshot: {error}"))?;
    if sha256_bytes(&compressed) != manifest.snapshot_sha256 {
        result.reason = Some("Backup snapshot hash does not match its manifest.".into());
        return Ok(result);
    }
    let uncompressed = match gunzip_bytes(&compressed) {
        Ok(bytes) => bytes,
        Err(error) => {
            result.reason = Some(error);
            return Ok(result);
        }
    };
    if sha256_bytes(&uncompressed) != manifest.snapshot_uncompressed_sha256 {
        result.reason =
            Some("Uncompressed backup snapshot hash does not match its manifest.".into());
        return Ok(result);
    }
    result.snapshot_verified = true;
    let verify_dir = safe_join(root, &format!("tmp/restore/verify-{}", new_id("backup")))?;
    fs::create_dir_all(&verify_dir)
        .map_err(|error| format!("Unable to create backup verification staging: {error}"))?;
    let database = verify_dir.join("library.db");
    atomic_write(&database, &uncompressed, "backup verification database")?;
    let connection = match Connection::open_with_flags(&database, OpenFlags::SQLITE_OPEN_READ_ONLY)
    {
        Ok(connection) => connection,
        Err(error) => {
            let _ = fs::remove_dir_all(&verify_dir);
            result.reason = Some(format!(
                "Backup snapshot is not a readable SQLite database: {error}"
            ));
            return Ok(result);
        }
    };
    let snapshot_schema = schema_meta_version(&connection)
        .ok()
        .flatten()
        .unwrap_or_default();
    if configure_read(&connection).is_ok()
        && snapshot_schema > 0
        && snapshot_schema <= LIBRARY_SCHEMA_VERSION
        && if snapshot_schema == LIBRARY_SCHEMA_VERSION {
            validate_schema(&connection).is_ok()
        } else {
            validate_legacy_schema(&connection).is_ok()
        }
        && integrity_check(&connection).is_ok()
    {
        result.database_integrity = true;
    } else {
        result.reason = Some("Backup snapshot failed schema or integrity validation.".into());
    }
    drop(connection);
    let _ = fs::remove_dir_all(&verify_dir);
    for blob in &manifest.blobs {
        let path = safe_join(root, &blob.storage_key)?;
        if path.is_file() && sha256_file(&path)? == blob.hash {
            result.blobs_verified += 1;
        } else {
            result.missing_blobs.push(blob.hash.clone());
        }
    }
    result.valid =
        result.snapshot_verified && result.database_integrity && result.missing_blobs.is_empty();
    if !result.valid && result.reason.is_none() {
        result.reason = Some("One or more backup blobs are missing or corrupt.".into());
    }
    Ok(result)
}

pub fn verify_backup(
    app: &tauri::AppHandle,
    backup_id: String,
) -> Result<BackupVerificationResult, String> {
    let paths = root_paths(app, false)?;
    verify_backup_at_root(&paths.root, &backup_id)
}

pub fn retention_preview(app: &tauri::AppHandle) -> Result<BackupRetentionPreview, String> {
    let paths = root_paths(app, false)?;
    let policy = retention_policy_for_root(&paths.root);
    let candidates = retention_candidates(&paths.root, &policy)?;
    let estimated_release_bytes = candidates.iter().map(|candidate| candidate.bytes).sum();
    Ok(BackupRetentionPreview {
        policy,
        candidates,
        estimated_release_bytes,
        deleted: Vec::new(),
    })
}

pub fn cleanup_backups(app: &tauri::AppHandle) -> Result<BackupRetentionPreview, String> {
    let handle = open_library_write(app)?;
    let policy = retention_policy_from_connection(&handle.connection);
    let candidates = retention_candidates(&handle.paths.root, &policy)?;
    let estimated_release_bytes = candidates.iter().map(|candidate| candidate.bytes).sum();
    let deleted = apply_retention(&handle.paths.root, &policy)?;
    Ok(BackupRetentionPreview {
        policy,
        candidates,
        estimated_release_bytes,
        deleted,
    })
}

fn directory_size(path: &Path, include_tmp: bool) -> Result<u64, String> {
    if !path.exists() {
        return Ok(0);
    }
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Unable to inspect storage usage path: {error}"))?;
    if metadata.file_type().is_symlink() {
        return Err("Symlinked storage paths are not supported.".into());
    }
    if metadata.is_file() {
        return Ok(metadata.len());
    }
    let mut total = 0_u64;
    for entry in
        fs::read_dir(path).map_err(|error| format!("Unable to inspect storage usage: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Unable to inspect storage usage: {error}"))?;
        if !include_tmp && entry.file_name() == "tmp" {
            continue;
        }
        total = total.saturating_add(directory_size(&entry.path(), include_tmp)?);
    }
    Ok(total)
}

pub fn backup_usage(app: &tauri::AppHandle) -> Result<BackupUsageResult, String> {
    let paths = root_paths(app, false)?;
    let backup = directory_size(&paths.backups(), true)?;
    let snapshots = directory_size(&paths.backups().join("snapshots"), true)?;
    let blobs = directory_size(&paths.backups().join("blobs"), true)?
        + directory_size(&paths.assets(), true)?;
    let manifests = directory_size(&paths.backups().join("manifests"), true)?;
    let manifests_list = list_backup_manifests(&paths.root)?;
    let protected_count = manifests_list
        .iter()
        .filter(|(manifest, _)| manifest.protected)
        .count();
    Ok(BackupUsageResult {
        root: "<data-root>".into(),
        backup_bytes: backup,
        snapshot_bytes: snapshots,
        blob_bytes: blobs,
        manifest_bytes: manifests,
        backup_count: manifests_list.len(),
        protected_count,
        temporary_bytes: directory_size(&paths.tmp(), true)?,
    })
}

pub fn gc_backups(app: &tauri::AppHandle, preview: bool) -> Result<BackupGcResult, String> {
    let mut handle = open_library_write(app)?;
    let manifests = list_backup_manifests(&handle.paths.root)?;
    let mut reachable = HashSet::new();
    for (manifest, _) in &manifests {
        for blob in &manifest.blobs {
            reachable.insert(blob.hash.clone());
        }
    }
    let mut statement = handle
        .connection
        .prepare("SELECT asset_hash FROM article_asset_refs")
        .map_err(|error| format!("Unable to prepare asset reachability query: {error}"))?;
    let refs = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("Unable to enumerate asset reachability: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Unable to collect asset reachability: {error}"))?;
    drop(statement);
    reachable.extend(refs);
    let directory = safe_join(&handle.paths.root, "assets/sha256")?;
    let mut candidates = Vec::new();
    if directory.exists() {
        for entry in fs::read_dir(&directory)
            .map_err(|error| format!("Unable to enumerate CAS blobs: {error}"))?
        {
            let entry = entry.map_err(|error| format!("Unable to enumerate CAS blobs: {error}"))?;
            let path = entry.path();
            let hash = entry.file_name().to_string_lossy().into_owned();
            if path.is_file() && valid_hash(&hash) && !reachable.contains(&hash) {
                candidates.push((hash, path));
            }
        }
    }
    let candidate_names = candidates
        .iter()
        .map(|(hash, _)| hash.clone())
        .collect::<Vec<_>>();
    let released_bytes = candidates
        .iter()
        .map(|(_, path)| {
            fs::metadata(path)
                .map(|metadata| metadata.len())
                .unwrap_or(0)
        })
        .sum();
    if !preview {
        let staging = safe_join(&handle.paths.root, &format!("tmp/backup/{}", new_id("gc")))?;
        fs::create_dir_all(&staging)
            .map_err(|error| format!("Unable to create CAS GC staging: {error}"))?;
        atomic_write(
            &staging.join("marker.json"),
            json!({"markerVersion":1,"tempType":"backup","sessionId":staging.file_name().and_then(|value| value.to_str()).unwrap_or("gc"),"state":"active","createdAt":now_string()}).to_string().as_bytes(),
            "CAS GC marker",
        )?;
        let mut moved = Vec::new();
        for (hash, path) in &candidates {
            let staged = staging.join(hash);
            if let Err(error) = fs::rename(path, &staged) {
                for (original, temporary) in moved.iter().rev() {
                    let _ = fs::rename(temporary, original);
                }
                let _ = fs::remove_dir_all(&staging);
                return Err(format!("Unable to stage unreachable CAS blob: {error}"));
            }
            moved.push((path.clone(), staged));
        }
        let cleanup_result = (|| -> Result<(), String> {
            let transaction = handle
                .connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(|error| format!("Unable to begin CAS GC transaction: {error}"))?;
            for hash in &candidate_names {
                transaction
                    .execute("DELETE FROM assets WHERE hash = ?1 AND NOT EXISTS (SELECT 1 FROM article_asset_refs WHERE asset_hash = ?1)", params![hash])
                    .map_err(|error| format!("Unable to remove unreachable CAS metadata: {error}"))?;
            }
            transaction
                .commit()
                .map_err(|error| format!("Unable to commit CAS GC transaction: {error}"))?;
            Ok(())
        })();
        if let Err(error) = cleanup_result {
            for (original, temporary) in moved.iter().rev() {
                let _ = fs::rename(temporary, original);
            }
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
        let _ = fs::remove_dir_all(&staging);
    }
    Ok(BackupGcResult {
        preview,
        candidates: candidate_names.clone(),
        deleted: if preview { Vec::new() } else { candidate_names },
        released_bytes,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRestoreResult {
    pub backup_id: String,
    pub restored: bool,
    pub restored_database_path: String,
    pub rollback_backup_id: Option<String>,
    pub message: String,
}

pub fn restore_backup(
    app: &tauri::AppHandle,
    backup_id: String,
) -> Result<BackupRestoreResult, String> {
    let paths = root_paths(app, true)?;
    let barrier = acquire_write_barrier(&paths.root, "restore")?;
    let verification = verify_backup_at_root(&paths.root, &backup_id)?;
    if !verification.valid {
        return Err(format!(
            "BACKUP_INVALID: restore refused: {}",
            verification
                .reason
                .unwrap_or_else(|| "backup verification failed".into())
        ));
    }
    let current = Connection::open(paths.database())
        .map_err(|error| format!("Unable to open the current Library before restore: {error}"))?;
    configure_write(&current)?;
    integrity_check(&current)?;
    let (rollback_manifest, _) = create_backup_manifest_from_connection(
        &paths,
        &current,
        "restore",
        true,
        Some(format!("pre-restore-{backup_id}")),
        LIBRARY_SCHEMA_VERSION,
    )?;
    current
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
        .map_err(|error| format!("Unable to checkpoint current Library before restore: {error}"))?;
    drop(current);
    let snapshot = backup_snapshot_path(&paths.root, &backup_id)?;
    let compressed =
        fs::read(snapshot).map_err(|error| format!("Unable to read restore snapshot: {error}"))?;
    let database_bytes = gunzip_bytes(&compressed)?;
    let session_id = new_id("restore");
    let staging = safe_join(&paths.root, &format!("tmp/restore/{session_id}"))?;
    fs::create_dir_all(&staging)
        .map_err(|error| format!("Unable to create restore staging: {error}"))?;
    let marker =
        json!({"type":"restore","sessionId":session_id,"state":"active","createdAt":now_string()});
    atomic_write(
        &staging.join(".marker.json"),
        marker.to_string().as_bytes(),
        "restore marker",
    )?;
    let staged_database = staging.join("library.db");
    atomic_write(
        &staged_database,
        &database_bytes,
        "restore staging database",
    )?;
    if fault_enabled("interrupt-restore") {
        return Err(format!(
            "Injected restore interruption; staging retained at {}.",
            root_string(&staging)
        ));
    }
    let check = Connection::open_with_flags(&staged_database, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("Restore staging database cannot be opened: {error}"))?;
    configure_read(&check)?;
    validate_supported_schema(&check)?;
    integrity_check(&check)?;
    drop(check);
    let previous = staging.join("library.db.previous");
    let database = paths.database();
    let old_wal = PathBuf::from(format!("{}-wal", root_string(&database)));
    let old_shm = PathBuf::from(format!("{}-shm", root_string(&database)));
    if database.exists() {
        fs::rename(&database, &previous)
            .map_err(|error| format!("Unable to stage the current Library for restore: {error}"))?;
    }
    let _ = fs::remove_file(&old_wal);
    let _ = fs::remove_file(&old_shm);
    if let Err(error) = fs::rename(&staged_database, &database) {
        if previous.exists() {
            let _ = fs::rename(&previous, &database);
        }
        return Err(format!(
            "Unable to activate restored Library database; rollback completed: {error}"
        ));
    }
    let health = (|| -> Result<(), String> {
        let restored = Connection::open_with_flags(&database, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|error| format!("Restored Library cannot be opened: {error}"))?;
        configure_read(&restored)?;
        validate_supported_schema(&restored)?;
        integrity_check(&restored)
    })();
    if let Err(error) = health {
        let failed = staging.join("library.db.failed");
        let _ = fs::rename(&database, &failed);
        if previous.exists() {
            let _ = fs::rename(&previous, &database);
        }
        return Err(format!(
            "Restored Library health check failed; rollback completed: {error}"
        ));
    }
    let _ = fs::remove_file(&previous);
    let _ = fs::remove_file(staging.join(".marker.json"));
    let _ = fs::remove_dir_all(&staging);
    drop(barrier);
    Ok(BackupRestoreResult {
        backup_id,
        restored: true,
        restored_database_path: root_string(&database),
        rollback_backup_id: Some(rollback_manifest.backup_id),
        message: "Backup restored after staging, hash, schema, and integrity verification.".into(),
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetPutInput {
    pub hash: Option<String>,
    pub media_type: Option<String>,
    pub data: Option<Vec<u8>>,
    pub data_base64: Option<String>,
    pub data_url: Option<String>,
    pub article_id: Option<String>,
    pub role: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetResult {
    pub hash: String,
    pub media_type: String,
    pub size: u64,
    pub storage_key: String,
    pub referenced: bool,
}

fn asset_bytes(input: &AssetPutInput) -> Result<Vec<u8>, String> {
    if let Some(value) = input.data_base64.as_deref() {
        return base64::engine::general_purpose::STANDARD
            .decode(value)
            .map_err(|error| format!("Asset base64 data is invalid: {error}"));
    }
    if let Some(value) = input.data_url.as_deref() {
        let (_, payload) = value
            .split_once(',')
            .ok_or_else(|| "Asset data URL is invalid.".to_string())?;
        if value[..value.find(',').unwrap_or(0)]
            .to_ascii_lowercase()
            .contains(";base64")
        {
            return base64::engine::general_purpose::STANDARD
                .decode(payload)
                .map_err(|error| format!("Asset data URL is invalid: {error}"));
        }
        return Ok(payload.as_bytes().to_vec());
    }
    Ok(input.data.clone().unwrap_or_default())
}

pub fn put_asset(app: &tauri::AppHandle, input: AssetPutInput) -> Result<AssetResult, String> {
    let bytes = asset_bytes(&input)?;
    if bytes.is_empty() {
        return Err("Asset data cannot be empty.".into());
    }
    let hash = sha256_bytes(&bytes);
    if let Some(expected) = input.hash.as_deref()
        && expected.to_ascii_lowercase() != hash
    {
        return Err("Asset hash does not match its content.".into());
    }
    let media_type = input
        .media_type
        .unwrap_or_else(|| "application/octet-stream".into());
    if media_type.trim().is_empty() || media_type.len() > 200 || path_has_control(&media_type) {
        return Err("Asset media type is invalid.".into());
    }
    let mut handle = open_library_write(app)?;
    let asset_directory = safe_join(&handle.paths.root, "assets/sha256")?;
    fs::create_dir_all(&asset_directory)
        .map_err(|error| format!("Unable to create the asset CAS directory: {error}"))?;
    let final_path = safe_join(&handle.paths.root, &format!("assets/sha256/{hash}"))?;
    let staged_directory = safe_join(
        &handle.paths.root,
        &format!("tmp/asset/{}", new_id("asset")),
    )?;
    fs::create_dir_all(&staged_directory)
        .map_err(|error| format!("Unable to create asset staging directory: {error}"))?;
    atomic_write(
        &staged_directory.join("marker.json"),
        json!({
            "markerVersion": 1,
            "tempType": "asset",
            "sessionId": staged_directory.file_name().and_then(|value| value.to_str()).unwrap_or("asset"),
            "state": "active",
            "operation": "asset-put",
            "createdAt": now_string()
        })
        .to_string()
        .as_bytes(),
        "asset transaction marker",
    )?;
    let staged_path = staged_directory.join("blob");
    atomic_write(&staged_path, &bytes, "asset staging blob")?;
    let mut created_file = false;
    if final_path.exists() {
        if sha256_file(&final_path)? != hash {
            let _ = fs::remove_dir_all(&staged_directory);
            return Err("Existing CAS blob failed its hash check.".into());
        }
        let _ = fs::remove_file(&staged_path);
    } else {
        fs::rename(&staged_path, &final_path)
            .map_err(|error| format!("Unable to activate CAS blob: {error}"))?;
        created_file = true;
    }
    let storage_key = format!("assets/sha256/{hash}");
    let result = (|| -> Result<bool, String> {
        let transaction = handle
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| format!("Unable to begin asset transaction: {error}"))?;
        transaction
            .execute(
                "INSERT INTO assets(hash, media_type, size, storage_key, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(hash) DO UPDATE SET media_type = excluded.media_type, size = excluded.size, storage_key = excluded.storage_key",
                params![hash, media_type, bytes.len() as i64, storage_key, now_string()],
            )
            .map_err(|error| format!("Unable to persist asset metadata: {error}"))?;
        let referenced = if let Some(article_id) = input.article_id.as_deref() {
            validate_document_id(article_id)?;
            let role = input.role.as_deref().unwrap_or("content");
            safe_component(role, "The asset reference role")?;
            let exists = transaction
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM articles WHERE id = ?1)",
                    params![article_id],
                    |row| row.get::<_, i64>(0),
                )
                .map_err(|error| format!("Unable to inspect asset reference article: {error}"))?
                == 1;
            if !exists {
                return Err(
                    "ARTICLE_NOT_FOUND: cannot attach an asset to a missing article.".into(),
                );
            }
            transaction
                .execute(
                    "INSERT OR IGNORE INTO article_asset_refs(article_id, asset_hash, role, created_at) VALUES (?1, ?2, ?3, ?4)",
                    params![article_id, hash, role, now_string()],
                )
                .map_err(|error| format!("Unable to persist asset reference: {error}"))?;
            true
        } else {
            false
        };
        transaction
            .commit()
            .map_err(|error| format!("Unable to commit asset transaction: {error}"))?;
        Ok(referenced)
    })();
    let _ = fs::remove_dir_all(&staged_directory);
    let referenced = match result {
        Ok(value) => value,
        Err(error) => {
            if created_file {
                let _ = fs::remove_file(&final_path);
            }
            return Err(error);
        }
    };
    Ok(AssetResult {
        hash,
        media_type,
        size: bytes.len() as u64,
        storage_key,
        referenced,
    })
}

pub fn link_asset(
    app: &tauri::AppHandle,
    document_id: String,
    hash: String,
    role: String,
) -> Result<bool, String> {
    validate_document_id(&document_id)?;
    if !valid_hash(&hash) {
        return Err("Asset hash is invalid.".into());
    }
    safe_component(&role, "The asset reference role")?;
    let mut handle = open_library_write(app)?;
    let transaction = handle
        .connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Unable to begin asset reference transaction: {error}"))?;
    let storage_key = transaction
        .query_row(
            "SELECT storage_key FROM assets WHERE hash = ?1",
            params![hash],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("Unable to inspect asset metadata: {error}"))?
        .ok_or_else(|| "ASSET_NOT_FOUND: the CAS blob is not registered.".to_string())?;
    let path = safe_join(&handle.paths.root, &storage_key)?;
    if !path.is_file() || sha256_file(&path)? != hash {
        return Err("ASSET_CORRUPT: the CAS blob failed its hash check.".into());
    }
    transaction
        .execute(
            "INSERT OR IGNORE INTO article_asset_refs(article_id, asset_hash, role, created_at)
             SELECT ?1, ?2, ?3, ?4 WHERE EXISTS(SELECT 1 FROM articles WHERE id = ?1)",
            params![document_id, hash, role, now_string()],
        )
        .map_err(|error| format!("Unable to link CAS asset: {error}"))?;
    let changed = transaction.changes() > 0;
    transaction
        .commit()
        .map_err(|error| format!("Unable to commit asset reference transaction: {error}"))?;
    if !changed {
        return Err("ARTICLE_NOT_FOUND or asset reference already exists.".into());
    }
    Ok(true)
}

pub fn unlink_asset(
    app: &tauri::AppHandle,
    document_id: String,
    hash: String,
    role: String,
) -> Result<bool, String> {
    validate_document_id(&document_id)?;
    if !valid_hash(&hash) {
        return Err("Asset hash is invalid.".into());
    }
    safe_component(&role, "The asset reference role")?;
    let handle = open_library_write(app)?;
    let deleted = handle
        .connection
        .execute(
            "DELETE FROM article_asset_refs WHERE article_id = ?1 AND asset_hash = ?2 AND role = ?3",
            params![document_id, hash, role],
        )
        .map_err(|error| format!("Unable to unlink CAS asset: {error}"))?;
    Ok(deleted > 0)
}

pub fn list_asset_refs(
    app: &tauri::AppHandle,
    document_id: String,
) -> Result<Vec<AssetResult>, String> {
    validate_document_id(&document_id)?;
    let handle = open_library_read(app)?;
    let mut statement = handle
        .connection
        .prepare(
            "SELECT a.hash, a.media_type, a.size, a.storage_key,
                    EXISTS(SELECT 1 FROM article_asset_refs r WHERE r.article_id = ?1 AND r.asset_hash = a.hash)
             FROM assets a JOIN article_asset_refs refs ON refs.asset_hash = a.hash
             WHERE refs.article_id = ?1 ORDER BY a.hash",
        )
        .map_err(|error| format!("Unable to prepare asset reference list: {error}"))?;
    statement
        .query_map(params![document_id], |row| {
            Ok(AssetResult {
                hash: row.get(0)?,
                media_type: row.get(1)?,
                size: row.get::<_, i64>(2)?.max(0) as u64,
                storage_key: row.get(3)?,
                referenced: row.get::<_, i64>(4)? == 1,
            })
        })
        .map_err(|error| format!("Unable to enumerate asset references: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Unable to collect asset references: {error}"))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataRootMigrationResult {
    pub old_root: String,
    pub new_root: String,
    pub staging_path: String,
    pub switched: bool,
    pub old_root_retained: bool,
    pub file_count: usize,
    pub total_bytes: u64,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CopyManifest {
    manifest_version: u32,
    operation: String,
    created_at: String,
    files: Vec<CopyManifestEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CopyManifestEntry {
    path: String,
    sha256: String,
    bytes: u64,
}

fn write_root_metadata_with_id(root: &Path, root_id: String) -> Result<(), String> {
    let created_at = now_string();
    atomic_write(
        &root.join("root.marker"),
        format!("w-editor-data-root\nschemaVersion={DATA_ROOT_SCHEMA_VERSION}\nrootId={root_id}\n")
            .as_bytes(),
        "Data Root marker",
    )?;
    let manifest = build_manifest(root_id, created_at);
    let bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|error| format!("Unable to encode the Data Root manifest: {error}"))?;
    atomic_write(&root.join("manifest.json"), &bytes, "Data Root manifest")
}

fn collect_durable_hashes(
    root: &Path,
    current: &Path,
    relative: &Path,
    hashes: &mut BTreeMap<String, String>,
) -> Result<(), String> {
    let metadata = fs::symlink_metadata(current)
        .map_err(|error| format!("Unable to inspect durable Data Root entry: {error}"))?;
    if metadata.file_type().is_symlink() {
        return Err("Symlinked durable Data Root entries are not allowed.".into());
    }
    if metadata.is_dir() {
        for entry in fs::read_dir(current)
            .map_err(|error| format!("Unable to enumerate durable Data Root entries: {error}"))?
        {
            let entry = entry.map_err(|error| {
                format!("Unable to enumerate durable Data Root entries: {error}")
            })?;
            let name = entry.file_name();
            if relative.as_os_str().is_empty() && name == "tmp" {
                continue;
            }
            collect_durable_hashes(root, &entry.path(), &relative.join(&name), hashes)?;
        }
    } else if metadata.is_file() {
        let relative_name = relative.to_string_lossy().replace('\\', "/");
        if relative_name != "manifest.json" {
            hashes.insert(relative_name, sha256_file(current)?);
        }
    }
    let _ = root;
    Ok(())
}

fn refresh_manifest_hashes(root: &Path) -> Result<(), String> {
    let mut manifest = read_manifest(root)?;
    let mut hashes = BTreeMap::new();
    collect_durable_hashes(root, root, Path::new(""), &mut hashes)?;
    manifest.durable_file_hashes = hashes;
    manifest.updated_at = now_string();
    let bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|error| format!("Unable to encode Data Root manifest hashes: {error}"))?;
    atomic_write(&root.join("manifest.json"), &bytes, "Data Root manifest")
}

fn copy_regular_tree(
    source: &Path,
    destination: &Path,
    relative: &Path,
    entries: &mut Vec<CopyManifestEntry>,
) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source)
        .map_err(|error| format!("Unable to inspect Data Root migration source: {error}"))?;
    if metadata.file_type().is_symlink() {
        return Err(format!(
            "Data Root migration refuses symlink: {}",
            root_string(source)
        ));
    }
    if metadata.is_dir() {
        fs::create_dir_all(destination)
            .map_err(|error| format!("Unable to create Data Root migration directory: {error}"))?;
        for child in fs::read_dir(source)
            .map_err(|error| format!("Unable to enumerate Data Root migration source: {error}"))?
        {
            let child = child.map_err(|error| {
                format!("Unable to enumerate Data Root migration source: {error}")
            })?;
            let child_name = child.file_name();
            let child_relative = relative.join(&child_name);
            copy_regular_tree(
                &child.path(),
                &destination.join(&child_name),
                &child_relative,
                entries,
            )?;
        }
        return Ok(());
    }
    if !metadata.is_file() {
        return Err("Data Root migration encountered an unsupported filesystem entry.".into());
    }
    let parent = destination
        .parent()
        .ok_or_else(|| "Data Root migration destination has no parent.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Unable to create Data Root migration file parent: {error}"))?;
    fs::copy(source, destination)
        .map_err(|error| format!("Unable to copy Data Root migration file: {error}"))?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(destination)
        .map_err(|error| format!("Unable to open copied migration file: {error}"))?;
    file.sync_all().map_err(|error| {
        format!(
            "Unable to flush copied migration file {}: {error}",
            root_string(destination)
        )
    })?;
    entries.push(CopyManifestEntry {
        path: relative.to_string_lossy().replace('\\', "/"),
        sha256: sha256_file(destination)?,
        bytes: metadata.len(),
    });
    Ok(())
}

fn verify_copy_manifest(root: &Path, manifest: &CopyManifest) -> Result<(), String> {
    for entry in &manifest.files {
        let path = safe_join(root, &entry.path)?;
        let metadata = fs::metadata(&path)
            .map_err(|error| format!("Copied Data Root file is missing: {error}"))?;
        if metadata.len() != entry.bytes || sha256_file(&path)? != entry.sha256 {
            return Err(format!(
                "Copied Data Root file hash mismatch: {}",
                entry.path
            ));
        }
    }
    Ok(())
}

fn root_health_for_path(root: &Path, check_write: bool) -> Result<(), String> {
    let is_staging = root
        .file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.starts_with(".W-EditorData.staging-"));
    if !is_staging {
        validate_data_root_path(root)?;
    } else if !root.is_absolute() || is_system_temp(root) {
        return Err("Data Root staging path is unsafe.".into());
    }
    if !root.is_dir() || !root_marker_valid(root) || !manifest_is_valid(root) {
        return Err("Data Root marker or manifest health check failed.".into());
    }
    if check_write {
        write_probe(root)?;
    }
    let database = root.join("library.db");
    if database.is_file() {
        let connection = Connection::open_with_flags(&database, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|error| {
            format!("Data Root Library health check cannot open database: {error}")
        })?;
        configure_read(&connection)?;
        validate_supported_schema(&connection)?;
        integrity_check(&connection)?;
    }
    Ok(())
}

pub fn migrate_data_root(
    app: &tauri::AppHandle,
    destination_parent: String,
) -> Result<DataRootMigrationResult, String> {
    let source = root_paths(app, true)?;
    let source_root = source.root.clone();
    let source_root_id = manifest_root_id(&source_root).unwrap_or_else(|| new_id("root"));
    let parent = absolute_path(&destination_parent, "The destination Data Root parent")?;
    if is_system_temp(&parent) {
        return Err(
            "The destination Data Root parent cannot be inside the system cache/temp directory."
                .into(),
        );
    }
    fs::create_dir_all(&parent)
        .map_err(|error| format!("Unable to create destination Data Root parent: {error}"))?;
    let parent = fs::canonicalize(&parent)
        .map_err(|error| format!("Unable to resolve destination Data Root parent: {error}"))?;
    let new_root = parent.join("W-EditorData");
    validate_data_root_path(&new_root)?;
    if normalized_path(&new_root) == normalized_path(&source_root) {
        return Err("The destination Data Root is already active.".into());
    }
    if new_root.exists() {
        if root_marker_valid(&new_root) || manifest_is_valid(&new_root) {
            return Err("The destination already contains a managed Data Root.".into());
        }
        if fs::read_dir(&new_root)
            .map_err(|error| format!("Unable to inspect destination Data Root: {error}"))?
            .next()
            .is_some()
        {
            return Err("The destination W-EditorData directory is not empty.".into());
        }
    }
    let barrier = acquire_write_barrier(&source_root, "migration")?;
    let migration_session = new_id("migration");
    let staging = parent.join(format!(".W-EditorData.staging-{migration_session}"));
    fs::create_dir_all(&staging)
        .map_err(|error| format!("Unable to create Data Root migration staging: {error}"))?;
    ensure_managed_directories(&staging)?;
    write_root_metadata_with_id(&staging, source_root_id.clone())?;
    let migration_tmp = staging.join("tmp/migration").join(&migration_session);
    fs::create_dir_all(&migration_tmp).map_err(|error| {
        format!("Unable to create migration transaction marker directory: {error}")
    })?;
    let migration_marker = TempMarker {
        marker_version: 1,
        temp_type: "migration".into(),
        session_id: migration_session.clone(),
        state: "migration".into(),
        operation: Some("data-root-migration".into()),
        created_at: now_string(),
    };
    atomic_write(
        &migration_tmp.join("marker.json"),
        &serde_json::to_vec_pretty(&migration_marker).map_err(|error| error.to_string())?,
        "migration transaction marker",
    )?;
    let mut entries = Vec::new();
    for name in ["assets", "backups", "logs", "settings"] {
        let source_path = source_root.join(name);
        if source_path.exists() {
            copy_regular_tree(
                &source_path,
                &staging.join(name),
                Path::new(name),
                &mut entries,
            )?;
        }
    }
    let source_database = source_root.join("library.db");
    if source_database.is_file() {
        if fault_enabled("database") {
            return Err(
                "Injected database failure during Data Root migration; source root retained."
                    .into(),
            );
        }
        let source_connection =
            Connection::open_with_flags(&source_database, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|error| format!("Unable to open source Library for migration: {error}"))?;
        let destination_database = staging.join("library.db");
        source_connection
            .backup("main", &destination_database, None)
            .map_err(|error| format!("SQLite migration backup failed: {error}"))?;
        entries.push(CopyManifestEntry {
            path: "library.db".into(),
            sha256: sha256_file(&destination_database)?,
            bytes: fs::metadata(&destination_database)
                .map(|metadata| metadata.len())
                .unwrap_or(0),
        });
        let staging_paths = RootPaths {
            root: staging.clone(),
            locator_path: source.locator_path.clone(),
        };
        let mut staged_connection = Connection::open(&destination_database)
            .map_err(|error| format!("Unable to reopen staged Library for migration: {error}"))?;
        configure_write(&staged_connection)?;
        prepare_write_library(&staging_paths, &mut staged_connection)?;
        staged_connection
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
            .map_err(|error| format!("Unable to checkpoint staged Library: {error}"))?;
        drop(staged_connection);
        if let Some(entry) = entries.iter_mut().find(|entry| entry.path == "library.db") {
            entry.sha256 = sha256_file(&destination_database)?;
            entry.bytes = fs::metadata(&destination_database)
                .map(|metadata| metadata.len())
                .unwrap_or(0);
        }
        for entry in &mut entries {
            let path = staging.join(&entry.path);
            if path.is_file() {
                entry.sha256 = sha256_file(&path)?;
                entry.bytes = fs::metadata(&path)
                    .map(|metadata| metadata.len())
                    .unwrap_or(0);
            }
        }
    }
    let copy_manifest = CopyManifest {
        manifest_version: 1,
        operation: "data-root-migration".into(),
        created_at: now_string(),
        files: entries,
    };
    let copy_manifest_path = migration_tmp.join("copy-manifest.json");
    let copy_manifest_bytes = serde_json::to_vec_pretty(&copy_manifest)
        .map_err(|error| format!("Unable to encode Data Root migration manifest: {error}"))?;
    atomic_write(
        &copy_manifest_path,
        &copy_manifest_bytes,
        "Data Root migration manifest",
    )?;
    verify_copy_manifest(&staging, &copy_manifest)?;
    refresh_manifest_hashes(&staging)?;
    root_health_for_path(&staging, true)?;
    if fault_enabled("manifest") {
        return Err(format!(
            "Injected manifest failure; migration staging retained at {}.",
            root_string(&staging)
        ));
    }
    if fault_enabled("interrupt-migration") {
        return Err(format!(
            "Injected migration interruption; staging retained at {}.",
            root_string(&staging)
        ));
    }
    let old_locator = read_locator(&source.locator_path)?;
    if new_root.exists() {
        fs::remove_dir(&new_root)
            .map_err(|error| format!("Unable to remove empty destination root: {error}"))?;
    }
    fs::rename(&staging, &new_root)
        .map_err(|error| format!("Unable to activate Data Root migration staging: {error}"))?;
    let new_root_result = (|| -> Result<(), String> {
        write_locator(
            &source.locator_path,
            &new_root,
            "ready",
            Some(source_root_id.clone()),
        )?;
        root_health_for_path(&new_root, true)
    })();
    if let Err(error) = new_root_result {
        let _ = write_locator(
            &source.locator_path,
            &source_root,
            &old_locator.health,
            old_locator.root_id.clone(),
        );
        return Err(format!(
            "Data Root migration failed after locator switch; old root retained and locator rolled back: {error}"
        ));
    }
    let _ = fs::remove_dir_all(new_root.join("tmp/migration").join(&migration_session));
    let file_count = copy_manifest.files.len();
    let total_bytes = copy_manifest.files.iter().map(|entry| entry.bytes).sum();
    drop(barrier);
    Ok(DataRootMigrationResult {
        old_root: root_string(&source_root),
        new_root: root_string(&new_root),
        staging_path: root_string(&staging),
        switched: true,
        old_root_retained: true,
        file_count,
        total_bytes,
        message: "Data Root copied to staging, hash/integrity/health checked, and locator switched atomically; old root was retained.".into(),
    })
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TempMarker {
    marker_version: u32,
    temp_type: String,
    session_id: String,
    state: String,
    operation: Option<String>,
    created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TempEntryResult {
    pub temp_type: String,
    pub session_id: String,
    pub path: String,
    pub state: String,
    pub lock_active: bool,
    pub bytes: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TempCreateInput {
    pub temp_type: String,
    pub session_id: Option<String>,
    pub operation: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TempCleanupResult {
    pub removed: Vec<String>,
    pub skipped_active: Vec<String>,
    pub released_bytes: u64,
}

fn temp_type(value: &str) -> Result<String, String> {
    let value = safe_component(value, "The temporary data type")?;
    if !TEMP_TYPES.contains(&value.as_str()) {
        return Err(format!("Unsupported temporary data type: {value}"));
    }
    Ok(value)
}

fn temp_session(value: Option<&str>) -> Result<String, String> {
    match value {
        Some(value) => safe_component(value, "The temporary session id"),
        None => Ok(new_id("tmp")),
    }
}

fn temp_path(root: &Path, temp_type_value: &str, session_id: &str) -> Result<PathBuf, String> {
    let temp_type = temp_type(temp_type_value)?;
    let session_id = safe_component(session_id, "The temporary session id")?;
    safe_join(root, &format!("tmp/{temp_type}/{session_id}"))
}

fn read_temp_marker(path: &Path) -> Option<TempMarker> {
    serde_json::from_slice(&fs::read(path.join("marker.json")).ok()?).ok()
}

fn temp_result(_root: &Path, path: &Path, marker: TempMarker) -> Result<TempEntryResult, String> {
    let lock_active = path.join("lock").is_file();
    Ok(TempEntryResult {
        temp_type: marker.temp_type,
        session_id: marker.session_id,
        path: root_string(path),
        state: marker.state,
        lock_active,
        bytes: directory_size(path, true)?,
    })
}

pub fn create_temp_entry(
    app: &tauri::AppHandle,
    input: TempCreateInput,
) -> Result<TempEntryResult, String> {
    let paths = root_paths(app, true)?;
    let temp_type = temp_type(&input.temp_type)?;
    let session_id = temp_session(input.session_id.as_deref())?;
    let barrier = acquire_write_barrier(&paths.root, "temporary")?;
    let path = temp_path(&paths.root, &temp_type, &session_id)?;
    if path.exists() {
        return Err("TEMP_EXISTS: the temporary session already exists.".into());
    }
    fs::create_dir_all(&path)
        .map_err(|error| format!("Unable to create temporary session: {error}"))?;
    let marker = TempMarker {
        marker_version: 1,
        temp_type: temp_type.clone(),
        session_id: session_id.clone(),
        state: "active".into(),
        operation: input.operation,
        created_at: now_string(),
    };
    let bytes = serde_json::to_vec_pretty(&marker)
        .map_err(|error| format!("Unable to encode temporary marker: {error}"))?;
    if let Err(error) = atomic_write(&path.join("marker.json"), &bytes, "temporary marker") {
        let _ = fs::remove_dir_all(&path);
        return Err(error);
    }
    let result = temp_result(&paths.root, &path, marker)?;
    drop(barrier);
    Ok(result)
}

pub fn acquire_temp_lock(
    app: &tauri::AppHandle,
    temp_type_value: String,
    session_id: String,
) -> Result<TempEntryResult, String> {
    let paths = root_paths(app, true)?;
    let path = temp_path(&paths.root, &temp_type_value, &session_id)?;
    if !path.is_dir() {
        return Err("TEMP_NOT_FOUND: the temporary session does not exist.".into());
    }
    let marker = read_temp_marker(&path)
        .ok_or_else(|| "TEMP_INVALID: temporary marker is invalid.".to_string())?;
    if path.join("lock").exists() {
        return Err("TEMP_BUSY: the temporary session is already locked.".into());
    }
    let mut lock = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path.join("lock"))
        .map_err(|error| format!("Unable to acquire temporary session lock: {error}"))?;
    if let Err(error) = lock
        .write_all(
            json!({"pid":std::process::id(),"createdAt":now_string()})
                .to_string()
                .as_bytes(),
        )
        .and_then(|_| lock.sync_all())
    {
        let _ = fs::remove_file(path.join("lock"));
        return Err(format!("Unable to write temporary session lock: {error}"));
    }
    let mut marker = marker;
    marker.state = "active".into();
    if let Err(error) = atomic_write(
        &path.join("marker.json"),
        &serde_json::to_vec_pretty(&marker).map_err(|error| error.to_string())?,
        "temporary marker",
    ) {
        let _ = fs::remove_file(path.join("lock"));
        return Err(error);
    }
    temp_result(&paths.root, &path, marker)
}

pub fn release_temp_lock(
    app: &tauri::AppHandle,
    temp_type_value: String,
    session_id: String,
) -> Result<bool, String> {
    let paths = root_paths(app, true)?;
    let path = temp_path(&paths.root, &temp_type_value, &session_id)?;
    if !path.is_dir() {
        return Err("TEMP_NOT_FOUND: the temporary session does not exist.".into());
    }
    let lock = path.join("lock");
    if !lock.exists() {
        return Ok(false);
    }
    fs::remove_file(lock)
        .map_err(|error| format!("Unable to release temporary session lock: {error}"))?;
    Ok(true)
}

fn list_temp_entries_at_root(root: &Path) -> Result<Vec<TempEntryResult>, String> {
    let mut result = Vec::new();
    let tmp = safe_join(root, "tmp")?;
    if !tmp.is_dir() {
        return Ok(result);
    }
    for type_entry in fs::read_dir(&tmp)
        .map_err(|error| format!("Unable to enumerate temporary data: {error}"))?
    {
        let type_entry =
            type_entry.map_err(|error| format!("Unable to enumerate temporary data: {error}"))?;
        if !type_entry.path().is_dir() || type_entry.file_name() == "lock" {
            continue;
        }
        for session_entry in fs::read_dir(type_entry.path())
            .map_err(|error| format!("Unable to enumerate temporary sessions: {error}"))?
        {
            let session_entry = session_entry
                .map_err(|error| format!("Unable to enumerate temporary sessions: {error}"))?;
            let path = session_entry.path();
            if !path.is_dir() {
                continue;
            }
            if let Some(marker) = read_temp_marker(&path) {
                result.push(temp_result(root, &path, marker)?);
            }
        }
    }
    result.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(result)
}

pub fn list_temp_entries(app: &tauri::AppHandle) -> Result<Vec<TempEntryResult>, String> {
    let paths = root_paths(app, false)?;
    list_temp_entries_at_root(&paths.root)
}

fn temp_marker_age(path: &Path, marker: &TempMarker) -> u128 {
    marker.created_at.parse::<u128>().unwrap_or_else(|_| {
        fs::metadata(path)
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis())
            .unwrap_or_else(unix_millis)
    })
}

pub fn cleanup_temp_entries(
    app: &tauri::AppHandle,
    manual: bool,
) -> Result<TempCleanupResult, String> {
    let paths = root_paths(app, true)?;
    let policy = retention_policy_for_root(&paths.root);
    let cutoff = unix_millis().saturating_sub(policy.temp_days.max(1) as u128 * 86_400_000);
    let barrier = acquire_write_barrier(&paths.root, "temporary-cleanup")?;
    let mut removed = Vec::new();
    let mut skipped_active = Vec::new();
    let mut released_bytes = 0_u64;
    let tmp = safe_join(&paths.root, "tmp")?;
    if tmp.is_dir() {
        for type_entry in fs::read_dir(&tmp)
            .map_err(|error| format!("Unable to enumerate temporary data: {error}"))?
        {
            let type_entry = type_entry
                .map_err(|error| format!("Unable to enumerate temporary data: {error}"))?;
            if !type_entry.path().is_dir() || type_entry.file_name() == "lock" {
                continue;
            }
            for session_entry in fs::read_dir(type_entry.path())
                .map_err(|error| format!("Unable to enumerate temporary sessions: {error}"))?
            {
                let session_entry = session_entry
                    .map_err(|error| format!("Unable to enumerate temporary sessions: {error}"))?;
                let path = session_entry.path();
                if !path.is_dir() {
                    continue;
                }
                let Some(marker) = read_temp_marker(&path) else {
                    continue;
                };
                let display = format!(
                    "{}/{}",
                    type_entry.file_name().to_string_lossy(),
                    session_entry.file_name().to_string_lossy()
                );
                let active = path.join("lock").is_file()
                    || matches!(marker.state.as_str(), "active" | "pending" | "migration");
                let old = temp_marker_age(&path, &marker) <= cutoff;
                if active {
                    skipped_active.push(display);
                } else if manual || old {
                    released_bytes = released_bytes.saturating_add(directory_size(&path, true)?);
                    fs::remove_dir_all(&path)
                        .map_err(|error| format!("Unable to clean temporary session: {error}"))?;
                    removed.push(display);
                }
            }
        }
    }
    drop(barrier);
    Ok(TempCleanupResult {
        removed,
        skipped_active,
        released_bytes,
    })
}

pub fn temp_usage(app: &tauri::AppHandle) -> Result<BackupUsageResult, String> {
    let paths = root_paths(app, false)?;
    let temporary_bytes = directory_size(&paths.tmp(), true)?;
    let entries = list_temp_entries_at_root(&paths.root)?;
    Ok(BackupUsageResult {
        root: "<data-root>".into(),
        backup_bytes: 0,
        snapshot_bytes: 0,
        blob_bytes: 0,
        manifest_bytes: 0,
        backup_count: entries.len(),
        protected_count: entries.iter().filter(|entry| entry.lock_active).count(),
        temporary_bytes,
    })
}

pub fn startup_maintenance(app: &tauri::AppHandle) {
    if let Ok(paths) = root_paths(app, false) {
        let _ = cleanup_temp_entries_at_root(&paths.root);
        append_log(
            &paths,
            "info",
            "startup.maintenance",
            json!({"temporaryCleanup": true}),
        );
    }
}

fn cleanup_temp_entries_at_root(root: &Path) -> Result<TempCleanupResult, String> {
    // Startup runs before a user operation owns the write barrier. It only
    // removes old, inactive entries and never touches active transaction state.
    let policy = RetentionPolicy::default();
    let cutoff = unix_millis().saturating_sub(policy.temp_days.max(1) as u128 * 86_400_000);
    let mut removed = Vec::new();
    let mut skipped_active = Vec::new();
    let mut released_bytes = 0_u64;
    let lock_path = root.join("tmp/lock/write.lock");
    if lock_path.is_file() {
        let lock_age = fs::metadata(&lock_path)
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis())
            .unwrap_or_else(unix_millis);
        if lock_age <= cutoff {
            released_bytes = released_bytes.saturating_add(
                fs::metadata(&lock_path)
                    .map(|metadata| metadata.len())
                    .unwrap_or(0),
            );
            fs::remove_file(&lock_path).map_err(|error| {
                format!("Unable to clean stale Data Root write barrier: {error}")
            })?;
            removed.push("lock/write.lock".into());
        } else {
            skipped_active.push("lock/write.lock".into());
        }
    }
    let tmp = root.join("tmp");
    if !tmp.is_dir() {
        return Ok(TempCleanupResult {
            removed,
            skipped_active,
            released_bytes,
        });
    }
    for type_entry in fs::read_dir(&tmp)
        .map_err(|error| format!("Unable to enumerate temporary data: {error}"))?
    {
        let type_entry =
            type_entry.map_err(|error| format!("Unable to enumerate temporary data: {error}"))?;
        if !type_entry.path().is_dir() || type_entry.file_name() == "lock" {
            continue;
        }
        for session_entry in fs::read_dir(type_entry.path())
            .map_err(|error| format!("Unable to enumerate temporary sessions: {error}"))?
        {
            let session_entry = session_entry
                .map_err(|error| format!("Unable to enumerate temporary sessions: {error}"))?;
            let path = session_entry.path();
            let Some(marker) = read_temp_marker(&path) else {
                continue;
            };
            let display = format!(
                "{}/{}",
                type_entry.file_name().to_string_lossy(),
                session_entry.file_name().to_string_lossy()
            );
            if path.join("lock").is_file()
                || matches!(marker.state.as_str(), "active" | "pending" | "migration")
            {
                skipped_active.push(display);
            } else if temp_marker_age(&path, &marker) <= cutoff {
                released_bytes = released_bytes.saturating_add(directory_size(&path, true)?);
                fs::remove_dir_all(&path).map_err(|error| {
                    format!("Unable to clean startup temporary session: {error}")
                })?;
                removed.push(display);
            }
        }
    }
    Ok(TempCleanupResult {
        removed,
        skipped_active,
        released_bytes,
    })
}

fn sanitize_log_value(value: &Value, key_hint: Option<&str>) -> Value {
    let sensitive_key = key_hint
        .map(|key| {
            let key = key.to_ascii_lowercase();
            key.contains("markdown")
                || key.contains("draft")
                || key.contains("cookie")
                || key.contains("credential")
                || key.contains("password")
                || key.contains("secret")
                || key.contains("token")
                || key == "url"
                || key.ends_with("path")
        })
        .unwrap_or(false);
    if sensitive_key {
        return Value::String("<redacted>".into());
    }
    match value {
        Value::Object(object) => Value::Object(
            object
                .iter()
                .map(|(key, child)| (key.clone(), sanitize_log_value(child, Some(key))))
                .collect(),
        ),
        Value::Array(items) => Value::Array(
            items
                .iter()
                .map(|item| sanitize_log_value(item, None))
                .collect(),
        ),
        Value::String(text) if text.chars().count() > 256 => {
            Value::String(format!("{}…", text.chars().take(256).collect::<String>()))
        }
        _ => value.clone(),
    }
}

pub fn append_log(paths: &RootPaths, level: &str, event: &str, details: Value) {
    let result = (|| -> Result<(), String> {
        if fault_enabled("disk-full") {
            return Err("Injected disk-full failure while writing logs.".into());
        }
        let log_path = safe_join(&paths.root, "logs/app.log")?;
        let max_bytes = DEFAULT_LOG_MAX_BYTES;
        if fs::metadata(&log_path)
            .map(|metadata| metadata.len())
            .unwrap_or(0)
            >= max_bytes
        {
            for index in (1..DEFAULT_LOG_RETENTION_FILES).rev() {
                let from = safe_join(&paths.root, &format!("logs/app.log.{index}"))?;
                let to = safe_join(&paths.root, &format!("logs/app.log.{}", index + 1))?;
                if from.exists() {
                    let _ = fs::remove_file(&to);
                    fs::rename(from, to)
                        .map_err(|error| format!("Unable to rotate Desktop log: {error}"))?;
                }
            }
            let first = safe_join(&paths.root, "logs/app.log.1")?;
            let _ = fs::remove_file(&first);
            if log_path.exists() {
                fs::rename(&log_path, first)
                    .map_err(|error| format!("Unable to rotate Desktop log: {error}"))?;
            }
        }
        let entry = json!({
            "timestamp": now_string(),
            "level": level,
            "event": event,
            "details": sanitize_log_value(&details, None),
        });
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .map_err(|error| format!("Unable to open Desktop log: {error}"))?;
        writeln!(file, "{}", entry)
            .map_err(|error| format!("Unable to append Desktop log: {error}"))?;
        file.sync_data()
            .map_err(|error| format!("Unable to flush Desktop log: {error}"))?;
        Ok(())
    })();
    let _ = result;
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogStatusResult {
    pub file_count: usize,
    pub total_bytes: u64,
    pub max_file_bytes: u64,
    pub retention_files: usize,
    pub relative_files: Vec<String>,
}

pub fn log_status(app: &tauri::AppHandle) -> Result<LogStatusResult, String> {
    let paths = root_paths(app, false)?;
    let directory = safe_join(&paths.root, "logs")?;
    let mut files = Vec::new();
    let mut total = 0_u64;
    if directory.is_dir() {
        for entry in fs::read_dir(directory)
            .map_err(|error| format!("Unable to enumerate Desktop logs: {error}"))?
        {
            let entry =
                entry.map_err(|error| format!("Unable to enumerate Desktop logs: {error}"))?;
            if entry.path().is_file() && entry.file_name().to_string_lossy().starts_with("app.log")
            {
                total = total
                    .saturating_add(entry.metadata().map(|metadata| metadata.len()).unwrap_or(0));
                files.push(format!("logs/{}", entry.file_name().to_string_lossy()));
            }
        }
    }
    files.sort();
    Ok(LogStatusResult {
        file_count: files.len(),
        total_bytes: total,
        max_file_bytes: DEFAULT_LOG_MAX_BYTES,
        retention_files: DEFAULT_LOG_RETENTION_FILES,
        relative_files: files,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticPreviewResult {
    pub root_state: String,
    pub library_schema_version: i64,
    pub included: Vec<String>,
    pub excluded: Vec<String>,
    pub log_files: usize,
    pub estimated_bytes: u64,
    pub note: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticExportResult {
    pub destination_path: String,
    pub bytes: u64,
    pub sha256: String,
    pub included: Vec<String>,
}

pub fn diagnostic_preview(app: &tauri::AppHandle) -> Result<DiagnosticPreviewResult, String> {
    let status = data_root_status(app)?;
    let mut included = vec!["environment.json".into(), "data-root/manifest.json".into()];
    let mut estimated_bytes = 0_u64;
    let mut log_files = 0_usize;
    if let Ok(logs) = log_status(app) {
        included.extend(logs.relative_files.clone());
        estimated_bytes = estimated_bytes.saturating_add(logs.total_bytes);
        log_files = logs.file_count;
    }
    let root_state = status.state;
    Ok(DiagnosticPreviewResult {
        root_state,
        library_schema_version: status.library_schema_version,
        included,
        excluded: vec![
            "article Markdown正文".into(),
            "recovery drafts".into(),
            "cookies and credentials".into(),
            "complete absolute paths".into(),
            "assets and temporary data".into(),
        ],
        log_files,
        estimated_bytes,
        note: "Preview is metadata-only;正文、草稿和资产不会在未选择时附加。".into(),
    })
}

fn read_sanitized_logs(paths: &RootPaths) -> Vec<String> {
    let Ok(directory) = safe_join(&paths.root, "logs") else {
        return Vec::new();
    };
    let Ok(entries) = fs::read_dir(directory) else {
        return Vec::new();
    };
    let mut files = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .file_name()
                    .is_some_and(|name| name.to_string_lossy().starts_with("app.log"))
        })
        .collect::<Vec<_>>();
    files.sort();
    files
        .into_iter()
        .flat_map(|path| fs::read_to_string(path).ok().into_iter())
        .flat_map(|contents| contents.lines().map(str::to_owned).collect::<Vec<_>>())
        .map(|line| {
            serde_json::from_str::<Value>(&line)
                .map(|value| sanitize_log_value(&value, None).to_string())
                .unwrap_or_else(|_| {
                    "{\"level\":\"info\",\"event\":\"unparseable-log-line\"}".into()
                })
        })
        .collect()
}

pub fn export_diagnostics(
    app: &tauri::AppHandle,
    destination_path: String,
    include_logs: Option<bool>,
    include_manifest: Option<bool>,
) -> Result<DiagnosticExportResult, String> {
    let destination = validate_external_destination(Path::new(&destination_path))?;
    let status = data_root_status(app)?;
    let paths = root_paths(app, false).ok();
    let mut included = vec!["environment.json".into()];
    let mut payload = Map::new();
    payload.insert("schemaVersion".into(), Value::from(1));
    payload.insert(
        "environment".into(),
        json!({
            "product": "W-Editor Desktop",
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "rootState": status.state,
            "librarySchemaVersion": status.library_schema_version,
        }),
    );
    if include_manifest.unwrap_or(true) {
        included.push("data-root/manifest.json".into());
        if let Some(paths) = paths.as_ref()
            && let Ok(manifest) = read_manifest(&paths.root)
        {
            payload.insert(
                "dataRootManifest".into(),
                serde_json::to_value(manifest).unwrap_or_else(|_| json!({})),
            );
        }
    }
    if include_logs.unwrap_or(true) {
        let logs = paths.as_ref().map(read_sanitized_logs).unwrap_or_default();
        included.push("logs/app.log (sanitized)".into());
        payload.insert(
            "logs".into(),
            Value::Array(logs.into_iter().map(Value::String).collect()),
        );
    }
    payload.insert(
        "excluded".into(),
        json!([
            "article Markdown正文",
            "recovery drafts",
            "cookies",
            "credentials",
            "complete absolute paths",
            "temporary data",
            "CAS assets"
        ]),
    );
    let bytes = serde_json::to_vec_pretty(&Value::Object(payload))
        .map_err(|error| format!("Unable to encode diagnostics: {error}"))?;
    atomic_write(&destination, &bytes, "diagnostic export")?;
    Ok(DiagnosticExportResult {
        destination_path: root_string(&destination),
        bytes: bytes.len() as u64,
        sha256: sha256_bytes(&bytes),
        included,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryRecoveryStatus {
    pub database_path: String,
    pub schema_version: i64,
    pub supported_schema_version: i64,
    pub mode: String,
    pub can_read_only_export: bool,
    pub can_migrate: bool,
    pub reason: Option<String>,
    pub tables: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryRecoveryExportResult {
    pub destination_path: String,
    pub copied_files: Vec<String>,
    pub bytes: u64,
    pub sha256: String,
    pub mode: String,
}

pub fn recovery_status(app: &tauri::AppHandle) -> Result<LibraryRecoveryStatus, String> {
    let paths = root_paths(app, false).or_else(|_| recovery_root_paths(app))?;
    let database = paths.database();
    if !database.is_file() {
        return Ok(LibraryRecoveryStatus {
            database_path: root_string(&database),
            schema_version: 0,
            supported_schema_version: LIBRARY_SCHEMA_VERSION,
            mode: "uninitialized".into(),
            can_read_only_export: false,
            can_migrate: false,
            reason: Some("The Library database has not been created.".into()),
            tables: Vec::new(),
        });
    }
    if let Err(error) = validate_wal_sidecar(&database) {
        return Ok(LibraryRecoveryStatus {
            database_path: root_string(&database),
            schema_version: 0,
            supported_schema_version: LIBRARY_SCHEMA_VERSION,
            mode: "read_only_recovery".into(),
            can_read_only_export: true,
            can_migrate: false,
            reason: Some(error),
            tables: Vec::new(),
        });
    }
    let connection = match Connection::open_with_flags(&database, OpenFlags::SQLITE_OPEN_READ_ONLY)
    {
        Ok(connection) => connection,
        Err(error) => {
            return Ok(LibraryRecoveryStatus {
                database_path: root_string(&database),
                schema_version: 0,
                supported_schema_version: LIBRARY_SCHEMA_VERSION,
                mode: "read_only_recovery".into(),
                can_read_only_export: true,
                can_migrate: false,
                reason: Some(format!("Database cannot be opened normally: {error}")),
                tables: Vec::new(),
            });
        }
    };
    let tables = table_names(&connection).unwrap_or_default();
    let schema_version = schema_meta_version(&connection)
        .ok()
        .flatten()
        .or_else(|| {
            pragma_user_version(&connection)
                .ok()
                .filter(|value| *value > 0)
        })
        .unwrap_or_default();
    let mode = if schema_version > LIBRARY_SCHEMA_VERSION {
        "read_only_recovery"
    } else if schema_version < LIBRARY_SCHEMA_VERSION && schema_version > 0 {
        "migration_available"
    } else if schema_version == LIBRARY_SCHEMA_VERSION
        && validate_schema(&connection).is_ok()
        && integrity_check(&connection).is_ok()
    {
        "ready"
    } else {
        "read_only_recovery"
    };
    let reason = match mode {
        "read_only_recovery" => Some("No automatic downgrade or destructive repair is allowed; export raw data before recovery.".into()),
        "migration_available" => Some("A protected backup is created before the forward migration.".into()),
        _ => None,
    };
    Ok(LibraryRecoveryStatus {
        database_path: root_string(&database),
        schema_version,
        supported_schema_version: LIBRARY_SCHEMA_VERSION,
        mode: mode.into(),
        can_read_only_export: true,
        can_migrate: mode == "migration_available",
        reason,
        tables,
    })
}

pub fn export_recovery_database(
    app: &tauri::AppHandle,
    destination_path: String,
) -> Result<LibraryRecoveryExportResult, String> {
    let paths = root_paths(app, false).or_else(|_| recovery_root_paths(app))?;
    let source = paths.database();
    if !source.is_file() {
        return Err("LIBRARY_UNINITIALIZED: no database is available for recovery export.".into());
    }
    let mut destination = validate_external_destination(Path::new(&destination_path))?;
    if destination.is_dir() {
        destination = destination.join("library.db.recovery");
    }
    let bytes = fs::read(&source)
        .map_err(|error| format!("Unable to read the raw Library database: {error}"))?;
    atomic_write(&destination, &bytes, "raw Library recovery export")?;
    let mut copied_files = vec![root_string(&destination)];
    for suffix in ["-wal", "-shm"] {
        let source_sidecar = PathBuf::from(format!("{}{}", root_string(&source), suffix));
        if source_sidecar.is_file() {
            let target_sidecar = PathBuf::from(format!("{}{}", root_string(&destination), suffix));
            let sidecar_bytes = fs::read(&source_sidecar)
                .map_err(|error| format!("Unable to read raw SQLite sidecar: {error}"))?;
            atomic_write(&target_sidecar, &sidecar_bytes, "raw SQLite sidecar export")?;
            copied_files.push(root_string(&target_sidecar));
        }
    }
    let status = recovery_status(app)?;
    Ok(LibraryRecoveryExportResult {
        destination_path: root_string(&destination),
        copied_files,
        bytes: bytes.len() as u64,
        sha256: sha256_bytes(&bytes),
        mode: status.mode,
    })
}

pub fn load_markdown(
    app: &tauri::AppHandle,
    document_id: String,
) -> Result<LibraryDocumentResult, String> {
    load_article(app, document_id, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    static TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    fn test_guard() -> std::sync::MutexGuard<'static, ()> {
        TEST_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("test lock")
    }

    fn test_root(label: &str) -> RootPaths {
        let parent = std::env::current_dir()
            .expect("current directory")
            .join(".tmp")
            .join(format!("storage-{label}-{}", new_id("test")));
        let root = parent.join("W-EditorData");
        ensure_managed_directories(&root).expect("managed directories");
        write_root_metadata(&root).expect("root metadata");
        RootPaths {
            root,
            locator_path: parent.join("locator.json"),
        }
    }

    fn cleanup(paths: &RootPaths) {
        let _ = fs::remove_dir_all(paths.root.parent().expect("test root parent"));
        let _ = clear_faults();
    }

    fn current_handle(paths: &RootPaths) -> LibraryHandle {
        let mut connection = Connection::open(paths.database()).expect("database");
        configure_write(&connection).expect("configure database");
        create_schema(&mut connection).expect("create schema");
        LibraryHandle {
            connection,
            paths: paths.clone(),
            _barrier: None,
        }
    }

    #[test]
    fn root_manifest_and_managed_path_validation_are_fail_closed() {
        let _guard = test_guard();
        let paths = test_root("paths");
        assert!(root_marker_valid(&paths.root));
        assert!(manifest_is_valid(&paths.root));
        assert!(safe_join(&paths.root, "logs/app.log").is_ok());
        assert!(safe_join(&paths.root, "../outside").is_err());
        assert!(safe_join(&paths.root, &root_string(&paths.root)).is_err());
        cleanup(&paths);
    }

    #[test]
    fn schema_has_required_tables_and_save_rolls_back_exactly() {
        let _guard = test_guard();
        let paths = test_root("schema");
        let mut handle = current_handle(&paths);
        validate_schema(&handle.connection).expect("schema validation");
        let first = save_version_with_handle(
            &mut handle,
            &SaveVersionInput {
                document_id: "article-test".into(),
                title: "Test article".into(),
                markdown: "# First".into(),
                requested_revision: None,
                kind: None,
                label: None,
                protected: None,
                seed_key: None,
            },
        )
        .expect("first save");
        assert_eq!(first.revision, 1);
        let failed = save_version_with_handle(
            &mut handle,
            &SaveVersionInput {
                document_id: "article-test".into(),
                title: "Changed".into(),
                markdown: "# Must not commit".into(),
                requested_revision: Some(1),
                kind: None,
                label: None,
                protected: None,
                seed_key: None,
            },
        )
        .expect_err("duplicate revision must fail");
        assert!(failed.contains("rolled back"));
        let article = load_article_from_connection(
            &handle.connection,
            &paths.database(),
            "article-test",
            false,
        )
        .expect("article after rollback");
        assert_eq!(article.markdown, "# First");
        assert_eq!(article.revision, 1);
        cleanup(&paths);
    }

    #[test]
    fn v1_schema_creates_protected_migration_backup_before_forward_migration() {
        let _guard = test_guard();
        let paths = test_root("migration");
        let mut connection = Connection::open(paths.database()).expect("database");
        configure_write(&connection).expect("configure database");
        connection
            .execute_batch(
                "CREATE TABLE schema_meta(key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
                 INSERT INTO schema_meta(key, value) VALUES ('schemaVersion', '1');
                 CREATE TABLE articles(id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, markdown TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
                 CREATE TABLE article_versions(id TEXT PRIMARY KEY NOT NULL, article_id TEXT NOT NULL REFERENCES articles(id), revision INTEGER NOT NULL, markdown TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(article_id, revision));
                 CREATE TABLE recovery_drafts(article_id TEXT PRIMARY KEY NOT NULL, base_revision INTEGER NOT NULL, markdown TEXT NOT NULL, updated_at TEXT NOT NULL);
                 PRAGMA user_version = 1;",
            )
            .expect("legacy schema");
        create_migration_backup(&paths, &connection, 1).expect("migration backup");
        migrate_schema(&mut connection, 1).expect("forward migration");
        validate_schema(&connection).expect("migrated schema");
        let backups = list_backup_manifests(&paths.root).expect("backup manifests");
        assert_eq!(backups.len(), 1);
        assert_eq!(backups[0].0.kind, "migration");
        assert!(backups[0].0.protected);
        let verification = verify_backup_at_root(&paths.root, &backups[0].0.backup_id)
            .expect("verify migration backup");
        assert!(verification.valid, "{verification:?}");
        cleanup(&paths);
    }

    #[test]
    fn backup_snapshot_is_compressed_and_hash_verified() {
        let _guard = test_guard();
        let paths = test_root("backup");
        let handle = current_handle(&paths);
        let (manifest, _) = create_backup_manifest_from_connection(
            &paths,
            &handle.connection,
            "daily",
            false,
            None,
            LIBRARY_SCHEMA_VERSION,
        )
        .expect("backup");
        let snapshot =
            backup_snapshot_path(&paths.root, &manifest.backup_id).expect("snapshot path");
        assert!(
            snapshot
                .extension()
                .is_some_and(|extension| extension == "gz")
        );
        let verified =
            verify_backup_at_root(&paths.root, &manifest.backup_id).expect("verify backup");
        assert!(verified.valid, "{verified:?}");
        let mut corrupt = fs::read(&snapshot).expect("snapshot bytes");
        corrupt[0] ^= 0xff;
        fs::write(&snapshot, corrupt).expect("corrupt snapshot");
        let invalid =
            verify_backup_at_root(&paths.root, &manifest.backup_id).expect("corrupt verification");
        assert!(!invalid.valid);
        assert!(!invalid.snapshot_verified);
        cleanup(&paths);
    }

    #[test]
    fn write_barrier_and_fault_injection_preserve_existing_files() {
        let _guard = test_guard();
        let paths = test_root("faults");
        let barrier = acquire_write_barrier(&paths.root, "test").expect("first barrier");
        assert!(acquire_write_barrier(&paths.root, "second").is_err());
        drop(barrier);
        let target = paths.root.join("logs/fault-test.log");
        fs::write(&target, b"original").expect("original file");
        set_fault("disk-full", true).expect("disk fault");
        assert!(atomic_write(&target, b"replacement", "fault test").is_err());
        assert_eq!(fs::read(&target).expect("existing file"), b"original");
        set_fault("permission", true).expect("permission fault");
        assert!(ensure_managed_directories(&paths.root).is_err());
        cleanup(&paths);
    }

    #[test]
    fn versions_retention_keeps_fifty_ordinary_and_all_published_versions() {
        let _guard = test_guard();
        let paths = test_root("versions");
        let mut handle = current_handle(&paths);
        for index in 0..55 {
            save_version_with_handle(
                &mut handle,
                &SaveVersionInput {
                    document_id: "versioned".into(),
                    title: "Versioned".into(),
                    markdown: format!("# Version {index}"),
                    requested_revision: None,
                    kind: None,
                    label: None,
                    protected: None,
                    seed_key: None,
                },
            )
            .expect("ordinary version");
        }
        save_version_with_handle(
            &mut handle,
            &SaveVersionInput {
                document_id: "versioned".into(),
                title: "Versioned".into(),
                markdown: "# Published".into(),
                requested_revision: None,
                kind: Some("publish".into()),
                label: Some("release".into()),
                protected: None,
                seed_key: None,
            },
        )
        .expect("published version");
        let ordinary: i64 = handle
            .connection
            .query_row(
                "SELECT COUNT(*) FROM article_versions WHERE article_id = 'versioned' AND protected = 0",
                [],
                |row| row.get(0),
            )
            .expect("ordinary count");
        let protected: i64 = handle
            .connection
            .query_row(
                "SELECT COUNT(*) FROM article_versions WHERE article_id = 'versioned' AND protected = 1",
                [],
                |row| row.get(0),
            )
            .expect("protected count");
        assert_eq!(ordinary, 50);
        assert_eq!(protected, 1);
        cleanup(&paths);
    }

    #[test]
    fn workspace_and_settings_reject_transient_state_and_merge_layers() {
        let _guard = test_guard();
        assert!(validate_stable_value(&json!({"undo": []}), "workspace").is_err());
        assert!(validate_stable_value(&json!({"fold": true}), "workspace").is_err());
        let product = product_defaults();
        let site = json!({"theme": "dark", "shortcuts": {"block.h1": "site-heading"}});
        let user = json!({"lineSpacing": "wide"});
        let resolved = merge_object_layers(&[&product, &site, &user]);
        assert_eq!(resolved["theme"], "dark");
        assert_eq!(resolved["lineSpacing"], "wide");
        assert_eq!(resolved["shortcuts"]["block.h1"], "site-heading");
        assert_eq!(resolved["shortcuts"]["block.h2"], "Mod-2");
    }

    #[test]
    fn temp_cleanup_and_diagnostics_are_bounded_and_private() {
        let _guard = test_guard();
        let paths = test_root("privacy");
        let orphan = paths.root.join("tmp/webview/orphan");
        fs::create_dir_all(&orphan).expect("orphan directory");
        let marker = TempMarker {
            marker_version: 1,
            temp_type: "webview".into(),
            session_id: "orphan".into(),
            state: "complete".into(),
            operation: None,
            created_at: "0".into(),
        };
        fs::write(
            orphan.join("marker.json"),
            serde_json::to_vec(&marker).expect("marker json"),
        )
        .expect("marker");
        let cleaned = cleanup_temp_entries_at_root(&paths.root).expect("temp cleanup");
        assert!(
            cleaned
                .removed
                .iter()
                .any(|entry| entry == "webview/orphan")
        );
        let sanitized = sanitize_log_value(
            &json!({"markdown": "private body", "path": "C:/Users/private"}),
            None,
        );
        assert_eq!(sanitized["markdown"], "<redacted>");
        assert_eq!(sanitized["path"], "<redacted>");
        cleanup(&paths);
    }

    #[test]
    fn future_schema_and_corrupt_wal_are_read_only_recovery_inputs() {
        let _guard = test_guard();
        let paths = test_root("future");
        let handle = current_handle(&paths);
        handle
            .connection
            .execute(
                "UPDATE schema_meta SET value = '99' WHERE key = 'schemaVersion'",
                [],
            )
            .expect("future schema marker");
        let connection =
            Connection::open_with_flags(paths.database(), OpenFlags::SQLITE_OPEN_READ_ONLY)
                .expect("future schema read-only open");
        configure_read(&connection).expect("read-only configuration");
        let (version, _) = schema_state(&connection).expect("future schema state");
        assert_eq!(version, Some(99));
        assert!(validate_supported_schema(&connection).is_err());
        drop(connection);
        drop(handle);
        let wal = PathBuf::from(format!("{}-wal", root_string(&paths.database())));
        fs::write(&wal, b"corrupted-wal").expect("corrupt WAL fixture");
        assert!(validate_wal_sidecar(&paths.database()).is_err());
        let _ = fs::remove_file(wal);
        cleanup(&paths);
    }
}
