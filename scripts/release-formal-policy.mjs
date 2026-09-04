export const FORMAL_GATE_INPUTS = Object.freeze([
  ['requiredArtifacts', 'REQUIRED_ARTIFACTS_MISSING_OR_FAILED'],
  ['artifactHashes', 'ARTIFACT_HASH_MISSING_OR_INVALID'],
  ['signatures', 'CODE_SIGNING_UNAVAILABLE_OR_INVALID'],
  ['sharedTests', 'SHARED_TESTS_MISSING_OR_FAILED'],
  ['hostContract', 'HOST_CONTRACT_MISSING_OR_FAILED'],
  ['rendererParity', 'RENDERER_PARITY_MISSING_OR_FAILED'],
  ['resourceClosure', 'RESOURCE_CLOSURE_MISSING_OR_FAILED'],
  ['browserWebView2', 'BROWSER_OR_WEBVIEW2_MISSING_OR_FAILED'],
  ['accessibility', 'ACCESSIBILITY_MISSING_OR_FAILED'],
  ['performance', 'PERFORMANCE_MISSING_OR_FAILED'],
  ['dataRecovery', 'DATA_RECOVERY_MISSING_OR_FAILED'],
  ['licensesAndProvenance', 'LICENSES_OR_PROVENANCE_MISSING_OR_FAILED'],
  ['cleanSource', 'WORKING_TREE_DIRTY'],
])

export function evaluateFormalRelease(inputs) {
  const blockers = FORMAL_GATE_INPUTS
    .filter(([key]) => inputs?.[key] !== true)
    .map(([input, code]) => Object.freeze({ code, input }))
  return Object.freeze({
    formalEligible: blockers.length === 0,
    blockers: Object.freeze(blockers),
  })
}
