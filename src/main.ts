import { createApp } from 'vue'
import { createTestingPreviewRenderer } from '#testing-preview-renderer'
import { createTestingVisualProjector } from '#testing-visual-projector'

import App from './ui/App.vue'
import { installRandomUuid } from './nwu/uuid'
import './ui/styles.css'
import './ui/shell.css'

installRandomUuid()

const previewRenderer = createTestingPreviewRenderer()
const visualProjector = createTestingVisualProjector()
createApp(App, {
  ...(previewRenderer === undefined ? {} : { previewRenderer }),
  ...(visualProjector === undefined ? {} : { visualProjector }),
}).mount('#app')
document.documentElement.dataset['wEditorReady'] = 'true'
