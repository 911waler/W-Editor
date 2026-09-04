import katex from 'katex'

import type { FormulaMode } from '@w-editor/editor-core'

export type SafeKatexRenderResult =
  | Readonly<{ status: 'ready'; html: string }>
  | Readonly<{ status: 'error'; html: string; message: string }>

const FALLBACK_MESSAGE = 'Formula rendering failed.'

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    switch (character) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      case "'":
        return '&#39;'
      default:
        return character
    }
  })
}

function createFallbackError(source: string, message: string): SafeKatexRenderResult {
  return Object.freeze({
    status: 'error' as const,
    html: `<span class="katex-error">${escapeHtml(source)}: ${escapeHtml(message)}</span>`,
    message,
  })
}

export function renderSafeKatex(
  mode: FormulaMode,
  source: string,
  ownerDocument: Document = document,
): SafeKatexRenderResult {
  try {
    const html = katex.renderToString(source, {
      displayMode: mode === 'block',
      output: 'htmlAndMathml',
      trust: false,
      maxSize: 20,
      maxExpand: 1000,
      throwOnError: false,
    })

    const parsed = ownerDocument.createElement('template')
    parsed.innerHTML = html
    const error = parsed.content.querySelector('.katex-error')
    if (error !== null) {
      const message = error.getAttribute('title')?.trim() || FALLBACK_MESSAGE
      return Object.freeze({ status: 'error' as const, html, message })
    }
    return Object.freeze({ status: 'ready' as const, html })
  } catch (error: unknown) {
    const message = error instanceof Error && error.message.length > 0
      ? error.message
      : FALLBACK_MESSAGE
    return createFallbackError(source, message)
  }
}
