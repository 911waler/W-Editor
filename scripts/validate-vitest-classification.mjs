import { readFileSync } from 'node:fs'
import { relative } from 'node:path'

const rawReport = JSON.parse(readFileSync('tests/fixtures/baseline/vitest-red.json', 'utf8'))
const classification = JSON.parse(readFileSync('tests/fixtures/baseline/vitest-red-classification.json', 'utf8'))
const normalize = (value) => value.replaceAll('\\', '/')
const repositoryRelativeTestPath = (fileName) => {
  const normalized = normalize(fileName)
  const testMarker = '/tests/'
  const testIndex = normalized.lastIndexOf(testMarker)
  if (testIndex >= 0) return `tests/${normalized.slice(testIndex + testMarker.length)}`
  return normalize(relative(process.cwd(), fileName))
}
const actualFailures = (rawReport.testResults ?? []).flatMap((file) => (
  (file.assertionResults ?? [])
    .filter((assertion) => assertion.status === 'failed')
    .map((assertion) => `${repositoryRelativeTestPath(file.name)}::${assertion.fullName}`)
))
const classifiedFailures = classification.failures.map((failure) => `${failure.file}::${failure.test}`)
const actualSet = new Set(actualFailures)
const classifiedSet = new Set(classifiedFailures)
const missing = actualFailures.filter((failure) => !classifiedSet.has(failure))
const extra = classifiedFailures.filter((failure) => !actualSet.has(failure))
const categoryCounts = Object.fromEntries(
  Object.entries(classification.summary.categories).map(([category]) => [
    category,
    classification.failures.filter((failure) => failure.category === category).length,
  ]),
)
const duplicateIds = classification.failures
  .map((failure) => failure.id)
  .filter((id, index, ids) => ids.indexOf(id) !== index)

if (actualFailures.length !== 18 || classifiedFailures.length !== 18 || missing.length > 0 || extra.length > 0) {
  throw new Error(JSON.stringify({ actualFailures, classifiedFailures, missing, extra }, null, 2))
}
if (duplicateIds.length > 0 || categoryCounts['product-defect'] !== 0 || categoryCounts['jsdom-canvas-environment'] !== 0) {
  throw new Error(JSON.stringify({ duplicateIds, categoryCounts }, null, 2))
}
console.log(JSON.stringify({ status: 'passed', failures: 18, categoryCounts }, null, 2))
