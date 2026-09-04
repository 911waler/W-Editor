import { describe, expect, it } from 'vitest'

import { decodeMsiLog, findMsiSecurityErrors } from '../../scripts/verify-msi-install-events.mjs'

describe('MSI installer security event gate', () => {
  it('detects file-security errors even when the transaction later reports exit code zero', () => {
    const findings = findMsiSecurityErrors(`
Product: W-Editor Desktop Spike -- Error 1926. Could not set file security for file 'D:\\Config.Msi\\x.rbf'. Error: 5.
MSI (s) Error: 11926: MsiInstaller reported a file security failure.
MainEngineThread is returning 0
`)

    expect(findings).toHaveLength(2)
    expect(findings.join('\n')).toContain('1926')
    expect(findings.join('\n')).toContain('11926')
  })

  it('accepts a clean verbose install log', () => {
    expect(findMsiSecurityErrors('Product: W-Editor Desktop Spike -- Installation completed successfully.\nMainEngineThread is returning 0')).toEqual([])
  })

  it('decodes the UTF-16LE BOM used by Windows Installer verbose logs', () => {
    const bytes = Buffer.from(`\uFEFFProduct: W-Editor Desktop Spike -- Error 1926. Could not set file security for file 'D:\\Config.Msi\\x.rbf'.`, 'utf16le')
    expect(findMsiSecurityErrors(decodeMsiLog(bytes))).toHaveLength(1)
  })
})
