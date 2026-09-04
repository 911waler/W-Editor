import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { chromium } from 'playwright'

const repositoryRoot = resolve(import.meta.dirname, '..')
const outputPath = resolve(repositoryRoot, 'artifacts/release-governance/task-9-7-current-verification.json')
const systemReportPath = resolve(repositoryRoot, 'artifacts/release-governance/task-9-7-system-browser-smoke.json')
const webViewEvidencePath = resolve(repositoryRoot, 'artifacts/release-governance/task-9-7-webview2-feature-matrix.json')
const lifecycleEvidencePath = resolve(repositoryRoot, 'artifacts/release-governance/task-9-5-current-installer-lifecycle-rerun-20260829.json')
const featureMatrixPort = 16_000 + (process.pid % 1_000)
const featureMatrixNativePort = 35_000 + (process.pid % 1_000)
const screenshots = ['esm-ordinary', 'esm-formula-code', 'esm-async-graphics', 'esm-complex-layout', 'iife-ordinary', 'iife-formula-code', 'iife-async-graphics', 'iife-complex-layout']
  .flatMap((name) => [`${name}-reader.png`, `${name}-final.png`])

function quoteWindows(value) {
  return /[\s"]/u.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value
}

function packageCommand(args) {
  if (process.platform === 'win32') return { command: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', ['corepack', 'pnpm', ...args].map(quoteWindows).join(' ')] }
  return { command: 'corepack', args: ['pnpm', ...args] }
}

function run(command, args, env = process.env) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd: repositoryRoot, env, stdio: 'inherit', windowsHide: true })
    child.once('error', rejectPromise)
    child.once('exit', (code) => code === 0 ? resolvePromise() : rejectPromise(new Error(`${command} ${args.join(' ')} exited with code ${String(code)}.`)))
  })
}

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase()
}

function writeEvidence(result) {
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
}

async function bundledChromiumGate() {
  const browser = await chromium.launch({ headless: true })
  const browserVersion = browser.version()
  await browser.close()
  const command = packageCommand(['exec', 'playwright', 'test', 'e2e/renderer-parity-distribution.spec.ts'])
  await run(command.command, command.args)
  const candidateRoot = resolve(repositoryRoot, 'artifacts/renderer/parity-candidates')
  const files = screenshots.map((name) => {
    const path = join(candidateRoot, name)
    if (!existsSync(path)) throw new Error(`Bundled Chromium parity screenshot is missing: ${path}`)
    return { path: `artifacts/renderer/parity-candidates/${name}`, bytes: readFileSync(path).byteLength, sha256: hashFile(path) }
  })
  return { status: 'passed', browser: 'Playwright bundled Chromium', browserVersion, command: 'corepack pnpm exec playwright test e2e/renderer-parity-distribution.spec.ts', tests: 8, screenshots: files }
}

async function systemBrowserGate() {
  const port = 4183 + (process.pid % 10)
  const command = packageCommand(['run', 'test:system-browsers'])
  await run(command.command, command.args, { ...process.env, W_EDITOR_SYSTEM_BROWSER_PORT: String(port), W_EDITOR_SYSTEM_BROWSER_REPORT: systemReportPath })
  const report = JSON.parse(readFileSync(systemReportPath, 'utf8'))
  if (report.status !== 'passed' || !Array.isArray(report.results) || report.results.length !== 2 || report.results.some(({ status }) => status !== 'passed')) throw new Error(`System browser smoke did not pass: ${JSON.stringify(report)}`)
  return { status: 'passed', report: 'artifacts/release-governance/task-9-7-system-browser-smoke.json', results: report.results }
}

async function webView2Gate() {
  if (!existsSync(lifecycleEvidencePath)) throw new Error(`Current lifecycle evidence is missing: ${lifecycleEvidencePath}`)
  const lifecycle = JSON.parse(readFileSync(lifecycleEvidencePath, 'utf8'))
  const executable = join(lifecycle.lifecycleRoot, 'msi', 'install', 'w-editor-desktop.exe')
  if (!existsSync(executable)) throw new Error(`Current installed MSI executable is missing: ${executable}`)
  const command = packageCommand(['run', 'test:desktop-feature-matrix'])
  await run(command.command, command.args, {
    ...process.env,
    W_EDITOR_DESKTOP_EXE: executable,
    W_EDITOR_FEATURE_MATRIX_EVIDENCE_PATH: webViewEvidencePath,
    W_EDITOR_FEATURE_MATRIX_PORT: String(featureMatrixPort),
    W_EDITOR_FEATURE_MATRIX_NATIVE_PORT: String(featureMatrixNativePort),
  })
  const evidence = JSON.parse(readFileSync(webViewEvidencePath, 'utf8'))
  if (evidence.status !== 'passed' || evidence.browser !== 'Microsoft Edge WebView2' || evidence.browserVersion === undefined || evidence.featureManifest?.missingCommands?.length !== 0) throw new Error(`WebView2 smoke did not pass: ${JSON.stringify(evidence)}`)
  return { status: 'passed', report: 'artifacts/release-governance/task-9-7-webview2-feature-matrix.json', browser: evidence.browser, browserVersion: evidence.browserVersion, commandCount: evidence.featureManifest.runtimeCommandCount, missingCommands: evidence.featureManifest.missingCommands }
}

const checks = []
try {
  checks.push(await bundledChromiumGate())
  checks.push(await systemBrowserGate())
  checks.push(await webView2Gate())
  const system = checks[1]
  const result = {
    schemaVersion: 1,
    change: 'dual-target-release',
    task: '9.7',
    status: 'passed',
    checks,
    browserMatrix: {
      bundledChromium: { browserVersion: checks[0].browserVersion, role: 'strict behavior and controlled pixels' },
      chrome: system.results.find(({ name }) => name === 'chrome'),
      edge: system.results.find(({ name }) => name === 'edge'),
      webView2: { browserVersion: checks[2].browserVersion, role: 'installed Desktop behavior smoke' },
    },
    notExecuted: ['9.8-9.11'],
  }
  writeEvidence(result)
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  const result = {
    schemaVersion: 1,
    change: 'dual-target-release',
    task: '9.7',
    status: 'failed',
    checks,
    error: error instanceof Error ? error.message : String(error),
    notExecuted: ['remaining browser matrix targets', '9.8-9.11'],
  }
  writeEvidence(result)
  console.error(JSON.stringify(result, null, 2))
  process.exitCode = 1
}
