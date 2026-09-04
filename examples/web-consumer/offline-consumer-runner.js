(function () {
  function waitFor(predicate, timeout) {
    var deadline = Date.now() + timeout
    return new Promise(function (resolve, reject) {
      function check() {
        var value = predicate()
        if (value) {
          resolve(value)
          return
        }
        if (Date.now() >= deadline) {
          reject(new Error('Timed out waiting for offline renderer hydration.'))
          return
        }
        globalThis.setTimeout(check, 25)
      }
      check()
    })
  }

  globalThis.runOfflineConsumer = async function (api, entry) {
    var status = globalThis.document.querySelector('[data-offline-status]')
    var resultNode = globalThis.document.querySelector('[data-offline-result]')
    var editorHost = globalThis.document.querySelector('[data-offline-editor]')
    var readerHost = globalThis.document.querySelector('[data-offline-reader]')

    try {
      status.dataset.offlineStage = 'api-check'
      if (!api || typeof api.mountWEditor !== 'function' || typeof api.mountWRenderer !== 'function') {
        throw new Error('The offline distribution did not expose the public mount API.')
      }

      var markdown = '# Offline distribution\n\nInline formula $x^2 + y^2 = z^2$.\n\n```js\nconst answer = 42\n```\n\n```mermaid\nflowchart LR\n  A[Offline] --> B[Bundled]\n```'
      var saveRequests = []
      status.dataset.offlineStage = 'mount-editor'
      var editor = api.mountWEditor(editorHost, {
        document: { documentId: 'offline-consumer', markdown: markdown, serverRevision: 'offline-server-1' },
        initialMode: 'preview',
        saveAdapter: {
          save: async function (request) {
            saveRequests.push(request)
            return {
              draftState: { baseServerRevision: 'offline-server-2', status: 'saved', updatedAt: '2026-08-27T00:00:00.000Z' },
              savedAt: '2026-08-27T00:00:00.000Z',
              serverRevision: 'offline-server-2',
              versionId: request.saveKind === 'autosave-draft' ? undefined : 'offline-version-1',
            }
          },
        },
      })

      status.dataset.offlineStage = 'mount-reader'
      var reader = api.mountWRenderer(readerHost, { markdown: editor.snapshot().markdown, profile: 'reader' })

      status.dataset.offlineStage = 'wait-for-hydration'
      await waitFor(function () {
        var editorContent = editorHost.querySelector('.w-editor-surface--visual [data-w-editor-preview]')
        var readerContent = readerHost.querySelector('.w-editor-renderer-content')
        if (!editorContent || !readerContent) return false
        var editorMermaid = editorContent.querySelector('[data-semantic-kind="mermaid"][data-preview-state="ready"]')
        var readerMermaid = readerContent.querySelector('[data-semantic-kind="mermaid"][data-preview-state="ready"]')
        return Boolean(
          editorContent.querySelector('.katex')
          && readerContent.querySelector('.katex')
          && editorContent.querySelector('pre > code')
          && readerContent.querySelector('pre > code')
          && editorMermaid
          && readerMermaid,
        )
      }, 30_000)

      status.dataset.offlineStage = 'save'
      var saved = await editor.save({ kind: 'manual-save' })
      status.dataset.offlineStage = 'destroy'
      var editorDestroy = await editor.destroy()
      var readerDestroy = await reader.destroy()

      resultNode.textContent = JSON.stringify({
        codeRendered: true,
        editorDestroyed: editorDestroy.status === 'destroyed',
        editorMounted: true,
        entry: entry,
        formulaRendered: true,
        readerDestroyed: readerDestroy.status === 'destroyed',
        readerMounted: true,
        saved: saved.status === 'saved' && saved.response.versionId === 'offline-version-1' && saveRequests.length === 1,
      })
      status.dataset.offlineStage = 'done'
      status.dataset.offlineStatus = 'passed'
    } catch (error) {
      resultNode.textContent = JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
      status.dataset.offlineStatus = 'failed'
    }
  }
}())
