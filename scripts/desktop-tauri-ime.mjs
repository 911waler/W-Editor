import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { parse, resolve } from 'node:path'
import { promisify } from 'node:util'
import { spawn } from 'node:child_process'

const execFileAsync = promisify(execFile)
const executable = resolve(process.env.W_EDITOR_DESKTOP_EXE ?? 'apps/desktop/src-tauri/target/debug/w-editor-desktop.exe')
const nativeDriver = resolve(process.env.W_EDITOR_EDGE_DRIVER ?? '.tmp/tauri-webdriver/msedgedriver.exe')
const tauriDriver = resolve(process.env.W_EDITOR_TAURI_DRIVER ?? '.tmp/tauri-driver.exe')
const port = Number(process.env.W_EDITOR_TAURI_IME_PORT ?? 4466)
const nativePort = Number(process.env.W_EDITOR_NATIVE_IME_PORT ?? 9537)
const base = `http://127.0.0.1:${port}`
const processName = parse(executable).name
const boundaryDelay = Number(process.env.W_EDITOR_IME_BOUNDARY_DELAY_MS ?? 2)
const dataRootParent = process.env.W_EDITOR_DATA_ROOT_PARENT ?? null
const articleTitle = `Physical IME ${Date.now()}`

if (!Number.isInteger(boundaryDelay) || boundaryDelay < 0) {
  throw new TypeError('W_EDITOR_IME_BOUNDARY_DELAY_MS must be a non-negative integer.')
}

function requireFile(path, label) {
  if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`)
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

const keyControl = '\uE009'
const keyShift = '\uE008'
const shortcutActions = (modifiers, key) => [
  ...modifiers.map((value) => ({ type: 'keyDown', value })),
  { type: 'keyDown', value: key },
  { type: 'keyUp', value: key },
  ...[...modifiers].reverse().map((value) => ({ type: 'keyUp', value })),
]

async function request(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { 'content-type': 'application/json' },
    method,
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(`WebDriver ${method} ${path}: ${payload?.value?.message ?? payload?.value?.error ?? response.status}`)
  }
  return payload?.value
}

async function execute(sessionId, script) {
  return request(`/session/${sessionId}/execute/sync`, 'POST', { args: [], script })
}

async function click(sessionId, selector) {
  const clicked = await execute(sessionId, `const element = document.querySelector(${JSON.stringify(selector)}); if (!(element instanceof HTMLElement)) return false; element.click(); return true`)
  if (clicked !== true) throw new Error(`No clickable element was found for ${selector}.`)
}

async function invoke(sessionId, command, payload = {}) {
  return request(`/session/${sessionId}/execute/async`, 'POST', {
    args: [payload],
    script: `const done = arguments[arguments.length - 1]; const bridge = globalThis.__TAURI_INTERNALS__; if (bridge === undefined || typeof bridge.invoke !== 'function') { done({ status: 'unavailable' }); } else { bridge.invoke(${JSON.stringify(command)}, arguments[0]).then((value) => done({ status: 'fulfilled', value })).catch((error) => done({ status: 'rejected', error: String(error) })); }`,
  })
}

async function waitForDriver() {
  const deadline = Date.now() + 10_000
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

async function waitFor(sessionId, script, expected, label, timeout = 20_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await execute(sessionId, script)
    if (expected(value)) return value
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${label}.`)
}

function escapePowerShellSingleQuoted(value) {
  return value.replaceAll("'", "''")
}

