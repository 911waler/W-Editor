import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '..')
const rawPath = resolve(repositoryRoot, 'artifacts/release-governance/task-9-9-performance-raw.json')
const evidencePath = resolve(repositoryRoot, 'artifacts/release-governance/task-9-9-current-verification.json')
const baselinePath = resolve(repositoryRoot, 'tests/fixtures/performance/performance-baseline.json')
const rawBaselinePath = resolve(repositoryRoot, 'tests/fixtures/performance/performance-raw.json')
const performanceBudgetsPath = resolve(repositoryRoot, 'release/performance-budgets.json')

function readJson(path) {
  return JSON.parse(readFileSync(resolve(repositoryRoot, path), 'utf8'))
}

function hash(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase()
}

function record(path) {
  const absolutePath = resolve(repositoryRoot, path)
  return { path, bytes: statSync(absolutePath).size, sha256: hash(absolutePath) }
}

function nearestRankP95(samples) {
  const ordered = [...samples].sort((left, right) => left - right)
  return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)]
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

function metricCheck(checks, id, metric, expectedCount, budget) {
  requireCondition(metric?.count === expectedCount, `${id} must contain ${expectedCount} samples.`)
  requireCondition(Array.isArray(metric.raw) && metric.raw.length === expectedCount, `${id} raw sample count is invalid.`)
  requireCondition(metric.p95NearestRank === nearestRankP95(metric.raw), `${id} nearest-rank P95 does not match raw samples.`)
  requireCondition(budget?.status === 'frozen', `${id} does not use a frozen performance budget.`)
  requireCondition(Number.isFinite(budget?.limitMs), `${id} has no measured/frozen latency budget.`)
  const passed = metric.p95NearestRank <= budget.limitMs
  checks.push({ id, status: passed ? 'passed' : 'failed', observedP95Ms: metric.p95NearestRank, limitMs: budget.limitMs, basis: budget.basis })
}

