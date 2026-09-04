(() => {
  const api = window.WEditor
  if (api === undefined) throw new Error('W-Editor IIFE is unavailable.')

  const assetBaseUrl = new URL('/static/vendor/w-editor/0.1.0/', document.baseURI).href
  const editorMount = document.querySelector('[data-nwu-w-editor-reference]')
  const legacyForm = document.querySelector('#blog-editor-form')
  const legacyTextarea = document.querySelector('#blog-content-input')

  if (editorMount instanceof HTMLElement && legacyForm instanceof HTMLFormElement && legacyTextarea instanceof HTMLTextAreaElement) {
    const documentId = editorMount.dataset.documentId || 'new-reference-document'
    const editor = api.mountWEditor(editorMount, {
      assetBaseUrl,
      document: {
        documentId,
        markdown: legacyTextarea.value,
      },
      hostAdapterVersion: '1.0.0',
      initialMode: 'source',
      onChange: (event) => {
        legacyTextarea.value = event.snapshot.markdown
      },
    })
    legacyTextarea.closest('.editor-source-field')?.setAttribute('hidden', '')
    document.querySelector('.blog-preview-panel')?.setAttribute('hidden', '')
    window.addEventListener('pagehide', () => void editor.destroy({ confirm: () => true }), { once: true })
  }

  const rendererMount = document.querySelector('[data-nwu-w-renderer-reference]')
  const rendererBootstrap = document.querySelector('[data-nwu-w-renderer-markdown]')
  if (rendererMount instanceof HTMLElement && rendererBootstrap instanceof HTMLScriptElement) {
    const markdown = JSON.parse(rendererBootstrap.textContent || '""')
    if (typeof markdown !== 'string') throw new TypeError('NWU Renderer bootstrap must contain a JSON string.')
    const renderer = api.mountWRenderer(rendererMount, {
      assetBaseUrl,
      hostAdapterVersion: '1.0.0',
      markdown,
      profile: 'reader',
    })
    document.querySelector('[data-nwu-w-renderer-fallback]')?.setAttribute('hidden', '')
    window.addEventListener('pagehide', () => void renderer.destroy(), { once: true })
  }
})()