function nativeImeScript() {
  const escapedExecutable = escapePowerShellSingleQuoted(executable)
  const escapedProcessName = escapePowerShellSingleQuoted(processName)
  return String.raw`
$ErrorActionPreference = 'Stop'
$env:LIB = ''
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WEditorNativeImeInput {
  [StructLayout(LayoutKind.Explicit, Size = 40)]
  public struct INPUT {
    [FieldOffset(0)] public UInt32 type;
    [FieldOffset(8)] public KEYBDINPUT ki;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public UInt16 wVk;
    public UInt16 wScan;
    public UInt32 dwFlags;
    public UInt32 time;
    public IntPtr dwExtraInfo;
  }
  [DllImport("user32.dll", SetLastError = true)]
  public static extern UInt32 SendInput(UInt32 nInputs, INPUT[] pInputs, Int32 cbSize);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, Int32 nCmdShow);
  [DllImport("user32.dll")]
  public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool SetActiveWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern IntPtr SetFocus(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool AttachThreadInput(UInt32 idAttach, UInt32 idAttachTo, bool fAttach);
  [DllImport("user32.dll")]
  public static extern UInt32 GetWindowThreadProcessId(IntPtr hWnd, out UInt32 processId);
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("kernel32.dll")]
  public static extern UInt32 GetCurrentThreadId();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr LoadKeyboardLayout(string pwszKLID, UInt32 Flags);
  [DllImport("user32.dll")]
  public static extern IntPtr GetKeyboardLayout(UInt32 idThread);
  [DllImport("user32.dll")]
  public static extern bool PostMessage(IntPtr hWnd, UInt32 message, IntPtr wParam, IntPtr lParam);
  public static void Key(UInt16 key) {
    var down = new INPUT { type = 1, ki = new KEYBDINPUT { wVk = key } };
    var up = new INPUT { type = 1, ki = new KEYBDINPUT { wVk = key, dwFlags = 2 } };
    var inputs = new INPUT[] { down, up };
    if (SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT))) != 2) throw new Exception("SendInput failed for key " + key);
  }
}
'@
$target = Get-CimInstance Win32_Process -Filter "Name='${escapedProcessName}.exe'" |
  Where-Object { $_.ExecutablePath -eq '${escapedExecutable}' } |
  Sort-Object CreationDate -Descending |
  Select-Object -First 1
if ($null -eq $target) { throw 'The target Desktop process was not found.' }
$process = Get-Process -Id $target.ProcessId
$window = [IntPtr]$process.MainWindowHandle
if ($window -eq [IntPtr]::Zero) { throw 'The target Desktop window handle is unavailable.' }
$currentThread = [WEditorNativeImeInput]::GetCurrentThreadId()
$foreground = [WEditorNativeImeInput]::GetForegroundWindow()
$foregroundPid = [UInt32]0
$foregroundThread = [WEditorNativeImeInput]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid)
$targetPid = [UInt32]0
$targetThread = [WEditorNativeImeInput]::GetWindowThreadProcessId($window, [ref]$targetPid)
$attachedForeground = $false
$attachedTarget = $false
try {
  if ($foregroundThread -ne [UInt32]0 -and $foregroundThread -ne $currentThread) {
    $attachedForeground = [WEditorNativeImeInput]::AttachThreadInput($currentThread, $foregroundThread, $true)
  }
  if ($targetThread -ne [UInt32]0 -and $targetThread -ne $currentThread -and $targetThread -ne $foregroundThread) {
    $attachedTarget = [WEditorNativeImeInput]::AttachThreadInput($currentThread, $targetThread, $true)
  }
  [void][WEditorNativeImeInput]::ShowWindow($window, 5)
  [void][WEditorNativeImeInput]::BringWindowToTop($window)
  [void][WEditorNativeImeInput]::SetActiveWindow($window)
  [void][WEditorNativeImeInput]::SetForegroundWindow($window)
  [void][WEditorNativeImeInput]::SetFocus($window)
  $focused = $false
  for ($attempt = 0; $attempt -lt 10; $attempt++) {
    Start-Sleep -Milliseconds 50
    $activeWindow = [WEditorNativeImeInput]::GetForegroundWindow()
    if ($activeWindow -eq $window) {
      $focused = $true
      break
    }
    [void][WEditorNativeImeInput]::BringWindowToTop($window)
    [void][WEditorNativeImeInput]::SetForegroundWindow($window)
  }
  if (-not $focused) {
    $activePid = [UInt32]0
    [void][WEditorNativeImeInput]::GetWindowThreadProcessId([WEditorNativeImeInput]::GetForegroundWindow(), [ref]$activePid)
    throw "The target Desktop window could not be focused (targetPid=$($target.ProcessId), foregroundPid=$activePid)."
  }
$originalLayout = [WEditorNativeImeInput]::GetKeyboardLayout($targetThread)
$chineseLayout = [WEditorNativeImeInput]::LoadKeyboardLayout('00000804', 1)
if ($chineseLayout -eq [IntPtr]::Zero) { throw 'The Simplified Chinese keyboard layout is unavailable.' }
try {
  [void][WEditorNativeImeInput]::PostMessage($window, 0x0050, [IntPtr]::Zero, $chineseLayout)
  Start-Sleep -Milliseconds 100
  $keys = @(0x4e, 0x49, 0x20, 0x48, 0x41, 0x4f, 0x20)
  for ($index = 0; $index -lt $keys.Count; $index++) {
    $key = $keys[$index]
    [WEditorNativeImeInput]::Key([UInt16]$key)
    if ($key -eq 0x20) {
      if ($index -eq 2) { Start-Sleep -Milliseconds ${boundaryDelay} } else { Start-Sleep -Milliseconds 2 }
    } else { Start-Sleep -Milliseconds 35 }
  }
  Write-Output 'physical-ime-key-sequence-sent'
}
finally {
  if ($originalLayout -ne [IntPtr]::Zero) {
    [void][WEditorNativeImeInput]::PostMessage($window, 0x0050, [IntPtr]::Zero, $originalLayout)
  }
}
}
finally {
  if ($attachedTarget) { [void][WEditorNativeImeInput]::AttachThreadInput($currentThread, $targetThread, $false) }
  if ($attachedForeground) { [void][WEditorNativeImeInput]::AttachThreadInput($currentThread, $foregroundThread, $false) }
}
`
}

