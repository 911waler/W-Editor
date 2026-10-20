import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const configPath = resolve('apps/desktop/src-tauri/tauri.conf.json')
const templatePath = resolve('apps/desktop/src-tauri/wix/per-user.wxs')
const rootPackagePath = resolve('package.json')

describe('Tauri desktop installer scope', () => {
  it('routes nested Tauri lifecycle commands through the pinned Corepack package manager', () => {
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      build?: { beforeBuildCommand?: string; beforeDevCommand?: string }
    }

    expect(config.build?.beforeBuildCommand).toBe('corepack pnpm --dir ../.. --filter @w-editor/desktop run build:frontend')
    expect(config.build?.beforeDevCommand).toBe('corepack pnpm --dir ../.. run dev -- --host 127.0.0.1 --port 1420 --strictPort')
  })

  it('keeps the root production build independent from ambient pnpm shims', () => {
    const packageJson = JSON.parse(readFileSync(rootPackagePath, 'utf8')) as {
      scripts?: { build?: string; 'validate:openspec'?: string }
    }

    expect(packageJson.scripts?.build).toBe('corepack pnpm run typecheck && vite build')
    expect(packageJson.scripts?.['validate:openspec']).toBe('corepack pnpm run verify:legacy-openspec-refs && openspec validate --specs --strict --no-interactive && openspec validate --all --strict --no-interactive')
  })

  it('keeps the E2E production server chain independent from ambient pnpm shims', () => {
    const packageJson = JSON.parse(readFileSync(rootPackagePath, 'utf8')) as {
      scripts?: { 'build:e2e'?: string; 'preview:e2e'?: string }
    }

    expect(packageJson.scripts?.['build:e2e']).toBe('corepack pnpm run typecheck && vite build --mode e2e && corepack pnpm --filter @w-editor/editor-web run build && corepack pnpm --filter @w-editor/nwu-host run build')
    expect(packageJson.scripts?.['preview:e2e']).toBe('corepack pnpm run build:e2e && vite preview --host 127.0.0.1 --port 4173 --strictPort')
  })

  it('uses the checked-in per-machine WiX template for the MSI spike', () => {
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      bundle?: { windows?: { wix?: { template?: string } } }
    }
    expect(config.bundle?.windows?.wix?.template).toBe('wix/per-user.wxs')
  })

  it('declares the productized Windows targets and one-way Markdown associations', () => {
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      productName?: string
      version?: string
      bundle?: {
        targets?: string[]
        fileAssociations?: Array<{ ext?: string[]; description?: string }>
        windows?: { allowDowngrades?: boolean }
      }
    }
    expect(config.productName).toBe('W-Editor Desktop')
    expect(config.version).toBe('0.1.0')
    expect(config.bundle?.targets).toEqual(['nsis', 'msi'])
    expect(config.bundle?.windows?.allowDowngrades).toBe(false)
    expect(config.bundle?.fileAssociations).toEqual([
      expect.objectContaining({
        ext: ['md', 'markdown', 'txt'],
        description: 'Import Markdown into the W-Editor Library',
      }),
    ])
  })

  it('keeps MSI installation elevated and in the machine program-files directory', () => {
    const template = readFileSync(templatePath, 'utf8')
    expect(template).toContain('InstallScope="perMachine"')
    expect(template).toContain('$(var.PlatformProgramFilesFolder)')
    expect(template).not.toContain('InstallPrivileges="limited"')
    expect(template).toContain('RegistryKey Root="HKCU" Key="Software\\\\{{manufacturer}}\\\\{{product_name}}\\Components"')
    expect(template).not.toContain('ARPNOREPAIR')
    expect(template).toContain('<MajorUpgrade')
    expect(template).toContain('<Property Id="PREVIOUSINSTALLDIR">')
    expect(template).toContain('<SetProperty Id="INSTALLDIR" Value="[PREVIOUSINSTALLDIR]" After="AppSearch" Sequence="both">NOT INSTALLDIR AND PREVIOUSINSTALLDIR</SetProperty>')
    expect(template).not.toContain('<Property Id="INSTALLDIR">')
  })

  it('does not install a DesktopFolder shortcut that can trigger redirected-drive Config.Msi rollback', () => {
    const template = readFileSync(templatePath, 'utf8')
    expect(template).not.toContain('ApplicationShortcutDesktop')
    expect(template).not.toContain('<Directory Id="DesktopFolder"')
    expect(template).toContain('ApplicationStartMenuShortcut')
  })
})
