import { describe, expect, it, vi } from 'vitest'

import {
  mountWEditor,
  normalizePublicError,
  type WEditorErrorCode,
} from '../../packages/editor-web/src/index'

describe('stable Web public error categories', () => {
  it.each([
    ['AUTH_REQUIRED', ['login']],
    ['AUTHORIZATION_DENIED', ['cancel']],
    ['CSRF_REJECTED', ['retry', 'login']],
    ['SAVE_FAILED', ['retry', 'export']],
    ['REVISION_CONFLICT', ['reload', 'export', 'save-as', 'authorized-overwrite']],
    ['UPLOAD_UNAVAILABLE', ['configure-upload']],
    ['ASSET_MISSING', ['inspect-asset']],
    ['INCOMPATIBLE_HOST', ['configure-host']],
  ] as const)('classifies %s independently with action hints', (code, actions) => {
    const error = normalizePublicError(Object.assign(new Error(code), { code }), 'SAVE_FAILED')
    expect(error).toMatchObject({ code, actionHints: actions })
    expect(Object.isFrozen(error)).toBe(true)
  })

  it('does not collapse authentication, authorization, and CSRF failures', () => {
    const codes: WEditorErrorCode[] = ['AUTH_REQUIRED', 'AUTHORIZATION_DENIED', 'CSRF_REJECTED']
    expect(codes.map((code) => normalizePublicError({ code, message: code }).code)).toEqual(codes)
  })

  it('blocks dirty destroy until the host explicitly confirms data handling', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const instance = mountWEditor(container, { document: { documentId: 'article-1', markdown: '# Initial' } })
    const source = container.querySelector<HTMLTextAreaElement>('textarea')!
    source.value = '# Unsaved'
    source.dispatchEvent(new Event('input', { bubbles: true }))

    const blocked = await instance.destroy()
    expect(blocked).toMatchObject({
      error: { actionHints: ['save', 'export', 'cancel'], code: 'DESTROY_BLOCKED' },
      status: 'blocked',
    })
    expect(container.querySelector('[data-w-editor-instance]')).not.toBeNull()
    expect(instance.exportMarkdown()).toBe('# Unsaved')

    const confirm = vi.fn(() => true)
    await expect(instance.destroy({ confirm })).resolves.toEqual({ status: 'destroyed' })
    expect(confirm).toHaveBeenCalledOnce()
    expect(container.childElementCount).toBe(0)
    container.remove()
  })
})
