import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { chromium } from 'playwright'

const HOST = '127.0.0.1'
const PORT = 4186
const BASE_URL = `http://${HOST}:${PORT}`
const OUTPUT_ROOT = resolve('tests/fixtures/parity/current-visual-references')
const MANIFEST_PATH = resolve('tests/fixtures/parity/visual-reference-manifest.json')
const REVIEWED_REFERENCE_MANIFEST = 'tests/fixtures/parity/reference-baseline-manifest.json'
const THEMES = Object.freeze(['default', 'dark', 'gray', 'abyss', 'green', 'red', 'violet', 'blue'])
const VIEWPORT = Object.freeze({ height: 1000, width: 1440 })
const FIXTURE = 'apps/playground/src/content/articles/welcome.md'
const TOLERANCE = Object.freeze({ maxDiffPixelRatio: 0, threshold: 0 })
const args = process.argv.slice(2)
const reviewIndex = args.indexOf('--review-evidence')
const reviewEvidence = reviewIndex === -1 ? '' : args[reviewIndex + 1] ?? ''
const replaceReviewed = args.includes('--replace-reviewed')

if (reviewEvidence.trim().length === 0) {
  throw new Error('--review-evidence is required for a current local reference freeze.')
}

async function waitFor(label, probe, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const result = await probe()
      if (result) return result
    } catch (error) {
      lastError = error
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error(`Timed out waiting for ${label}.${lastError instanceof Error ? ` ${lastError.message}` : ''}`)
}

function startPreviewServer() {
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

async function stopPreviewServer(server) {
  if (server === null || server.child.exitCode !== null) return
  server.child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolvePromise) => server.child.once('exit', resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 3_000)),
  ])
  if (server.child.exitCode === null) server.child.kill('SIGKILL')
}

