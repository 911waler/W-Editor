use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    tauri_build::build();

    let manifest_path =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is required"))
            .join("../../../release/versions.json");
    println!("cargo:rerun-if-changed={}", manifest_path.display());
    let manifest =
        fs::read_to_string(&manifest_path).expect("Unable to read release/versions.json");
    let versions: serde_json::Value =
        serde_json::from_str(&manifest).expect("release/versions.json is invalid JSON");
    let string_value = |key: &str| -> String {
        versions
            .get(key)
            .and_then(serde_json::Value::as_str)
            .unwrap_or_else(|| panic!("release/versions.json field {key} must be a string"))
            .to_string()
    };
    let integer_value = |key: &str| -> i64 {
        versions
            .get(key)
            .and_then(serde_json::Value::as_i64)
            .unwrap_or_else(|| panic!("release/versions.json field {key} must be an integer"))
    };
    let generated = format!(
        "pub const PRODUCT_VERSION: &str = {product:?};\n\
pub const MARKDOWN_DIALECT_VERSION: &str = {dialect:?};\n\
pub const DATA_ROOT_SCHEMA_VERSION: u32 = {data_root}u32;\n\
pub const LIBRARY_SCHEMA_VERSION: i64 = {database};\n\
pub const SETTINGS_SCHEMA_VERSION: i64 = {settings};\n",
        product = string_value("productVersion"),
        dialect = string_value("markdownDialectVersion"),
        data_root = integer_value("dataRootSchemaVersion"),
        database = integer_value("databaseSchemaVersion"),
        settings = integer_value("settingsSchemaVersion"),
    );
    let output_path = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR is required"))
        .join("release_versions.rs");
    fs::write(output_path, generated).expect("Unable to write generated release version constants");
}
