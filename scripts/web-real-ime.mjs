import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { chromium } from 'playwright'

const execFileAsync = promisify(execFile)
const baseUrl = process.env.W_EDITOR_WEB_IME_URL ?? 'http://localhost:5173/'
const boundaryDelay = Number(process.env.W_EDITOR_IME_BOUNDARY_DELAY_MS ?? 2)
const browserExecutablePath = process.env.W_EDITOR_WEB_IME_BROWSER_PATH

if (!Number.isInteger(boundaryDelay) || boundaryDelay < 0) {
  throw new TypeError('W_EDITOR_IME_BOUNDARY_DELAY_MS must be a non-negative integer.')
}

function nativeImeScript(processId) {
  return String.raw`
$ErrorActionPreference = 'Stop'
$env:LIB = ''
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WEditorWebNativeImeInput {
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
  public static extern UInt32 GetWindowThreadProcessId(IntPtr hWnd, out UInt32 processId);
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
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
$target = Get-Process -Id ${processId}
$windowProcess = $target
if ($windowProcess.MainWindowHandle -eq 0) {
  $childProcesses = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $target.Id } |
    ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue } |
    Where-Object { $_.MainWindowHandle -ne 0 } |
    Sort-Object StartTime -Descending
  $windowProcess = $childProcesses | Select-Object -First 1
}
if ($null -eq $windowProcess) { throw 'The browser window process was not found.' }
$window = [IntPtr]$windowProcess.MainWindowHandle
if ($window -eq [IntPtr]::Zero) { throw 'The browser window handle is unavailable.' }
[void][WEditorWebNativeImeInput]::ShowWindow($window, 5)
[void][WEditorWebNativeImeInput]::BringWindowToTop($window)
[void][WEditorWebNativeImeInput]::SetForegroundWindow($window)
Start-Sleep -Milliseconds 250
$foreground = [WEditorWebNativeImeInput]::GetForegroundWindow()
$foregroundPid = [UInt32]0
[void][WEditorWebNativeImeInput]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid)
if ($foregroundPid -ne [UInt32]$windowProcess.Id) { throw 'The browser window could not be focused.' }
$windowThread = [WEditorWebNativeImeInput]::GetWindowThreadProcessId($window, [ref]$foregroundPid)
$originalLayout = [WEditorWebNativeImeInput]::GetKeyboardLayout($windowThread)
$chineseLayout = [WEditorWebNativeImeInput]::LoadKeyboardLayout('00000804', 1)
if ($chineseLayout -eq [IntPtr]::Zero) { throw 'The Simplified Chinese keyboard layout is unavailable.' }
try {
  [void][WEditorWebNativeImeInput]::PostMessage($window, 0x0050, [IntPtr]::Zero, $chineseLayout)
  Start-Sleep -Milliseconds 100
  $keys = @(0x4e, 0x49, 0x20, 0x48, 0x41, 0x4f, 0x20)
  for ($index = 0; $index -lt $keys.Count; $index++) {
    $key = $keys[$index]
    [WEditorWebNativeImeInput]::Key([UInt16]$key)
    if ($key -eq 0x20) {
      if ($index -eq 2) { Start-Sleep -Milliseconds ${boundaryDelay} } else { Start-Sleep -Milliseconds 2 }
    } else { Start-Sleep -Milliseconds 35 }
  }
  Write-Output 'physical-ime-key-sequence-sent'
}
finally {
  if ($originalLayout -ne [IntPtr]::Zero) {
    [void][WEditorWebNativeImeInput]::PostMessage($window, 0x0050, [IntPtr]::Zero, $originalLayout)
  }
}
`
}

