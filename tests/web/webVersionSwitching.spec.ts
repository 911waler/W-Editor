import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  createAtomicVersionPointer,
  inspectWebVersion,
  versionedAssetUrl,
} from '../../scripts/web-version-switching.mjs'

const distributionRoot = resolve(process.cwd(), 'packages/editor-web/dist')

describe('atomic Web version switching', () => {
  it('keeps old and new directories available, switches only after compatibility verification, and rolls back on failure', async () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'w-editor-version-switch-'))
    try {
      const oldDirectory = join(temporaryRoot, '1.0.0')
      const newDirectory = join(temporaryRoot, '1.1.0')
      cpSync(distributionRoot, oldDirectory, { recursive: true })
      cpSync(distributionRoot, newDirectory, { recursive: true })
      const oldVersion = inspectWebVersion({ directory: oldDirectory, version: '1.0.0', hostAdapterVersion: '1.0.0' })
      const newVersion = inspectWebVersion({ directory: newDirectory, version: '1.1.0', hostAdapterVersion: '1.0.0' })
      expect(oldVersion.status).toBe('compatible')
      expect(newVersion.status).toBe('compatible')
      expect(existsSync(oldDirectory)).toBe(true)
      expect(existsSync(newDirectory)).toBe(true)

      const pointer = createAtomicVersionPointer(join(temporaryRoot, 'current.json'), '1.0.0')
      await expect(pointer.read()).resolves.toMatchObject({ activeVersion: '1.0.0' })
      await expect(pointer.switchTo({ directory: newDirectory, version: '1.1.0' }, async (candidate) => {
        const verification = inspectWebVersion({ directory: candidate.directory, version: candidate.version, hostAdapterVersion: '1.0.0' })
        return { ok: verification.status === 'compatible', verification }
      })).resolves.toMatchObject({ activeVersion: '1.1.0', status: 'switched' })
      await expect(pointer.read()).resolves.toMatchObject({ activeVersion: '1.1.0' })

      const incompatibleDirectory = join(temporaryRoot, '2.0.0')
      cpSync(distributionRoot, incompatibleDirectory, { recursive: true })
      const incompatibleManifestPath = join(incompatibleDirectory, 'manifest.json')
      const incompatibleManifest = JSON.parse(readFileSync(incompatibleManifestPath, 'utf8')) as Record<string, unknown>
       incompatibleManifest['apiVersion'] = '2.0.0'
      writeFileSync(incompatibleManifestPath, `${JSON.stringify(incompatibleManifest)}\n`, 'utf8')
      await expect(pointer.switchTo({ directory: incompatibleDirectory, version: '2.0.0' }, async (candidate) => {
        const verification = inspectWebVersion({ directory: candidate.directory, version: candidate.version, hostAdapterVersion: '1.0.0' })
        return { ok: verification.status === 'compatible', reason: 'API major mismatch', verification }
      })).resolves.toMatchObject({ activeVersion: '1.1.0', status: 'rolled-back' })
      await expect(pointer.read()).resolves.toMatchObject({ activeVersion: '1.1.0' })
      expect(versionedAssetUrl('https://host.example.test', '1.0.0', 'editor.es.js')).toBe('https://host.example.test/static/vendor/w-editor/1.0.0/editor.es.js')
      expect(versionedAssetUrl('https://host.example.test', '1.1.0', 'editor.es.js')).toBe('https://host.example.test/static/vendor/w-editor/1.1.0/editor.es.js')
    } finally {
      rmSync(temporaryRoot, { force: true, recursive: true })
    }
  }, 30_000)
})
