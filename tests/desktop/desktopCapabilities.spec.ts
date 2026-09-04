import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const capabilitiesPath = resolve('apps/desktop/src-tauri/capabilities/main.json')
const configPath = resolve('apps/desktop/src-tauri/tauri.conf.json')
const cargoPath = resolve('apps/desktop/src-tauri/Cargo.toml')
const desktopPackagePath = resolve('apps/desktop/package.json')
const libPath = resolve('apps/desktop/src-tauri/src/lib.rs')

describe('Tauri desktop spike capability boundary', () => {
  it('grants the main window no filesystem, shell, process, or network plugin permission', () => {
    const capabilities = JSON.parse(readFileSync(capabilitiesPath, 'utf8')) as { permissions?: unknown }
    expect(capabilities.permissions).toEqual([
      'core:event:allow-listen',
      'core:event:allow-unlisten',
      'core:window:allow-set-focus',
      'core:window:allow-set-title',
      'core:window:allow-show',
      'core:window:allow-unminimize',
      'dialog:allow-open',
      'dialog:allow-save',
    ])
    const source = readFileSync(capabilitiesPath, 'utf8')
    expect(source).not.toMatch(/(?:fs|shell|process|http):/u)
  })

  it('locks and registers only the native dialog open/save capabilities', () => {
    const desktopPackage = JSON.parse(readFileSync(desktopPackagePath, 'utf8')) as { dependencies?: Record<string, string> }
    const cargo = readFileSync(cargoPath, 'utf8')
    const lib = readFileSync(libPath, 'utf8')
    expect(desktopPackage.dependencies?.['@tauri-apps/plugin-dialog']).toBe('2.7.2')
    expect(cargo).toContain('tauri-plugin-dialog = "=2.7.2"')
    expect(lib).toContain('.plugin(tauri_plugin_dialog::init())')
  })

  it('keeps the spike restricted to the main window and managed frontend resource closure', () => {
    const capabilities = JSON.parse(readFileSync(capabilitiesPath, 'utf8')) as { windows?: unknown }
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as { build?: { frontendDist?: string }; app?: { windows?: Array<{ label?: string }> } }
    expect(capabilities.windows).toEqual(['main'])
    expect(config.app?.windows?.map(({ label }) => label)).toEqual(['main'])
    expect(config.build?.frontendDist).toBe('../dist')
  })
})
