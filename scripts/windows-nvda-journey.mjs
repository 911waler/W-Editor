import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(import.meta.dirname, '..')
const lifecycleEvidencePath = resolve(repositoryRoot, 'artifacts/release-governance/task-9-5-current-installer-lifecycle-rerun-20260829.json')
const lifecycleEvidence = existsSync(lifecycleEvidencePath) ? JSON.parse(readFileSync(lifecycleEvidencePath, 'utf8')) : null
const executable = resolve(process.env.W_EDITOR_DESKTOP_EXE ?? lifecycleEvidence?.lifecycleRoot ?? join(resolve(import.meta.dirname, '..'), '.missing'), ...(process.env.W_EDITOR_DESKTOP_EXE === undefined && lifecycleEvidence?.lifecycleRoot !== undefined ? ['msi', 'install', 'w-editor-desktop.exe'] : []))
const nvdaExecutable = resolve(process.env.W_EDITOR_NVDA_PATH ?? 'C:/Program Files/NVDA/nvda.exe')
const outputPath = resolve(process.env.W_EDITOR_NVDA_JOURNEY_EVIDENCE_PATH ?? 'artifacts/release-governance/task-9-8-nvda-journey.json')
const configRoot = resolve(process.env.W_EDITOR_NVDA_CONFIG_PATH ?? join(repositoryRoot, '.tmp', `nvda-journey-config-${process.pid}`))
const profileRoot = resolve(process.env.W_EDITOR_NVDA_PROFILE_PATH ?? (lifecycleEvidence?.lifecycleRoot === undefined
  ? join(repositoryRoot, '.tmp', `nvda-journey-profile-${process.pid}`)
  : join(lifecycleEvidence.lifecycleRoot, 'msi', 'profile')))

function requireFile(path, label) {
  if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`)
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

async function powershell(script) {
  const utf8Command = `${String.raw`$OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8;`}
${script}`
  const result = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', utf8Command], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  })
  return result.stdout.trim()
}

async function powershellJson(script) {
  const output = await powershell(script)
  if (output.length === 0) throw new Error('PowerShell helper returned no JSON.')
  try {
    return JSON.parse(output)
  } catch (error) {
    throw new Error(`PowerShell helper returned invalid JSON: ${output}`, { cause: error })
  }
}

function inputHelperClass() {
  return String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WEditorNvdaJourneyInput {
  [StructLayout(LayoutKind.Explicit, Size = 40)] public struct INPUT { [FieldOffset(0)] public UInt32 type; [FieldOffset(8)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public UInt16 wVk; public UInt16 wScan; public UInt32 dwFlags; public UInt32 time; public IntPtr dwExtraInfo; }
  [DllImport("user32.dll", SetLastError = true)] public static extern UInt32 SendInput(UInt32 count, INPUT[] inputs, Int32 size);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern UInt32 GetWindowThreadProcessId(IntPtr hWnd, out UInt32 processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern Int32 GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, Int32 maxCount);
  static void Down(UInt16 key) { var input = new INPUT { type = 1, ki = new KEYBDINPUT { wVk = key } }; if (SendInput(1, new[] { input }, Marshal.SizeOf(typeof(INPUT))) != 1) throw new Exception("SendInput keyDown failed."); }
  static void Up(UInt16 key) { var input = new INPUT { type = 1, ki = new KEYBDINPUT { wVk = key, dwFlags = 2 } }; if (SendInput(1, new[] { input }, Marshal.SizeOf(typeof(INPUT))) != 1) throw new Exception("SendInput keyUp failed."); }
  public static void Key(UInt16 key) { Down(key); System.Threading.Thread.Sleep(120); Up(key); }
  public static void Chord(UInt16 modifier, UInt16 key) { Down(modifier); System.Threading.Thread.Sleep(120); Down(key); System.Threading.Thread.Sleep(120); Up(key); System.Threading.Thread.Sleep(120); Up(modifier); }
  public static string Foreground() { var hWnd = GetForegroundWindow(); UInt32 processId; GetWindowThreadProcessId(hWnd, out processId); var title = new System.Text.StringBuilder(512); GetWindowText(hWnd, title, title.Capacity); return String.Format("{0}|{1}", processId, title); }
}
'@
`
}

