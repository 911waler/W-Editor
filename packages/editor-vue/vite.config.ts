import { resolve } from 'node:path'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { createWEditorCssScopePlugin } from '../../scripts/scope-w-editor-css.mjs'

export default defineConfig({
  plugins: [createWEditorCssScopePlugin(), vue()],
  build: {
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      fileName: 'index',
      formats: ['es'],
    },
    rollupOptions: {
      external: ['vue', '@w-editor/editor-core'],
    },
  },
})