async function waitForServer(server) {
  await waitFor('production preview server', async () => {
    if (server.child.exitCode !== null) throw new Error(server.output())
    try {
      return (await fetch(BASE_URL)).ok
    } catch {
      return false
    }
  }, 30_000)
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function main() {
  const existing = existsSync(OUTPUT_ROOT) ? await readdir(OUTPUT_ROOT) : []
  if (existing.length > 0 && !replaceReviewed) {
    throw new Error(`Current local reference files already exist; pass --replace-reviewed with review evidence to replace them: ${OUTPUT_ROOT}`)
  }
  await mkdir(OUTPUT_ROOT, { recursive: true })

  const server = startPreviewServer()
  const browser = await chromium.launch({ headless: true })
  const captureRecords = []
  const behaviorSnapshots = []
  const captureCss = `
    *, *::before, *::after {
      animation-delay: 0s !important;
      animation-duration: 0s !important;
      caret-color: transparent !important;
      transition-delay: 0s !important;
      transition-duration: 0s !important;
    }
  `

  try {
    await waitForServer(server)
    const seam = execFileSync(process.execPath, ['scripts/verify-e2e-build-seam.mjs', 'absent'], { encoding: 'utf8' }).trim()
    const browserVersion = browser.version()
    const reviewed = JSON.parse(readFileSync(REVIEWED_REFERENCE_MANIFEST, 'utf8'))

    for (const theme of THEMES) {
      const context = await browser.newContext({
        colorScheme: theme === 'dark' || theme === 'abyss' ? 'dark' : 'light',
        deviceScaleFactor: 1,
        locale: 'zh-CN',
        viewport: VIEWPORT,
      })
      const page = await context.newPage()
      await page.goto(`${BASE_URL}/?reference-theme=${theme}`, { waitUntil: 'domcontentloaded' })
      await page.locator('html[data-w-editor-ready="true"]').waitFor({ timeout: 60_000 })
      await page.locator('.workspace-shell').waitFor({ state: 'visible', timeout: 60_000 })
      await page.locator('[data-toolbar-menu="theme"] .toolbar-menu__trigger').click()
      await page.locator(`[data-theme-option="${theme}"]`).click()
      await page.locator(`.workspace-shell[data-theme="${theme}"]`).waitFor({ state: 'visible' })
      await page.addStyleTag({ content: captureCss })
      await page.evaluate(async () => globalThis.document.fonts?.ready)
      await page.waitForTimeout(250)
      await page.locator('[data-toolbar-menu="line-spacing"] .toolbar-menu__trigger').click()
      const lineSpacingIds = await page.locator('[data-line-spacing-option]').evaluateAll((options) => options.map((option) => option.getAttribute('data-line-spacing-option')))
      await page.keyboard.press('Escape')
      const behavior = await page.evaluate(() => {
        const ownerDocument = globalThis.document
        const shell = ownerDocument.querySelector('.workspace-shell')
        const elements = [...ownerDocument.querySelectorAll('[data-command-id]')]
        const commandIds = [...new Set(elements.map((element) => element.dataset['commandId']).filter((id) => typeof id === 'string'))]
        const selectors = ['.workspace-shell', '.toolbar-region', '.editor-surface', '.visual-surface', '.status-region']
        const fontFamilies = [...new Set(selectors
          .map((selector) => ownerDocument.querySelector(selector))
          .filter((element) => element !== null)
          .map((element) => globalThis.getComputedStyle(element).fontFamily))]
        return {
          commandIds,
          componentCounts: Object.fromEntries(selectors.map((selector) => [selector, ownerDocument.querySelectorAll(selector).length])),
          dpr: globalThis.devicePixelRatio,
          fontFamilies,
          modeIds: [...ownerDocument.querySelectorAll('[data-command-id^="mode."]')].map((element) => element.dataset['commandId']),
          shellTheme: shell?.dataset['theme'] ?? null,
          themeOptionIds: [...ownerDocument.querySelectorAll('[data-theme-option]')].map((element) => element.dataset['themeOption']),
          viewport: { height: globalThis.innerHeight, width: globalThis.innerWidth },
        }
      })
      behaviorSnapshots.push({ theme, lineSpacingIds, ...behavior })

      const regions = [
        ['workspace', '.workspace-shell'],
        ['toolbar', '.toolbar-region'],
        ['editor-surface', '.editor-surface'],
        ['status', '.status-region'],
      ]
      for (const [regionId, selector] of regions) {
        const localPath = `tests/fixtures/parity/current-visual-references/${theme}-${regionId}.png`
        const absolutePath = resolve(localPath)
        await page.locator(selector).screenshot({ animations: 'disabled', path: absolutePath })
        captureRecords.push({
          animationControls: 'All CSS animations and transitions disabled; caret hidden before capture.',
          baselineReviewEvidence: reviewEvidence,
          browser: 'Playwright bundled Chromium',
          browserVersion,
          captureDate: new Date().toISOString().slice(0, 10),
          dpr: 1,
          fixture: FIXTURE,
          fonts: behavior.fontFamilies,
          id: `${theme}-${regionId}`,
          localPath,
          masks: [],
          ownership: `Current W-Editor ${regionId} local baseline for theme ${theme}.`,
          screenshotRegion: selector,
          sha256: await sha256(absolutePath),
          sourceUrl: 'repository://dist production preview',
          theme,
          timeControls: 'Clock-independent current playground seed; capture after document.fonts.ready and fixed 250 ms settle.',
          tolerance: TOLERANCE,
          viewport: VIEWPORT,
        })
      }
      await context.close()
    }

    const manifest = {
      schemaVersion: 1,
      manifestType: 'w-editor-current-visual-reference-freeze',
      capturedAt: new Date().toISOString(),
      productBaselineCommit: '39dddc311f0afb23339b4bba6d816fcfb285ef91',
      currentHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      browser: 'Playwright bundled Chromium',
      browserVersion,
      viewport: VIEWPORT,
      dpr: 1,
      fixture: FIXTURE,
      reviewedReferenceManifest: {
        path: REVIEWED_REFERENCE_MANIFEST,
        pixelCanonicalEngine: reviewed.pixelCanonicalEngine,
        assetIds: reviewed.assets.map(({ id }) => id),
        unreviewedRerecordingForbidden: reviewed.unreviewedRerecordingForbidden,
      },
      pagesAndComponents: [
        { id: 'workspace', selector: '.workspace-shell', purpose: 'full current application shell and theme surface' },
        { id: 'toolbar', selector: '.toolbar-region', purpose: '80-command toolbar, menus, sticky geometry and theme entry' },
        { id: 'editor-surface', selector: '.editor-surface', purpose: 'active Source/Visual/Final surface boundary' },
        { id: 'status', selector: '.status-region', purpose: 'synchronization, autosave, checkpoint and mode status' },
      ],
      themes: THEMES,
      captures: captureRecords,
      behaviorSnapshots,
      seamEvidence: seam,
      approvalRules: {
        replaceRequires: ['explicit approved behavior/visual contract change', 'review evidence string', 'new capture metadata and SHA-256', 'affected focused/full gates rerun from earliest changed input'],
        forbidden: ['test mismatch as review evidence', 'unreviewed overwrite', 'masking a changed product region to preserve a pass', 'changing tolerance to make a mismatch green'],
        reviewer: 'User or explicitly authorized release reviewer; no automatic refresh.',
        externalAssetBoundary: 'Existing reviewed upstream assets remain immutable; this manifest freezes repository-local current W-Editor output only.',
      },
      sourceInputs: [
        'tests/fixtures/manifests/feature-manifest.json',
        REVIEWED_REFERENCE_MANIFEST,
        'docs/reference-baseline.md',
        FIXTURE,
        'tests/fixtures/parity/w-editor-parity-state.json',
      ],
    }
    await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify({ status: 'passed', manifestPath: 'tests/fixtures/parity/visual-reference-manifest.json', captures: captureRecords.length, themes: THEMES.length }, null, 2))
  } finally {
    await browser.close()
    await stopPreviewServer(server)
  }
}

await main()
