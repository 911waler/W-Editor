import {
  configuredDrawioEditorUrl,
  DrawioBridgeController,
} from './drawioBridge'

function boot(): void {
  const frame = document.querySelector<HTMLIFrameElement>('#drawio-editor')
  const status = document.querySelector<HTMLElement>('[data-drawio-bridge-status]')
  if (frame === null || status === null) throw new Error('draw.io bridge markup is incomplete.')
  const metaEditorPath = document.querySelector<HTMLMetaElement>('meta[name="w-editor-drawio-editor"]')?.content ?? ''
  const configured = configuredDrawioEditorUrl(
    new URLSearchParams(window.location.search).get('editor') ?? metaEditorPath,
    window.location.href,
  )
  frame.src = configured.url
  const editorWindow = frame.contentWindow
  if (editorWindow === null) throw new Error('draw.io editor window is unavailable.')
  const controller = new DrawioBridgeController({
    editorOrigin: configured.origin,
    editorWindow,
    parentOrigin: window.location.origin,
    parentWindow: window.parent,
  })
  frame.addEventListener('load', () => {
    status.textContent = 'Diagram editor loaded'
  })
  window.addEventListener('pagehide', () => controller.destroy(), { once: true })
}

try {
  boot()
} catch (error) {
  const status = document.querySelector<HTMLElement>('[data-drawio-bridge-status]')
  if (status !== null) status.textContent = error instanceof Error ? error.message : 'draw.io bridge failed.'
  throw error
}