async function sendAppInput(input) {
  const targetPath = psQuote(executable)
  const script = [String.raw`
$ErrorActionPreference = 'Stop'
$env:LIB = ''
$targetPath = ${targetPath}
$targetProcesses = Get-CimInstance Win32_Process -Filter "Name='w-editor-desktop.exe'" | Where-Object { $_.ExecutablePath -ieq $targetPath } | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue } | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match 'W-Editor' } | Sort-Object StartTime -Descending
$targetProcess = $targetProcesses | Select-Object -First 1
if ($null -eq $targetProcess) { throw "Installed Desktop main window was not found: $targetPath" }
$shell = New-Object -ComObject WScript.Shell
if (-not $shell.AppActivate($targetProcess.MainWindowTitle)) { throw "Could not activate installed Desktop window '$($targetProcess.MainWindowTitle)'." }
Start-Sleep -Milliseconds 350
`, inputHelperClass(), String.raw`
$foreground = [WEditorNvdaJourneyInput]::Foreground()
$foregroundParts = $foreground -split '\|', 2
if ([int]$foregroundParts[0] -ne $targetProcess.Id) { throw "Installed Desktop did not become foreground: targetPid=$($targetProcess.Id), targetTitle=$($targetProcess.MainWindowTitle), foreground=$foreground" }
`, input.type === 'key'
    ? `[WEditorNvdaJourneyInput]::Key([UInt16]${input.key})`
    : `[WEditorNvdaJourneyInput]::Chord([UInt16]${input.modifier}, [UInt16]${input.key})`, String.raw`
[pscustomobject]@{ processId = $targetProcess.Id; foreground = $foreground; input = '${input.label}' } | ConvertTo-Json -Compress
`].join('\n')
  return powershellJson(script)
}