requireFile(executable, 'Desktop debug executable')
requireFile(nativeDriver, 'Edge WebDriver')
requireFile(tauriDriver, 'tauri-driver')

const driverProcess = spawn(tauriDriver, [
  '--port', String(port),
  '--native-port', String(nativePort),
  '--native-driver', nativeDriver,
], { stdio: 'ignore', windowsHide: true })
let sessionId = null
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
  await request(`/session/${sessionId}/timeouts`, 'POST', { script: 10_000 })
  if (dataRootParent !== null) {
    await waitFor(sessionId, 'return typeof globalThis.__TAURI_INTERNALS__?.invoke === "function"', (value) => value === true, 'Tauri invoke bridge')
    const selected = await invoke(sessionId, 'select_data_root', { parentPath: dataRootParent })
    if (selected?.status !== 'fulfilled' || selected.value?.state !== 'ready') throw new Error(`Data Root setup failed: ${JSON.stringify(selected)}`)
  }
  await waitFor(sessionId,
    `return { mode: document.querySelector('[data-testid="editor-surface"]')?.dataset.mode, ready: document.documentElement.dataset.desktopReady, visual: Boolean(document.querySelector('.ProseMirror')) }`,
    (value) => value?.ready === 'true' && value.mode === 'visual' && value.visual === true,
    'the Desktop Visual surface',
  )
  await click(sessionId, '[data-testid="desktop-new-article"]')
  await waitFor(sessionId, `return Boolean(document.querySelector('[data-testid="new-article-dialog"]'))`, (value) => value === true, 'the physical IME article dialog')
  await execute(sessionId, `const input = document.querySelector('[data-testid="new-article-title"]'); if (!(input instanceof HTMLInputElement)) throw new Error('The physical IME article title input is unavailable.'); input.value = ${JSON.stringify(articleTitle)}; input.dispatchEvent(new Event('input', { bubbles: true })); return input.value`)
  await click(sessionId, '[data-testid="new-article-create"]')
  await waitFor(sessionId,
    `return { dialog: Boolean(document.querySelector('[data-testid="new-article-dialog"]')), title: document.querySelector('.workspace-controls__meta span')?.textContent ?? '', documentId: document.querySelector('.workspace-shell')?.getAttribute('data-document-id') ?? '', visual: Boolean(document.querySelector('.ProseMirror')) }`,
    (value) => value?.dialog === false && value.title === articleTitle && value.documentId.length > 0 && value.visual === true,
    'the unique physical IME article',
  )
  const selectionContext = await execute(sessionId, `const editor = document.querySelector('.ProseMirror'); const paragraph = editor?.querySelector(':scope > p'); const shell = document.querySelector('.workspace-shell'); if (!(editor instanceof HTMLElement) || !(paragraph instanceof HTMLElement) || !(shell instanceof HTMLElement)) throw new Error('The first Visual paragraph or document identity is unavailable.'); const range = document.createRange(); range.selectNodeContents(paragraph); range.collapse(false); const selection = getSelection(); if (selection === null) throw new Error('Selection is unavailable.'); selection.removeAllRanges(); selection.addRange(range); editor.focus(); const events = []; for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input']) editor.addEventListener(type, (event) => { const input = event instanceof InputEvent ? event : null; events.push({ data: input?.data ?? (event instanceof CompositionEvent ? event.data : null), inputType: input?.inputType ?? null, isComposing: input?.isComposing ?? null, type }); }, true); window.__W_EDITOR_IME_TRACE__ = events; return { before: editor.textContent ?? '', documentId: shell.getAttribute('data-document-id') ?? '', paragraph: paragraph.textContent ?? '' }`)
  const before = selectionContext.before
  const inputResult = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    nativeImeScript(),
  ], { maxBuffer: 10_000 })
  await sleep(1_000)
  const result = await execute(sessionId, `return { authority: document.querySelector('.status-region')?.textContent ?? '', after: document.querySelector('.ProseMirror')?.textContent ?? '', errors: [...document.querySelectorAll('.workspace-error')].map((node) => node.textContent?.trim() ?? '').filter(Boolean), trace: window.__W_EDITOR_IME_TRACE__ ?? [] }`)
  const hasComposition = result.trace.some((event) => event.type === 'compositionstart')
  const hasComposingInput = result.trace.some((event) => event.inputType === 'insertCompositionText' && event.isComposing === true)
  const committedCandidates = result.trace
    .filter((event) => event.type === 'compositionend' && typeof event.data === 'string')
    .map((event) => event.data)
    .join('')
  const hasChineseCandidates = /^\p{Script=Han}{2}$/u.test(committedCandidates) && result.after.includes(committedCandidates)
  const expectedMarker = `${selectionContext.paragraph}${committedCandidates}`
  if (!hasComposition) throw new Error(`Physical keys did not create a browser composition: ${JSON.stringify(result)}`)
  if (!hasComposingInput) throw new Error(`Physical keys did not create a composing input event: ${JSON.stringify(result)}`)
  if (!hasChineseCandidates) throw new Error(`Physical Chinese IME did not produce the expected candidates: ${JSON.stringify(result)}`)
  if (result.errors.length > 0) throw new Error(`Desktop physical IME produced workspace errors: ${JSON.stringify(result.errors)}`)
  const authorityMarkdown = async () => {
    if (dataRootParent !== null) {
      const draft = await invoke(sessionId, 'recovery_load_draft', { documentId: selectionContext.documentId })
      if (draft?.status === 'fulfilled' && typeof draft.value?.markdown === 'string') return draft.value.markdown
      const article = await invoke(sessionId, 'library_load_markdown', { documentId: selectionContext.documentId })
      return article?.status === 'fulfilled' && typeof article.value?.markdown === 'string' ? article.value.markdown : null
    }
    return await execute(sessionId, `const raw = localStorage.getItem('w-editor:v1:document:welcome'); if (raw === null) return null; try { const markdown = JSON.parse(raw)?.autosave?.markdown; return typeof markdown === 'string' ? markdown : null } catch { return null }`)
  }
  const waitPersistedMarkdown = async (containsCandidates) => {
    const deadline = Date.now() + 20_000
    let last = null
    while (Date.now() < deadline) {
      last = await authorityMarkdown()
      if (typeof last === 'string' && last.includes(expectedMarker) === containsCandidates) return last
      await sleep(100)
    }
    throw new Error(`Timed out waiting for Markdown authority ${containsCandidates ? 'with' : 'without'} physical IME candidates: ${JSON.stringify(last)}`)
  }
  const source = await waitPersistedMarkdown(true)
  const enterVisual = async () => {
    await waitFor(sessionId,
      `return { mode: document.querySelector('[data-testid="editor-surface"]')?.dataset.mode, visual: Boolean(document.querySelector('.ProseMirror')) }`,
      (value) => value?.mode === 'visual' && value.visual === true,
      'focusable Visual mode',
    )
    await execute(sessionId, `const editor = document.querySelector('.ProseMirror'); if (!(editor instanceof HTMLElement)) throw new Error('The Visual editor is unavailable.'); editor.focus(); return true`)
  }
  let undoCount = 0
  let afterUndo = source
  while (undoCount < 2 && afterUndo?.includes(expectedMarker)) {
    await enterVisual()
    await request(`/session/${sessionId}/actions`, 'POST', { actions: [{ type: 'key', id: 'keyboard', actions: shortcutActions([keyControl], 'z') }] })
    afterUndo = await waitPersistedMarkdown(false)
    undoCount += 1
  }
  if (afterUndo?.includes(expectedMarker)) throw new Error('Undo did not remove the physical IME candidates from authority.')
  let redoCount = 0
  let afterRedo = afterUndo
  while (redoCount < undoCount && !afterRedo?.includes(expectedMarker)) {
    await enterVisual()
    await request(`/session/${sessionId}/actions`, 'POST', { actions: [{ type: 'key', id: 'keyboard', actions: shortcutActions([keyControl, keyShift], 'z') }] })
    afterRedo = await waitPersistedMarkdown(true)
    redoCount += 1
  }
  if (!afterRedo?.includes(expectedMarker)) throw new Error('Redo did not restore the physical IME candidates in authority.')
  await enterVisual()
  const historyErrors = await execute(sessionId, `return [...document.querySelectorAll('.workspace-error')].map((node) => node.textContent?.trim() ?? '').filter(Boolean)`)
  if (historyErrors.length > 0) throw new Error(`Desktop physical IME history produced workspace errors: ${JSON.stringify(historyErrors)}`)
  console.log(JSON.stringify({
    afterContainsExpectedCandidates: hasChineseCandidates,
    beforeTail: before.slice(-80),
    browser: session.capabilities?.browserVersion ?? 'Microsoft Edge WebView2',
    errors: result.errors,
    eventTypes: result.trace.map((event) => event.type),
    hasComposingInput,
    committedCandidates,
    historyRoundTrip: { redoCount, undoCount },
    sourceContainsExpectedCandidates: source.includes(expectedMarker),
    expectedMarker,
    documentId: selectionContext.documentId,
    status: 'passed',
    visualTail: result.after.slice(-80),
    powershell: inputResult.stdout.trim(),
    boundaryDelayMs: boundaryDelay,
  }, null, 2))
} finally {
  if (sessionId !== null) await request(`/session/${sessionId}`, 'DELETE').catch(() => {})
  driverProcess.kill()
}
