import { existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(import.meta.dirname, '..')
const executable = resolve(process.env.W_EDITOR_DESKTOP_EXE ?? 'apps/desktop/src-tauri/target/debug/w-editor-desktop.exe')
const nativeDriver = resolve(process.env.W_EDITOR_EDGE_DRIVER ?? '.tmp/tauri-webdriver/msedgedriver.exe')
const tauriDriver = resolve(process.env.W_EDITOR_TAURI_DRIVER ?? '.tmp/tauri-driver.exe')
const portSeed = Number(process.env.W_EDITOR_FEATURE_MATRIX_PORT_SEED ?? process.pid % 500)
const port = Number(process.env.W_EDITOR_FEATURE_MATRIX_PORT ?? 4800 + portSeed * 10)
const nativePort = Number(process.env.W_EDITOR_FEATURE_MATRIX_NATIVE_PORT ?? 30_000 + portSeed * 10)
const base = `http://127.0.0.1:${port}`
const testParent = mkdtempSync(resolve(repositoryRoot, '.tmp', 'desktop-feature-matrix-'))
const parityFixture = resolve(repositoryRoot, 'tests/fixtures/parity/w-editor-parity.md')
const longDocumentPath = join(testParent, 'long-1mb.md')
const locatorPath = join(process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming'), 'com.weditor.desktop.spike', 'data-root.json')
const previousLocator = existsSync(locatorPath) ? readFileSync(locatorPath) : null
const featureManifest = JSON.parse(readFileSync(resolve(repositoryRoot, 'tests/fixtures/manifests/feature-manifest.json'), 'utf8'))
const expectedCommands = new Set(featureManifest.commands.ids)
const elementKey = 'element-6066-11e4-a52e-4f735466cecf'

function requireFile(path, label) {
  if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`)
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

async function request(path, method = 'GET', body, timeoutMs = 30_000) {
  const response = await fetch(`${base}${path}`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { 'content-type': 'application/json' },
    method,
    signal: AbortSignal.timeout(timeoutMs),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`WebDriver ${method} ${path} failed: ${payload?.value?.message ?? response.status}`)
  return payload?.value
}

async function execute(sessionId, script, args = []) {
  return request(`/session/${sessionId}/execute/sync`, 'POST', { args, script })
}

async function invoke(sessionId, command, payload = {}) {
  return request(`/session/${sessionId}/execute/async`, 'POST', {
    args: [payload],
    script: `const done = arguments[arguments.length - 1]; const bridge = globalThis.__TAURI_INTERNALS__; if (bridge === undefined || typeof bridge.invoke !== 'function') { done({ status: 'unavailable' }); } else { bridge.invoke(${JSON.stringify(command)}, arguments[0]).then((value) => done({ status: 'fulfilled', value })).catch((error) => done({ status: 'rejected', error: String(error) })); }`,
  })
}

async function waitForDriver() {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      await request('/status')
      return
    } catch {
      await sleep(100)
    }
  }
  throw new Error('tauri-driver did not become ready.')
}

async function waitFor(sessionId, script, predicate, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  let lastValue = null
  while (Date.now() < deadline) {
    lastValue = await execute(sessionId, script)
    if (predicate(lastValue)) return lastValue
    await sleep(150)
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(lastValue)}`)
}

async function find(sessionId, selector) {
  const result = await request(`/session/${sessionId}/element`, 'POST', { using: 'css selector', value: selector })
  const id = result?.[elementKey]
  if (typeof id !== 'string') throw new Error(`No WebDriver element was found for ${selector}.`)
  return id
}

async function click(sessionId, selector) {
  const id = await find(sessionId, selector)
  await request(`/session/${sessionId}/element/${id}/click`, 'POST', {})
}

async function setFile(sessionId, selector, path) {
  const id = await find(sessionId, selector)
  await request(`/session/${sessionId}/element/${id}/value`, 'POST', { text: path, value: [...path] })
}

async function pointerClick(sessionId, x, y) {
  await request(`/session/${sessionId}/actions`, 'POST', {
    actions: [{
      type: 'pointer',
      id: 'mouse',
      parameters: { pointerType: 'mouse' },
      actions: [
        { type: 'pointerMove', x: Math.round(x), y: Math.round(y), duration: 0 },
        { type: 'pointerDown', button: 0 },
        { type: 'pointerUp', button: 0 },
      ],
    }],
  })
}

function shortcutActions(key, shift = false) {
  const control = '\uE009'
  const modifiers = shift ? [control, '\uE008'] : [control]
  return [
    ...modifiers.map((value) => ({ type: 'keyDown', value })),
    { type: 'keyDown', value: key },
    { type: 'keyUp', value: key },
    ...[...modifiers].reverse().map((value) => ({ type: 'keyUp', value })),
  ]
}

function fulfilled(result, label) {
  if (result?.status !== 'fulfilled') throw new Error(`${label} failed: ${JSON.stringify(result)}`)
  return result.value
}

async function readClipboard() {
  const result = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-Clipboard -Raw'], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 })
  return result.stdout.trimEnd()
}

function psLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

async function activateDesktopWindow(executablePath) {
  const command = `
$targetPath = ${psLiteral(resolve(executablePath))}
$process = Get-CimInstance Win32_Process -Filter "Name='w-editor-desktop.exe'" |
  Where-Object { $_.ExecutablePath -and $_.ExecutablePath -ieq $targetPath } |
  ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue } |
  Where-Object { $_.MainWindowHandle -ne 0 } |
  Select-Object -First 1
if ($null -eq $process) { throw 'The installed Desktop foreground window was not found.' }
$shell = New-Object -ComObject WScript.Shell
if (-not $shell.AppActivate($process.Id)) { throw "Could not activate installed Desktop PID $($process.Id)." }
Write-Output "desktop-window-activated:$($process.Id)"
`
  const result = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 })
  if (!result.stdout.includes('desktop-window-activated:')) throw new Error(`Desktop activation produced no completion marker: ${result.stdout}`)
  await sleep(250)
}