async function readSpeechViewer(nvdaProcessId) {
  const script = [String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'RICHEDIT50W')
$controls = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
$matches = @()
foreach ($element in $controls) {
  try {
    $current = $element.Current
    if ($current.ProcessId -eq ${nvdaProcessId}) { $matches += [pscustomobject]@{ text = $current.Name; className = $current.ClassName; automationId = $current.AutomationId } }
  } catch { }
}
if ($matches.Count -eq 0) { [pscustomobject]@{ status = 'missing'; processId = ${nvdaProcessId} } | ConvertTo-Json -Compress }
else { [pscustomobject]@{ status = 'available'; processId = ${nvdaProcessId}; className = $matches[0].className; automationId = $matches[0].automationId; text = $matches[0].text } | ConvertTo-Json -Compress }
`].join('\n')
  return powershellJson(script)
}

async function waitForSpeechViewer(nvdaProcessId) {
  const deadline = Date.now() + 20_000
  let last = null
  while (Date.now() < deadline) {
    last = await readSpeechViewer(nvdaProcessId)
    if (last.status === 'available') return last
    await sleep(250)
  }
  throw new Error(`NVDA Speech Viewer did not become readable: ${JSON.stringify(last)}`)
}

function speechLines(text) {
  return String(text ?? '').split(/\r?\n/u)
}

function speechDelta(before, after) {
  const previous = speechLines(before)
  const current = speechLines(after)
  let common = 0
  while (common < previous.length && common < current.length && previous[common] === current[common]) common += 1
  return current.slice(common).filter((line) => line.trim().length > 0)
}

async function waitForSpeechDelta(nvdaProcessId, beforeText, matcher, label) {
  const deadline = Date.now() + 10_000
  let last = await readSpeechViewer(nvdaProcessId)
  while (Date.now() < deadline) {
    if (last.status === 'available') {
      const newLines = speechDelta(beforeText, last.text)
      if (matcher(newLines.join('\n'))) return { snapshot: last, newLines }
    }
    await sleep(250)
    last = await readSpeechViewer(nvdaProcessId)
  }
  const newLines = last.status === 'available' ? speechDelta(beforeText, last.text) : []
  throw new Error(`NVDA did not announce ${label}: ${JSON.stringify({ status: last.status, newLines })}`)
}

function containsAny(text, values) {
  return values.some((value) => text.toLocaleLowerCase().includes(value.toLocaleLowerCase()))
}

function matchWindowTitle(text) {
  return containsAny(text, ['W-Editor', 'Product notes'])
}

function matchEditor(text) {
  return containsAny(text, ['可视化编辑器区域', 'visual editor']) && containsAny(text, ['编辑框', 'edit'])
}

function matchLanguageControl(text) {
  return containsAny(text, ['语言', 'language', 'язык'])
    && containsAny(text, ['菜单按钮', 'menu button', 'кнопка меню'])
}

async function runStep(nvdaProcessId, label, input, matcher) {
  const before = await readSpeechViewer(nvdaProcessId)
  if (before.status !== 'available') throw new Error(`Speech Viewer unavailable before ${label}.`)
  const inputResult = await sendAppInput(input)
  const observed = await waitForSpeechDelta(nvdaProcessId, before.text, matcher, label)
  return {
    label,
    status: 'passed',
    input: inputResult,
    speechViewer: { className: observed.snapshot.className, automationId: observed.snapshot.automationId, newLines: observed.newLines, textAfter: observed.snapshot.text },
  }
}

async function runRepeatedKeyStep(nvdaProcessId, label, input, matcher, maxAttempts) {
  let before = await readSpeechViewer(nvdaProcessId)
  if (before.status !== 'available') throw new Error(`Speech Viewer unavailable before ${label}.`)
  const attempts = []
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const inputResult = await sendAppInput(input)
    const deadline = Date.now() + 1_500
    let after = before
    let newLines = []
    while (Date.now() < deadline) {
      after = await readSpeechViewer(nvdaProcessId)
      if (after.status === 'available') {
        newLines = speechDelta(before.text, after.text)
        if (newLines.length > 0) break
      }
      await sleep(150)
    }
    attempts.push({ attempt, input: inputResult, newLines })
    if (matcher(newLines.join('\n'))) {
      return {
        label,
        status: 'passed',
        attemptCount: attempt,
        attempts,
        speechViewer: { className: after.className, automationId: after.automationId, newLines, textAfter: after.text },
      }
    }
    before = after
  }
  throw new Error(`NVDA did not announce ${label} after ${maxAttempts} keyboard steps: ${JSON.stringify(attempts)}`)
}

function writeResult(result) {
  mkdirSync(resolve(outputPath, '..'), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
}

async function startNvda() {
  const script = [String.raw`
$nvdaPath = ${psQuote(nvdaExecutable)}
$configPath = ${psQuote(configRoot)}
$started = Start-Process -FilePath $nvdaPath -ArgumentList @('-c', $configPath, '--disable-addons', '--no-sr-flag') -PassThru
[pscustomobject]@{ processId = $started.Id } | ConvertTo-Json -Compress
`].join('\n')
  const started = await powershellJson(script)
  return { pid: Number(started.processId), exitCode: null }
}

async function startDesktop() {
  const script = [String.raw`
$ErrorActionPreference = 'Stop'
$env:APPDATA = ${psQuote(profileRoot)}
$env:LOCALAPPDATA = ${psQuote(profileRoot)}
$desktopPath = ${psQuote(executable)}
$started = Start-Process -FilePath $desktopPath -PassThru
[pscustomobject]@{ processId = $started.Id } | ConvertTo-Json -Compress
`].join('\n')
  const started = await powershellJson(script)
  return { pid: Number(started.processId) }
}

async function waitForDesktop(desktopHandle) {
  const deadline = Date.now() + 30_000
  let last = null
  while (Date.now() < deadline) {
    const script = [String.raw`
$desktopPath = ${psQuote(executable)}
$candidate = Get-CimInstance Win32_Process -Filter "Name='w-editor-desktop.exe'" | Where-Object { $_.ExecutablePath -ieq $desktopPath -and $_.ProcessId -eq ${desktopHandle.pid} } | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue } | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match 'W-Editor' } | Select-Object -First 1
if ($null -eq $candidate) { [pscustomobject]@{ status = 'waiting'; processId = ${desktopHandle.pid} } | ConvertTo-Json -Compress }
else { [pscustomobject]@{ status = 'available'; processId = $candidate.Id; handle = $candidate.MainWindowHandle.ToInt64(); title = $candidate.MainWindowTitle } | ConvertTo-Json -Compress }
`].join('\n')
    last = await powershellJson(script)
    if (last.status === 'available') return last
    await sleep(250)
  }
  throw new Error(`Installed Desktop did not expose a visible main window: ${JSON.stringify(last)}`)
}

async function quitNvda(nvdaHandle) {
  if (nvdaHandle === null) return
  await powershell([String.raw`
& ${psQuote(nvdaExecutable)} --quit
`].join('\n')).catch(() => {})
  await sleep(2_000)
  await powershell([String.raw`
