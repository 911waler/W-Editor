import '@w-editor/editor-web/styles.css'

import { createNwuMockHost, type NwuMockHost, type NwuVisibility } from './mockNwuHost'
import type { WEditorErrorEvent, WEditorInstance, WRendererInstance } from '@w-editor/editor-web'

export { createNwuMockHost }
export * from './mockNwuHost'

export const NWU_HOST_PACKAGE = '@w-editor/nwu-host' as const

interface NwuBootstrap {
  readonly documentId: string
  readonly markdown: string
  readonly serverRevision: string
  readonly userId: string
  readonly visibility: NwuVisibility
}

export interface NwuHostPage {
  readonly editor: WEditorInstance
  readonly host: NwuMockHost
  readonly reader: WRendererInstance
  destroy(): Promise<void>
}

function readBootstrap(ownerDocument: Document): NwuBootstrap {
  const node = ownerDocument.querySelector('[data-nwu-bootstrap]')
  if (!(node instanceof HTMLScriptElement)) throw new Error('Jinja NWU bootstrap is missing.')
  const value = JSON.parse(node.textContent ?? '') as Partial<NwuBootstrap>
  if (typeof value.documentId !== 'string' || typeof value.markdown !== 'string' || typeof value.serverRevision !== 'string' || typeof value.userId !== 'string' || !isNwuVisibility(value.visibility)) {
    throw new Error('Jinja NWU bootstrap is invalid.')
  }
  return Object.freeze({
    documentId: value.documentId,
    markdown: value.markdown,
    serverRevision: value.serverRevision,
    userId: value.userId,
    visibility: value.visibility,
  })
}

function renderShell(ownerDocument: Document): Readonly<{
  readonly app: HTMLElement
  readonly editor: HTMLElement
  readonly reader: HTMLElement
  readonly result: HTMLElement
  readonly requestLog: HTMLElement
  readonly status: HTMLElement
}> {
  const app = ownerDocument.querySelector<HTMLElement>('#app')
  if (app === null) throw new Error('NWU host mount root is missing.')
  app.innerHTML = `
    <main data-nwu-reference-host>
      <header>
        <p>Framework-free NWU reference host</p>
        <h1>W-Editor Web Distribution contract fixture</h1>
        <p data-nwu-status data-nwu-status-value="booting">Booting Jinja session…</p>
      </header>
      <nav aria-label="NWU host actions" data-nwu-actions>
        <button data-nwu-action="edit" type="button">Append edit</button>
        <button data-nwu-action="autosave" type="button">Autosave draft</button>
        <button data-nwu-action="manual-save" type="button">Save version</button>
        <button data-nwu-action="save-workspace" type="button">Save workspace</button>
        <button data-nwu-action="reopen" type="button">Reopen</button>
        <button data-nwu-action="recover" type="button">Recover draft</button>
        <button data-nwu-action="discard" type="button">Discard draft</button>
        <button data-nwu-action="export" type="button">Export draft</button>
        <button data-nwu-action="expire-auth" type="button">Expire auth</button>
        <button data-nwu-action="restore-auth" type="button">Restore auth</button>
        <button data-nwu-action="rotate-csrf" type="button">Rotate CSRF</button>
        <button data-nwu-action="refresh-csrf" type="button">Refresh CSRF</button>
        <button data-nwu-action="force-conflict" type="button">Force conflict</button>
        <button data-nwu-action="authorized-save" type="button">Authorized overwrite</button>
        <button data-nwu-action="fail-next-save" type="button">Fail next save</button>
        <button data-nwu-action="set-form-data" type="button">Use FormData</button>
        <button data-nwu-action="set-json" type="button">Use JSON</button>
        <button data-nwu-action="set-dark-theme" type="button">Set dark theme</button>
        <button data-nwu-action="reset-theme" type="button">Reset theme</button>
        <button data-nwu-action="retry" type="button">Retry</button>
      </nav>
      <section data-nwu-panels>
        <article><h2>Editor</h2><div data-nwu-editor></div></article>
        <article><h2>Reader</h2><div data-nwu-reader></div></article>
      </section>
      <pre data-nwu-result aria-live="polite"></pre>
      <pre data-nwu-export aria-label="Exported draft"></pre>
      <pre data-nwu-request-log aria-label="NWU request log"></pre>
    </main>`
  const editor = app.querySelector<HTMLElement>('[data-nwu-editor]')
  const reader = app.querySelector<HTMLElement>('[data-nwu-reader]')
  const result = app.querySelector<HTMLElement>('[data-nwu-result]')
  const requestLog = app.querySelector<HTMLElement>('[data-nwu-request-log]')
  const status = app.querySelector<HTMLElement>('[data-nwu-status]')
  if (editor === null || reader === null || result === null || requestLog === null || status === null) throw new Error('NWU host shell is incomplete.')
  return Object.freeze({ app, editor, reader, requestLog, result, status })
}

function setStatus(status: HTMLElement, value: string): void {
  status.textContent = value
  status.dataset['nwuStatusValue'] = value
}

function appendEvent(result: HTMLElement, event: Readonly<Record<string, unknown>>): void {
  const existing = result.textContent
  const entries = existing === null || existing.length === 0 ? [] : JSON.parse(existing) as unknown[]
  entries.push(event)
  result.textContent = JSON.stringify(entries)
}

function renderRequestLog(host: NwuMockHost, requestLog: HTMLElement): void {
  requestLog.textContent = JSON.stringify(host.requests)
}