const browserServer = await chromium.launchServer({
  ...(browserExecutablePath === undefined ? {} : { executablePath: browserExecutablePath }),
  headless: false,
})
const browser = await chromium.connect(browserServer.wsEndpoint())
const page = await browser.newPage()
try {
  await page.goto(baseUrl)
  await page.locator('html[data-w-editor-ready="true"]').waitFor()
  await page.locator('.ProseMirror > p').first().evaluate((element) => {
    const editor = element.closest('.ProseMirror')
    const selection = globalThis.getSelection()
    if (editor === null || selection === null) throw new Error('Expected Visual selection.')
    const range = globalThis.document.createRange()
    range.selectNodeContents(element)
    range.collapse(false)
    editor.focus()
    selection.removeAllRanges()
    selection.addRange(range)
    const events = []
    for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input']) {
      editor.addEventListener(type, (event) => {
        const input = event instanceof globalThis.InputEvent ? event : null
        events.push({
          data: input?.data ?? (event instanceof globalThis.CompositionEvent ? event.data : null),
          inputType: input?.inputType ?? null,
          isComposing: input?.isComposing ?? null,
          type,
        })
      }, true)
    }
    Object.assign(globalThis, { __W_EDITOR_IME_TRACE__: events })
  })
  const processId = browserServer.process().pid
  if (processId === undefined) throw new Error('The Playwright browser process id is unavailable.')
  const input = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    nativeImeScript(processId),
  ], { maxBuffer: 10_000 })
  await page.waitForTimeout(1_000)
  const result = await page.evaluate(() => ({
    errors: [...globalThis.document.querySelectorAll('.workspace-error')].map((node) => node.textContent?.trim() ?? '').filter(Boolean),
    events: globalThis.__W_EDITOR_IME_TRACE__ ?? [],
    visual: globalThis.document.querySelector('.ProseMirror')?.textContent ?? '',
  }))
  const hasComposition = result.events.filter((event) => event.type === 'compositionstart').length === 2
  const hasComposingInput = result.events.some((event) => event.inputType === 'insertCompositionText' && event.isComposing === true)
  if (!hasComposition || !hasComposingInput) throw new Error(`The browser did not receive two real composing sequences: ${JSON.stringify(result)}`)
  if (!result.visual.includes('你好')) throw new Error(`The browser did not render the expected Chinese candidates: ${JSON.stringify(result)}`)
  if (result.errors.length > 0) throw new Error(`Web physical IME produced workspace errors: ${JSON.stringify(result.errors)}`)
  const readPersistedMarkdown = async () => await page.evaluate(() => {
    const raw = globalThis.localStorage.getItem('w-editor:v1:document:welcome')
    if (raw === null) return null
    try {
      const envelope = JSON.parse(raw)
      return typeof envelope?.autosave?.markdown === 'string' ? envelope.autosave.markdown : null
    } catch {
      return null
    }
  })
  const waitPersistedMarkdown = async (containsCandidates) => {
    await page.waitForFunction((shouldContain) => {
      const raw = globalThis.localStorage.getItem('w-editor:v1:document:welcome')
      if (raw === null) return false
      try {
        const markdown = JSON.parse(raw)?.autosave?.markdown
        return typeof markdown === 'string' && markdown.includes('begin你好') === shouldContain
      } catch {
        return false
      }
    }, containsCandidates, { timeout: 10_000 })
    return await readPersistedMarkdown()
  }
  const source = await waitPersistedMarkdown(true)
  if (!source?.includes('begin你好')) throw new Error('The physical IME candidates did not reach Markdown authority.')
  const enterVisual = async () => {
    await page.locator('.ProseMirror').waitFor()
    await page.locator('.ProseMirror').focus()
  }
  let undoCount = 0
  let afterUndo = source
  while (undoCount < 2 && afterUndo.includes('begin你好')) {
    await enterVisual()
    await page.keyboard.press('Control+z')
    afterUndo = await waitPersistedMarkdown(false) ?? ''
    undoCount += 1
  }
  if (afterUndo.includes('begin你好')) throw new Error('Undo did not remove the physical IME candidates from authority.')
  let redoCount = 0
  let afterRedo = afterUndo
  while (redoCount < undoCount && !afterRedo.includes('begin你好')) {
    await enterVisual()
    await page.keyboard.press('Control+Shift+z')
    afterRedo = await waitPersistedMarkdown(true) ?? ''
    redoCount += 1
  }
  if (!afterRedo.includes('begin你好')) throw new Error('Redo did not restore the physical IME candidates in authority.')
  await enterVisual()
  if (await page.locator('.workspace-error').count() > 0) throw new Error('Physical IME history produced a workspace error.')
  console.log(JSON.stringify({
    browser: browserExecutablePath ?? 'Playwright bundled Chromium',
    boundaryDelayMs: boundaryDelay,
    errors: result.errors,
    eventCount: result.events.length,
    hasComposingInput,
    historyRoundTrip: { redoCount, undoCount },
    powershell: input.stdout.trim(),
    sourceContainsExpectedCandidates: true,
    status: 'passed',
    visualContainsExpectedCandidates: true,
  }, null, 2))
} finally {
  await browser.close()
  await browserServer.close()
}
