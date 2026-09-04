/* global TextEncoder, document, fetch */

(function () {
  function waitFor(predicate, label, timeout) {
    return new Promise(function (resolve, reject) {
      var deadline = Date.now() + (timeout || 30000)
      function tick() {
        try {
          var value = predicate()
          if (value) {
            resolve(value)
            return
          }
        } catch (error) {
          reject(error)
          return
        }
        if (Date.now() >= deadline) {
          reject(new Error('Timed out waiting for ' + label + '.'))
          return
        }
        globalThis.setTimeout(tick, 100)
      }
      tick()
    })
  }

  function semantic(root) {
    var clone = root.cloneNode(true)
    clone.querySelectorAll('style, script, [data-semantic-edit], [data-raw-edit], .visual-code-block__language, .table-node-view__handle, .table-node-view__menu, .table-cell-selection-overlay').forEach(function (node) { node.remove() })
    function normalize(value) { return value.replace(/\s+/gu, ' ').trim() }
    return {
      code: Array.from(clone.querySelectorAll('pre > code')).map(function (node) { return node.textContent || '' }),
      headings: Array.from(clone.querySelectorAll('h1,h2,h3,h4,h5,h6')).map(function (node) { return node.tagName + ':' + normalize(node.textContent || '') }),
      images: clone.querySelectorAll('img').length,
      links: Array.from(clone.querySelectorAll('a')).map(function (node) { return normalize(node.textContent || '') }),
      svg: clone.querySelectorAll('svg').length,
      tables: clone.querySelectorAll('table').length,
      text: normalize(clone.textContent || ''),
    }
  }

  function settle(root) {
    return waitFor(function () {
      return !root.querySelector('[aria-busy="true"], [data-preview-state="loading"]')
    }, 'renderer hydration', 30000).then(function () {
      return new Promise(function (resolve) { globalThis.setTimeout(resolve, 250) })
    })
  }

  globalThis.runWEditorFeatureParity = async function (api, entry) {
    var status = document.querySelector('[data-feature-parity-status]')
    var editorHost = document.querySelector('[data-feature-parity-editor]')
    var readerHost = document.querySelector('[data-feature-parity-reader]')
    try {
      if (!api || typeof api.mountWEditor !== 'function' || typeof api.mountWRenderer !== 'function') throw new Error('Built ' + entry + ' entry did not expose the public mount API.')
      var markdown = await fetch('/tests/fixtures/parity/w-editor-parity.md').then(function (response) {
        if (!response.ok) throw new Error('Parity fixture request failed with ' + response.status)
        return response.text()
      })
      var readyPromise = new Promise(function (resolve) {
        globalThis.__W_EDITOR_FEATURE_READY__ = resolve
      })
      var errors = []
      var editor = api.mountWEditor(editorHost, {
        document: { documentId: 'release-parity-' + entry, markdown: markdown, serverRevision: 'release-parity-1' },
        initialMode: 'preview',
        locale: 'zh',
        onError: function (event) { errors.push(event.error && event.error.code ? event.error.code : 'unknown') },
        onReady: function (event) { globalThis.__W_EDITOR_FEATURE_READY__(event) },
      })
      var ready = await readyPromise
      await waitFor(function () { return editorHost.querySelector('[data-w-editor-instance]') }, 'built editor mount', 30000)
      var commands = Array.from(editorHost.querySelectorAll('[data-command-id]')).map(function (node) { return node.getAttribute('data-command-id') }).filter(Boolean)
      var editorSnapshot = editor.snapshot()
      var finalContent = await waitFor(function () { return editorHost.querySelector('[data-w-editor-preview]') }, 'built Final Preview', 30000)
      await settle(finalContent)
      var finalSemantic = semantic(finalContent)
      var reader = api.mountWRenderer(readerHost, { locale: 'zh', markdown: editorSnapshot.markdown, profile: 'reader' })
      var readerContent = await waitFor(function () { return readerHost.querySelector('[data-w-editor-renderer-content]') }, 'built Reader', 30000)
      await settle(readerContent)
      var readerSemantic = semantic(readerContent)
      var destroyed = await Promise.all([editor.destroy(), reader.destroy()])
      var result = {
        status: 'passed',
        entry: entry,
        ready: ready.type === 'ready',
        apiVersion: editor.apiVersion,
        schemaVersion: editor.schemaVersion,
        commands: Array.isArray(api.W_EDITOR_COMMAND_IDS) ? api.W_EDITOR_COMMAND_IDS.slice() : commands,
        markdownBytes: new TextEncoder().encode(editorSnapshot.markdown).byteLength,
        finalSemantic: finalSemantic,
        readerSemantic: readerSemantic,
        readerEditControls: readerHost.querySelectorAll('[data-w-editor-action="edit-code"]').length,
        destroyed: destroyed.every(function (value) { return value.status === 'destroyed' }),
        errors: errors,
      }
      globalThis.__W_EDITOR_FEATURE_PARITY__ = result
      status.dataset.featureParityStatus = 'passed'
    } catch (error) {
      var preview = editorHost && editorHost.querySelector('[data-w-editor-preview]')
      var failure = {
        status: 'failed',
        entry: entry,
        error: error instanceof Error ? error.message : String(error),
        diagnostic: {
          editorHtml: editorHost ? editorHost.innerHTML.slice(0, 1200) : '',
          previewHtml: preview ? preview.innerHTML.slice(0, 1200) : '',
          surfaces: editorHost ? Array.from(editorHost.querySelectorAll('[data-w-editor-surface]')).map(function (node) { return { mode: node.dataset.wEditorSurface, hidden: node.hidden, text: (node.textContent || '').slice(0, 120) } }) : [],
          snapshot: typeof editor !== 'undefined' && editor ? editor.snapshot() : null,
        },
      }
      globalThis.__W_EDITOR_FEATURE_PARITY__ = failure
      status.dataset.featureParityStatus = 'failed'
      status.textContent = failure.error
    }
  }
}())
