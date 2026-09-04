import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const nwuFixtureRoot = resolve(import.meta.dirname, '../fixtures/nwu-reference')
const schemaDraftPath = resolve(nwuFixtureRoot, 'nwu-911-future-schema-api-draft.md')
const handoffPath = resolve(nwuFixtureRoot, 'nwu-911-real-repo-integration-handoff.md')
const validationReportPath = resolve(nwuFixtureRoot, 'nwu-reference-integration-validation.md')

describe('NWU reference integration documentation contracts', () => {
  it('keeps the future schema/API draft explicit, complete, and unimplemented', () => {
    const document = readFileSync(schemaDraftPath, 'utf8')
    for (const marker of [
      '仅供真实 NWU 当前仓库重新调查与独立设计参考',
      '不得声明已实施',
      'serverRevision',
      'article_versions',
      'recovery_drafts',
      'workspace_state',
      'user_preferences',
      'content-addressed assets',
      'article_asset_refs',
      'autosave-draft',
      'manual-save',
      'publish',
      'AUTH_REQUIRED',
      'AUTHORIZATION_DENIED',
      'CSRF_REJECTED',
      'REVISION_CONFLICT',
      '真实仓库 OpenSpec',
    ]) expect(document).toContain(marker)
  })

  it('covers the real-repository handoff and reference-only boundary', () => {
    const document = readFileSync(handoffPath, 'utf8')
    for (const marker of [
      '真实 NWU 当前仓库',
      '落后 NWU 副本',
      '模拟宿主',
      '生产环境',
      'API',
      'Jinja',
      'DB',
      '权限',
      'CSRF',
      'CSP',
      'cache',
      'proxy',
      'assets',
      'extensions',
      'staging',
      '双轨',
      '回退',
      'Firefox',
      'Safari',
      'iOS',
      'Android',
      '独立 NWU OpenSpec',
      '禁止机械应用旧 patch',
    ]) expect(document).toContain(marker)
  })

  it('keeps the phase validation report reference-only and requires a future independent OpenSpec', () => {
    const document = readFileSync(validationReportPath, 'utf8')
    for (const marker of [
      '落后 NWU 副本不等于真实实现',
      '模拟宿主不等于真实 NWU 当前仓库',
      '生产环境未验证',
      '禁止机械应用旧 patch',
      '未来 Codex 必须建立独立 NWU OpenSpec',
      '10.1–10.7',
      'Firefox',
      'WebKit/Safari',
      'iOS',
      'Android',
      '未验证',
      '不进入 11.x',
    ]) expect(document).toContain(marker)
  })
})
