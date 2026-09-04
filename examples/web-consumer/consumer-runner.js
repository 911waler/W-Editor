(function () {
  function waitForPaint() {
    return new Promise(function (resolve) {
      globalThis.setTimeout(resolve, 0)
    })
  }

  globalThis.runWebDistributionConsumer = async function (api, entry) {
    var status = globalThis.document.querySelector('[data-consumer-status]')
    var resultNode = globalThis.document.querySelector('[data-consumer-result]')
    var editorHost = globalThis.document.querySelector('[data-consumer-editor]')
    var readerHost = globalThis.document.querySelector('[data-consumer-reader]')

    try {
      status.dataset.consumerStage = 'api-check'
      if (!api || typeof api.mountWEditor !== 'function' || typeof api.mountWRenderer !== 'function') {
        throw new Error('The distribution did not expose the public mount API.')
      }

      status.dataset.consumerStage = 'mount-editor'
      var markdown = '# Static consumer\n\n[[toc]]\n\n```js\nconst value = 42\n```'
      var saveRequests = []
      var editor = api.mountWEditor(editorHost, {
        document: { documentId: 'static-consumer', markdown: markdown, serverRevision: 'server-1' },
        saveAdapter: {
          save: async function (request) {
            saveRequests.push(request)
            return {
              draftState: { baseServerRevision: 'server-2', status: 'saved', updatedAt: '2026-08-27T00:00:00.000Z' },
              savedAt: '2026-08-27T00:00:00.000Z',
              serverRevision: 'server-2',
              versionId: request.saveKind === 'autosave-draft' ? undefined : 'version-1',
            }
          },
        },
      })

      status.dataset.consumerStage = 'edit'
      var source = editorHost.querySelector('[data-w-editor-source]')
      source.value = markdown + '\n\nSaved from ' + entry
      source.dispatchEvent(new globalThis.Event('input', { bubbles: true }))
      await editor.flush()
      status.dataset.consumerStage = 'save'
      var saved = await editor.save({ kind: 'manual-save' })
      status.dataset.consumerStage = 'mount-reader'
      var reader = api.mountWRenderer(readerHost, {
        markdown: editor.snapshot().markdown,
        profile: 'reader',
      })
      await waitForPaint()

      status.dataset.consumerStage = 'inspect-reader'
      var readerRoot = readerHost.querySelector('[data-w-editor-profile="reader"]')
      var capabilities = []
      if (readerRoot && readerRoot.querySelector('[data-w-editor-action="copy-code"]')) capabilities.push('copy')
      if (readerRoot && readerRoot.querySelector('[data-w-editor-renderer-content][contenteditable="false"]')) capabilities.push('readonly')
      if (readerRoot && readerRoot.querySelector('h1')) capabilities.push('heading')
      var editorDestroy = await editor.destroy()
      var readerDestroy = await reader.destroy()
      status.dataset.consumerStage = 'done'
      var payload = {
        apiKeys: Object.keys(api).sort(),
        apiVersion: editor.apiVersion,
        capabilities: capabilities,
        destroyed: editorDestroy.status === 'destroyed' && readerDestroy.status === 'destroyed',
        entry: entry,
        readerProfile: reader.snapshot().profile,
        saved: saved.status === 'saved' && saveRequests.length === 1,
      }
      resultNode.textContent = JSON.stringify(payload)
      status.dataset.consumerStatus = 'passed'
    } catch (error) {
      resultNode.textContent = JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
      status.dataset.consumerStatus = 'failed'
    }
  }
}())
