import { resolve } from 'node:path'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { createWEditorCssScopePlugin } from '../../scripts/scope-w-editor-css.mjs'

export default defineConfig(({ mode }) => {
  const buildIife = mode === 'distribution-iife'

  return {
    plugins: [createWEditorCssScopePlugin(), vue()],
    root: import.meta.dirname,
    build: {
      cssCodeSplit: false,
      emptyOutDir: !buildIife,
      lib: buildIife
        ? {
            cssFileName: 'w-editor',
            entry: resolve(import.meta.dirname, 'src/iifeBuildEntry.ts'),
            fileName: 'w-editor.global',
            formats: ['iife'],
            name: 'WEditor',
          }
        : {
            cssFileName: 'w-editor',
            entry: {
              editor: resolve(import.meta.dirname, 'src/editorEntry.ts'),
              renderer: resolve(import.meta.dirname, 'src/rendererEntry.ts'),
            },
            fileName: (_format, entryName) => `${entryName}.es`,
            formats: ['es'],
          },
      rollupOptions: {
        output: {
          chunkFileNames: 'chunks/[name]-[hash].js',
          entryFileNames: buildIife ? 'w-editor.global.js' : '[name].es.js',
          intro: 'const process = { env: { NODE_ENV: "production" }, platform: "browser", cwd: () => "" };',
        },
      },
      sourcemap: true,
      target: 'es2023',
    },
  }
})
