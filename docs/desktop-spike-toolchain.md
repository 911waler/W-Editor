# Tauri Desktop Spike Toolchain

This document freezes the Windows x64 toolchain used by OpenSpec task 6.1. The product-representative runtime, data, draw.io, and installer journeys are verified by tasks 6.2–6.10; a successful shell build alone is not the Tauri route decision.

## Pinned project toolchain

| Component | Version / target |
| --- | --- |
| Node.js | 24.18.0 |
| pnpm | 11.19.0 |
| Rust / Cargo | 1.97.1 |
| Rust target | `x86_64-pc-windows-msvc` |
| Tauri Rust crate | 2.11.5 |
| `tauri-build` | 2.6.3 |
| Tauri CLI | 2.11.4 |
| Tauri JavaScript API | 2.11.1 |
| `wry` / `tao` | 0.55.1 / 0.35.3 |
| Tauri bundler embedded by CLI | 2.9.4 |
| NSIS toolset downloaded by Tauri | 3.11 |
| WiX toolset downloaded by Tauri | 3.14 |

The project pins JavaScript versions in `apps/desktop/package.json`, Rust versions in `apps/desktop/src-tauri/Cargo.toml`, and Rust compiler/target selection in `apps/desktop/src-tauri/rust-toolchain.toml`. Both `pnpm-lock.yaml` and the Desktop `Cargo.lock` are required inputs.

## Verified Windows prerequisites

- Windows x64 build `10.0.26200`.
- Microsoft Edge WebView2 Evergreen Runtime `151.0.4129.107`.
- Visual Studio Build Tools 2026 `18.8.1` with the C++ x64 toolchain.
- Windows SDK `10.0.26100.0` (older SDKs are also installed but are not the selected record).
- Rust MSVC target `x86_64-pc-windows-msvc`.
- Tauri MSI bundling requires the Windows VBSCRIPT optional feature. Non-elevated feature inspection is insufficient evidence; task 6.9 must prove the actual MSI build and installed journey.
- The first NSIS/MSI bundle build may download Tauri's hash-verified WiX/NSIS tool archives into the user-local Tauri tool cache. Task 6.9 records the resolved cache paths and installer hashes.

The Windows prerequisites and MSI VBSCRIPT requirement follow the [official Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). Installer targets and behavior follow the [official Windows installer guide](https://v2.tauri.app/distribute/windows-installer/).

## Reproducible commands

```powershell
corepack pnpm --filter @w-editor/desktop tauri info
corepack pnpm --filter @w-editor/desktop tauri:build:debug
corepack pnpm --filter @w-editor/desktop exec cargo fmt --manifest-path src-tauri/Cargo.toml --check
corepack pnpm --filter @w-editor/desktop exec cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

The 6.1 debug build intentionally uses `--no-bundle`; NSIS and MSI generation, installation, uninstall, reinstall, and data retention are hard gates in 6.9. Public signing is outside the spike and remains a later formal-release gate.

## MSI spike install mode

The checked-in `apps/desktop/src-tauri/wix/per-user.wxs` template makes the spike MSI a per-machine package (`InstallScope=perMachine`) rooted in the machine Program Files directory. This is intentional: the earlier per-user template produced Error 1926/5 while Windows Installer secured rollback files on a user-volume `Config.Msi`. The MSI therefore requires administrator UAC for installation and uninstall. The template keeps Tauri's dynamic product/version/upgrade/resource placeholders and does not claim non-elevated MSI installation.

The spike MSI deliberately omits the `DesktopFolder`/`ApplicationShortcutDesktop` component. Some Windows users redirect Desktop to another volume (the current test machine uses `D:\桌面`). This prevents the fixed package from touching a redirected desktop during its own install lifecycle. The MSI retains the Start Menu shortcut and the in-app uninstall entry; a future product installer may add a separately tested desktop shortcut strategy.

The default WiX template is also per-machine. The custom template is retained only to remove the redirected Desktop shortcut while preserving the supported elevated MSI installation model; it is part of the spike evidence, not a tolerance change. A later formal release may choose another system-wide MSI policy, but that is outside this spike and must be separately specified and tested.

Use the reproducible bundle command below. It selects an ASCII target directory at the Windows drive root to avoid WiX 3 path handling failures from a non-ASCII checkout path; override it only when the target is known to be ASCII:

```powershell
corepack pnpm run test:desktop-installer-build
$env:W_EDITOR_CARGO_TARGET_DIR = 'G:\\w-editor-tauri-target'
corepack pnpm run test:desktop-installer-build
```

Every MSI install, uninstall, and reinstall log must pass the security-event gate. It decodes Windows Installer's UTF-16LE verbose logs and fails on Error 1926, event 11926, or either file-security diagnostic, regardless of the `msiexec` exit code:

```powershell
corepack pnpm run verify:desktop-msi-events -- G:\\path\\install.log G:\\path\\uninstall.log G:\\path\\reinstall.log G:\\path\\msi-events.txt
```

The MSI spike uses the supported per-machine WiX installation model, so an interactive or silent install must be launched from an elevated PowerShell/UAC-approved process. A non-elevated run is expected to fail with Windows Installer 1603 and is not MSI function evidence:

```powershell
$msi = 'G:\\w-editor-tauri-target\\debug\\bundle\\msi\\W-Editor Desktop Spike_0.1.0_x64_en-US.msi'
Start-Process msiexec.exe -Verb RunAs -Wait -ArgumentList @('/i', $msi, '/norestart', '/L*V', 'G:\\w-editor-msi-install.log')
```

After an interactive test, export recent Windows Installer events and pass them to the same gate. This catches a visible Error 1926/5 even when a transaction later reports exit code 0:

```powershell
wevtutil qe Application /q:"*[System[Provider[@Name='MsiInstaller'] and TimeCreated[timediff(@SystemTime) <= 900000]]]" /f:text > G:\\w-editor-msi-events.txt
corepack pnpm run verify:desktop-msi-events -- G:\\w-editor-msi-install.log G:\\w-editor-msi-events.txt
```

Do not set `DisableRollback` or grant broad permissions to a whole data volume to silence this gate.
