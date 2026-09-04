import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { createWEditorCssScopePlugin } from './scripts/scope-w-editor-css.mjs'

const projectRoot = dirname(fileURLToPath(import.meta.url))

function e2eFixtureAssets(): Plugin {
  return {
    apply: 'build',
    generateBundle() {
      const directory = resolve(projectRoot, 'e2e/fixtures/files')
      for (const name of readdirSync(directory)) {
        this.emitFile({
          fileName: name,
          source: readFileSync(resolve(directory, name)),
          type: 'asset',
        })
      }
    },
    name: 'w-editor-e2e-fixture-assets',
  }
}

export default defineConfig(({ mode }) => ({
  base: './',
  publicDir: resolve(projectRoot, 'public'),
  plugins: [createWEditorCssScopePlugin(), vue(), ...(mode === 'e2e' ? [e2eFixtureAssets()] : [])],
  resolve: {
    alias: {
      '#testing-capability-loader': resolve(
        projectRoot,
        mode === 'e2e'
          ? 'src/testing/capabilityLoader.e2e.ts'
          : 'src/testing/capabilityLoader.ts',
      ),
      '#testing-preview-renderer': resolve(
        projectRoot,
        mode === 'e2e'
          ? 'src/testing/previewRenderer.e2e.ts'
          : 'src/testing/previewRenderer.ts',
      ),
      '#testing-visual-projector': resolve(
        projectRoot,
        mode === 'e2e'
          ? 'src/testing/visualProjector.e2e.ts'
          : 'src/testing/visualProjector.ts',
      ),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(projectRoot, 'index.html'),
        drawioBridge: resolve(projectRoot, 'drawio-bridge.html'),
        ...(mode === 'e2e' ? {
          drawioFake: resolve(projectRoot, 'e2e/fixtures/drawio/fake-drawio.html'),
        } : {}),
      },
    },
    sourcemap: mode !== 'e2e',
    target: 'es2023',
  },
}))
