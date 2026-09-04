import { spawn } from 'node:child_process'
import { join, parse, resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '..')
const defaultTargetDirectory = process.platform === 'win32'
  ? join(parse(repositoryRoot).root, 'w-editor-tauri-target')
  : resolve(repositoryRoot, '.tmp', 'tauri-target')
const targetDirectory = process.env.W_EDITOR_CARGO_TARGET_DIR ?? defaultTargetDirectory
const packageManager = process.platform === 'win32' ? 'cmd.exe' : 'corepack'
const packageArguments = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'corepack pnpm --filter @w-editor/desktop tauri build --debug --bundles nsis,msi']
  : ['pnpm', '--filter', '@w-editor/desktop', 'tauri', 'build', '--debug', '--bundles', 'nsis,msi']

const child = spawn(
  packageManager,
  packageArguments,
  {
    cwd: repositoryRoot,
    env: { ...process.env, CARGO_TARGET_DIR: targetDirectory },
    stdio: 'inherit',
    windowsHide: true,
  },
)

child.on('error', (error) => {
  console.error(`Desktop bundle build could not start: ${error.message}`)
  process.exitCode = 1
})

child.on('exit', (code, signal) => {
  if (signal !== null) {
    console.error(`Desktop bundle build terminated by ${signal}.`)
    process.exitCode = 1
    return
  }
  process.exitCode = code ?? 1
})
