(function () {
  var fixtures = {
    ordinary: [
      '# Ordinary parity',
      '',
      'A **bold** paragraph with [a link](https://example.test/path).',
      '',
      '- first item',
      '- second item',
      '',
      '| Name | Value |',
      '| --- | ---: |',
      '| Alpha | 1 |',
      '| Beta | 2 |',
    ].join('\n'),
    'formula-code': [
      '# Formula and code',
      '',
      'Inline $x^2+y^2$ stays aligned.',
      '',
      '$$\\frac{a}{b}=c$$',
      '',
      '```javascript',
      'const answer = 42',
      'console.log(answer)',
      '```',
    ].join('\n'),
    'async-graphics': [
      '# Asynchronous graphics',
      '',
      '```mermaid',
      'flowchart LR',
      '  Start([Start]) --> Check{Ready?}',
      '  Check -->|Yes| Finish([Finish])',
      '  Check -->|No| Start',
      '```',
    ].join('\n'),
    'complex-layout': [
      '# Complex layout',
      '',
      '::: primary Important',
      'A deterministic panel body.',
      ':::',
      '',
      '::: 2cols Two columns',
      'First column content',
      '::',
      'Second column content',
      ':::',
    ].join('\n'),
  }

  function waitForStableRender(root) {
    return new Promise(function (resolve, reject) {
      var started = Date.now()
      function inspect() {
        var pending = root.querySelector('[data-w-editor-mermaid-preview]:not([data-render-state="ready"])')
        if (!pending) {
          globalThis.setTimeout(resolve, 150)
          return
        }
        if (Date.now() - started > 10000) {
          reject(new Error('Renderer hydration did not settle.'))
          return
        }
        globalThis.setTimeout(inspect, 50)
      }
      inspect()
    })
  }

  globalThis.runRendererParityCandidate = async function (api, entry) {
    var status = globalThis.document.querySelector('[data-parity-status]')
    var readerHost = globalThis.document.querySelector('[data-parity-reader]')
    var finalHost = globalThis.document.querySelector('[data-parity-final]')
    var fixture = new globalThis.URL(globalThis.location.href).searchParams.get('fixture') || 'ordinary'
    var markdown = fixtures[fixture]
    if (!markdown) throw new Error('Unknown parity fixture: ' + fixture)

    try {
      var reader = api.mountWRenderer(readerHost, { markdown: markdown, profile: 'reader', theme: 'default' })
      var finalPreview = api.mountWRenderer(finalHost, { markdown: markdown, profile: 'author-preview', theme: 'default' })
      await Promise.all([waitForStableRender(readerHost), waitForStableRender(finalHost), globalThis.document.fonts.ready])
      status.dataset.parityEntry = entry
      status.dataset.parityFixture = fixture
      status.dataset.parityStatus = 'ready'
      globalThis.__W_EDITOR_PARITY__ = { finalPreview: finalPreview, reader: reader }
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error)
      status.dataset.parityStatus = 'failed'
    }
  }
}())
