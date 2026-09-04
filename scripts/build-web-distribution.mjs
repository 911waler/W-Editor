import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const packageRootPath = fileURLToPath(new URL('../packages/editor-web/', import.meta.url))
const viteConfig = fileURLToPath(new URL('../packages/editor-web/vite.config.ts', import.meta.url))

await build({
  configFile: viteConfig,
  logLevel: 'info',
  mode: 'distribution-es',
})

await build({
  configFile: viteConfig,
  logLevel: 'info',
  mode: 'distribution-iife',
})

const tsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))
execFileSync(process.execPath, [
  tsc,
  '--declaration',
  '--emitDeclarationOnly',
  '--project',
  `${packageRootPath}tsconfig.types.json`,
  '--tsBuildInfoFile',
  `${packageRootPath}dist/types-build.tsbuildinfo`,
], { stdio: 'inherit' })

const bridgeEntry = fileURLToPath(new URL('../src/integrations/drawioBridgePage.ts', import.meta.url))
const bridgeOutput = fileURLToPath(new URL('../packages/editor-web/dist/drawio/', import.meta.url))
rmSync(bridgeOutput, { force: true, recursive: true })
await build({
  build: {
    emptyOutDir: false,
    lib: {
      entry: bridgeEntry,
      fileName: () => 'bridge.js',
      formats: ['iife'],
      name: 'WEditorDrawioBridge',
    },
    outDir: bridgeOutput,
    rollupOptions: {
      output: {
        assetFileNames: 'bridge-[name]-[hash][extname]',
        chunkFileNames: 'bridge-[name]-[hash].js',
        entryFileNames: 'bridge.js',
      },
    },
    sourcemap: true,
    target: 'es2023',
  },
  configFile: false,
  logLevel: 'info',
  mode: 'distribution-bridge',
  publicDir: false,
  root: fileURLToPath(new URL('..', import.meta.url)),
})

const manifestGenerator = fileURLToPath(new URL('./generate-web-distribution-manifest.mjs', import.meta.url))
execFileSync(process.execPath, [manifestGenerator], { stdio: 'inherit' })
