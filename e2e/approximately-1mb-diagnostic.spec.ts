import { Buffer } from 'node:buffer'
import { stat, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { resolve } from 'node:path'

import type { Page, TestInfo } from '@playwright/test'

import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

const FIXTURE_PATH = resolve('e2e/fixtures/documents/approximately-1mb.md')

interface LargeDocumentDiagnostic {
  error: string | null
  fixtureBytes: number
  recordedAt: string
  status: 'completed' | 'diagnostic-error'
  timingsMs: Record<string, number>
}

async function authority(page: Page) {
  return page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read())
}

async function recordDiagnostic(testInfo: TestInfo, report: LargeDocumentDiagnostic): Promise<void> {
  const body = Buffer.from(`${JSON.stringify(report, null, 2)}\n`)
  await writeFile(resolve('test-results/approximately-1mb-timing.json'), body)
  await testInfo.attach('approximately-1mb-timing.json', {
    body,
    contentType: 'application/json',
  })
  testInfo.annotations.push({
    description: report.status === 'completed'
      ? `1 MB timing recorded: ${JSON.stringify(report.timingsMs)}`
      : `1 MB diagnostic error recorded without a latency gate: ${report.error ?? 'unknown error'}`,
    type: 'large-document-diagnostic',
  })
}

async function measure(timings: Record<string, number>, label: string, action: () => Promise<void>): Promise<void> {
  const started = performance.now()
  await action()
  timings[label] = Math.round((performance.now() - started) * 100) / 100
}

test('approximately 1 MB document records non-blocking source lifecycle timings without a latency assertion', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  const fixtureBytes = (await stat(FIXTURE_PATH)).size
  const report: LargeDocumentDiagnostic = {
    error: null,
    fixtureBytes,
    recordedAt: new Date().toISOString(),
    status: 'completed',
    timingsMs: {},
  }

  try {
    await measure(report.timingsMs, 'startup', async () => openReadyApp(page))
    await measure(report.timingsMs, 'confirmedImportToAuthority', async () => {
      await page.getByTestId('import-markdown-input').setInputFiles(FIXTURE_PATH)
      await page.getByTestId('document-lifecycle-confirm').click()
      await expect.poll(async () => (await authority(page))?.revision, { timeout: 90_000 }).toBe(1)
    })

    await page.locator('[data-command-id="mode.source"]').click()
    const editor = page.locator('#markdown-source-editor')
    await measure(report.timingsMs, 'sourceTailAppendToAuthority', async () => {
      await editor.focus()
      await editor.press('Control+End')
      await page.keyboard.insertText('\nDiagnostic-only tail append.')
      await expect.poll(async () => (await authority(page))?.revision, { timeout: 60_000 }).toBe(2)
    })
    await measure(report.timingsMs, 'pagehidePersistenceFlush', async () => {
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
      await expect.poll(async () => (await authority(page))?.autosaveStatus, { timeout: 60_000 }).toBe('saved')
    })
    await measure(report.timingsMs, 'reloadToReadyAuthority', async () => {
      await page.reload()
      await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true', { timeout: 90_000 })
      await expect.poll(async () => (await authority(page))?.revision, { timeout: 90_000 }).toBe(2)
    })
  } catch (failure) {
    report.status = 'diagnostic-error'
    report.error = failure instanceof Error ? failure.stack ?? failure.message : String(failure)
  } finally {
    await recordDiagnostic(testInfo, report)
  }
})
