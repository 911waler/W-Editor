/* global document, getComputedStyle, HTMLElement, window */

import { spawn } from 'node:child_process'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { resolve } from 'node:path'

import { chromium } from 'playwright'

const HOST = '127.0.0.1'
const PORT = Number(process.env.W_EDITOR_SYSTEM_BROWSER_PORT ?? 4183)
const BASE_URL = `http://${HOST}:${PORT}`
const REPORT_PATH = resolve(process.env.W_EDITOR_SYSTEM_BROWSER_REPORT ?? 'artifacts/system-browser-smoke.json')

function candidates() {
  if (process.platform === 'win32') {
    return {
      chrome: [
        process.env.ProgramFiles && resolve(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'),
        process.env['ProgramFiles(x86)'] && resolve(process.env['ProgramFiles(x86)'], 'Google/Chrome/Application/chrome.exe'),
        process.env.LOCALAPPDATA && resolve(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
      ],
      edge: [
        process.env.ProgramFiles && resolve(process.env.ProgramFiles, 'Microsoft/Edge/Application/msedge.exe'),
        process.env['ProgramFiles(x86)'] && resolve(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'),
        process.env.LOCALAPPDATA && resolve(process.env.LOCALAPPDATA, 'Microsoft/Edge/Application/msedge.exe'),
      ],
    }
  }
  if (process.platform === 'darwin') {
    return {
      chrome: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
      edge: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
    }
  }
  return {
    chrome: ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome'],
    edge: ['/usr/bin/microsoft-edge-stable', '/usr/bin/microsoft-edge'],
  }
}

async function firstExecutable(paths) {
  for (const path of paths.filter(Boolean)) {
    try {
      await access(path, constants.X_OK)
      return path
    } catch {
      // Continue through the stable-channel installation locations.
    }
  }
  return null
}

async function discoverStableBrowsers() {
  const browserCandidates = candidates()
  return Promise.all(Object.entries(browserCandidates).map(async ([name, paths]) => ({
    executablePath: await firstExecutable(paths),
    name,
  })))
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
  const collect = (chunk) => {
    output = `${output}${String(chunk)}`.slice(-12_000)
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  return { child, output: () => output }
}

async function waitForServer(server) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) {
      throw new Error(`Production preview exited before readiness.\n${server.output()}`)
    }
    try {
      const response = await fetch(BASE_URL)
      if (response.ok) return
    } catch {
      // The preview process is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200))
  }
  throw new Error(`Production preview did not become ready at ${BASE_URL}.\n${server.output()}`)
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

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function sourceMarkdown(page) {
  return page.locator('#markdown-source-editor').locator('.cm-line').evaluateAll((lines) =>
    lines.map((line) => line.textContent ?? '').join('\n'),
  )
}

async function waitForSourceMarkdown(page, expected) {
  await page.waitForFunction((expectedMarkdown) => {
    const lines = [...document.querySelectorAll('#markdown-source-editor .cm-line')]
    return lines.map((line) => line.textContent ?? '').join('\n') === expectedMarkdown
  }, expected, { timeout: 10_000 })
}

async function waitForSourceContaining(page, expectedFragment) {
  await page.waitForFunction((fragment) => {
    const lines = [...document.querySelectorAll('#markdown-source-editor .cm-line')]
    return lines.map((line) => line.textContent ?? '').join('\n').includes(fragment)
  }, expectedFragment, { timeout: 10_000 })
}

async function waitForPersistedMarkdown(page, expected) {
  await page.waitForFunction(({ key, markdown }) => {
    const raw = localStorage.getItem(key)
    if (raw === null) return false
    try {
      return JSON.parse(raw).autosave?.markdown === markdown
    } catch {
      return false
    }
  }, { key: 'w-editor:v1:document:welcome', markdown: expected }, { timeout: 10_000 })
}

async function waitForSynchronized(page) {
  await page.getByLabel('Workspace status').filter({ hasText: 'All changes synchronized' }).waitFor({ timeout: 10_000 })
}

async function enterSource(page, markdown) {
  if (await page.getByTestId('editor-surface').getAttribute('data-mode') !== 'source') {
    await page.locator('[data-command-id="mode.source"]').click()
  }
  const source = page.locator('#markdown-source-editor')
  const current = await sourceMarkdown(page)
  if (current !== markdown) await source.fill(markdown)
  await waitForSourceMarkdown(page, markdown)
  await waitForPersistedMarkdown(page, markdown)
  await waitForSynchronized(page)
  await page.waitForTimeout(250)
  return source
}

async function moveSourceCaretToEnd(page, source) {
  await source.click()
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+End`)
}

async function flushSourceThroughModeRoundTrip(page) {
  await page.locator('[data-command-id="mode.visual"]').click()
  await page.getByTestId('editor-surface').waitFor({ state: 'visible' })
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').waitFor()
  await waitForSynchronized(page)
}

async function openToolbarCommand(page, menuId, commandId) {
  await page.locator(`[data-toolbar-menu="${menuId}"] .toolbar-menu__trigger`).click()
  await page.locator(`[data-command-id="${commandId}"]`).click()
}

async function runJourney(discovered) {
  const started = performance.now()
  const diagnostics = []
  const journey = {
    productionSeamAbsent: false,
    selection: false,
    shortcut: false,
    italicSynthesis: false,
    listFocus: false,
    stickyToolbar: false,
    panelValid: false,
    panelInvalidRetry: false,
    codeValid: false,
    codeInvalidRetry: false,
    table: false,
    formula: false,
    toc: false,
    sourceVisualFinalConvergence: false,
    autosave: false,
    reload: false,
    diagnostics: false,
  }
  let browser
  try {
    browser = await chromium.launch({
      executablePath: discovered.executablePath,
      headless: true,
    })
    const actualVersion = browser.version()
    const context = await browser.newContext()
    const page = await context.newPage()
    page.on('console', (message) => {
      if (message.type() === 'error') diagnostics.push(`[console] ${message.text()}`)
    })
    page.on('pageerror', (error) => diagnostics.push(`[pageerror] ${error.stack ?? error.message}`))
    page.on('requestfailed', (request) => {
      if (request.url().startsWith(BASE_URL)) diagnostics.push(`[requestfailed] ${request.url()} ${request.failure()?.errorText ?? ''}`)
    })

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
    await page.locator('html[data-w-editor-ready="true"]').waitFor({ timeout: 30_000 })
    journey.productionSeamAbsent = await page.evaluate(() => !('__W_EDITOR_AUTHORITY__' in globalThis))
    assert(journey.productionSeamAbsent, 'The system-browser runner received an E2E build instead of the production build.')
    await page.locator('[data-toolbar-menu="language"] .toolbar-menu__trigger').click()
    await page.locator('[data-command-id="language.en"]').click()

    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
    let source = await enterSource(page, 'Shortcut target')
    await source.click()
    await page.keyboard.press(`${modifier}+a`)
    journey.selection = await page.evaluate(() => window.getSelection()?.toString() === 'Shortcut target')
    assert(journey.selection, 'The source surface did not expose the real keyboard selection.')
    await page.keyboard.press(`${modifier}+b`)
    await waitForSourceMarkdown(page, '**Shortcut target**')
    await waitForPersistedMarkdown(page, '**Shortcut target**')
    await waitForSynchronized(page)
    journey.shortcut = await sourceMarkdown(page) === '**Shortcut target**'
    assert(journey.shortcut, 'The default physical bold shortcut did not transform the live source selection.')

    source = await enterSource(page, '中文斜体')
    await source.click()
    await page.keyboard.press(`${modifier}+a`)
    await page.keyboard.press(`${modifier}+i`)
    await waitForSourceMarkdown(page, '*中文斜体*')
    await waitForPersistedMarkdown(page, '*中文斜体*')
    await waitForSynchronized(page)
    await page.getByRole('button', { exact: true, name: 'Visual' }).click()
    const synthesizedItalic = page.locator('[data-testid="editor-surface"][data-mode="visual"] .ProseMirror em')
    await synthesizedItalic.waitFor({ timeout: 20_000 })
    journey.italicSynthesis = await synthesizedItalic.evaluate((element) => {
      const style = getComputedStyle(element)
      return element.textContent === '中文斜体'
        && style.fontStyle === 'italic'
        && style.fontSynthesis === 'style'
    })
    assert(journey.italicSynthesis, 'Chinese italic content did not allow synthesized slanted glyphs.')

    source = await enterSource(page, '1. Parent\n2. Child')
    await page.getByRole('button', { exact: true, name: 'Visual' }).click()
    const visualEditor = page.locator('[data-testid="editor-surface"][data-mode="visual"] .ProseMirror')
    await visualEditor.waitFor({ timeout: 20_000 })
    const childItem = visualEditor.locator('ol > li > p').filter({ hasText: 'Child' })
    await childItem.click()
    await page.keyboard.press('End')
    await page.keyboard.press('Tab')
    await visualEditor.locator('ol ol').waitFor({ timeout: 10_000 })
    journey.listFocus = await visualEditor.locator('ol ol').count() === 1 && await visualEditor.evaluate((editor) => editor === document.activeElement)
    assert(journey.listFocus, 'Real list nesting did not preserve Visual editor focus.')

    await page.evaluate(() => {
      const spacer = document.createElement('div')
      spacer.dataset['systemBrowserScrollSpacer'] = 'true'
      spacer.style.height = '600px'
      document.body.prepend(spacer)
      window.scrollTo(0, 800)
    })
    const toolbar = page.getByRole('toolbar', { name: 'W-Editor toolbar' })
    await page.waitForFunction(() => {
      const current = document.querySelector('[role="toolbar"][aria-label="W-Editor toolbar"]')
      return current instanceof HTMLElement && Math.abs(current.getBoundingClientRect().top) <= 1
    }, undefined, { timeout: 10_000 })
    journey.stickyToolbar = await toolbar.evaluate((element) => (
      Math.abs(element.getBoundingClientRect().top) <= 1 && getComputedStyle(element).position === 'sticky'
    ))
    assert(journey.stickyToolbar, 'The real toolbar did not remain sticky during page scroll.')
    await page.evaluate(() => {
      document.querySelector('[data-system-browser-scroll-spacer="true"]')?.remove()
      window.scrollTo(0, 0)
    })

    const panelValidSource = '::: info Stable information\nStable panel body.\n:::'
    source = await enterSource(page, 'Alpha')
    await moveSourceCaretToEnd(page, source)
    await flushSourceThroughModeRoundTrip(page)
    source = page.locator('#markdown-source-editor')
    await moveSourceCaretToEnd(page, source)
    await openToolbarCommand(page, 'panel', 'panel.info')
    let panelDialog = page.locator('[data-picker-command="panel.info"]')
    await panelDialog.waitFor()
    await panelDialog.locator('#panel-source').fill(panelValidSource)
    await panelDialog.locator('.primary-action').click()
    await panelDialog.waitFor({ state: 'hidden' })
    await waitForSourceMarkdown(page, `Alpha\n\n${panelValidSource}`)
    journey.panelValid = await sourceMarkdown(page) === `Alpha\n\n${panelValidSource}`
    assert(journey.panelValid, 'A valid panel draft did not apply through the production dialog.')

    source = await enterSource(page, 'Alpha')
    await moveSourceCaretToEnd(page, source)
    await openToolbarCommand(page, 'panel', 'panel.info')
    panelDialog = page.locator('[data-picker-command="panel.info"]')
    const invalidPanelSource = '::: info Missing body\n\n:::'
    await panelDialog.locator('#panel-source').fill(invalidPanelSource)
    await panelDialog.locator('.primary-action').click()
    const panelAlert = panelDialog.getByRole('alert')
    await panelAlert.waitFor()
    const panelRetryRetained = await panelDialog.isVisible()
      && await panelDialog.locator('#panel-source').inputValue() === invalidPanelSource
      && (await panelAlert.textContent())?.includes('one complete Info panel source') === true
      && await panelDialog.locator('.primary-action').isEnabled()
    await panelDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await panelDialog.waitFor({ state: 'hidden' })
    source = await enterSource(page, 'Alpha')
    await moveSourceCaretToEnd(page, source)
    await flushSourceThroughModeRoundTrip(page)
    source = page.locator('#markdown-source-editor')
    await moveSourceCaretToEnd(page, source)
    await openToolbarCommand(page, 'panel', 'panel.info')
    panelDialog = page.locator('[data-picker-command="panel.info"]')
    await panelDialog.locator('#panel-source').fill(panelValidSource)
    await panelDialog.locator('.primary-action').click()
    await panelDialog.waitFor({ state: 'hidden' })
    await waitForSourceMarkdown(page, `Alpha\n\n${panelValidSource}`)
    journey.panelInvalidRetry = panelRetryRetained && await sourceMarkdown(page) === `Alpha\n\n${panelValidSource}`
    assert(journey.panelInvalidRetry, 'An invalid panel draft did not stay open and succeed after a valid retry.')

    const codeBody = 'const updated = true\nconsole.log(updated)'
    const codeSource = `\`\`\`typescript\n${codeBody}\n\`\`\``
    source = await enterSource(page, 'Alpha')
    await moveSourceCaretToEnd(page, source)
    await flushSourceThroughModeRoundTrip(page)
    source = page.locator('#markdown-source-editor')
    await moveSourceCaretToEnd(page, source)
    await openToolbarCommand(page, 'insert', 'insert.code-block')
    let codeDialog = page.locator('[data-editor-command="insert.code-block"]')
    await codeDialog.waitFor()
    await codeDialog.locator('#code-block-language').selectOption('typescript')
    await codeDialog.locator('#code-block-source .cm-content[contenteditable="true"]').fill(codeBody)
    await codeDialog.locator('.primary-action').click()
    await codeDialog.waitFor({ state: 'hidden' })
    await waitForSourceMarkdown(page, `Alpha\n\n${codeSource}`)
    journey.codeValid = await sourceMarkdown(page) === `Alpha\n\n${codeSource}`
    assert(journey.codeValid, 'A valid code draft did not apply through the production dialog.')

    source = await enterSource(page, 'Alpha')
    await moveSourceCaretToEnd(page, source)
    await flushSourceThroughModeRoundTrip(page)
    source = page.locator('#markdown-source-editor')
    await moveSourceCaretToEnd(page, source)
    await openToolbarCommand(page, 'insert', 'insert.code-block')
    codeDialog = page.locator('[data-editor-command="insert.code-block"]')
    await codeDialog.locator('#code-block-language').evaluate((element) => {
      if (!(element instanceof globalThis.HTMLSelectElement)) throw new TypeError('Code language control must be a select element.')
      const option = new globalThis.Option('unsafe language', 'unsafe language')
      element.add(option)
      element.value = 'unsafe language'
      element.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await codeDialog.locator('#code-block-source .cm-content[contenteditable="true"]').fill(codeBody)
    await codeDialog.locator('.primary-action').click()
    const codeAlert = codeDialog.getByRole('alert')
    await codeAlert.waitFor()
    const codeRetryRetained = await codeDialog.isVisible()
      && await codeDialog.locator('#code-block-language').inputValue() === 'unsafe language'
      && await codeDialog.locator('#code-block-source .cm-content[contenteditable="true"] .cm-line').evaluateAll((lines) => lines.map((line) => line.textContent ?? '').join('\n')) === codeBody
      && (await codeAlert.textContent())?.includes('single safe identifier') === true
      && await codeDialog.locator('.primary-action').isEnabled()
    await codeDialog.locator('#code-block-language').selectOption('typescript')
    await codeDialog.locator('.primary-action').click()
    await codeDialog.waitFor({ state: 'hidden' })
    await waitForSourceMarkdown(page, `Alpha\n\n${codeSource}`)
    journey.codeInvalidRetry = codeRetryRetained && await sourceMarkdown(page) === `Alpha\n\n${codeSource}`
    assert(journey.codeInvalidRetry, 'An invalid code draft did not stay open and succeed after a valid retry.')

    source = await enterSource(page, 'Alpha')
    await moveSourceCaretToEnd(page, source)
    await flushSourceThroughModeRoundTrip(page)
    source = page.locator('#markdown-source-editor')
    await moveSourceCaretToEnd(page, source)
    await openToolbarCommand(page, 'insert', 'insert.table')
    const tableGrid = page.getByRole('grid', { name: 'Table size' })
    await tableGrid.waitFor()
    await tableGrid.getByRole('gridcell', { name: '2 columns by 2 data rows' }).click()
    await waitForSourceContaining(page, '| Header | Header |')
    const tableMarkdown = await sourceMarkdown(page)
    journey.table = tableMarkdown.startsWith('Alpha\n\n| Header | Header |')
      && tableMarkdown.split('\n').filter((line) => line.startsWith('|')).length === 4
    assert(journey.table, 'The real table size picker did not insert the selected 2-by-2 table.')

    source = await enterSource(page, 'Alpha')
    await moveSourceCaretToEnd(page, source)
    await flushSourceThroughModeRoundTrip(page)
    source = page.locator('#markdown-source-editor')
    await moveSourceCaretToEnd(page, source)
    await openToolbarCommand(page, 'insert', 'insert.formula')
    const formulaDialog = page.locator('[data-picker-command="insert.formula"]')
    await formulaDialog.waitFor()
    await formulaDialog.getByLabel('Formula source').fill('a^2 + b^2 = c^2')
    await formulaDialog.locator('.primary-action').click()
    await formulaDialog.waitFor({ state: 'hidden' })
    const formulaBlockSource = 'Alpha\n\n$$\na^2 + b^2 = c^2\n$$'
    await waitForSourceMarkdown(page, formulaBlockSource)
    await waitForPersistedMarkdown(page, formulaBlockSource)
    journey.formula = await sourceMarkdown(page) === formulaBlockSource
    assert(journey.formula, 'The formula picker did not insert the valid default block formula.')

    await enterSource(page, '[[toc]]\n\n# Heading')
    await page.getByRole('button', { exact: true, name: 'Visual' }).click()
    const toc = page.locator('[data-testid="editor-surface"][data-mode="visual"] [data-w-editor-node="toc"]')
    await toc.waitFor({ timeout: 20_000 })
    journey.toc = await toc.getByRole('link', { name: 'Heading', exact: true }).count() === 1
    assert(journey.toc, 'The generated Visual table of contents did not link to the heading.')

    const markdown = [
      `# ${discovered.name} stable system smoke`,
      '',
      '[[toc]]',
      '',
      '## Section',
      '',
      '1. Parent',
      '   1. Child',
      '',
      panelValidSource,
      '',
      codeSource,
      '',
      '| Column 1 | Column 2 |',
      '| --- | --- |',
      '| Cell 1 | Cell 2 |',
      '',
      'Inline $a^2 + b^2 = c^2$.',
    ].join('\n')
    await enterSource(page, markdown)
    await page.getByLabel('Workspace status').filter({ hasText: 'Autosave saved' }).waitFor({ timeout: 10_000 })
    journey.autosave = await page.evaluate(({ key, markdown: expectedMarkdown }) => {
      const raw = localStorage.getItem(key)
      return raw !== null && JSON.parse(raw).autosave?.markdown === expectedMarkdown
    }, { key: 'w-editor:v1:document:welcome', markdown })
    assert(journey.autosave, 'Autosave did not persist the exact system-browser smoke Markdown.')

    await page.getByRole('button', { name: 'Visual', exact: true }).click()
    const finalVisual = page.locator('[data-testid="editor-surface"][data-mode="visual"] .ProseMirror')
    await finalVisual.waitFor({ timeout: 20_000 })
    const visualConverged = (await finalVisual.textContent())?.includes(`${discovered.name} stable system smoke`) === true
      && await finalVisual.locator('[data-w-editor-node="toc"]').count() === 1
      && await finalVisual.locator('[data-w-editor-node="code-block"]').count() === 1
      && await finalVisual.locator('[data-w-editor-node="ordinary-table"]').count() === 1
      && await finalVisual.locator('[data-w-editor-node="formula"]').count() === 1

    await page.locator('[data-command-id="mode.preview"]').click()
    const finalPreview = page.locator('[data-testid="editor-surface"][data-mode="preview"] .preview-rendered-content')
    await finalPreview.waitFor({ timeout: 20_000 })
    const previewText = await finalPreview.textContent()
    const previewConverged = previewText?.includes(`${discovered.name} stable system smoke`) === true
      && previewText.includes('Stable panel body.')
      && previewText.includes('const updated = true')
      && previewText.includes('Cell 1')
    journey.sourceVisualFinalConvergence = visualConverged && previewConverged
    assert(journey.sourceVisualFinalConvergence, 'Source, Visual, and Final did not converge on the comprehensive production document.')

    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('html[data-w-editor-ready="true"]').waitFor({ timeout: 30_000 })
    await page.locator('[data-toolbar-menu="language"] .toolbar-menu__trigger').click()
    await page.locator('[data-command-id="language.en"]').click()
    await page.locator('[data-command-id="mode.source"]').click()
    await page.locator('#markdown-source-editor').waitFor()
    const reloaded = await page.evaluate((key) => {
      const raw = localStorage.getItem(key)
      return raw === null ? null : JSON.parse(raw).autosave?.markdown
    }, 'w-editor:v1:document:welcome')
    journey.reload = reloaded === markdown && await sourceMarkdown(page) === markdown
    assert(journey.reload, 'Reload did not restore the exact system-browser smoke document.')
    journey.diagnostics = diagnostics.length === 0
    assert(journey.diagnostics, `Unexpected browser diagnostics:\n${diagnostics.join('\n')}`)

    await context.close()
    return {
      actualVersion,
      durationMs: Math.round((performance.now() - started) * 100) / 100,
      executablePath: discovered.executablePath,
      journey,
      name: discovered.name,
      status: 'passed',
    }
  } catch (failure) {
    return {
      actualVersion: browser?.version() ?? null,
      durationMs: Math.round((performance.now() - started) * 100) / 100,
      error: failure instanceof Error ? failure.stack ?? failure.message : String(failure),
      executablePath: discovered.executablePath,
      journey,
      name: discovered.name,
      status: 'failed',
    }
  } finally {
    await browser?.close()
  }
}

async function writeReport(report) {
  await mkdir(resolve('artifacts'), { recursive: true })
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
}

async function main() {
  await buildProduction()
  const discovered = await discoverStableBrowsers()
  const missing = discovered.filter((browser) => browser.executablePath === null)
  if (missing.length > 0) {
    const report = {
      baseUrl: BASE_URL,
      generatedAt: new Date().toISOString(),
      platform: process.platform,
      results: discovered.map((browser) => ({ ...browser, status: browser.executablePath === null ? 'missing' : 'not-run' })),
      schemaVersion: 1,
    }
    await writeReport(report)
    throw new Error(`Stable system browser installations were not found: ${missing.map((browser) => browser.name).join(', ')}.`)
  }

  const server = startProductionServer()
  let results
  try {
    await waitForServer(server)
    results = []
    for (const browser of discovered) results.push(await runJourney(browser))
  } finally {
    await stopServer(server)
  }
  const failures = results.filter((result) => result.status !== 'passed')
  const report = {
    baseUrl: BASE_URL,
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    results,
    schemaVersion: 1,
    status: failures.length === 0 ? 'passed' : 'failed',
  }
  await writeReport(report)
  if (failures.length > 0) {
    throw new Error(`System-browser smoke failed: ${failures.map((failure) => `${failure.name}: ${failure.error}`).join('\n')}`)
  }
  for (const result of results) {
    console.log(`${result.name} ${result.actualVersion}: passed (${result.durationMs} ms)`)
  }
  console.log(`System-browser smoke report: ${REPORT_PATH}`)
}

await main()
