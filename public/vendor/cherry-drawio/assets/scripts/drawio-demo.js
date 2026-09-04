/*
 * Derived from Tencent/cherry-markdown examples/assets/scripts/drawio-demo.js
 * at 9eba3371cce07c8ffcc422ccde1abdb961559f80 (Apache-2.0).
 * W-Editor changes: exact same-origin messaging and mxfile compatibility.
 */
(function () {
  var editorUiInit = EditorUi.prototype.init;

  if (typeof EditorUi.prototype.convertImageToDataUri !== 'function') {
    EditorUi.prototype.convertImageToDataUri = function (source, callback) {
      if (this.editor && typeof this.editor.convertImageToDataUri === 'function') {
        return this.editor.convertImageToDataUri(source, callback);
      }

      var completed = false;
      var timeout = window.setTimeout(function () {
        finish(source);
      }, 10000);
      var finish = function (value) {
        if (completed) return;
        completed = true;
        window.clearTimeout(timeout);
        callback(value);
      };
      var image = new Image();
      image.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth || image.width;
          canvas.height = image.naturalHeight || image.height;
          var context = canvas.getContext('2d');
          if (context === null) return finish(source);
          context.drawImage(image, 0, 0);
          finish(canvas.toDataURL());
        }
        catch (_error) {
          finish(source);
        }
      };
      image.onerror = function () {
        finish(source);
      };
      image.src = source;
    };
  }

  EditorUi.prototype.init = function () {
    editorUiInit.apply(this, arguments);
  };

  mxResources.loadDefaultBundle = false;
  var bundle = './assets/drawio_lib/resources/' + mxLanguage + '.txt';

  mxUtils.getAll([bundle, './assets/drawio_lib/theme/default.xml'], function (xhr) {
    mxResources.parse(xhr[0].getText());

    var themes = new Object();
    themes[Graph.prototype.defaultThemeName] = xhr[1].getDocumentElement();

    window.editorUIInstance = new EditorUi(new Editor(false, themes));
    addPostMessageListener(window.editorUIInstance.editor);
    postToBridge({ eventName: 'ready', value: '' });
  }, function () {
    document.body.innerHTML = '<center style="margin-top:10%;">Error loading resource files. Please check browser console.</center>';
  });
})();

function postToBridge(message) {
  window.parent.postMessage(message, window.location.origin);
}

function blankGraphModel() {
  return mxUtils.parseXml('<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>').documentElement;
}

function childGraphModel(diagram) {
  for (var index = 0; index < diagram.childNodes.length; index += 1) {
    var child = diagram.childNodes[index];
    if (child.nodeType === 1 && child.nodeName === 'mxGraphModel') return child;
  }
  return null;
}

function graphModelFromValue(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return blankGraphModel();
  var documentNode = mxUtils.parseXml(value);
  var root = documentNode.documentElement;
  if (root.nodeName === 'mxGraphModel') return root;
  if (root.nodeName.toLowerCase() !== 'mxfile') throw new Error('Expected mxfile or mxGraphModel XML.');

  var diagrams = root.getElementsByTagName('diagram');
  if (diagrams.length === 0) return blankGraphModel();
  var directModel = childGraphModel(diagrams[0]);
  if (directModel !== null) return directModel;

  var compressed = mxUtils.getTextContent(diagrams[0]).trim();
  if (compressed.length === 0) return blankGraphModel();
  var decompressed = Graph.decompress(compressed);
  var model = mxUtils.parseXml(decompressed).documentElement;
  if (model.nodeName !== 'mxGraphModel') throw new Error('The mxfile diagram does not contain an mxGraphModel.');
  return model;
}

function addPostMessageListener(graphEditor) {
  window.addEventListener('message', function (event) {
    if (event.origin !== window.location.origin || event.source !== window.parent) return;
    if (!event.data || !event.data.eventName) return;

    switch (event.data.eventName) {
      case 'setData':
        try {
          var model = graphModelFromValue(event.data.value);
          window.editorUIInstance.editor.setGraphXml(model);
          graphEditor.setFilename('w-editor-drawio-' + new Date().getTime());
          postToBridge({ eventName: 'setData:success', value: '' });
        }
        catch (error) {
          postToBridge({ eventName: 'setData:error', value: String(error && error.message ? error.message : error) });
        }
        break;
      case 'getData':
        window.editorUIInstance.editor.graph.stopEditing();
        var xmlData = mxUtils.getXml(window.editorUIInstance.editor.getGraphXml());
        window.editorUIInstance.exportImage(1, '#ffffff', true, null, true, 50, null, 'png', function (base64) {
          postToBridge({
            mceAction: 'getData:success',
            eventName: 'getData:success',
            value: {
              xmlData: xmlData,
              base64: base64,
            },
          });
        });
        break;
      case 'ready?':
        postToBridge({ eventName: 'ready', value: '' });
        break;
      default:
        break;
    }
  });
}
