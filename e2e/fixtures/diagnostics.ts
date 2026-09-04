import type { BrowserContext, ConsoleMessage, Page, Request, Response, TestInfo } from '@playwright/test'

export type BrowserDiagnosticKind = 'console' | 'pageerror' | 'requestfailed' | 'response'

export interface BrowserDiagnostic {
  readonly kind: BrowserDiagnosticKind
  readonly message: string
  readonly url: string
}

const REQUIRED_RESOURCE_TYPES = new Set(['document', 'script', 'stylesheet', 'fetch', 'xhr'])

export function isRequiredApplicationRequest(
  resourceType: string,
  requestUrl: string,
  baseURL = 'http://127.0.0.1:4173',
): boolean {
  if (!REQUIRED_RESOURCE_TYPES.has(resourceType)) return false
  try {
    return new URL(requestUrl).origin === new URL(baseURL).origin
  } catch {
    return false
  }
}

function recordConsole(message: ConsoleMessage, diagnostics: BrowserDiagnostic[]): void {
  if (message.type() !== 'error') return
  diagnostics.push({
    kind: 'console',
    message: message.text(),
    url: message.location().url,
  })
}

function observePage(page: Page, diagnostics: BrowserDiagnostic[]): void {
  page.on('console', (message) => recordConsole(message, diagnostics))
  page.on('pageerror', (error) => {
    diagnostics.push({ kind: 'pageerror', message: error.stack ?? error.message, url: page.url() })
  })
}

function recordFailedRequest(request: Request, diagnostics: BrowserDiagnostic[], baseURL: string): void {
  if (!isRequiredApplicationRequest(request.resourceType(), request.url(), baseURL)) return
  diagnostics.push({
    kind: 'requestfailed',
    message: request.failure()?.errorText ?? 'request failed without an error string',
    url: request.url(),
  })
}

function recordFailedResponse(response: Response, diagnostics: BrowserDiagnostic[], baseURL: string): void {
  const request = response.request()
  if (response.status() < 400) return
  if (!isRequiredApplicationRequest(request.resourceType(), response.url(), baseURL)) return
  diagnostics.push({
    kind: 'response',
    message: `HTTP ${response.status()} ${response.statusText()}`,
    url: response.url(),
  })
}

export async function monitorBrowserDiagnostics(
  context: BrowserContext,
  baseURL: string,
  testInfo: TestInfo,
  use: () => Promise<void>,
): Promise<void> {
  const diagnostics: BrowserDiagnostic[] = []
  const onPage = (page: Page): void => observePage(page, diagnostics)
  const onRequestFailed = (request: Request): void => recordFailedRequest(request, diagnostics, baseURL)
  const onResponse = (response: Response): void => recordFailedResponse(response, diagnostics, baseURL)

  context.pages().forEach(onPage)
  context.on('page', onPage)
  context.on('requestfailed', onRequestFailed)
  context.on('response', onResponse)

  try {
    await use()
  } finally {
    context.off('page', onPage)
    context.off('requestfailed', onRequestFailed)
    context.off('response', onResponse)
  }

  if (diagnostics.length > 0) {
    await testInfo.attach('unexpected-browser-diagnostics.json', {
      body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
      contentType: 'application/json',
    })
    throw new Error(`Unexpected browser diagnostics:\n${diagnostics
      .map((diagnostic) => `[${diagnostic.kind}] ${diagnostic.message} (${diagnostic.url})`)
      .join('\n')}`)
  }
}