export function bootNwuHost(ownerDocument: Document = document): NwuHostPage {
  const bootstrap = readBootstrap(ownerDocument)
  const shell = renderShell(ownerDocument)
  const host = createNwuMockHost({
    documentId: bootstrap.documentId,
    initialMarkdown: bootstrap.markdown,
    serverRevision: bootstrap.serverRevision,
    userId: bootstrap.userId,
    visibility: bootstrap.visibility,
  })
  let editor!: WEditorInstance
  let reader!: WRendererInstance

  const mountReader = (): void => {
    reader = host.mountReader(shell.reader, {
      onError: (event) => appendEvent(shell.result, { kind: 'reader-error', code: event.error.code }),
      onReady: () => appendEvent(shell.result, { kind: 'reader-ready', profile: 'reader' }),
    })
  }
  const mountEditor = (documentInput = host.readServerDocument()): void => {
    editor = host.mountEditor(shell.editor, {
      document: documentInput,
      onChange: (event) => {
        reader.setMarkdown(event.snapshot.markdown)
        appendEvent(shell.result, { kind: 'change', revision: event.snapshot.revision })
      },
      onError: (event: WEditorErrorEvent) => {
        appendEvent(shell.result, { kind: 'editor-error', code: event.error.code })
        setStatus(shell.status, event.error.code)
      },
      onReady: (event) => {
        appendEvent(shell.result, { kind: 'editor-ready', mode: event.snapshot.mode })
        setStatus(shell.status, `ready:${event.snapshot.mode}`)
      },
      onSaveStateChange: (event) => appendEvent(shell.result, { kind: 'save-state', state: event.state }),
    })
  }

  mountReader()
  mountEditor()
  renderRequestLog(host, shell.requestLog)

  const action = async (name: string): Promise<void> => {
    switch (name) {
      case 'edit': {
        const source = shell.editor.querySelector<HTMLTextAreaElement>('[data-w-editor-source]')
        if (source === null) throw new Error('NWU editor source is unavailable.')
        source.value = `${source.value}\n\nEdited by the framework-free NWU host.`
        source.dispatchEvent(new Event('input', { bubbles: true }))
        setStatus(shell.status, 'edited')
        return
      }
      case 'autosave':
        await editor.flush()
        setStatus(shell.status, `autosave:${editor.snapshot().saveState}`)
        return
      case 'manual-save': {
        const result = await editor.save()
        setStatus(shell.status, `manual:${result.status}`)
        return
      }
      case 'save-workspace': {
        const exchange = await editor.saveWorkspace()
        setStatus(shell.status, `workspace:${exchange.mode}`)
        return
      }
      case 'reopen':
        await editor.destroy({ confirm: () => true })
        await reader.destroy()
        shell.editor.replaceChildren()
        shell.reader.replaceChildren()
        mountReader()
        mountEditor()
        setStatus(shell.status, 'reopened')
        return
      case 'recover': {
        const result = await editor.recoverDraft()
        setStatus(shell.status, `recovered:${result.snapshot.revision}`)
        return
      }
      case 'discard': {
        const result = await editor.discardDraft()
        setStatus(shell.status, result.status)
        return
      }
      case 'export': {
        const markdown = editor.exportDraft()
        const exported = shell.app.querySelector<HTMLElement>('[data-nwu-export]')
        if (exported !== null) exported.textContent = markdown ?? ''
        setStatus(shell.status, markdown === null ? 'no-draft' : 'exported')
        return
      }
      case 'expire-auth':
        host.session.expireAuth()
        setStatus(shell.status, 'auth-expired')
        return
      case 'restore-auth':
        host.session.restoreAuth()
        setStatus(shell.status, 'auth-restored')
        return
      case 'rotate-csrf':
        host.session.rotateCsrf()
        setStatus(shell.status, 'csrf-rotated')
        return
      case 'refresh-csrf':
        host.session.refreshCsrf()
        setStatus(shell.status, 'csrf-refreshed')
        return
      case 'force-conflict':
        host.forceServerUpdate('# Server-side conflicting update')
        setStatus(shell.status, 'conflict-armed')
        return
      case 'authorized-save': {
        const result = await editor.save({ overwrite: true })
        setStatus(shell.status, `authorized:${result.status}`)
        return
      }
      case 'fail-next-save':
        host.failNextSave()
        setStatus(shell.status, 'save-failure-armed')
        return
      case 'set-form-data':
        host.setTransport('form-data')
        setStatus(shell.status, 'transport:form-data')
        return
      case 'set-json':
        host.setTransport('json')
        setStatus(shell.status, 'transport:json')
        return
      case 'set-dark-theme':
        await host.settingsStore.setUserOverride('appearanceTheme', 'dark')
        setStatus(shell.status, 'theme:dark')
        return
      case 'reset-theme':
        await host.settingsStore.clearUserOverride('appearanceTheme')
        setStatus(shell.status, 'theme:site-default')
        return
      case 'retry': {
        const result = await editor.retry()
        setStatus(shell.status, `retry:${result.status}`)
        return
      }
      default:
        throw new Error(`Unknown NWU host action: ${name}`)
    }
  }

  shell.app.querySelector('[data-nwu-actions]')?.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const name = target.dataset['nwuAction']
    if (name === undefined) return
    void action(name)
      .catch((failure: unknown) => {
        appendEvent(shell.result, { kind: 'action-error', message: failure instanceof Error ? failure.message : String(failure) })
        setStatus(shell.status, 'action-failed')
      })
      .finally(() => renderRequestLog(host, shell.requestLog))
  })

  return {
    editor,
    host,
    reader,
    async destroy(): Promise<void> {
      await editor.destroy({ confirm: () => true })
      await reader.destroy()
    },
  }
}

function isNwuVisibility(value: unknown): value is NwuVisibility {
  return value === 'public' || value === 'selected' || value === 'private'
}

if (typeof document !== 'undefined' && document.querySelector('#app') !== null) bootNwuHost(document)
