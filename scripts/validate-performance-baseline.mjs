import { readFileSync } from 'node:fs'

const raw = JSON.parse(readFileSync('tests/fixtures/performance/performance-raw.json', 'utf8'))
const summary = JSON.parse(readFileSync('tests/fixtures/performance/performance-baseline.json', 'utf8'))

function nearestRankP95(samples) {
  const ordered = [...samples].sort((left, right) => left - right)
  return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)]
}

function assertMetric(metric, label) {
  if (metric?.count !== 5 || !Array.isArray(metric.raw) || metric.raw.length !== 5) {
    throw new Error(`${label} must contain five raw samples.`)
  }
  if (metric.p95NearestRank !== nearestRankP95(metric.raw)) {
    throw new Error(`${label} nearest-rank P95 does not match its raw samples.`)
  }
}

if (raw.status !== 'completed' || summary.status !== 'completed') throw new Error('Performance baseline must complete without diagnostics.')
assertMetric(raw.samples.firstEditable, 'firstEditable')
assertMetric(raw.samples.ordinaryInput, 'ordinaryInput')
assertMetric(raw.readerFinal.final, 'final')
if (raw.readerFinal.reader.status !== 'not-implemented-at-baseline') {
  throw new Error('Reader baseline must explicitly record that Reader is not implemented.')
}
if (raw.documents.representativeLongDocument?.bytes <= 150_000) throw new Error('Representative long fixture is not present in performance evidence.')
if (raw.documents.approximately1MiB?.bytes < 1024 * 1024 || raw.documents.approximately1MiB?.bytes >= 1_050_000) {
  throw new Error('Approximately 1 MiB fixture is outside the accepted deterministic range.')
}
if (raw.diagnostics.length !== 0 || summary.diagnostics.length !== 0) throw new Error('Performance evidence contains browser diagnostics.')
if (raw.budgetCandidates.approximately1MiB.valueMs !== null || raw.budgetCandidates.representativeLongDocument.valueMs !== null) {
  throw new Error('Large-document measurements must remain diagnostic-only in Phase 0.')
}
console.log(JSON.stringify({ status: 'passed', firstEditableP95: raw.samples.firstEditable.p95NearestRank, ordinaryInputP95: raw.samples.ordinaryInput.p95NearestRank, finalP95: raw.readerFinal.final.p95NearestRank }, null, 2))
