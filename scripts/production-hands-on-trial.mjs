import { spawn } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { resolve } from 'node:path'

import { chromium } from 'playwright'

const HOST = '127.0.0.1'
const PORT = 4184
const BASE_URL = `http://${HOST}:${PORT}`
const REPORT_PATH = resolve('artifacts/agent-hands-on-trial.json')
const SCREENSHOT_PATH = resolve('artifacts/agent-hands-on-trial.png')
const FAILURE_SCREENSHOT_PATH = resolve('artifacts/agent-hands-on-trial-failure.png')
const DOCUMENT_KEY = 'w-editor:v1:document:welcome'
const COVERAGE_IDS = Object.freeze([
  'requirementFamilies',
  'commands',
  'parityComponents',
  'rawRecovery',
  'diagramsNetBoundary',
  'realBrowserInput',
  'persistence',
  'imports',
  'exports',
  'failureStates',
  'diagnostics',
])

const MARKDOWN_OUTCOMES = Object.freeze({
  'align.center': '::: center\nAlpha\n:::',
  'align.justify': '::: justify\nAlpha\n:::',
  'align.left': '::: left\nAlpha\n:::',
  'align.right': '::: right\nAlpha\n:::',
  'block.h1': '# Alpha',
  'block.h2': '## Alpha',
  'block.h3': '### Alpha',
  'block.h4': '#### Alpha',
  'block.h5': '##### Alpha',
  'block.quote': '> Alpha',
  'insert.hard-break': 'Alpha  \n',
  'insert.horizontal-rule': 'Alpha\n\n---',
  'insert.inline-code': '`Alpha`',
  'insert.toc': 'Alpha\n\n[[toc]]',
  'list.ordered': '1. Alpha',
  'list.task': '- [ ] Alpha',
  'list.unordered': '- Alpha',
  'text.bold': '**Alpha**',
  'text.italic': '*Alpha*',
  'text.strike': '~~Alpha~~',
  'text.subscript': '~Alpha~',
  'text.superscript': '^Alpha^',
  'text.underline': '++Alpha++',
})

const DIALOG_SELECTORS = Object.freeze({
  'document.word-count': '[data-testid="word-count-dialog"]',
  'insert.audio': '[data-editor-command="insert.audio"]',
  'insert.code-block': '[data-editor-command="insert.code-block"]',
  'insert.drawio': '[data-editor-command="insert.drawio"]',
  'insert.file': '[data-editor-command="insert.file"]',
  'insert.formula': '[data-picker-command="insert.formula"]',
  'insert.image': '[data-editor-command="insert.image"]',
  'insert.link': '[data-picker-command="insert.link"]',
  'insert.pdf': '[data-editor-command="insert.pdf"]',
  'insert.video': '[data-editor-command="insert.video"]',
  'insert.word': '[data-editor-command="insert.word"]',
  'layout.accordion': '[data-picker-command="layout.accordion"]',
  'layout.multi-column': '[data-picker-command="layout.multi-column"]',
  'layout.tabs': '[data-picker-command="layout.tabs"]',
  'layout.timeline': '[data-picker-command="layout.timeline"]',
  'layout.two-column': '[data-picker-command="layout.two-column"]',
  'panel.danger': '[data-picker-command="panel.danger"]',
  'panel.info': '[data-picker-command="panel.info"]',
  'panel.primary': '[data-picker-command="panel.primary"]',
  'panel.success': '[data-picker-command="panel.success"]',
  'panel.warning': '[data-picker-command="panel.warning"]',
  'search.replace': '.search-dock',
  'settings.shortcuts': '[data-testid="shortcut-settings"]',
  'text.background': '[data-picker-command="text.background"]',
  'text.color': '[data-picker-command="text.color"]',
  'text.ruby': '[data-picker-command="text.ruby"]',
  'text.size': '[data-picker-command="text.size"]',
})

const DOWNLOAD_FILENAMES = Object.freeze({
  'export.html': 'welcome.html',
  'export.markdown': 'welcome.md',
  'export.pdf': 'welcome.pdf',
  'export.screenshot': 'welcome.png',
  'export.word': 'welcome.doc',
})

const ALL_SELECTION_COMMANDS = new Set([
  ...Object.keys(MARKDOWN_OUTCOMES).filter((id) => (
    id.startsWith('align.') || id.startsWith('block.') || id.startsWith('list.') || id.startsWith('text.')
  )),
  'insert.inline-code',
  'insert.link',
  'text.background',
  'text.color',
  'text.ruby',
  'text.size',
])

