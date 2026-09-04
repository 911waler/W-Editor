import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '..')
const evidencePath = resolve(repositoryRoot, 'artifacts/release-governance/task-9-2-current-verification.json')

export const RELEASE_PIPELINE_STAGES = Object.freeze([
  Object.freeze({
    id: 'shared',
    purpose: 'Validate the shared runtime and lockfile boundary before either target build.',
    steps: Object.freeze([
      Object.freeze({ id: 'lockfiles', runner: 'package', args: ['run', 'guard:lockfiles'] }),
      Object.freeze({ id: 'release-versions', runner: 'package', args: ['run', 'verify:release-versions'] }),
      Object.freeze({ id: 'editor-core-build', runner: 'package', args: ['--filter', '@w-editor/editor-core', 'run', 'build'] }),
      Object.freeze({ id: 'editor-vue-build', runner: 'package', args: ['--filter', '@w-editor/editor-vue', 'run', 'build'] }),
    ]),
  }),
  Object.freeze({
    id: 'web',
    purpose: 'Build and verify the self-contained Web ESM/IIFE distribution.',
    steps: Object.freeze([
      Object.freeze({ id: 'web-build', runner: 'package', args: ['--filter', '@w-editor/editor-web', 'run', 'build'] }),
      Object.freeze({ id: 'web-manifest', runner: 'package', args: ['run', 'verify:web-manifest'] }),
    ]),
  }),
  Object.freeze({
    id: 'desktop',
    purpose: 'Build and verify the Windows x64 NSIS and MSI artifacts.',
    steps: Object.freeze([
      Object.freeze({ id: 'playground-build', runner: 'package', args: ['run', 'build'] }),
      Object.freeze({ id: 'desktop-bundle', runner: 'package', args: ['run', 'test:desktop-installer-build'] }),
      Object.freeze({ id: 'desktop-packages', runner: 'package', args: ['run', 'verify:desktop-installer'] }),
    ]),
  }),
  Object.freeze({
    id: 'hash-sign',
    purpose: 'Hash, sign when an approved identity is configured, and verify artifact signatures.',
    steps: Object.freeze([
      Object.freeze({ id: 'desktop-sign', runner: 'package', args: ['run', 'sign:desktop'] }),
      Object.freeze({ id: 'desktop-manifest', runner: 'package', args: ['run', 'generate:desktop-manifest'] }),
      Object.freeze({ id: 'desktop-signature', runner: 'package', args: ['run', 'verify:desktop-signature'] }),
    ]),
  }),
  Object.freeze({
    id: 'runtime-tests',
    purpose: 'Run the shared, browser, installed Desktop, and host runtime gates.',
    steps: Object.freeze([
      Object.freeze({ id: 'unit', runner: 'package', args: ['run', 'test:unit'] }),
      Object.freeze({ id: 'browser-e2e', runner: 'package', args: ['run', 'test:e2e'] }),
      Object.freeze({ id: 'system-browsers', runner: 'package', args: ['run', 'test:system-browsers'] }),
      Object.freeze({ id: 'installed-desktop-lifecycle', runner: 'package', args: ['run', 'verify:desktop-installed-lifecycle'] }),
      Object.freeze({ id: 'installed-desktop-features', runner: 'package', args: ['run', 'test:desktop-feature-matrix'] }),
    ]),
  }),
  Object.freeze({
    id: 'manifest-finalize',
    purpose: 'Finalize one release manifest only after every preceding stage has returned successfully.',
    steps: Object.freeze([
      Object.freeze({ id: 'manifest-finalize', runner: 'node', args: ['scripts/finalize-release-manifest.mjs'] }),
    ]),
  }),
])

function parseOption(name) {
  const argument = process.argv.find((value) => value.startsWith(`${name}=`))
  return argument === undefined ? null : argument.slice(name.length + 1)
}

function selectedStages() {
  const stage = parseOption('--stage')
  const through = parseOption('--through')
  if (stage !== null && through !== null) throw new Error('--stage and --through cannot be used together.')
  if (stage !== null) {
    const selected = RELEASE_PIPELINE_STAGES.find((candidate) => candidate.id === stage)
    if (selected === undefined) throw new Error(`Unknown release pipeline stage: ${stage}`)
    return [selected]
  }
  if (through !== null) {
    const index = RELEASE_PIPELINE_STAGES.findIndex((candidate) => candidate.id === through)
    if (index < 0) throw new Error(`Unknown release pipeline stage: ${through}`)
    return RELEASE_PIPELINE_STAGES.slice(0, index + 1)
  }
  return RELEASE_PIPELINE_STAGES
}

function commandFor(step) {
  if (step.runner === 'node') return { executable: process.execPath, args: step.args }
  const packageArguments = ['pnpm', ...step.args]
  if (process.platform === 'win32') {
    const quote = (value) => /[\s"]/u.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value
    return {
      display: ['corepack', ...packageArguments].map(quote).join(' '),
      executable: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', ['corepack', ...packageArguments].map(quote).join(' ')],
    }
  }
  return {
    display: ['corepack', ...packageArguments].join(' '),
    executable: process.platform === 'win32' ? 'corepack.cmd' : 'corepack',
    args: packageArguments,
  }
}

function writeEvidence(result) {
  writeFileSync(evidencePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
}

function runStep(stage, step, dryRun) {
  const command = commandFor(step)
  const display = command.display ?? [command.executable, ...command.args].join(' ')
  if (dryRun) return { stage: stage.id, step: step.id, command: display, status: 'planned' }
  console.log(`\n[release-pipeline] ${stage.id}/${step.id}: ${display}`)
  const result = spawnSync(command.executable, command.args, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.error !== undefined) throw new Error(`${stage.id}/${step.id} could not start: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`${stage.id}/${step.id} failed with exit code ${String(result.status)}.`)
  return { stage: stage.id, step: step.id, command: display, status: 'passed' }
}

const dryRun = process.argv.includes('--plan')
const stages = selectedStages()
const steps = stages.flatMap((stage) => stage.steps.map((step) => ({ stage, step })))
const startedAt = new Date().toISOString()
const results = []

try {
  for (const { stage, step } of steps) results.push(runStep(stage, step, dryRun))
  const result = {
    schemaVersion: 1,
    change: 'dual-target-release',
    task: '9.2',
    status: dryRun ? 'planned' : 'passed',
    mode: dryRun ? 'plan' : 'execute',
    startedAt,
    completedAt: new Date().toISOString(),
    stages: stages.map(({ id, purpose }) => ({ id, purpose })),
    sequence: results,
    providerAgnostic: true,
    ciEntryPoint: 'corepack pnpm run release:verify',
    notExecuted: dryRun ? ['command execution'] : ['9.3-9.11 task-specific evidence beyond the shared pipeline'],
  }
  writeEvidence(result)
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  const result = {
    schemaVersion: 1,
    change: 'dual-target-release',
    task: '9.2',
    status: 'failed',
    mode: dryRun ? 'plan' : 'execute',
    startedAt,
    completedAt: new Date().toISOString(),
    stages: stages.map(({ id, purpose }) => ({ id, purpose })),
    sequence: results,
    failedStep: error instanceof Error ? error.message : String(error),
  }
  writeEvidence(result)
  console.error(JSON.stringify(result, null, 2))
  process.exitCode = 1
}