function writeResult(result) {
  writeFileSync(evidencePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
}

try {
  requireCondition(existsSync(rawPath), `Performance raw evidence is missing: ${rawPath}`)
  const raw = JSON.parse(readFileSync(rawPath, 'utf8'))
  const manifest = readJson('artifacts/desktop/release-manifest.json')
  const frozenBudgets = readJson('release/performance-budgets.json')
  const checks = []

  requireCondition(raw.change === 'dual-target-release' && raw.task === '9.9', 'Performance raw evidence identity is invalid.')
  requireCondition(raw.status === 'completed', `Performance measurement did not complete: ${raw.error ?? 'unknown error'}`)
  requireCondition(raw.diagnostics.length === 0, `Performance evidence contains diagnostics: ${JSON.stringify(raw.diagnostics)}`)
  requireCondition(typeof raw.environment.seam === 'string' && raw.environment.seam.toLocaleLowerCase().includes('absent'), 'Production performance measurement did not prove E2E seam absence.')
  requireCondition(raw.environment.phase0Baseline.summary.sha256 === hash(baselinePath), 'Phase 0 performance summary changed after measurement.')
  requireCondition(raw.environment.phase0Baseline.raw.sha256 === hash(rawBaselinePath), 'Phase 0 performance raw evidence changed after measurement.')
  requireCondition(frozenBudgets.change === 'dual-target-release' && frozenBudgets.task === '9.9', 'Frozen performance budget identity is invalid.')
  requireCondition(raw.inputs.performanceBudgets?.path === 'release/performance-budgets.json', 'Performance raw evidence does not identify the frozen budget file.')
  requireCondition(raw.inputs.performanceBudgets.sha256 === hash(performanceBudgetsPath), 'Frozen performance budget file changed after measurement.')
  checks.push({ name: 'measurement-identity-and-seam', status: 'passed', browserVersion: raw.environment.browserVersion, diagnostics: raw.diagnostics.length })
  checks.push({ name: 'frozen-performance-budgets', status: 'passed', budgetFile: raw.inputs.performanceBudgets })

  const inputPaths = ['tests/fixtures/parity/w-editor-parity.md', 'e2e/fixtures/documents/representative-long.md', 'e2e/fixtures/documents/approximately-1mb.md']
  for (const path of inputPaths) {
    const actual = record(path)
    const captured = Object.values(raw.inputs).find((value) => value?.path === path)
    requireCondition(captured?.bytes === actual.bytes && captured?.sha256 === actual.sha256, `Performance input changed after measurement: ${path}`)
  }
  checks.push({ name: 'performance-input-hashes', status: 'passed', count: inputPaths.length })

  metricCheck(checks, 'web.esm.editor', raw.measurements.web.esm.editor, 5, raw.budgets['web.esm.editor'])
  metricCheck(checks, 'web.esm.reader', raw.measurements.web.esm.reader, 5, raw.budgets['web.esm.reader'])
  metricCheck(checks, 'web.iife.editor', raw.measurements.web.iife.editor, 5, raw.budgets['web.iife.editor'])
  metricCheck(checks, 'web.iife.reader', raw.measurements.web.iife.reader, 5, raw.budgets['web.iife.reader'])
  metricCheck(checks, 'playground.firstEditable', raw.measurements.playground.firstEditable, 5, raw.budgets['playground.firstEditable'])
  metricCheck(checks, 'playground.ordinaryInputSource', raw.measurements.playground.ordinaryInputSource, 20, raw.budgets['playground.ordinaryInputSource'])
  metricCheck(checks, 'playground.ordinaryInputVisual', raw.measurements.playground.ordinaryInputVisual, 20, raw.budgets['playground.ordinaryInputVisual'])
  metricCheck(checks, 'playground.finalRender', raw.measurements.playground.finalRender, 5, raw.budgets['playground.finalRender'])
  metricCheck(checks, 'documents.representativeLong', raw.measurements.documents.representativeLong.summary, 5, raw.budgets['documents.representativeLong'])
  metricCheck(checks, 'documents.approximately1MiB', raw.measurements.documents.approximately1MiB.summary, 5, raw.budgets['documents.approximately1MiB'])
  metricCheck(checks, 'drawio.lazyLoad', raw.measurements.drawioLazyLoad.summary, 5, raw.budgets['drawio.lazyLoad'])
  metricCheck(checks, 'desktop.startup', raw.measurements.desktopStartup.summary, 5, raw.budgets['desktop.startup'])

  requireCondition(raw.measurements.documents.representativeLong.bytes > 150_000, 'Representative long-document fixture is too small.')
  requireCondition(raw.measurements.documents.approximately1MiB.bytes >= 1024 * 1024 && raw.measurements.documents.approximately1MiB.bytes < 1_050_000, 'Approximately 1 MiB fixture is outside the accepted deterministic range.')
  checks.push({ name: 'long-document-input-shape', status: 'passed', representativeBytes: raw.measurements.documents.representativeLong.bytes, approximately1MiBBytes: raw.measurements.documents.approximately1MiB.bytes })

  const drawioSamples = raw.measurements.drawioLazyLoad.samples
  requireCondition(drawioSamples.every(({ initialRequests, resourceCount, externalResources }) => initialRequests === 0 && resourceCount > 0 && externalResources.length === 0), 'draw.io did not remain lazy/offline or emitted external resources.')
  checks.push({ name: 'drawio-lazy-offline-boundary', status: 'passed', samples: drawioSamples.length, initialRequests: drawioSamples.map(({ initialRequests }) => initialRequests), loadedResources: drawioSamples.map(({ resourceCount }) => resourceCount) })

  for (const [key, artifact] of Object.entries(raw.artifacts)) {
    const manifestArtifact = key === 'webZip' ? manifest.artifacts.webZip : key === 'nsis' ? manifest.artifacts.nsis : manifest.artifacts.msi
    const actual = record(artifact.path)
    requireCondition(actual.bytes === artifact.bytes && actual.sha256 === artifact.sha256, `${key} changed after performance measurement.`)
    requireCondition(actual.bytes === manifestArtifact.bytes && actual.sha256 === manifestArtifact.sha256, `${key} does not match release manifest.`)
    const packageBudget = raw.budgets.packageSize[key]
    requireCondition(packageBudget?.status === 'frozen' && Number.isInteger(packageBudget.limitBytes), `${key} has no frozen package-size budget.`)
    requireCondition(/^[0-9A-F]{64}$/u.test(packageBudget.sha256), `${key} frozen package hash is not a SHA-256 digest.`)
    requireCondition(actual.bytes === packageBudget.limitBytes && actual.sha256 === packageBudget.sha256, `${key} does not match the frozen package-size budget.`)
    requireCondition(actual.bytes === frozenBudgets.packageSize[key].limitBytes && actual.sha256 === frozenBudgets.packageSize[key].sha256, `${key} does not match release/performance-budgets.json.`)
  }
  checks.push({ name: 'package-size-and-hash-budget', status: 'passed', artifacts: raw.artifacts, budgets: raw.budgets.packageSize })

  const stableInputs = Object.fromEntries(Object.entries(raw.inputs).filter(([key]) => key !== 'releaseManifest'))

  const result = {
    schemaVersion: 1,
    change: 'dual-target-release',
    task: '9.9',
    status: checks.every(({ status }) => status === 'passed') ? 'passed' : 'failed',
    rawEvidence: record('artifacts/release-governance/task-9-9-performance-raw.json'),
    environment: raw.environment,
    inputs: stableInputs,
    measurements: raw.measurements,
    budgets: raw.budgets,
    artifacts: raw.artifacts,
    checks,
    diagnostics: raw.diagnostics,
    notExecuted: [],
  }
  writeResult(result)
  console.log(JSON.stringify(result, null, 2))
  if (result.status !== 'passed') process.exitCode = 1
} catch (error) {
  const result = {
    schemaVersion: 1,
    change: 'dual-target-release',
    task: '9.9',
    status: 'failed',
    checks: [],
    error: error instanceof Error ? error.message : String(error),
    notExecuted: ['remaining 9.9 measurements', '9.10-9.11'],
  }
  writeResult(result)
  console.error(JSON.stringify(result, null, 2))
  process.exitCode = 1
}