const END_SELECTION_COMMANDS = new Set([
  ...Object.keys(DIALOG_SELECTORS).filter((id) => (
    id.startsWith('insert.') || id.startsWith('layout.') || id.startsWith('panel.')
  )),
  'insert.hard-break',
  'insert.horizontal-rule',
  'insert.table',
  'insert.toc',
])

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`)
  }
}

function passedInventory(ids) {
  return Object.fromEntries(ids.map((id) => [id, 'not-run']))
}

async function frozenInventories() {
  const featureManifest = JSON.parse(
    await readFile(resolve('tests/fixtures/manifests/feature-manifest.json'), 'utf8'),
  )
  const commandIds = [...featureManifest.commands.ids]
  const parityComponentIds = [...featureManifest.components.ids]
  const requirementFamilyIds = [...featureManifest.requirementFamilies.ids]
  assertEqual(commandIds.length, 80, 'Frozen command inventory size')
  assertEqual(parityComponentIds.length, 41, 'Frozen parity-component inventory size')
  assertEqual(requirementFamilyIds.length, 7, 'Frozen requirement-family inventory size')
  return { commandIds, parityComponentIds, requirementFamilyIds }
}

function markPassed(record, id, label) {
  assert(Object.hasOwn(record, id), `Unknown ${label} inventory item: ${id}.`)
  record[id] = 'passed'
}

function markComponents(report, ids) {
  for (const id of ids) markPassed(report.inventory.parityComponents, id, 'parity component')
}

function menuForCommand(commandId) {
  if (['text.strike', 'text.underline', 'text.subscript', 'text.superscript', 'text.ruby', 'block.quote'].includes(commandId)) return 'text-style'
  if (commandId === 'text.color' || commandId === 'text.background') return 'color'
  if (commandId.startsWith('block.')) return 'heading'
  if (commandId.startsWith('panel.')) return 'panel'
  if (['layout.two-column', 'layout.multi-column', 'layout.tabs'].includes(commandId)) return 'panel'
  if (commandId.startsWith('align.')) return 'alignment'
  if (commandId.startsWith('insert.') && commandId !== 'insert.drawio') return 'insert'
  if (commandId.startsWith('mermaid.')) return 'mermaid'
  if (commandId.startsWith('chart.')) return 'chart'
  if (commandId.startsWith('language.')) return 'language'
  if (commandId.startsWith('export.')) return 'export'
  return null
}

function componentsForCommand(commandId) {
  const components = ['component.toolbar']
  if (/^text\.(?:bold|italic|strike|underline|subscript|superscript)$/u.test(commandId)) components.push('component.text-marks')
  if (commandId === 'text.ruby') components.push('component.ruby-pinyin')
  if (commandId === 'text.size') components.push('component.font-size-picker')
  if (commandId === 'text.color' || commandId === 'text.background') components.push('component.color-picker')
  if (commandId.startsWith('block.') && commandId !== 'block.quote') components.push('component.heading')
  if (commandId === 'block.quote') components.push('component.quote')
  if (commandId === 'list.ordered' || commandId === 'list.unordered') components.push('component.list')
  if (commandId === 'list.task') components.push('component.task-list')
  if (commandId.startsWith('panel.')) components.push('component.panel')
  if (commandId.startsWith('align.')) components.push('component.alignment')
  if (commandId === 'layout.two-column' || commandId === 'layout.multi-column') components.push('component.columns')
  if (commandId === 'layout.tabs') components.push('component.tabs')
  if (commandId === 'layout.accordion') components.push('component.accordion')
  if (commandId === 'layout.timeline') components.push('component.timeline')
  if (/^insert\.(?:image|audio|video)$/u.test(commandId)) components.push('component.media')
  if (commandId === 'insert.link') components.push('component.link')
  if (commandId === 'insert.horizontal-rule' || commandId === 'insert.hard-break') components.push('component.simple-insert')
  if (commandId === 'insert.code-block') components.push('component.code-block')
  if (commandId === 'insert.inline-code') components.push('component.inline-code')
  if (commandId === 'insert.formula') components.push('component.formula')
  if (commandId === 'insert.toc') components.push('component.toc')
  if (commandId === 'insert.table') components.push('component.table')
  if (/^insert\.(?:pdf|word|file)$/u.test(commandId)) components.push('component.attachment')
  if (commandId === 'insert.drawio') components.push('component.drawio')
  if (commandId.startsWith('mermaid.')) components.push('component.mermaid')
  if (commandId.startsWith('chart.')) components.push('component.chart-table')
  if (commandId.startsWith('history.')) components.push('component.history')
  if (commandId === 'document.manual-save') components.push('component.manual-save')
  if (commandId === 'search.replace') components.push('component.search-replace')
  if (commandId === 'settings.shortcuts') components.push('component.shortcut-settings')
  if (commandId.startsWith('mode.')) components.push('component.mode-controls')
  if (commandId === 'mode.source') components.push('component.source-surface')
  if (commandId === 'mode.visual') components.push('component.visual-surface')
  if (commandId === 'mode.preview') components.push('component.preview-surface')
  if (commandId === 'application.fullscreen') components.push('component.fullscreen')
  if (commandId.startsWith('language.')) components.push('component.locale-picker')
  if (commandId === 'document.word-count') components.push('component.word-count')
  if (commandId.startsWith('export.')) components.push('component.export-menu')
  return components
}

async function waitUntil(label, probe, timeout = 15_000) {
  const deadline = Date.now() + timeout
  let lastFailure
  while (Date.now() < deadline) {
    try {
      const result = await probe()
      if (result) return
    } catch (failure) {
      lastFailure = failure
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  const suffix = lastFailure instanceof Error ? ` Last failure: ${lastFailure.message}` : ''
  throw new Error(`Timed out waiting for ${label}.${suffix}`)
}

function runCommand(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd: process.cwd(), stdio: 'inherit', windowsHide: true })
    child.once('error', rejectPromise)
    child.once('exit', (code) => {
      if (code === 0) resolvePromise()
      else rejectPromise(new Error(`${command} ${args.join(' ')} exited with code ${String(code)}.`))
    })
  })
}

async function buildProduction() {
  if (process.platform === 'win32') {
    await runCommand(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'corepack pnpm run build'])
  } else {
    await runCommand('corepack', ['pnpm', 'run', 'build'])
  }
  await runCommand(process.execPath, ['scripts/verify-e2e-build-seam.mjs', 'absent'])
}

function startProductionServer() {
  const vite = resolve('node_modules/vite/bin/vite.js')
  const child = spawn(process.execPath, [vite, 'preview', '--host', HOST, '--port', String(PORT), '--strictPort'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let output = ''
  const collect = (chunk) => { output = `${output}${String(chunk)}`.slice(-12_000) }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  return { child, output: () => output }
}

async function waitForServer(server) {
  await waitUntil('the production preview server', async () => {
    if (server.child.exitCode !== null) {
      throw new Error(`Production preview exited before readiness.\n${server.output()}`)
    }
    try {
      return (await fetch(BASE_URL)).ok
    } catch {
      return false
    }
  }, 30_000)
}

async function stopServer(server) {
  if (server.child.exitCode !== null) return
  server.child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolvePromise) => server.child.once('exit', resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 3_000)),
  ])
  if (server.child.exitCode === null) server.child.kill('SIGKILL')
}

async function stableChromePath() {
  const candidates = process.platform === 'win32'
    ? [
        process.env.ProgramFiles && resolve(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'),
        process.env['ProgramFiles(x86)'] && resolve(process.env['ProgramFiles(x86)'], 'Google/Chrome/Application/chrome.exe'),
        process.env.LOCALAPPDATA && resolve(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
      ]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome']
  for (const candidate of candidates.filter(Boolean)) {
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      // Continue through stable-channel installation locations.
    }
  }
  throw new Error('A stable Google Chrome installation is required for the headed production trial.')
}

async function ready(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  await page.locator('html[data-w-editor-ready="true"]').waitFor({ timeout: 30_000 })
  const seamAbsent = await page.evaluate(() => !('__W_EDITOR_AUTHORITY__' in globalThis))
  assert(seamAbsent, 'The hands-on trial received an E2E build instead of the production build.')
  await page.locator('[data-toolbar-menu="language"] .toolbar-menu__trigger').click()
  await page.locator('[data-command-id="language.en"]').click()
}

async function sourceText(page) {
  return page.getByLabel('Markdown source').locator('.cm-line').evaluateAll(
    (lines) => lines.map((line) => line.textContent ?? '').join('\n'),
  )
}

async function expectSource(page, expected) {
  await waitUntil('exact visible source Markdown', async () => (await sourceText(page)) === expected)
}

async function setSource(page, markdown) {
  if (await page.getByTestId('editor-surface').getAttribute('data-mode') !== 'source') {
    await page.locator('[data-command-id="mode.source"]').click()
    await page.getByLabel('Markdown source').waitFor()
  }
  const current = await sourceText(page)
  if (current !== markdown) await page.getByLabel('Markdown source').fill(markdown)
  await expectSource(page, markdown)
  await waitForAutosave(page, markdown)
}

async function storedDocument(page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw === null ? null : JSON.parse(raw)
  }, DOCUMENT_KEY)
}

async function waitForAutosave(page, markdown) {
  await waitUntil('exact autosaved production Markdown', async () => {
    const envelope = await storedDocument(page)
    return envelope?.autosave?.markdown === markdown
  })
}

async function waitForSynchronized(page) {
  await waitUntil('visible synchronization completion', async () => (
    (await page.getByLabel('Workspace status').textContent())?.toLowerCase().includes('synchronized') === true
  ))
}

async function clickMenuCommand(page, menuId, commandId) {
  await page.locator(`[data-toolbar-menu="${menuId}"] .toolbar-menu__trigger`).click()
  await page.locator(`[data-command-id="${commandId}"]`).click()
}

async function commandControl(page, commandId) {
  const menuId = menuForCommand(commandId)
  if (menuId !== null) {
    await page.locator(`[data-toolbar-menu="${menuId}"] .toolbar-menu__trigger`).click()
  }
  const control = page.locator(`[data-command-id="${commandId}"]`)
  await control.waitFor()
  assert(await control.isEnabled(), `${commandId} was disabled during its production trial.`)
  return control
}

async function selectSource(page, selection) {
  const source = page.getByLabel('Markdown source')
  await source.click()
  await page.keyboard.press(selection === 'all' ? 'Control+A' : 'Control+End')
}

async function recordStep(report, category, action, operation) {
  const started = performance.now()
  await operation()
  report.steps.push({
    action,
    category,
    durationMs: Math.round((performance.now() - started) * 100) / 100,
    status: 'passed',
  })
  if (Object.hasOwn(report.coverage, category)) report.coverage[category] = 'passed'
}

async function setCaret(page, blockIndex, offset) {
  await page.locator('.ProseMirror').evaluate((editor, caret) => {
    const block = editor.querySelectorAll('.ordinary-block')[caret.blockIndex]
    const text = block?.firstChild
    if (!(text instanceof globalThis.Text)) throw new Error('Expected an ordinary text block for the caret trial.')
    const range = globalThis.document.createRange()
    range.setStart(text, caret.offset)
    range.collapse(true)
    const selection = globalThis.getSelection()
    if (selection === null) throw new Error('Browser selection is unavailable.')
    selection.removeAllRanges()
    selection.addRange(range)
    editor.dispatchEvent(new Event('focus'))
    editor.focus()
  }, { blockIndex, offset })
}

async function caret(page) {
  return page.locator('.ProseMirror').evaluate((editor) => {
    const selection = globalThis.getSelection()
    const anchor = selection?.anchorNode
    const block = anchor?.parentElement?.closest('.ordinary-block')
    if (selection === null || anchor === null || block === null || !editor.contains(block)) {
      throw new Error('Expected a caret inside an ordinary visual block.')
    }
    return { blockText: block.textContent ?? '', offset: selection.anchorOffset }
  })
}

async function selectAcrossBlocks(page) {
  return page.locator('.ProseMirror').evaluate((editor) => {
    const blocks = editor.querySelectorAll('.ordinary-block')
    const start = blocks[1]?.firstChild
    const end = blocks[2]?.firstChild
    if (!(start instanceof globalThis.Text) || !(end instanceof globalThis.Text)) throw new Error('Expected adjacent text blocks.')
    const range = globalThis.document.createRange()
    range.setStart(start, 2)
    range.setEnd(end, 3)
    const selection = globalThis.getSelection()
    if (selection === null) throw new Error('Browser selection is unavailable.')
    selection.removeAllRanges()
    selection.addRange(range)
    return selection.toString()
  })
}

async function closeCommandDialog(dialog, commandId, beginDrawioTeardown) {
  const closeName = commandId === 'insert.drawio'
    ? /Cancel draw\.io editing/u
    : commandId === 'document.word-count'
      ? /^Close$/u
      : /^Cancel$/u
  if (commandId === 'insert.drawio') beginDrawioTeardown()
  await dialog.getByRole('button', { name: closeName }).first().click()
  await dialog.waitFor({ state: 'hidden' })
}

async function runSingleCommand(page, commandId, beginDrawioTeardown) {
  await setSource(page, 'Alpha')
  if (ALL_SELECTION_COMMANDS.has(commandId)) await selectSource(page, 'all')
  else if (
    END_SELECTION_COMMANDS.has(commandId)
    || commandId.startsWith('mermaid.')
    || commandId.startsWith('chart.')
  ) await selectSource(page, 'end')

  if (commandId === 'history.undo' || commandId === 'history.redo') {
    await selectSource(page, 'all')
    await (await commandControl(page, 'text.bold')).click()
    await expectSource(page, '**Alpha**')
    if (commandId === 'history.redo') {
      await (await commandControl(page, 'history.undo')).click()
      await expectSource(page, 'Alpha')
    }
    await (await commandControl(page, commandId)).click()
    await expectSource(page, commandId === 'history.undo' ? 'Alpha' : '**Alpha**')
    return
  }

  if (commandId === 'text.color' || commandId === 'text.background') {
    await page.locator('[data-toolbar-menu="color"] .toolbar-menu__trigger').click()
    let dialog = page.locator('[data-picker-command="text.color"]')
    await dialog.waitFor()
    if (commandId === 'text.background') {
      await dialog.getByRole('tab', { name: 'Background', exact: true }).click()
      dialog = page.locator('[data-picker-command="text.background"]')
      await dialog.waitFor()
    }
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    await expectSource(page, 'Alpha')
    return
  }

  const control = await commandControl(page, commandId)
  if (Object.hasOwn(DOWNLOAD_FILENAMES, commandId)) {
    const pending = page.waitForEvent('download', { timeout: 45_000 })
    await control.click()
    const download = await pending
    assertEqual(download.suggestedFilename(), DOWNLOAD_FILENAMES[commandId], `${commandId} filename`)
    const downloadPath = await download.path()
    assert(downloadPath !== null, `${commandId} had no readable download path.`)
    if (commandId === 'export.pdf') {
      const pdf = await readFile(downloadPath)
      assertEqual(pdf.subarray(0, 5).toString('ascii'), '%PDF-', 'PDF header')
      assert(pdf.toString('latin1').trimEnd().endsWith('%%EOF'), 'PDF did not end with a valid EOF marker.')
      await waitUntil('PDF download status', async () => (
        (await page.locator('.status-region [role="status"]').textContent())?.includes('PDF revision') === true
      ))
    }
    return
  }

  await control.click()
  if (Object.hasOwn(MARKDOWN_OUTCOMES, commandId)) {
    await expectSource(page, MARKDOWN_OUTCOMES[commandId])
    return
  }
  if (Object.hasOwn(DIALOG_SELECTORS, commandId)) {
    const dialog = page.locator(DIALOG_SELECTORS[commandId])
    await dialog.waitFor()
    if (commandId === 'search.replace') {
      await dialog.locator('.search-dock__close').click()
      await dialog.waitFor({ state: 'hidden' })
      await expectSource(page, 'Alpha')
      return
    }
    await closeCommandDialog(dialog, commandId, beginDrawioTeardown)
    await expectSource(page, 'Alpha')
    return
  }
  if (commandId === 'insert.table') {
    const grid = page.getByRole('grid', { name: 'Table size' })
    await grid.waitFor()
    await grid.getByRole('gridcell', { name: '2 columns by 1 data row' }).click()
    await expectSource(page, 'Alpha\n\n| Header | Header |\n| ------ | ------ |\n| Sample | Sample |')
    return
  }
  if (commandId.startsWith('mermaid.')) {
    const keyword = {
      'mermaid.class': 'classDiagram',
      'mermaid.flowchart': 'flowchart LR',
      'mermaid.gantt': 'gantt',
      'mermaid.pie': 'pie title',
      'mermaid.sequence': 'sequenceDiagram',
      'mermaid.state': 'stateDiagram-v2',
    }[commandId]
    await waitUntil(`${commandId} starter`, async () => {
      const markdown = await sourceText(page)
      return markdown.startsWith('Alpha\n\n```mermaid\n') && markdown.includes(keyword)
    })
    return
  }
  if (commandId.startsWith('chart.')) {
    const type = commandId.slice('chart.'.length)
    await waitUntil(`${commandId} starter`, async () => (await sourceText(page)).includes(`| :${type}:`))
    return
  }
  if (commandId === 'document.manual-save') {
    await waitUntil('manual checkpoint clean state', async () => (
      (await page.getByLabel('Workspace status').textContent())?.includes('Manual checkpoint clean') === true
    ))
    return
  }
  if (commandId.startsWith('mode.')) {
    const expectedMode = commandId.slice('mode.'.length)
    await waitUntil(`${expectedMode} mode`, async () => (
      await page.getByTestId('editor-surface').getAttribute('data-mode') === expectedMode
    ))
    return
  }
  if (commandId === 'application.fullscreen') {
    await waitUntil('fullscreen entry', async () => page.evaluate(() => globalThis.document.fullscreenElement !== null))
    await page.locator('[data-command-id="application.fullscreen"]').click()
    await waitUntil('fullscreen exit', async () => page.evaluate(() => globalThis.document.fullscreenElement === null))
    return
  }
  if (commandId.startsWith('language.')) {
    const label = { 'language.en': 'Search', 'language.ru': 'Поиск', 'language.zh': '搜索' }[commandId]
    assert((await page.locator('[data-command-id="search.replace"]').textContent())?.includes(label) === true, `${commandId} did not localize the Search control.`)
    if (commandId !== 'language.en') await (await commandControl(page, 'language.en')).click()
    return
  }
  throw new Error(`No production hands-on outcome is defined for ${commandId}.`)
}

