import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { evaluateFormalRelease, FORMAL_GATE_INPUTS } from './release-formal-policy.mjs'

const manifestPath = resolve(process.env.W_EDITOR_RELEASE_MANIFEST ?? 'artifacts/desktop/release-manifest.json')
const outputPath = resolve(process.env.W_EDITOR_FORMAL_GATE_EVIDENCE_PATH ?? 'artifacts/release-governance/task-9-11-current-verification.json')

function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

const checks = []
try {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const passingInputs = Object.fromEntries(FORMAL_GATE_INPUTS.map(([key]) => [key, true]))
  const passingDecision = evaluateFormalRelease(passingInputs)
  requireCondition(passingDecision.formalEligible === true && passingDecision.blockers.length === 0, 'An all-passed formal gate did not become eligible.')
  checks.push({ name: 'all-required-inputs-pass', status: 'passed' })

  const faultInjection = FORMAL_GATE_INPUTS.map(([key, expectedCode]) => {
    const decision = evaluateFormalRelease({ ...passingInputs, [key]: false })
    requireCondition(decision.formalEligible === false, `${key} failure was allowed to become formal.`)
    requireCondition(decision.blockers.some(({ code, input }) => code === expectedCode && input === key), `${key} failure did not retain its expected blocker.`)
    return { input: key, expectedCode, formalEligible: decision.formalEligible, blockers: decision.blockers, status: 'passed' }
  })
  checks.push({ name: 'every-required-input-fails-closed', status: 'passed', faultInjection })

  const unsignedDecision = evaluateFormalRelease({ ...passingInputs, signatures: false })
  requireCondition(unsignedDecision.formalEligible === false && unsignedDecision.blockers.some(({ input }) => input === 'signatures'), 'An unsigned package was allowed to become formal.')
  checks.push({ name: 'test-unsigned-never-formal', status: 'passed', decision: unsignedDecision })

  const currentDecision = evaluateFormalRelease(manifest.formalGate?.inputs)
  requireCondition(currentDecision.formalEligible === manifest.formalEligible, 'The manifest formalEligible value diverges from the formal policy.')
  requireCondition(JSON.stringify(currentDecision.blockers) === JSON.stringify(manifest.formalGate?.blockers), 'The manifest formal blockers diverge from the formal policy.')
  requireCondition(manifest.releaseStatus !== 'formal' || currentDecision.formalEligible === true, 'The current manifest is formal with failed required inputs.')
  requireCondition(manifest.releaseStatus !== 'formal' && manifest.formalEligible === false, 'The current TEST/UNSIGNED package was unexpectedly marked formal.')
  checks.push({ name: 'current-manifest-policy-consistency', status: 'passed', releaseStatus: manifest.releaseStatus, decision: currentDecision })

  const result = {
    schemaVersion: 1,
    change: 'dual-target-release',
    task: '9.11',
    status: 'passed',
    manifestPath: 'artifacts/desktop/release-manifest.json',
    requiredInputs: FORMAL_GATE_INPUTS.map(([input, blocker]) => ({ input, blocker })),
    checks,
    formalEligible: manifest.formalEligible,
    releaseStatus: manifest.releaseStatus,
    notExecuted: manifest.notExecuted,
  }
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  const result = {
    schemaVersion: 1,
    change: 'dual-target-release',
    task: '9.11',
    status: 'failed',
    checks,
    error: error instanceof Error ? error.message : String(error),
  }
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.error(JSON.stringify(result, null, 2))
  process.exitCode = 1
}