async function completeNativeSaveDialog(executablePath, destinationPath) {
  const command = `
$ErrorActionPreference = 'Stop'
$env:LIB = ''
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$unusedNativeDialogSource = @'
using System;
using System.Runtime.InteropServices;

public static class WEditorNativeDialogAutomation {
  private delegate bool EnumWindowsProc(IntPtr handle, IntPtr parameter);

  [DllImport("user32.dll")]
  private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

  [DllImport("user32.dll")]
  private static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc callback, IntPtr parameter);

  [DllImport("user32.dll")]
  private static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);

  [DllImport("user32.dll")]
  private static extern int GetDlgCtrlID(IntPtr handle);

  [DllImport("user32.dll")]
  private static extern IntPtr GetParent(IntPtr handle);

  [DllImport("user32.dll")]
  private static extern IntPtr GetAncestor(IntPtr handle, uint flags);

  [DllImport("user32.dll")]
  private static extern bool SetForegroundWindow(IntPtr handle);

  [DllImport("user32.dll")]
  private static extern IntPtr SetFocus(IntPtr handle);

  [DllImport("user32.dll")]
  private static extern IntPtr GetForegroundWindow();

  [DllImport("kernel32.dll")]
  private static extern uint GetCurrentThreadId();

  [DllImport("user32.dll")]
  private static extern bool AttachThreadInput(uint sourceThread, uint targetThread, bool attach);

  [DllImport("user32.dll")]
  private static extern bool ShowWindow(IntPtr handle, int command);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern int GetClassNameW(IntPtr handle, System.Text.StringBuilder className, int maximumCount);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern int GetWindowTextW(IntPtr handle, System.Text.StringBuilder value, int maximumCount);

  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "SendMessageW")]
  private static extern IntPtr SendText(IntPtr handle, uint message, IntPtr wParam, string lParam);

  [DllImport("user32.dll", EntryPoint = "SendMessageW")]
  private static extern IntPtr SendCommand(IntPtr handle, uint message, IntPtr wParam, IntPtr lParam);

  public static IntPtr FindControl(uint processId, int controlId) {
    IntPtr match = IntPtr.Zero;
    EnumWindows((root, _) => {
      GetWindowThreadProcessId(root, out uint candidateProcessId);
      if (candidateProcessId != processId) return true;
      EnumChildWindows(root, (child, __) => {
        if (GetDlgCtrlID(child) != controlId) return true;
        match = child;
        return false;
      }, IntPtr.Zero);
      return match == IntPtr.Zero;
    }, IntPtr.Zero);
    return match;
  }

  public static void SetText(IntPtr handle, string value) {
    SendText(handle, 0x000C, IntPtr.Zero, value);
    EnumChildWindows(handle, (child, _) => {
      var className = new System.Text.StringBuilder(256);
      GetClassNameW(child, className, className.Capacity);
      if (className.ToString().IndexOf("Edit", StringComparison.OrdinalIgnoreCase) >= 0) {
        SendText(child, 0x000C, IntPtr.Zero, value);
      }
      return true;
    }, IntPtr.Zero);
  }

  public static void Click(IntPtr handle) {
    SendCommand(handle, 0x00F5, IntPtr.Zero, IntPtr.Zero);
    IntPtr parent = GetParent(handle);
    if (parent != IntPtr.Zero) SendCommand(parent, 0x0111, new IntPtr(1), handle);
  }

  public static void Focus(IntPtr handle) {
    IntPtr root = GetAncestor(handle, 2);
    if (root != IntPtr.Zero) SetForegroundWindow(root);
    SetFocus(handle);
  }

  public static void ForceForeground(IntPtr handle) {
    IntPtr foreground = GetForegroundWindow();
    GetWindowThreadProcessId(foreground, out uint foregroundProcessId);
    uint foregroundThread = GetWindowThreadProcessId(foreground, out foregroundProcessId);
    uint currentThread = GetCurrentThreadId();
    bool attached = foregroundThread != 0 && foregroundThread != currentThread && AttachThreadInput(currentThread, foregroundThread, true);
    ShowWindow(handle, 9);
    SetForegroundWindow(handle);
    if (attached) AttachThreadInput(currentThread, foregroundThread, false);
  }

  public static string Describe(IntPtr handle) {
    var className = new System.Text.StringBuilder(256);
    var value = new System.Text.StringBuilder(512);
    GetClassNameW(handle, className, className.Capacity);
    GetWindowTextW(handle, value, value.Capacity);
    return String.Format("handle={0};id={1};class={2};text={3};parent={4}", handle, GetDlgCtrlID(handle), className, value, GetParent(handle));
  }
}
'@
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class WEditorNativeControlAutomation {
  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "SendMessageW")]
  private static extern IntPtr SendText(IntPtr handle, uint message, IntPtr wParam, string lParam);

  [DllImport("user32.dll", EntryPoint = "SendMessageW")]
  private static extern IntPtr SendCommand(IntPtr handle, uint message, IntPtr wParam, IntPtr lParam);

  public static void SetText(IntPtr handle, string value) {
    SendText(handle, 0x000C, IntPtr.Zero, value);
  }

  public static void Click(IntPtr handle) {
    SendCommand(handle, 0x00F5, IntPtr.Zero, IntPtr.Zero);
  }
}
'@
$targetPath = ${psLiteral(resolve(executablePath))}
$destinationPath = ${psLiteral(resolve(destinationPath))}
$deadline = [DateTime]::UtcNow.AddSeconds(20)
$dialog = $null
$fileNameEdit = $null
while ([DateTime]::UtcNow -lt $deadline -and $null -eq $fileNameEdit) {
  $processIds = @(Get-CimInstance Win32_Process -Filter "Name='w-editor-desktop.exe'" |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath -ieq $targetPath } |
    Select-Object -ExpandProperty ProcessId)
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $windowCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Window
  )
  $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $windowCondition)
  $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
  if ($null -ne $focused -and $processIds -contains $focused.Current.ProcessId) {
    $focusedValuePattern = $null
    if ($focused.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$focusedValuePattern)) {
      $fileNameEdit = $focused
      $dialog = $windows | Where-Object { $_.Current.ProcessId -eq $focused.Current.ProcessId } | Select-Object -First 1
    }
  }
  foreach ($candidate in $windows) {
      if ($null -ne $fileNameEdit) { break }
      $belongsToTarget = $processIds -contains $candidate.Current.ProcessId
      $hasSaveTitle = $candidate.Current.Name -match 'Save exported file|保存导出文件|Сохранить экспортированный файл'
      if (-not $hasSaveTitle -and -not $belongsToTarget) { continue }
      $dialogControls = @($candidate.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition))
      $hasSearchBox = $dialogControls | Where-Object { $_.Current.AutomationId -eq 'SearchEditBox' } | Select-Object -First 1
      $hasNameColumn = $dialogControls | Where-Object { $_.Current.AutomationId -eq 'System.ItemNameDisplay' } | Select-Object -First 1
      if ($null -ne $hasSearchBox -and $null -ne $hasNameColumn) {
        $nativeFileName = $dialogControls | Where-Object {
          $_.Current.AutomationId -eq '1001' -and $_.Current.ClassName -eq 'Edit'
        } | Select-Object -First 1
        $nativeSave = $dialogControls | Where-Object {
          $_.Current.AutomationId -eq '1' -and $_.Current.ClassName -eq 'Button' -and $_.Current.Name -match 'Save|保存|Сохранить'
        } | Select-Object -First 1
        if ($null -eq $nativeFileName -or $null -eq $nativeSave) { throw 'The native save dialog did not expose its file-name and save controls.' }
        $nativeValuePattern = $null
        if ($nativeFileName.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$nativeValuePattern)) {
          ([System.Windows.Automation.ValuePattern]$nativeValuePattern).SetValue($destinationPath)
          Write-Output 'native-file-pattern:value'
        } elseif ($nativeFileName.Current.NativeWindowHandle -ne 0) {
          [WEditorNativeControlAutomation]::SetText([IntPtr]$nativeFileName.Current.NativeWindowHandle, $destinationPath)
          Write-Output 'native-file-pattern:win32'
        } else { throw 'The native file-name control exposes neither ValuePattern nor a native HWND.' }
        Start-Sleep -Milliseconds 100
        $nativeInvokePattern = $null
        if ($nativeSave.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$nativeInvokePattern)) {
          ([System.Windows.Automation.InvokePattern]$nativeInvokePattern).Invoke()
          Write-Output 'native-save-pattern:invoke'
        } elseif ($nativeSave.Current.NativeWindowHandle -ne 0) {
          [WEditorNativeControlAutomation]::Click([IntPtr]$nativeSave.Current.NativeWindowHandle)
          Write-Output 'native-save-pattern:win32'
        } else { throw 'The native save control exposes neither InvokePattern nor a native HWND.' }
        Start-Sleep -Milliseconds 200
        $saveDialogLabelCondition = New-Object System.Windows.Automation.PropertyCondition(
          [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
          'SaveDialogLabel'
        )
        $stillOpen = $candidate.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $saveDialogLabelCondition)
        if ($null -ne $stillOpen) { throw 'The native save dialog remained open after its default action.' }
        Write-Output 'native-save-dialog-completed'
        exit 0
      }
      $edits = @($candidate.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | Where-Object {
        $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -or
          $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::ComboBox
      })
      $preferred = @($edits | Where-Object {
        $_.Current.AutomationId -in @('1001', '1148', 'FileNameControlHost') -or $_.Current.Name -match 'File name|文件名|Имя файла'
      } | Select-Object -First 1)
      if ($preferred.Count -gt 0) {
        $fileNameEdit = $preferred[0]
      } elseif ($hasSaveTitle -and $edits.Count -gt 0) {
        $fileNameEdit = $edits | Sort-Object { $_.Current.BoundingRectangle.Top } -Descending | Select-Object -First 1
      }
      if ($null -ne $fileNameEdit) {
        $dialog = $candidate
        break
      }
  }
  if ($null -eq $fileNameEdit) { Start-Sleep -Milliseconds 100 }
}
if ($null -eq $dialog -or $null -eq $fileNameEdit) {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $windowCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Window
  )
  $diagnostics = @($root.FindAll([System.Windows.Automation.TreeScope]::Children, $windowCondition) | ForEach-Object {
    $window = $_
    $edits = if ($processIds -contains $window.Current.ProcessId) {
      @($window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | Where-Object {
        $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -or
          $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::ComboBox
      } | ForEach-Object {
        [pscustomobject]@{ name = $_.Current.Name; automationId = $_.Current.AutomationId; className = $_.Current.ClassName }
      })
    } else { @() }
    [pscustomobject]@{ name = $window.Current.Name; className = $window.Current.ClassName; processId = $window.Current.ProcessId; edits = $edits }
  }) | ConvertTo-Json -Compress
  $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
  $focusedDiagnostic = if ($null -eq $focused) { 'null' } else {
    [pscustomobject]@{ name = $focused.Current.Name; automationId = $focused.Current.AutomationId; className = $focused.Current.ClassName; processId = $focused.Current.ProcessId; controlType = $focused.Current.ControlType.ProgrammaticName } | ConvertTo-Json -Compress
  }
  throw "The installed Desktop native save dialog was not found. Focused element: $focusedDiagnostic. Top-level windows: $diagnostics"
}
$valuePatternObject = $null
if (-not $fileNameEdit.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePatternObject)) {
  $editCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Edit
  )
  $nestedEdit = $fileNameEdit.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
  if ($null -eq $nestedEdit -or -not $nestedEdit.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePatternObject)) {
    throw 'The installed Desktop native file-name control does not expose ValuePattern.'
  }
}
$valuePattern = [System.Windows.Automation.ValuePattern]$valuePatternObject
$valuePattern.SetValue($destinationPath)
$buttonCondition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Button
)
$buttons = @($dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition))
$saveButton = $buttons | Where-Object {
  $_.Current.AutomationId -eq '1' -or $_.Current.Name -match '^(Save|保存|Сохранить)'
} | Select-Object -First 1
if ($null -eq $saveButton) { throw 'The installed Desktop native save button was not found.' }
$invokePattern = [System.Windows.Automation.InvokePattern]$saveButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
$invokePattern.Invoke()
Write-Output 'native-save-dialog-completed'
`
  const result = await execFileAsync('powershell.exe', ['-NoProfile', '-STA', '-Command', command], {
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  })
  console.log(result.stdout.trim())
  if (!result.stdout.includes('native-save-dialog-completed')) throw new Error(`Native save dialog automation produced no completion marker: ${result.stdout}`)
}