async function runCommandInventoryJourney(page, report, commandIds, beginDrawioTeardown) {
  await recordStep(report, 'commands', 'Exercise all 80 frozen public commands through their production controls', async () => {
    const controls = page.locator('[data-command-id]')
    assertEqual(await controls.count(), 80, 'Rendered public command count')
    for (const commandId of commandIds) {
      const started = performance.now()
      await runSingleCommand(page, commandId, beginDrawioTeardown)
      markPassed(report.inventory.commands, commandId, 'command')
      markComponents(report, componentsForCommand(commandId))
      report.steps.push({
        action: commandId,
        category: 'command',
        durationMs: Math.round((performance.now() - started) * 100) / 100,
        status: 'passed',
      })
    }
    assert(Object.values(report.inventory.commands).every((status) => status === 'passed'), 'Not every public command completed its production outcome.')
  })
}

async function runRealBrowserInputJourney(page, report) {
  await recordStep(report, 'realBrowserInput', 'Use native selection, a physical shortcut, and list Tab focus without a test seam', async () => {
    const source = page.getByLabel('Markdown source')
    await setSource(page, 'Shortcut target')
    await source.click()
    await page.keyboard.press('Control+A')
    assert(await page.evaluate(() => globalThis.getSelection()?.toString()) === 'Shortcut target', 'Native Source selection was not observable.')
    await page.keyboard.press('Control+b')
    await expectSource(page, '**Shortcut target**')
    await waitForAutosave(page, '**Shortcut target**')

    await setSource(page, '1. Parent\n2. Child')
    await page.locator('[data-command-id="mode.visual"]').click()
    const editor = page.locator('[data-testid="editor-surface"][data-mode="visual"] .ProseMirror')
    await editor.waitFor()
    await editor.locator('ol > li > p').filter({ hasText: 'Child' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Tab')
    await editor.locator('ol ol').waitFor()
    assert(await editor.evaluate((element) => element === globalThis.document.activeElement), 'List nesting lost Visual focus.')
    await waitForAutosave(page, '1. Parent\n   1. Child')
  })
}

async function runParityComponentJourney(page, report) {
  await recordStep(report, 'parityComponents', 'Inspect the remaining theme, Source, Visual, Final, inline-formula, and quote parity components', async () => {
    const markdown = '# Agent parity heading\n\n> Quoted parity text\n\nInline $x+y$ and `code`.'
    await setSource(page, markdown)
    markComponents(report, ['component.source-surface'])

    await page.locator('[data-command-id="mode.visual"]').click()
    const visual = page.locator('[data-testid="editor-surface"][data-mode="visual"] .ProseMirror')
    await visual.waitFor()
    assert(await visual.locator('h1').count() === 1, 'Visual heading parity node was absent.')
    assert(await visual.locator('blockquote').count() === 1, 'Visual quote parity node was absent.')
    assert(await visual.locator('[data-w-editor-node="formula"][data-formula-mode="inline"]').count() === 1, 'Visual inline-formula parity node was absent.')
    assert(await visual.locator('p code').count() === 1, 'Visual inline-code parity node was absent.')
    markComponents(report, [
      'component.heading',
      'component.inline-code',
      'component.inline-formula',
      'component.quote',
      'component.visual-surface',
    ])

    await page.locator('[data-command-id="mode.preview"]').click()
    const preview = page.locator('[data-testid="editor-surface"][data-mode="preview"] .preview-rendered-content')
    await preview.waitFor()
    assert(await preview.locator('blockquote').count() === 1, 'Final quote parity output was absent.')
    assert(await preview.locator('.formula-node--inline .katex').count() === 1, 'Final inline formula parity output was absent.')
    await page.locator('[data-command-id="mode.source"]').click()
    assertEqual(await sourceText(page), markdown, 'Preview inline-formula Markdown authority')
    await page.locator('[data-command-id="mode.preview"]').click()
    await preview.waitFor()
    markComponents(report, ['component.preview-surface'])

    await page.locator('[data-toolbar-menu="theme"] .toolbar-menu__trigger').click()
    await page.locator('[data-theme-option="abyss"]').click()
    assertEqual(await page.locator('.workspace-shell').getAttribute('data-theme'), 'abyss', 'Whole-workspace theme')
    const previewTheme = await preview.evaluate((element) => {
      const shell = element.closest('.workspace-shell')
      const content = element.querySelector('p') ?? element
      return {
        color: globalThis.getComputedStyle(content).color,
        shellClass: shell?.className ?? '',
        shellTheme: shell?.getAttribute('data-theme') ?? '',
      }
    })
    assertEqual(previewTheme.shellTheme, 'abyss', 'Preview inherited workspace theme')
    assert(previewTheme.shellClass.includes('theme__abyss'), 'Preview workspace lacked the abyss theme class.')
    assert(previewTheme.color.length > 0, 'Preview abyss content color was unavailable.')
    assertEqual(await page.evaluate(() => localStorage.getItem('w-editor:appearance-theme')), 'abyss', 'Persisted appearance theme')
    markComponents(report, ['component.appearance-theme'])

    const missing = Object.entries(report.inventory.parityComponents).filter(([, status]) => status !== 'passed')
    assert(missing.length === 0, `Parity components lacked hands-on evidence: ${missing.map(([id]) => id).join(', ')}.`)
  })
}

async function runFailureStateJourney(page, report) {
  await recordStep(report, 'failureStates', 'Exercise intrinsic panel, code, formula, and semantic-render failures with valid retry', async () => {
    const panelValid = '::: info Agent retry\nRecovered panel body.\n:::'
    await setSource(page, 'Alpha')
    await selectSource(page, 'end')
    await (await commandControl(page, 'panel.info')).click()
    let dialog = page.locator('[data-picker-command="panel.info"]')
    const invalidPanel = '::: info Missing body\n\n:::'
    await dialog.locator('#panel-source').fill(invalidPanel)
    await dialog.locator('.primary-action').click()
    await dialog.getByRole('alert').waitFor()
    assert(await dialog.locator('#panel-source').inputValue() === invalidPanel, 'Invalid panel draft was not retained.')
    await dialog.locator('#panel-source').fill(panelValid)
    await dialog.locator('.primary-action').click()
    await dialog.waitFor({ state: 'hidden' })
    await expectSource(page, `Alpha\n\n${panelValid}`)

    const codeBody = 'const agentRetry = true'
    await setSource(page, 'Alpha')
    await selectSource(page, 'end')
    await (await commandControl(page, 'insert.code-block')).click()
    dialog = page.locator('[data-editor-command="insert.code-block"]')
    await dialog.locator('#code-block-language').evaluate((element) => {
      if (!(element instanceof globalThis.HTMLSelectElement)) throw new TypeError('Code language control must be a select element.')
      const option = new globalThis.Option('unsafe language', 'unsafe language')
      element.add(option)
      element.value = 'unsafe language'
      element.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await dialog.locator('#code-block-source .cm-content').fill(codeBody)
    await dialog.locator('.primary-action').click()
    await dialog.getByRole('alert').waitFor()
    assert(await dialog.locator('#code-block-language').inputValue() === 'unsafe language', 'Invalid code language was not retained.')
    await dialog.locator('#code-block-language').selectOption('typescript')
    await dialog.locator('.primary-action').click()
    await dialog.waitFor({ state: 'hidden' })
    await expectSource(page, `Alpha\n\n\`\`\`typescript\n${codeBody}\n\`\`\``)

    await setSource(page, 'Alpha')
    await selectSource(page, 'end')
    await (await commandControl(page, 'insert.formula')).click()
    dialog = page.locator('[data-picker-command="insert.formula"]')
    await dialog.getByLabel('Formula source').fill('bad $$ close')
    await dialog.locator('.primary-action').click()
    await dialog.getByRole('alert').waitFor()
    assert((await dialog.getByRole('alert').textContent())?.includes('delimiter') === true, 'Invalid formula did not expose its delimiter error.')
    await dialog.getByLabel('Formula source').fill('E = mc^2')
    await dialog.locator('.primary-action').click()
    await dialog.waitFor({ state: 'hidden' })
    await expectSource(page, 'Alpha\n\n$$\nE = mc^2\n$$')

    await setSource(page, '```mermaid\nnot valid\n  preserved exactly\n```\n\nEditable sibling')
    await page.locator('[data-command-id="mode.visual"]').click()
    const mermaid = page.locator('[data-semantic-kind="mermaid"]')
    await waitUntil('local Mermaid error state', async () => await mermaid.getAttribute('data-preview-state') === 'error')
    assert((await mermaid.getByRole('alert').textContent())?.includes('Mermaid preview failed') === true, 'Invalid Mermaid did not remain a local semantic-node error.')
    assert((await page.locator('.ProseMirror').textContent())?.includes('Editable sibling') === true, 'A local Mermaid failure hid its editable sibling.')
  })
}

async function runRawRecoveryJourney(page, report) {
  await recordStep(report, 'rawRecovery', 'Inspect an unknown raw node, then export and explicitly reset a corrupt production envelope', async () => {
    const rawBlock = '::: mystery\nexact raw bytes  \n:::'
    await setSource(page, `${rawBlock}\n\nEditable raw sibling`)
    await page.locator('[data-command-id="mode.visual"]').click()
    const raw = page.locator('[data-w-editor-node="raw-block"]')
    await raw.waitFor()
    assertEqual(await raw.locator('.raw-node__source').textContent(), rawBlock, 'Raw-node source')
    await raw.getByRole('button', { name: 'Edit unknown block source' }).click()
    const rawDialog = page.locator('[data-editor-command="raw.source"]')
    await rawDialog.waitFor()
    await rawDialog.getByRole('button', { name: 'Cancel' }).click()
    await rawDialog.waitFor({ state: 'hidden' })

    await page.evaluate((key) => localStorage.setItem(key, '{not-json'), DOCUMENT_KEY)
    await page.reload({ waitUntil: 'domcontentloaded' })
    const recovery = page.getByTestId('startup-recovery')
    await recovery.waitFor({ timeout: 30_000 })
    assert(await page.locator('#markdown-source-editor').count() === 0, 'Corrupt storage exposed an editable surface before recovery.')
    const recoveryActions = recovery.locator(':scope > .startup-recovery__actions > button')
    const exportRaw = recoveryActions.nth(0)
    const reset = recoveryActions.nth(1)
    assert(await reset.isDisabled(), 'Recovery reset was enabled before raw export.')
    const pending = page.waitForEvent('download')
    await exportRaw.click()
    const download = await pending
    const path = await download.path()
    assert(path !== null, 'Raw recovery export had no local path.')
    assertEqual((await readFile(path)).toString('utf8'), '{not-json', 'Raw recovery export bytes')
    assert(await reset.isEnabled(), 'Recovery reset remained disabled after raw export.')
    await reset.click()
    let confirmation = page.getByTestId('startup-recovery-confirmation')
    await confirmation.locator('.startup-recovery__actions > button').nth(0).click()
    assertEqual(await page.evaluate((key) => localStorage.getItem(key), DOCUMENT_KEY), '{not-json', 'Cancelled recovery reset')
    await reset.click()
    confirmation = page.getByTestId('startup-recovery-confirmation')
    await confirmation.locator('.startup-recovery__actions > button').nth(1).click()
    await recovery.waitFor({ state: 'hidden' })
    await page.locator('[data-command-id="mode.source"]').click()
    await page.locator('#markdown-source-editor').waitFor()
    const restored = await page.evaluate((key) => localStorage.getItem(key), DOCUMENT_KEY)
    assert(JSON.parse(restored).schemaVersion === 1, 'Recovery reset did not restore a supported document envelope.')
  })
}

async function runEditingJourney(page, report) {
  const markdown = 'Keep\n\nAlpha\n\nBravo\n\nTail'
  const joined = 'Keep\n\nAlphaBravo\n\nTail'
  await setSource(page, markdown)

  await recordStep(report, 'persistence', 'Autosave exact Markdown and restore it after reload', async () => {
    await waitForAutosave(page, markdown)
  })

  await page.locator('[data-command-id="mode.visual"]').click()
  await page.locator('[data-testid="editor-surface"][data-mode="visual"] .ProseMirror').waitFor()
  await waitUntil('four ordinary visual blocks', async () => await page.locator('.ProseMirror .ordinary-block').count() === 4)

  await recordStep(report, 'wordLikeEditing', 'Exercise arrows, cross-block selection, Backspace, Delete, and joins', async () => {
    await setCaret(page, 1, 5)
    await page.keyboard.press('ArrowRight')
    await waitUntil('ArrowRight crossing a block boundary', async () => {
      const value = await caret(page)
      return value.blockText === 'Bravo' && value.offset === 0
    })
    await page.keyboard.press('ArrowLeft')
    await waitUntil('ArrowLeft crossing a block boundary', async () => {
      const value = await caret(page)
      return value.blockText === 'Alpha' && value.offset === 5
    })
    assertEqual(await selectAcrossBlocks(page), 'pha\n\nBra', 'Cross-block selection')

    await setCaret(page, 2, 0)
    await page.keyboard.press('Backspace')
    await waitUntil('Backspace joining adjacent blocks', async () => await page.locator('.ProseMirror .ordinary-block').count() === 3)
    assertEqual(await page.locator('.ProseMirror .ordinary-block').nth(1).textContent(), 'AlphaBravo', 'Backspace join')
    await waitForSynchronized(page)

    await page.locator('[data-command-id="history.undo"]').click()
    await waitUntil('visible visual Undo', async () => await page.locator('.ProseMirror .ordinary-block').count() === 4)
    await setCaret(page, 1, 5)
    await page.keyboard.press('Delete')
    await waitUntil('Delete joining adjacent blocks', async () => await page.locator('.ProseMirror .ordinary-block').count() === 3)
    assertEqual(await page.locator('.ProseMirror .ordinary-block').nth(1).textContent(), 'AlphaBravo', 'Delete join')
    await waitForSynchronized(page)
  })

  await recordStep(report, 'synchronization', 'Project the visual edit back to exact source Markdown', async () => {
    await page.locator('[data-command-id="mode.source"]').click()
    await expectSource(page, joined)
  })

  await recordStep(report, 'undoBoundaries', 'Verify source activation does not traverse the preceding visual native history', async () => {
    const undo = page.locator('[data-command-id="history.undo"]')
    if (!(await undo.isDisabled())) await undo.click()
    await expectSource(page, joined)
  })

  await recordStep(report, 'conversion', 'Traverse Visual, final Preview, and Source without hidden mutation', async () => {
    await page.locator('[data-command-id="mode.visual"]').click()
    await page.locator('[data-testid="editor-surface"][data-mode="visual"]').waitFor()
    await page.locator('[data-command-id="mode.preview"]').click()
    await page.locator('[data-testid="editor-surface"][data-mode="preview"] .preview-rendered-content').waitFor()
    assert((await page.locator('.preview-rendered-content').textContent())?.includes('AlphaBravo') === true, 'Final preview lost the joined paragraph.')
    await page.locator('[data-command-id="mode.source"]').click()
    await expectSource(page, joined)
  })

  await waitForAutosave(page, joined)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('html[data-w-editor-ready="true"]').waitFor({ timeout: 30_000 })
  await page.locator('[data-toolbar-menu="language"] .toolbar-menu__trigger').click()
  await page.locator('[data-command-id="language.en"]').click()
  await page.locator('[data-command-id="mode.source"]').click()
  await expectSource(page, joined)
}

async function runToolbarJourney(page, report) {
  await recordStep(report, 'toolbarFamilies', 'Exercise direct, history, format, structure, insert, draw, mode, document, search, and More families', async () => {
    await setSource(page, 'Alpha')
    await page.getByLabel('Markdown source').click()
    await page.keyboard.press('Control+A')
    await page.locator('[data-command-id="text.bold"]').click()
    await expectSource(page, '**Alpha**')
    await page.locator('[data-command-id="history.undo"]').click()
    await expectSource(page, 'Alpha')
    await page.locator('[data-command-id="history.redo"]').click()
    await expectSource(page, '**Alpha**')

    await setSource(page, 'Heading')
    await page.getByLabel('Markdown source').click()
    await page.keyboard.press('Control+A')
    await clickMenuCommand(page, 'heading', 'block.h2')
    await expectSource(page, '## Heading')

    await setSource(page, '')
    await clickMenuCommand(page, 'panel', 'panel.info')
    const panelDialog = page.locator('[data-picker-command="panel.info"]')
    await panelDialog.waitFor()
    await panelDialog.getByRole('button', { name: 'Apply', exact: true }).click()
    await waitUntil('panel insertion', async () => (await sourceText(page)).includes('::: info'))

    await page.locator('[data-command-id="document.manual-save"]').click()
    await waitUntil('manual checkpoint clean state', async () => (
      (await page.getByLabel('Workspace status').textContent())?.includes('Manual checkpoint clean') === true
    ))

    await page.locator('[data-command-id="search.replace"]').click()
    const search = page.getByRole('search', { name: 'Search this article' })
    await search.getByLabel('Search text').fill('Information')
    await search.getByRole('button', { name: 'Show replacement controls' }).click()
    await search.getByLabel('Replacement text').fill('Agent information')
    await search.getByRole('button', { name: 'Replace all', exact: true }).click()
    await search.locator('.search-dock__close').click()
    await waitUntil('search replacement', async () => (await sourceText(page)).includes('Agent information'))

    await page.locator('[data-command-id="settings.shortcuts"]').click()
    const settings = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await settings.getByRole('button', { name: 'Cancel', exact: true }).click()

    await page.locator('[data-command-id="application.fullscreen"]').click()
    await waitUntil('fullscreen entry', async () => page.evaluate(() => globalThis.document.fullscreenElement !== null))
    await page.locator('[data-command-id="application.fullscreen"]').click()
    await waitUntil('fullscreen exit', async () => page.evaluate(() => globalThis.document.fullscreenElement === null))

    await clickMenuCommand(page, 'language', 'language.zh')
    assert((await page.locator('[data-command-id="search.replace"]').textContent())?.includes('搜索') === true, 'Chinese toolbar localization did not apply.')
    await clickMenuCommand(page, 'language', 'language.ru')
    assert((await page.locator('[data-command-id="search.replace"]').textContent())?.includes('Поиск') === true, 'Russian toolbar localization did not apply.')
    await clickMenuCommand(page, 'language', 'language.en')

    await page.locator('[data-command-id="document.word-count"]').click()
    const statistics = page.getByTestId('word-count-dialog')
    await statistics.waitFor()
    assert(Number(await statistics.locator('[data-statistic="characters"]').textContent()) > 0, 'Word-count dialog did not report characters.')
    await statistics.getByRole('button', { name: 'Close', exact: true }).click()
  })

  await recordStep(report, 'semanticEditors', 'Edit panel, Mermaid, and chart-table semantic nodes through their dialogs', async () => {
    await page.locator('[data-command-id="mode.visual"]').click()
    const panel = page.locator('[data-semantic-kind="panel"]')
    await panel.locator('[data-semantic-edit="panel-editor"]').click()
    const panelDialog = page.locator('[data-picker-command="panel.info"]')
    await panelDialog.locator('#panel-source').fill('::: info Agent title\nAgent body\n:::')
    await panelDialog.getByRole('button', { name: 'Apply', exact: true }).click()
    await waitUntil('semantic panel update', async () => (await panel.textContent())?.includes('Agent title') === true)

    await setSource(page, '::: info Agent title\nAgent body\n:::\n\nAnchor')
    await page.locator('[data-command-id="mode.visual"]').click()
    await page.locator('.ProseMirror > p', { hasText: 'Anchor' }).click()
    await clickMenuCommand(page, 'mermaid', 'mermaid.flowchart')
    const mermaid = page.locator('[data-semantic-kind="mermaid"]')
    await mermaid.waitFor({ timeout: 15_000 })
    await mermaid.locator('[data-semantic-edit="mermaid-editor"]').click()
    const mermaidDialog = page.locator('[data-editor-command="mermaid.source"]')
    await mermaidDialog.waitFor()
    await mermaidDialog.getByRole('button', { name: 'Cancel', exact: true }).click()

    await page.locator('[data-command-id="mode.source"]').click()
    await setSource(page, `${await sourceText(page)}\n\nAgent chart anchor`)
    await page.getByLabel('Markdown source').locator('.cm-line').last().click()
    await page.keyboard.press('End')
    await page.locator('[data-toolbar-menu="chart"] .toolbar-menu__trigger').click()
    await waitUntil('Chart insertion to become compatible with the ordinary source selection', async () => (
      !(await page.locator('[data-command-id="chart.line"]').isDisabled())
    ))
    await page.locator('[data-command-id="chart.line"]').click()
    await page.locator('[data-command-id="mode.visual"]').click()
    const chart = page.locator('[data-semantic-kind="chart-table"]')
    await chart.waitFor({ timeout: 15_000 })
    await chart.click({ position: { x: 8, y: 8 } })
    await waitUntil('chart-table semantic selection', async () => await chart.getAttribute('data-selected') === 'true')
    await chart.locator('[data-semantic-edit="chart-table-editor"]').click()
    const chartDialog = page.locator('[data-editor-command="chart-table.editor"]')
    await chartDialog.getByLabel('Title').fill('Agent chart')
    await chartDialog.getByRole('button', { name: 'Apply', exact: true }).click()
    await waitUntil('semantic chart update', async () => (await chart.textContent())?.includes('Agent chart') === true)

    await page.locator('[data-command-id="mode.source"]').click()
    await clickMenuCommand(page, 'insert', 'insert.formula')
    const formula = page.locator('[data-picker-command="insert.formula"]')
    await formula.locator('#formula-source').fill('E = mc^2')
    await formula.getByRole('button', { name: 'Apply', exact: true }).click()
    await waitUntil('formula insertion', async () => (await sourceText(page)).includes('E = mc^2'))
  })
}

async function runLifecycleAndIntegrationJourney(page, report, beginDrawioTeardown) {
  const before = '# Before import\n\nKeep this checkpoint.'
  const imported = '# Agent imported Markdown\n\nExact UTF-8 input.\n'
  await setSource(page, before)
  await waitForAutosave(page, before)

  await recordStep(report, 'imports', 'Cancel and then confirm a UTF-8 Markdown import with a destructive checkpoint', async () => {
    const input = page.getByTestId('import-markdown-input')
    await input.setInputFiles({ buffer: Buffer.from('# Cancelled import'), mimeType: 'text/markdown', name: 'cancelled.md' })
    const confirmation = page.getByTestId('document-lifecycle-confirmation')
    await confirmation.getByTestId('document-lifecycle-cancel').click()
    await expectSource(page, before)

    await input.setInputFiles({ buffer: Buffer.from([0xff, 0xfe, 0x00]), mimeType: 'text/markdown', name: 'unreadable.md' })
    const importError = page.getByTestId('document-lifecycle-error')
    await importError.waitFor()
    assert((await importError.textContent())?.includes('not readable UTF-8 Markdown') === true, 'Unreadable import did not expose its bounded failure.')
    await expectSource(page, before)

    await input.setInputFiles({ buffer: Buffer.from(imported), mimeType: 'text/markdown', name: 'agent-import.md' })
    await confirmation.getByTestId('document-lifecycle-confirm').click()
    await expectSource(page, imported)
    await waitForAutosave(page, imported)
    const envelope = await storedDocument(page)
    assertEqual(envelope?.preDestructiveReplace?.markdown, before, 'Pre-destructive import checkpoint')
  })

  await recordStep(report, 'exports', 'Download exact Markdown, safe HTML, Word-compatible output, and a long PNG', async () => {
    const download = async (commandId) => {
      const pending = page.waitForEvent('download')
      await clickMenuCommand(page, 'export', commandId)
      return pending
    }
    const markdownDownload = await download('export.markdown')
    const markdownPath = await markdownDownload.path()
    assert(markdownPath !== null, 'Markdown export had no local download path.')
    assertEqual((await readFile(markdownPath)).toString('utf8'), imported, 'Markdown export bytes')

    const htmlDownload = await download('export.html')
    const htmlPath = await htmlDownload.path()
    assert(htmlPath !== null, 'HTML export had no local download path.')
    const html = (await readFile(htmlPath)).toString('utf8')
    assert(html.includes('<!doctype html>') && !/<script/iu.test(html), 'HTML export was not a safe standalone document.')

    const wordDownload = await download('export.word')
    const wordPath = await wordDownload.path()
    assert(wordPath !== null, 'Word export had no local download path.')
    const word = await readFile(wordPath)
    assertEqual([...word.subarray(0, 3)].join(','), '239,187,191', 'Word export UTF-8 BOM')

    const screenshotDownload = await download('export.screenshot')
    const screenshotPath = await screenshotDownload.path()
    assert(screenshotPath !== null, 'Screenshot export had no local download path.')
    const screenshot = await readFile(screenshotPath)
    assertEqual([...screenshot.subarray(0, 8)].join(','), '137,80,78,71,13,10,26,10', 'PNG signature')
    await expectSource(page, imported)
  })

  await recordStep(report, 'diagramsNetBoundary', 'Open/cancel a media integration and inspect the production same-origin draw.io bridge', async () => {
    await clickMenuCommand(page, 'insert', 'insert.image')
    const imageDialog = page.locator('[data-editor-command="insert.image"]')
    await imageDialog.waitFor()
    await imageDialog.getByRole('button', { name: 'Cancel', exact: true }).click()

    await page.locator('[data-command-id="insert.drawio"]').click()
    const drawioDialog = page.locator('[data-editor-command="insert.drawio"]')
    await drawioDialog.waitFor()
    const bridge = drawioDialog.getByTestId('drawio-bridge-frame')
    const bridgeUrl = new URL(await bridge.getAttribute('src'), BASE_URL)
    assertEqual(bridgeUrl.origin, BASE_URL, 'draw.io bridge origin')
    assertEqual(bridgeUrl.pathname, '/drawio-bridge.html', 'draw.io bridge path')
    const nestedSource = await page.frameLocator('[data-testid="drawio-bridge-frame"]').locator('#drawio-editor').getAttribute('src')
    const nestedUrl = new URL(nestedSource, BASE_URL)
    assertEqual(nestedUrl.origin, BASE_URL, 'draw.io editor origin')
    assertEqual(nestedUrl.pathname, '/vendor/cherry-drawio/drawio_demo.html', 'draw.io editor path')
    beginDrawioTeardown()
    await drawioDialog.getByRole('button', { name: 'Cancel draw.io editing' }).click()
  })
}

async function writeReport(report) {
  await mkdir(resolve('artifacts'), { recursive: true })
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
}

async function main() {
  await buildProduction()
  const inventories = await frozenInventories()
  const executablePath = await stableChromePath()
  const server = startProductionServer()
  const diagnostics = { expectedLocalRequestAborts: [], externalRequestFailures: [], localErrors: [] }
  let drawioTeardownDeadline = 0
  const report = {
    baseUrl: BASE_URL,
    browser: null,
    coverage: Object.fromEntries(COVERAGE_IDS.map((id) => [id, 'not-run'])),
    inventory: {
      requirementFamilies: passedInventory(inventories.requirementFamilyIds),
      commands: passedInventory(inventories.commandIds),
      parityComponents: passedInventory(inventories.parityComponentIds),
    },
    diagnostics,
    generatedAt: new Date().toISOString(),
    productionSeam: 'absent',
    schemaVersion: 1,
    status: 'failed',
    steps: [],
    trialMode: 'headed-stable-chrome-slow-production-ui',
  }
  let browser
  let context
  let page
  try {
    await waitForServer(server)
    browser = await chromium.launch({
      args: ['--disable-background-timer-throttling'],
      executablePath,
      headless: false,
      slowMo: 60,
    })
    report.browser = { executablePath, version: browser.version() }
    context = await browser.newContext({ acceptDownloads: true, viewport: { height: 900, width: 1440 } })
    await context.addInitScript(() => {
      globalThis.print = () => {
        globalThis.sessionStorage.setItem('w-editor-agent-print-invoked', 'true')
      }
    })
    page = await context.newPage()
    page.on('console', (message) => {
      if (message.type() === 'error') diagnostics.localErrors.push(`[console] ${message.text()}`)
    })
    page.on('pageerror', (error) => diagnostics.localErrors.push(`[pageerror] ${error.stack ?? error.message}`))
    page.on('requestfailed', (request) => {
      const entry = `${request.url()} ${request.failure()?.errorText ?? ''}`.trim()
      const expectedDrawioTeardown = Date.now() <= drawioTeardownDeadline
        && request.url().startsWith(`${BASE_URL}/vendor/cherry-drawio/`)
        && request.failure()?.errorText.includes('ERR_ABORTED') === true
      if (expectedDrawioTeardown) diagnostics.expectedLocalRequestAborts.push(entry)
      else if (request.url().startsWith(BASE_URL)) diagnostics.localErrors.push(`[requestfailed] ${entry}`)
      else diagnostics.externalRequestFailures.push(entry)
    })

    await ready(page)
    await runEditingJourney(page, report)
    await runRealBrowserInputJourney(page, report)
    await runCommandInventoryJourney(page, report, inventories.commandIds, () => { drawioTeardownDeadline = Date.now() + 5_000 })
    await runParityComponentJourney(page, report)
    await runToolbarJourney(page, report)
    await runFailureStateJourney(page, report)
    await runLifecycleAndIntegrationJourney(page, report, () => { drawioTeardownDeadline = Date.now() + 5_000 })
    await runRawRecoveryJourney(page, report)
    await page.screenshot({ fullPage: true, path: SCREENSHOT_PATH })
    assert(diagnostics.localErrors.length === 0, `Unexpected local production diagnostics:\n${diagnostics.localErrors.join('\n')}`)
    report.coverage.diagnostics = 'passed'
    await recordStep(report, 'requirementFamilies', 'Correlate completed production journeys to every OpenSpec requirement family', async () => {
      const incompleteCoverage = Object.entries(report.coverage).filter(([id, status]) => (
        id !== 'requirementFamilies' && status !== 'passed'
      ))
      assert(incompleteCoverage.length === 0, `Requirement-family synthesis found incomplete trial coverage: ${incompleteCoverage.map(([id]) => id).join(', ')}.`)
      for (const id of inventories.requirementFamilyIds) {
        markPassed(report.inventory.requirementFamilies, id, 'requirement family')
      }
    })
    assert(Object.values(report.coverage).every((status) => status === 'passed'), 'The production trial did not cover every required category.')
    assert(Object.values(report.inventory.requirementFamilies).every((status) => status === 'passed'), 'The production trial did not cover every requirement family.')
    assert(Object.values(report.inventory.commands).every((status) => status === 'passed'), 'The production trial did not cover all 80 commands.')
    assert(Object.values(report.inventory.parityComponents).every((status) => status === 'passed'), 'The production trial did not cover all 41 parity components.')
    report.status = 'passed'
  } catch (failure) {
    report.error = failure instanceof Error ? failure.stack ?? failure.message : String(failure)
    if (page !== undefined && !page.isClosed()) {
      await page.screenshot({ fullPage: true, path: FAILURE_SCREENSHOT_PATH }).catch(() => undefined)
    }
    throw failure
  } finally {
    await writeReport(report)
    await context?.close()
    await browser?.close()
    await stopServer(server)
  }
  console.log(`Headed production trial passed in Chrome ${report.browser.version}.`)
  console.log(`Production trial report: ${REPORT_PATH}`)
  console.log(`Production trial screenshot: ${SCREENSHOT_PATH}`)
}

await main()
