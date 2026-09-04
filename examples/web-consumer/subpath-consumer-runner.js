(function () {
  function waitFor(predicate, timeout) {
    var deadline = Date.now() + timeout
    return new Promise(function (resolve, reject) {
      function check() {
        if (predicate()) {
          resolve()
          return
        }
        if (Date.now() >= deadline) {
          reject(new Error('Timed out waiting for the subpath distribution.'))
          return
        }
        globalThis.setTimeout(check, 25)
      }
      check()
    })
  }

  globalThis.runSubpathConsumer = async function (api, entry, assetBaseUrl) {
    var status = globalThis.document.querySelector('[data-subpath-status]')
    var resultNode = globalThis.document.querySelector('[data-subpath-result]')
    var editorHost = globalThis.document.querySelector('[data-subpath-editor]')
    var readerHost = globalThis.document.querySelector('[data-subpath-reader]')

    try {
      status.dataset.subpathStage = 'api-check'
      if (!api || typeof api.mountWEditor !== 'function' || typeof api.mountWRenderer !== 'function' || typeof api.resolveWebAssetUrl !== 'function') {
        throw new Error('The subpath distribution did not expose the public API.')
      }
      var resolvedChunk = api.resolveWebAssetUrl('chunks/renderer.js', {
        assetBaseUrl: assetBaseUrl,
        baseUrl: globalThis.location.href,
      })
      if (!resolvedChunk.valid || resolvedChunk.url.indexOf(assetBaseUrl + 'chunks/renderer.js') !== 0) {
        throw new Error('assetBaseUrl did not resolve a distribution-relative resource.')
      }

      var markdown = '# Subpath distribution\n\nThe static entry loaded below a reverse proxy prefix.\n\n```js\nconst value = 42\n```'
      var editor = api.mountWEditor(editorHost, {
        assetBaseUrl: assetBaseUrl,
        document: { documentId: 'subpath-consumer', markdown: markdown, serverRevision: 'subpath-server-1' },
        initialMode: 'preview',
        saveAdapter: {
          save: async function (request) {
            return {
              draftState: { baseServerRevision: 'subpath-server-2', status: 'saved', updatedAt: '2026-08-27T00:00:00.000Z' },
              savedAt: '2026-08-27T00:00:00.000Z',
              serverRevision: 'subpath-server-2',
              versionId: request.saveKind === 'autosave-draft' ? undefined : 'subpath-version-1',
            }
          },
        },
      })
      var reader = api.mountWRenderer(readerHost, {
        assetBaseUrl: assetBaseUrl,
        markdown: editor.snapshot().markdown,
        profile: 'reader',
      })

      status.dataset.subpathStage = 'wait-for-render'
      await waitFor(function () {
        return editorHost.querySelector('.w-editor-surface--visual [data-w-editor-preview] h1') !== null
          && readerHost.querySelector('[data-w-editor-renderer-content] h1') !== null
      }, 30_000)
      status.dataset.subpathStage = 'save-and-destroy'
      var saved = await editor.save({ kind: 'manual-save' })
      var editorDestroy = await editor.destroy()
      var readerDestroy = await reader.destroy()
      await globalThis.document.fonts.ready
      var resourceRequests = globalThis.performance.getEntriesByType('resource').map(function (entry) { return entry.name })
      resultNode.textContent = JSON.stringify({
        assetBaseUrl: new globalThis.URL('./', globalThis.location.href).href,
        destroyed: editorDestroy.status === 'destroyed' && readerDestroy.status === 'destroyed',
        entry: entry,
        fontsReady: globalThis.document.fonts.status === 'loaded',
        resourceRequests: resourceRequests,
        saved: saved.status === 'saved' && saved.response.versionId === 'subpath-version-1',
      })
      status.dataset.subpathStage = 'done'
      status.dataset.subpathStatus = 'passed'
    } catch (error) {
      resultNode.textContent = JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
      status.dataset.subpathStatus = 'failed'
    }
  }
}())
