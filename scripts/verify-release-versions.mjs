import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import {
  EDITOR_WEB_RELEASE_VERSION_SOURCE_PATH,
  readReleaseVersions,
  RELEASE_VERSIONS_PATH,
  renderEditorWebReleaseVersionSource,
} from './release-versions.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const evidenceArgument = process.argv.find((argument) => argument.startsWith('--evidence='))
const evidencePath = evidenceArgument === undefined ? null : resolve(repositoryRoot, evidenceArgument.slice('--evidence='.length))

function readJson(path) {
  return JSON.parse(readFileSync(resolve(repositoryRoot, path), 'utf8'))
}

function check(checks, name, actual, expected) {
  const passed = actual === expected
  checks.push({ name, passed, actual, expected })
  if (!passed) throw new Error(`${name}: expected ${String(expected)}, received ${String(actual)}.`)
}

function checkContains(checks, name, source, fragment) {
  const passed = source.includes(fragment)
  checks.push({ name, passed, fragment })
  if (!passed) throw new Error(`${name}: required source fragment is missing.`)
}

function checkNotContains(checks, name, source, fragment) {
  const passed = !source.includes(fragment)
  checks.push({ name, passed, fragment })
  if (!passed) throw new Error(`${name}: forbidden source fragment is present.`)
}

function writeEvidence(payload) {
  if (evidencePath === null) return
  writeFileSync(evidencePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

const checks = []
try {
  const versions = readReleaseVersions(repositoryRoot)
  const packagePaths = [
    'package.json',
    'packages/editor-core/package.json',
    'packages/editor-vue/package.json',
    'packages/editor-web/package.json',
    'apps/playground/package.json',
    'apps/desktop/package.json',
  ]
  for (const path of packagePaths) check(checks, `${path}: product version`, readJson(path).version, versions.productVersion)

  check(checks, 'Tauri config: product version', readJson('apps/desktop/src-tauri/tauri.conf.json').version, versions.productVersion)
  const cargo = readFileSync(resolve(repositoryRoot, 'apps/desktop/src-tauri/Cargo.toml'), 'utf8')
  checkContains(checks, 'Cargo manifest: product version', cargo, `version = "${versions.productVersion}"`)

  const publicContracts = readFileSync(resolve(repositoryRoot, 'packages/editor-web/src/publicContracts.ts'), 'utf8')
  checkContains(checks, 'Web contracts: package-local generated version source', publicContracts, "./releaseVersions.generated")
  checkNotContains(checks, 'Web contracts: no repository-root source escape', publicContracts, 'release/versions.json')
  for (const key of ['webApiVersion', 'webSchemaVersion', 'hostContractsVersion', 'minimumHostAdapterVersion']) {
    checkContains(checks, `Web contracts: ${key}`, publicContracts, `RELEASE_VERSIONS.${key}`)
  }
  const generatedWebVersions = readFileSync(resolve(repositoryRoot, EDITOR_WEB_RELEASE_VERSION_SOURCE_PATH), 'utf8')
  check(
    checks,
    'Web contracts: generated source matches central version source',
    generatedWebVersions,
    renderEditorWebReleaseVersionSource(versions),
  )

  const build = readFileSync(resolve(repositoryRoot, 'apps/desktop/src-tauri/build.rs'), 'utf8')
  checkContains(checks, 'Desktop build: central version source', build, RELEASE_VERSIONS_PATH)
  const storage = readFileSync(resolve(repositoryRoot, 'apps/desktop/src-tauri/src/storage.rs'), 'utf8')
  for (const key of ['DATA_ROOT_SCHEMA_VERSION', 'LIBRARY_SCHEMA_VERSION', 'SETTINGS_SCHEMA_VERSION', 'MARKDOWN_DIALECT_VERSION']) {
    checkContains(checks, `Desktop storage: generated ${key}`, storage, `crate::release_versions::${key}`)
  }

  const result = {
    schemaVersion: 1,
    change: 'dual-target-release',
    task: '9.1',
    status: 'passed',
    source: RELEASE_VERSIONS_PATH,
    versions,
    productManifests: packagePaths.concat(['apps/desktop/src-tauri/tauri.conf.json', 'apps/desktop/src-tauri/Cargo.toml']),
    checks,
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim(),
    notExecuted: ['9.2-9.11'],
  }
  writeEvidence(result)
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  const result = {
    schemaVersion: 1,
    change: 'dual-target-release',
    task: '9.1',
    status: 'failed',
    source: RELEASE_VERSIONS_PATH,
    checks,
    error: error instanceof Error ? error.message : String(error),
  }
  writeEvidence(result)
  console.error(JSON.stringify(result, null, 2))
  process.exitCode = 1
}
