import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { chromium } from 'playwright'

const REVIEW_FLAG = '--review-evidence'
const REPLACE_FLAG = '--replace-reviewed'
const args = process.argv.slice(2)
const reviewFlagIndex = args.indexOf(REVIEW_FLAG)
const reviewEvidence = reviewFlagIndex === -1 ? undefined : args[reviewFlagIndex + 1]
const replaceReviewed = args.includes(REPLACE_FLAG)

if (reviewEvidence === undefined || reviewEvidence.trim().length === 0) {
  throw new Error(`${REVIEW_FLAG} is required; unreviewed reference recording is forbidden.`)
}

const outputRoot = resolve('tests/fixtures/parity/reference')
const outputPaths = Object.freeze({
  cherryComponents: resolve(outputRoot, 'cherry-components.png'),
  cherryFormulaPicker: resolve(outputRoot, 'cherry-formula-picker.png'),
  cherryPanelPicker: resolve(outputRoot, 'cherry-panel-picker.png'),
  cherryTablePicker: resolve(outputRoot, 'cherry-table-picker.png'),
  cherryToolbar: resolve(outputRoot, 'cherry-toolbar-main-right.png'),
  tiptapCode: resolve(outputRoot, 'tiptap-notion-like-code.png'),
  tiptapTable: resolve(outputRoot, 'tiptap-table-node.png'),
  tiptapVisual: resolve(outputRoot, 'tiptap-notion-like-visual.png'),
})

await mkdir(outputRoot, { recursive: true })

if (!replaceReviewed) {
  const { existsSync } = await import('node:fs')
  const existing = Object.values(outputPaths).filter((path) => existsSync(path))
  if (existing.length > 0) {
    throw new Error(`Reviewed assets already exist; pass ${REPLACE_FLAG} with new review evidence to replace them: ${existing.join(', ')}`)
  }
}

const browser = await chromium.launch({ headless: true })
const captureCss = `
  *, *::before, *::after {
    animation-delay: 0s !important;
    animation-duration: 0s !important;
    caret-color: transparent !important;
    transition-delay: 0s !important;
    transition-duration: 0s !important;
  }
`

async function settle(page) {
  await page.addStyleTag({ content: captureCss })
  await page.evaluate(async () => globalThis.document.fonts?.ready)
  await page.waitForTimeout(250)
}

try {
  const cherryContext = await browser.newContext({
    colorScheme: 'light',
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    viewport: { height: 1000, width: 1440 },
  })
  const cherryPage = await cherryContext.newPage()
  await cherryPage.goto('https://tencent.github.io/cherry-markdown/examples/index.html', {
    timeout: 120_000,
    waitUntil: 'networkidle',
  })
  await cherryPage.locator('.cherry-toolbar').waitFor({ state: 'visible' })
  await settle(cherryPage)
  await cherryPage.locator('.cherry-toolbar').screenshot({
    animations: 'disabled',
    path: outputPaths.cherryToolbar,
  })

  const parityMarkdown = await readFile(resolve('tests/fixtures/parity/w-editor-parity.md'), 'utf8')
  await cherryPage.evaluate((markdown) => {
    const cherry = globalThis.cherry
    if (typeof cherry?.setValue !== 'function') throw new Error('Cherry reference instance is unavailable')
    cherry.setValue(markdown)
  }, parityMarkdown)
  await cherryPage.waitForTimeout(750)
  await settle(cherryPage)
  await cherryPage.locator('.cherry-previewer').evaluate((element) => { element.scrollTop = 0 })
  await cherryPage.locator('.cherry-previewer').screenshot({
    animations: 'disabled',
    path: outputPaths.cherryComponents,
  })

  await cherryPage.locator('.toolbar-left .cherry-toolbar-tips').click()
  await cherryPage.locator('.cherry-dropdown:visible').screenshot({
    animations: 'disabled',
    path: outputPaths.cherryPanelPicker,
  })
  await cherryPage.keyboard.press('Escape')
  await cherryPage.locator('body').click({ position: { x: 1200, y: 800 } })

  await cherryPage.locator('.toolbar-left .cherry-toolbar-insertFormula').click()
  await cherryPage.locator('.cherry-insert-formula-wrappler:visible').screenshot({
    animations: 'disabled',
    path: outputPaths.cherryFormulaPicker,
  })
  await cherryPage.keyboard.press('Escape')
  await cherryPage.locator('body').click({ position: { x: 1200, y: 800 } })

  await cherryPage.locator('.toolbar-left .cherry-toolbar-insert').click()
  await cherryPage.locator('.cherry-dropdown:visible .cherry-dropdown-item[title="表格"]').click()
  await cherryPage.locator('.cherry-insert-table-menu:visible').screenshot({
    animations: 'disabled',
    path: outputPaths.cherryTablePicker,
  })
  await cherryContext.close()

  const tiptapContext = await browser.newContext({
    colorScheme: 'light',
    deviceScaleFactor: 1,
    locale: 'en-US',
    viewport: { height: 1000, width: 1440 },
  })
  const notionPage = await tiptapContext.newPage()
  await notionPage.goto('https://template.tiptap.dev/notion-like', {
    timeout: 120_000,
    waitUntil: 'domcontentloaded',
  })
  await notionPage.locator('.ProseMirror').waitFor({ state: 'visible', timeout: 120_000 })
  await notionPage.waitForTimeout(3_000)
  await settle(notionPage)
  await notionPage.locator('.ProseMirror').screenshot({
    animations: 'disabled',
    path: outputPaths.tiptapVisual,
  })
  await notionPage.locator('.ProseMirror pre').first().screenshot({
    animations: 'disabled',
    path: outputPaths.tiptapCode,
  })

  const tablePage = await tiptapContext.newPage()
  await tablePage.goto('https://tiptap.dev/docs/ui-components/node-components/table-node', {
    timeout: 120_000,
    waitUntil: 'domcontentloaded',
  })
  const tableFrame = tablePage.frames().find((frame) => frame.url().includes('/preview/tiptap-node/table-node'))
    ?? await tablePage.waitForEvent('framenavigated', {
      predicate: (frame) => frame.url().includes('/preview/tiptap-node/table-node'),
      timeout: 120_000,
    })
  await tableFrame.locator('.ProseMirror').waitFor({ state: 'visible', timeout: 120_000 })
  await tableFrame.locator('td').first().click()
  await tableFrame.waitForTimeout(250)
  await tableFrame.addStyleTag({ content: captureCss })
  await tableFrame.evaluate(async () => globalThis.document.fonts?.ready)
  await tableFrame.locator('body').screenshot({
    animations: 'disabled',
    path: outputPaths.tiptapTable,
  })
  await tiptapContext.close()

  console.log(JSON.stringify({
    browser: await browser.version(),
    outputs: outputPaths,
    reviewEvidence,
  }, null, 2))
} finally {
  await browser.close()
}