function semanticScript(selector) {
  return `const root = document.querySelector(${JSON.stringify(selector)}); if (!(root instanceof HTMLElement)) return null; const clone = root.cloneNode(true); clone.querySelectorAll('style, script, [data-semantic-edit], [data-raw-edit], .visual-code-block__language, .table-node-view__handle, .table-node-view__menu, .table-cell-selection-overlay').forEach((node) => node.remove()); const normalize = (value) => value.replace(/\\s+/gu, ' ').trim(); return { text: normalize(clone.textContent ?? ''), headings: [...clone.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((node) => node.tagName + ':' + normalize(node.textContent ?? '')), code: [...clone.querySelectorAll('pre > code')].map((node) => node.textContent ?? ''), tables: clone.querySelectorAll('table').length, svg: clone.querySelectorAll('svg').length, images: clone.querySelectorAll('img').length, links: [...clone.querySelectorAll('a')].map((node) => normalize(node.textContent ?? '')) }`
}

async function waitForDownloadedFile(filename, roots, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const root of roots) {
      const path = join(root, filename)
      if (existsSync(path)) return path
    }
    await sleep(200)
  }
  return null
}

async function runChild(script, env) {
  const result = await execFileAsync(process.execPath, [resolve(repositoryRoot, 'scripts', script)], {
    cwd: repositoryRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 12 * 1024 * 1024,
  })
  const jsonStart = result.stdout.lastIndexOf('{\n  "status": "passed"')
  return jsonStart >= 0 ? JSON.parse(result.stdout.slice(jsonStart)) : { status: 'passed', outputTail: result.stdout.slice(-2000) }
}

