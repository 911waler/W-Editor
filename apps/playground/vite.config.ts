import { resolve } from 'node:path'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { createWEditorCssScopePlugin } from '../../scripts/scope-w-editor-css.mjs'

export default defineConfig({
  plugins: [createWEditorCssScopePlugin(), vue()],
  build: {
    rollupOptions: {
      input: resolve(import.meta.dirname, 'index.html'),
    },
  },
})