if (Get-Process -Id ${nvdaHandle.pid} -ErrorAction SilentlyContinue) { Stop-Process -Id ${nvdaHandle.pid} -Force -ErrorAction SilentlyContinue }
`].join('\n')).catch(() => {})
}

async function stopDesktop(desktopHandle) {
  if (desktopHandle === null) return
  await powershell([String.raw`
$desktopPath = ${psQuote(executable)}
$process = Get-CimInstance Win32_Process -Filter "Name='w-editor-desktop.exe'" | Where-Object { $_.ExecutablePath -ieq $desktopPath -and $_.ProcessId -eq ${desktopHandle.pid} }
if ($null -ne $process) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }
`].join('\n')).catch(() => {})
}

requireFile(executable, 'Installed Desktop executable')
requireFile(nvdaExecutable, 'NVDA executable')
if (lifecycleEvidence?.status !== 'passed') throw new Error('Current installer lifecycle evidence is not passed.')
if (lifecycleEvidence.lifecycleRoot !== undefined && !executable.toLocaleLowerCase().startsWith(resolve(lifecycleEvidence.lifecycleRoot).toLocaleLowerCase())) throw new Error('NVDA journey executable is not inside the current installer lifecycle root.')

mkdirSync(configRoot, { recursive: true })
mkdirSync(profileRoot, { recursive: true })
writeFileSync(join(configRoot, 'nvda.ini'), [
  'schemaVersion = 22',
  '',
  '[general]',
  '\tshowWelcomeDialogAtStartup = False',
  '',
  '[speechViewer]',
  '\tshowSpeechViewerAtStartup = True',
  '',
  '[update]',
  '\tallowUsageStats = False',
  '\taskedAllowUsageStats = True',
].join('\n'), 'utf8')

let nvdaProcess = null
let desktopProcess = null
const steps = []
try {
  nvdaProcess = await startNvda()
  const speechViewer = await waitForSpeechViewer(nvdaProcess.pid)
  desktopProcess = await startDesktop()
  const readiness = await waitForDesktop(desktopProcess)
  steps.push(await runStep(nvdaProcess.pid, 'NVDA reports the installed Desktop window', { type: 'chord', modifier: 0x2D, key: 0x54, label: 'Insert+T' }, matchWindowTitle))
  steps.push(await runStep(nvdaProcess.pid, 'NVDA reports the focused visual editor', { type: 'chord', modifier: 0x2D, key: 0x09, label: 'Insert+Tab' }, matchEditor))
  const languageStep = await runRepeatedKeyStep(nvdaProcess.pid, 'Physical Tab reaches the named language control', { type: 'key', key: 0x09, label: 'Tab' }, matchLanguageControl, 96)
  steps.push(languageStep)
  steps.push(await runRepeatedKeyStep(nvdaProcess.pid, 'Physical Shift+Tab returns to the editor', { type: 'chord', modifier: 0x10, key: 0x09, label: 'Shift+Tab' }, matchEditor, languageStep.attemptCount + 2))
  const result = {
    schemaVersion: 1,
    change: 'dual-target-release',
    task: '9.8',
    status: 'passed',
    method: 'real NVDA Speech Viewer output collected through Windows UI Automation while Win32 SendInput drove the installed Desktop window',
    nvda: { executable: nvdaExecutable, processId: nvdaProcess.pid },
    desktop: { executable, browser: 'Microsoft Edge WebView2', readiness },
    speechViewer: { processId: speechViewer.processId, className: speechViewer.className, automationId: speechViewer.automationId },
    steps,
    notExecuted: [],
  }
  writeResult(result)
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  const result = {
    schemaVersion: 1,
    change: 'dual-target-release',
    task: '9.8',
    status: 'failed',
    method: 'real NVDA Speech Viewer output collected through Windows UI Automation while Win32 SendInput drove the installed Desktop window',
    nvda: { executable: nvdaExecutable, processId: nvdaProcess?.pid ?? null },
    desktop: { executable },
    steps,
    error: error instanceof Error ? error.message : String(error),
    notExecuted: ['remaining NVDA journey steps'],
  }
  writeResult(result)
  console.error(JSON.stringify(result, null, 2))
  process.exitCode = 1
} finally {
  await stopDesktop(desktopProcess)
  await quitNvda(nvdaProcess)
}
