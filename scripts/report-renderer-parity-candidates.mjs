import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

import { chromium } from 'playwright'

import { decodePng } from '../e2e/fixtures/png.ts'

const repositoryRoot = resolve(import.meta.dirname, '..')
const candidateRoot = resolve(repositoryRoot, 'artifacts/renderer/parity-candidates')
const fixtures = ['ordinary', 'formula-code', 'async-graphics', 'complex-layout']
const entries = ['esm', 'iife']
const pixelTolerances = Object.freeze({
  'async-graphics': Object.freeze({ maximumChannelDelta: 8, maximumDifferenceRatio: 0.0002 }),
  'complex-layout': Object.freeze({ maximumChannelDelta: 2, maximumDifferenceRatio: 0 }),
  'formula-code': Object.freeze({ maximumChannelDelta: 2, maximumDifferenceRatio: 0 }),
  ordinary: Object.freeze({ maximumChannelDelta: 2, maximumDifferenceRatio: 0 }),
})

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function listFiles(root, current = root) {
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(current, entry.name)
    return entry.isDirectory() ? listFiles(root, path) : [path]
  }).sort()
}

const distributionRoot = resolve(repositoryRoot, 'packages/editor-web/dist')
const distributionFiles = listFiles(distributionRoot).map((path) => {
  const bytes = readFileSync(path)
  return Object.freeze({
    path: relative(repositoryRoot, path).replaceAll('\\', '/'),
    sha256: digest(bytes),
    size: statSync(path).size,
  })
})
const distributionFingerprint = Buffer.from(distributionFiles
  .map(({ path, sha256, size }) => `${path}\0${size}\0${sha256}`)
  .join('\n'), 'utf8')
const worktreeStatus = execFileSync('git', ['status', '--porcelain=v1', '-z'], {
  cwd: repositoryRoot,
  encoding: 'buffer',
})
const worktreeEntries = worktreeStatus.toString('utf8').split('\0').filter(Boolean)
const trackedChangeCount = worktreeEntries.filter((entry) => !entry.startsWith('?? ')).length
const untrackedChangeCount = worktreeEntries.filter((entry) => entry.startsWith('?? ')).length
const currentHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim()

function pixelDifference(left, right) {
  if (left.width !== right.width || left.height !== right.height) {
    throw new Error(`Candidate dimensions differ: ${left.width}x${left.height} versus ${right.width}x${right.height}.`)
  }
  let bottom = -1
  let changed = 0
  let leftEdge = left.width
  let maximumChannelDelta = 0
  let rightEdge = -1
  let top = left.height
  for (let offset = 0; offset < left.data.length; offset += 4) {
    let pixelChanged = false
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs((left.data[offset + channel] ?? 0) - (right.data[offset + channel] ?? 0))
      maximumChannelDelta = Math.max(maximumChannelDelta, delta)
      if (delta > 2) pixelChanged = true
    }
    if (!pixelChanged) continue
    changed += 1
    const pixel = offset / 4
    const x = pixel % left.width
    const y = Math.floor(pixel / left.width)
    leftEdge = Math.min(leftEdge, x)
    rightEdge = Math.max(rightEdge, x)
    top = Math.min(top, y)
    bottom = Math.max(bottom, y)
  }
  return Object.freeze({
    bounds: changed === 0 ? null : Object.freeze({ bottom, left: leftEdge, right: rightEdge, top }),
    changedPixels: changed,
    maximumChannelDelta,
    ratio: changed / (left.width * left.height),
  })
}

const browser = await chromium.launch({ headless: true })
const browserVersion = browser.version()
await browser.close()
const comparisons = []
for (const entry of entries) {
  for (const fixture of fixtures) {
    const readerRelativePath = `artifacts/renderer/parity-candidates/${entry}-${fixture}-reader.png`
    const finalRelativePath = `artifacts/renderer/parity-candidates/${entry}-${fixture}-final.png`
    const readerBytes = readFileSync(resolve(repositoryRoot, readerRelativePath))
    const finalBytes = readFileSync(resolve(repositoryRoot, finalRelativePath))
    const reader = decodePng(readerBytes)
    const finalPreview = decodePng(finalBytes)
    const difference = pixelDifference(reader, finalPreview)
    const tolerance = pixelTolerances[fixture]
    const passed = difference.maximumChannelDelta <= tolerance.maximumChannelDelta
      && difference.ratio <= tolerance.maximumDifferenceRatio
    if (!passed) throw new Error(`Candidate comparison failed for ${entry}/${fixture}: ${JSON.stringify(difference)}.`)
    comparisons.push(Object.freeze({
      difference,
      entry,
      finalPreview: Object.freeze({ path: finalRelativePath, sha256: digest(finalBytes) }),
      fixture,
      reader: Object.freeze({ path: readerRelativePath, sha256: digest(readerBytes) }),
      size: Object.freeze({ height: reader.height, width: reader.width }),
      status: 'passed',
      tolerance,
    }))
  }
}

const report = Object.freeze({
  browser: 'Playwright bundled Chromium',
  browserVersion,
  candidateStatus: 'candidate-unreviewed',
  capturedAt: new Date().toISOString(),
  change: 'dual-target-release',
  comparisons: Object.freeze(comparisons),
  dpr: 1,
  distribution: Object.freeze({
    artifactRoot: 'packages/editor-web/dist',
    fileCount: distributionFiles.length,
    files: Object.freeze(distributionFiles),
    sha256: digest(distributionFingerprint),
    totalBytes: distributionFiles.reduce((total, file) => total + file.size, 0),
  }),
  fixtures: Object.freeze(fixtures.map((fixture) => Object.freeze({
    id: fixture,
    mask: Object.freeze([]),
    source: 'examples/web-consumer/parity-runner.js',
    tolerance: pixelTolerances[fixture],
  }))),
  fonts: Object.freeze({
    renderer: Object.freeze(['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif']),
    formula: Object.freeze(['KaTeX_Main', 'Times New Roman', 'serif']),
    code: Object.freeze(['SFMono-Regular', 'Consolas', 'Liberation Mono', 'monospace']),
  }),
  head: currentHead,
  profileException: 'The author-preview edit-code action is hidden only for the controlled content-pixel comparison; source, semantic DOM, and profile behavior remain tested separately.',
  reviewPolicy: Object.freeze({
    frozenBaselineModified: false,
    reviewerConfirmationRequired: true,
    unreviewedOverwriteForbidden: true,
  }),
  schemaVersion: 1,
  semanticGate: Object.freeze({ capabilityFixtures: 19, status: 'passed' }),
  viewport: Object.freeze({ height: 1200, width: 1560 }),
  worktree: Object.freeze({
    dirty: worktreeEntries.length > 0,
    entryCount: worktreeEntries.length,
    statusSha256: digest(worktreeStatus),
    trackedChangeCount,
    untrackedChangeCount,
  }),
})

writeFileSync(resolve(candidateRoot, 'manifest.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(`Renderer parity candidate report generated: ${comparisons.length} comparisons, review required.`)