requireFile(executable, 'Desktop executable')
requireFile(nativeDriver, 'Edge WebDriver')
requireFile(tauriDriver, 'tauri-driver')
requireFile(parityFixture, 'Reader/Final parity fixture')

const driverProcess = spawn(tauriDriver, [
  '--port', String(port),
  '--native-port', String(nativePort),
  '--native-driver', nativeDriver,
], { stdio: 'ignore', windowsHide: true })
let sessionId = null
let childDriversClosed = false

async function closeMainSession() {
  if (sessionId !== null) {
    await request(`/session/${sessionId}`, 'DELETE').catch(() => {})
    sessionId = null
  }
  if (!childDriversClosed) {
    driverProcess.kill()
    childDriversClosed = true
    await sleep(350)
  }
}

try {
  await waitForDriver()
  const session = await request('/session', 'POST', {
    capabilities: {
      alwaysMatch: {
        browserName: 'webview2',
        'tauri:options': { application: executable, webviewOptions: {} },
      },
    },
  })
  sessionId = session?.sessionId ?? null
  if (sessionId === null) throw new Error('WebDriver did not return a session id.')
  await request(`/session/${sessionId}/timeouts`, 'POST', { script: 20_000 })
  await waitFor(sessionId, 'return typeof globalThis.__TAURI_INTERNALS__?.invoke === "function"', (value) => value === true, 'Tauri invoke bridge')
  const selected = fulfilled(await invoke(sessionId, 'select_data_root', { parentPath: testParent }), 'Data Root selection')
  if (selected.state !== 'ready') throw new Error(`Data Root is not ready: ${JSON.stringify(selected)}`)
  const identity = await waitFor(sessionId,
    `return { ready: document.documentElement.dataset.desktopReady === 'true', mode: document.querySelector('[data-testid="editor-surface"]')?.dataset.mode ?? '', commands: [...new Set([...document.querySelectorAll('[data-command-id]')].map((node) => node.getAttribute('data-command-id')).filter(Boolean))], clipboard: typeof navigator.clipboard?.writeText === 'function', fullscreen: typeof document.querySelector('.workspace-shell')?.requestFullscreen === 'function', export: Boolean(document.querySelector('[data-command-id="export.markdown"]')), readerEntry: Boolean(document.querySelector('[data-testid="desktop-reader-entry"]')) }`,
    (value) => value?.ready === true && value.mode === 'visual',
    'the real Desktop WebView2 workspace',
  )
  const missingCommands = [...expectedCommands].filter((commandId) => !identity.commands.includes(commandId))
  if (missingCommands.length > 0) throw new Error(`Shared feature manifest commands are missing at runtime: ${missingCommands.join(', ')}`)

  await setFile(sessionId, '[data-testid="import-markdown-input"]', parityFixture)
  await waitFor(sessionId, 'return document.querySelector("[data-testid=\\"import-markdown-input\\"]")?.files?.length ?? 0', (value) => value === 1, 'parity fixture file selection')
  await execute(sessionId, 'document.querySelector("[data-testid=\\"import-markdown-input\\"]")?.dispatchEvent(new Event("change", { bubbles: true })); return true')
  const imported = await waitFor(sessionId,
    `return { title: document.querySelector('.workspace-controls__meta span')?.textContent ?? '', documentId: document.querySelector('.workspace-shell')?.getAttribute('data-document-id') ?? '', errors: [...document.querySelectorAll('.workspace-error')].map((node) => node.textContent?.trim() ?? '').filter(Boolean) }`,
    (value) => value?.title === 'w-editor-parity' && value.documentId.length > 0 && value.errors.length === 0,
    'the parity fixture import',
    30_000,
  )

  await click(sessionId, '[data-command-id="mode.preview"]')
  const finalReady = await waitFor(sessionId,
    `return { mode: document.querySelector('[data-testid="editor-surface"]')?.dataset.mode ?? '', content: Boolean(document.querySelector('[data-mode="preview"] .preview-rendered-content.ProseMirror[data-presentation-engine="tiptap"]')) }`,
    (value) => value?.mode === 'preview' && value.content === true,
    'Final Preview for parity',
    30_000,
  )
  await sleep(1_000)
  const finalSemantic = await execute(sessionId, semanticScript('[data-mode="preview"] .preview-rendered-content.ProseMirror'))
  await click(sessionId, '[data-testid="desktop-reader-entry"]')
  const readerReady = await waitFor(sessionId,
    `return { panel: Boolean(document.querySelector('[data-testid="desktop-reader-parity"]')), profile: document.querySelector('[data-testid="desktop-reader-parity"] [data-renderer-profile]')?.getAttribute('data-renderer-profile') ?? '', content: Boolean(document.querySelector('[data-testid="desktop-reader-parity"] [data-presentation-engine="tiptap"] .ProseMirror[data-renderer-profile="reader"]')), editControls: document.querySelectorAll('[data-testid="desktop-reader-parity"] [data-semantic-edit], [data-testid="desktop-reader-parity"] [data-raw-edit]').length }`,
    (value) => value?.panel === true && value.profile === 'reader' && value.content === true,
    'the actual Reader profile surface',
    30_000,
  )
  const readerSemantic = await execute(sessionId, semanticScript('[data-testid="desktop-reader-parity"] [data-presentation-engine="tiptap"] .ProseMirror'))
  if (JSON.stringify(readerSemantic) !== JSON.stringify(finalSemantic)) throw new Error(`Reader/Final semantic parity failed: ${JSON.stringify({ final: finalSemantic, reader: readerSemantic })}`)
  if (readerReady.editControls !== 0) throw new Error('Reader profile exposed an author code-edit control.')
  await click(sessionId, '[data-testid="desktop-reader-preview-close"]')

  await click(sessionId, '[data-command-id="mode.visual"]')
  await waitFor(sessionId, 'return document.querySelector("[data-testid=\\"editor-surface\\"]")?.dataset.mode ?? ""', (value) => value === 'visual', 'Visual shortcut surface')
  await execute(sessionId, `window.__W_EDITOR_SHORTCUT_TRACE__ = []; window.addEventListener('keydown', (event) => window.__W_EDITOR_SHORTCUT_TRACE__.push({ key: event.key, code: event.code, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, target: event.target instanceof Element ? event.target.className : '' }), true); return true`)
  const selectedParagraph = await execute(sessionId, `const node = [...document.querySelectorAll('.ProseMirror p')].find((candidate) => (candidate.textContent ?? '').includes('Paragraph with')); if (!(node instanceof HTMLElement)) throw new Error('Parity paragraph is unavailable.'); const range = document.createRange(); range.selectNodeContents(node); const selection = getSelection(); if (selection === null) throw new Error('Selection is unavailable.'); selection.removeAllRanges(); selection.addRange(range); document.querySelector('.ProseMirror')?.focus(); return node.textContent ?? ''`)
  await request(`/session/${sessionId}/actions`, 'POST', { actions: [{ type: 'key', id: 'keyboard', actions: shortcutActions('1') }] })
  const headingShortcut = await waitFor(sessionId, `return { matched: [...document.querySelectorAll('.ProseMirror h1')].some((node) => (node.textContent ?? '').includes('Paragraph with')), selection: (() => { const value = getSelection(); return value === null ? null : { anchor: value.anchorNode?.textContent ?? '', focus: value.focusNode?.textContent ?? '', collapsed: value.isCollapsed }; })(), active: document.activeElement instanceof Element ? document.activeElement.className : '', trace: window.__W_EDITOR_SHORTCUT_TRACE__ ?? [] }`, (value) => value?.matched === true, 'Ctrl+1 heading shortcut')
  await request(`/session/${sessionId}/actions`, 'POST', { actions: [{ type: 'key', id: 'keyboard', actions: shortcutActions('1') }] })
  const paragraphShortcut = await waitFor(sessionId, `return { matched: [...document.querySelectorAll('.ProseMirror p')].some((node) => (node.textContent ?? '').includes('Paragraph with')), trace: window.__W_EDITOR_SHORTCUT_TRACE__ ?? [] }`, (value) => value?.matched === true, 'reversible Ctrl+1 shortcut')
  await request(`/session/${sessionId}/actions`, 'POST', { actions: [{ type: 'key', id: 'keyboard', actions: shortcutActions('s') }] })
  const shortcutSaved = await waitFor(sessionId, `return { dirty: document.querySelector('.workspace-shell')?.getAttribute('data-dirty') ?? '', title: document.title }`, (value) => value?.dirty === 'false' && !value.title.startsWith('* '), 'Ctrl+S manual save')

  await click(sessionId, '[data-command-id="mode.preview"]')
  await waitFor(sessionId, 'return document.querySelector("[data-testid=\\"editor-surface\\"]")?.dataset.mode ?? ""', (value) => value === 'preview', 'Final Preview clipboard surface')
  const copyControl = await find(sessionId, '[data-mode="preview"] [data-w-editor-action="copy-code"]')
  await request(`/session/${sessionId}/element/${copyControl}/click`, 'POST', {})
  await sleep(250)
  const clipboard = await readClipboard()
  if (!clipboard.includes('deterministic parity fixture')) throw new Error(`OS clipboard did not contain the copied code block: ${JSON.stringify(clipboard.slice(0, 160))}`)

  await click(sessionId, '[data-command-id="application.fullscreen"]')
  const fullscreenEntered = await waitFor(sessionId, 'return document.fullscreenElement === document.querySelector(".workspace-shell")', (value) => value === true, 'fullscreen entry', 15_000)
  await click(sessionId, '[data-command-id="application.fullscreen"]')
  const fullscreenExited = await waitFor(sessionId, 'return document.fullscreenElement === null', (value) => value === true, 'fullscreen exit', 15_000)

  const articleId = imported.documentId
  const articleList = fulfilled(await invoke(sessionId, 'library_list_articles'), 'parity article listing')
  const currentArticle = articleList.find((article) => article.documentId === articleId)
  if (currentArticle === undefined) throw new Error(`Imported parity article disappeared: ${articleId}`)
  const exportedFilename = `${articleId}.md`
  const exportedPath = join(testParent, exportedFilename)
  if (existsSync(exportedPath)) throw new Error(`Refusing to overwrite an existing test export: ${exportedPath}`)
  await activateDesktopWindow(executable)
  await click(sessionId, '[data-toolbar-menu="export"] .toolbar-menu__trigger')
  await waitFor(sessionId, 'const panel = document.querySelector("[data-toolbar-menu=\\"export\\"] .toolbar-menu__panel"); if (!(panel instanceof HTMLElement)) return false; const style = getComputedStyle(panel); const rect = panel.getBoundingClientRect(); return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0', (value) => value === true, 'visible export menu')
  await click(sessionId, '[data-toolbar-menu="export"] .toolbar-menu__panel [data-command-id="export.markdown"]')
  await completeNativeSaveDialog(executable, exportedPath)
  const savedPath = await waitForDownloadedFile(exportedFilename, [testParent])
  if (savedPath === null) throw new Error(`Native Markdown export did not create ${exportedPath}`)
  const exportedMarkdown = readFileSync(savedPath, 'utf8')
  if (exportedMarkdown !== currentArticle.markdown) throw new Error('Native Markdown export differs from Library authority.')

  const longMarkdown = `# Approximately 1 MiB Desktop smoke\n\n${'Long document input remains Markdown authority. 中文长文档 smoke。\n\n'.repeat(20_000)}`
  if (Buffer.byteLength(longMarkdown, 'utf8') < 1_048_576) throw new Error(`Long document fixture is too small: ${Buffer.byteLength(longMarkdown, 'utf8')} bytes`)
  writeFileSync(longDocumentPath, longMarkdown, 'utf8')
  await click(sessionId, '[data-command-id="mode.visual"]')
  await waitFor(sessionId, 'return document.querySelector("[data-testid=\\"editor-surface\\"]")?.dataset.mode ?? ""', (value) => value === 'visual', 'Visual long-document surface')
  await setFile(sessionId, '[data-testid="import-markdown-input"]', longDocumentPath)
  await execute(sessionId, 'document.querySelector("[data-testid=\\"import-markdown-input\\"]")?.dispatchEvent(new Event("change", { bubbles: true })); return true')
  const longArticle = await waitFor(sessionId,
    `return { title: document.querySelector('.workspace-controls__meta span')?.textContent ?? '', documentId: document.querySelector('.workspace-shell')?.getAttribute('data-document-id') ?? '', textLength: document.querySelector('.ProseMirror')?.textContent?.length ?? 0, errors: [...document.querySelectorAll('.workspace-error')].map((node) => node.textContent?.trim() ?? '').filter(Boolean) }`,
    (value) => value?.title === 'long-1mb' && value.textLength > 900_000 && value.errors.length === 0,
    'approximately 1 MiB Visual document',
    60_000,
  )
  const longArticles = fulfilled(await invoke(sessionId, 'library_list_articles'), 'long-document Library listing')
  const durableLong = longArticles.find((article) => article.documentId === longArticle.documentId)
  if (durableLong === undefined || Buffer.byteLength(durableLong.markdown, 'utf8') < 1_048_576) throw new Error('Approximately 1 MiB document was not durable in Library authority.')
  const longErrors = await execute(sessionId, 'return [...document.querySelectorAll(".workspace-error")].map((node) => node.textContent?.trim() ?? "").filter(Boolean)')
  if (longErrors.length > 0) throw new Error(`Long-document WebView2 smoke produced errors: ${JSON.stringify(longErrors)}`)

  const previewScrollDocumentPath = join(testParent, 'preview-task-scroll.md')
  const previewBefore = Array.from({ length: 24 }, (_, index) => `## Before ${index + 1}\n\nStable paragraph ${index + 1}.`).join('\n\n')
  const previewTasks = ['- [ ] 1', '- [ ] 2', '  - [ ] 3', '  - [ ] 3', '    - [ ] 4'].join('\n')
  const previewAfter = Array.from({ length: 8 }, (_, index) => `## Panel ${index + 1}\n\n::: info Information\nStable panel body ${index + 1}.\n:::`).join('\n\n')
  const previewScrollMarkdown = `# Preview task scroll repro\n\n${previewBefore}\n\n${previewTasks}\n\n${previewAfter}`
  writeFileSync(previewScrollDocumentPath, previewScrollMarkdown, 'utf8')
  await setFile(sessionId, '[data-testid="import-markdown-input"]', previewScrollDocumentPath)
  await execute(sessionId, 'document.querySelector("[data-testid=\\"import-markdown-input\\"]")?.dispatchEvent(new Event("change", { bubbles: true })); return true')
  await waitFor(sessionId,
    `return { title: document.querySelector('.workspace-controls__meta span')?.textContent ?? '', documentId: document.querySelector('.workspace-shell')?.getAttribute('data-document-id') ?? '', errors: [...document.querySelectorAll('.workspace-error')].map((node) => node.textContent?.trim() ?? '').filter(Boolean) }`,
    (value) => value?.title === 'preview-task-scroll' && value.documentId.length > 0 && value.errors.length === 0,
    'the Preview viewport fixture import',
    30_000,
  )
  await click(sessionId, '[data-command-id="mode.preview"]')
  await waitFor(sessionId,
    `return { mode: document.querySelector('[data-testid="editor-surface"]')?.dataset.mode ?? '', preview: Boolean(document.querySelector('.visual-surface[data-mode="preview"] .ProseMirror')) }`,
    (value) => value?.mode === 'preview' && value.preview === true,
    'Preview viewport fixture surface',
    30_000,
  )
  const previewViewport = await execute(sessionId, `const selector = '.visual-surface[data-mode="preview"] input[type="checkbox"]'; const tasks = [...document.querySelectorAll(selector)]; const anchor = [...document.querySelectorAll('.visual-surface[data-mode="preview"] h2')].find((node) => (node.textContent ?? '').trim() === 'Panel 1'); const scroller = document.querySelector('[data-testid="editor-surface"]'); if (!(scroller instanceof HTMLElement) || !(anchor instanceof HTMLElement) || tasks.length !== 5) throw new Error('Preview viewport fixture is incomplete.'); tasks[2].scrollIntoView({ block: 'center' }); const initial = { scrollTop: scroller.scrollTop, anchorTop: anchor.getBoundingClientRect().top }; const observations = []; for (const index of [2, 4, 0, 3]) { const rect = tasks[index].getBoundingClientRect(); await new Promise((resolve) => requestAnimationFrame(() => resolve())); observations.push({ index, rect: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } }); } return { initial, observations }`)
  const previewInitial = previewViewport?.initial
  const previewClicks = []
  if (previewInitial === undefined || !Array.isArray(previewViewport?.observations)) throw new Error('Preview viewport fixture measurements are unavailable.')
  for (const observation of previewViewport.observations) {
    await pointerClick(sessionId, observation.rect.x, observation.rect.y)
    await sleep(250)
    const result = await execute(sessionId, `const selector = '.visual-surface[data-mode="preview"] input[type="checkbox"]'; const tasks = [...document.querySelectorAll(selector)]; const scroller = document.querySelector('[data-testid="editor-surface"]'); const anchor = [...document.querySelectorAll('.visual-surface[data-mode="preview"] h2')].find((node) => (node.textContent ?? '').trim() === 'Panel 1'); return { checked: tasks[${observation.index}]?.checked === true, activeIndex: tasks.indexOf(document.activeElement), scrollTop: scroller instanceof HTMLElement ? scroller.scrollTop : null, anchorTop: anchor instanceof HTMLElement ? anchor.getBoundingClientRect().top : null }`)
    previewClicks.push({ index: observation.index, ...result })
  }
  const previewMaxScrollDelta = Math.max(...previewClicks.map(({ scrollTop }) => Math.abs(scrollTop - previewInitial.scrollTop)))
  const previewMaxAnchorDelta = Math.max(...previewClicks.map(({ anchorTop }) => Math.abs(anchorTop - previewInitial.anchorTop)))
  if (previewMaxScrollDelta > 1 || previewMaxAnchorDelta > 1 || previewClicks.some(({ checked, activeIndex, index }) => checked !== true || activeIndex !== index)) {
    throw new Error(`Preview task viewport moved in Desktop WebView2: ${JSON.stringify({ previewInitial, previewClicks, previewMaxScrollDelta, previewMaxAnchorDelta })}`)
  }

  await closeMainSession()
  const ime = await runChild('desktop-tauri-ime.mjs', {
    W_EDITOR_DESKTOP_EXE: executable,
    W_EDITOR_DATA_ROOT_PARENT: testParent,
    W_EDITOR_TAURI_IME_PORT: String(port + 10),
    W_EDITOR_NATIVE_IME_PORT: String(nativePort + 10),
    W_EDITOR_IME_BOUNDARY_DELAY_MS: process.env.W_EDITOR_IME_BOUNDARY_DELAY_MS ?? '2',
  })
  const continuous = await runChild('desktop-tauri-continuous-input.mjs', {
    W_EDITOR_DESKTOP_EXE: executable,
    W_EDITOR_DATA_ROOT_PARENT: testParent,
    W_EDITOR_TAURI_INPUT_PORT: String(port + 20),
    W_EDITOR_NATIVE_INPUT_PORT: String(nativePort + 20),
  })
  const serializedResult = JSON.stringify({
    status: 'passed',
    browser: 'Microsoft Edge WebView2',
    browserVersion: session.capabilities?.browserVersion ?? 'unknown',
    executable,
    testParent,
    featureManifest: { expectedCommandCount: expectedCommands.size, runtimeCommandCount: identity.commands.length, missingCommands },
    readerFinalParity: { finalReady, finalSemantic, readerReady, readerSemantic },
    shortcuts: { selectedParagraph, headingShortcut, paragraphShortcut, shortcutSaved },
    clipboard: { api: identity.clipboard, copiedText: clipboard },
    fullscreen: { api: identity.fullscreen, entered: fullscreenEntered, exited: fullscreenExited },
    export: { command: identity.export, filename: exportedFilename, path: savedPath, nativeDialog: true, exactAuthority: true },
    longDocument: { path: longDocumentPath, bytes: Buffer.byteLength(longMarkdown, 'utf8'), documentId: durableLong.documentId, markdownBytes: Buffer.byteLength(durableLong.markdown, 'utf8'), visualTextLength: longArticle.textLength },
    previewViewport: { fixture: previewScrollDocumentPath, initial: previewInitial, clicks: previewClicks, maxScrollDelta: previewMaxScrollDelta, maxAnchorDelta: previewMaxAnchorDelta },
    physicalIme: ime,
    continuousInput: continuous,
  }, null, 2)
  if (process.env.W_EDITOR_FEATURE_MATRIX_EVIDENCE_PATH) {
    const evidencePath = resolve(process.env.W_EDITOR_FEATURE_MATRIX_EVIDENCE_PATH)
    mkdirSync(resolve(evidencePath, '..'), { recursive: true })
    writeFileSync(evidencePath, `${serializedResult}\n`, 'utf8')
  }
  console.log(serializedResult)
} finally {
  if (sessionId !== null) await request(`/session/${sessionId}`, 'DELETE').catch(() => {})
  if (!childDriversClosed) driverProcess.kill()
  await sleep(250)
  if (previousLocator === null) {
    if (existsSync(locatorPath)) unlinkSync(locatorPath)
  } else {
    const { mkdirSync } = await import('node:fs')
    mkdirSync(resolve(locatorPath, '..'), { recursive: true })
    writeFileSync(locatorPath, previousLocator)
  }
}
