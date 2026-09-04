import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '..')
const evidencePath = resolve(repositoryRoot, 'artifacts/desktop/task-8-10-current-verification.json')
let recordedRoot = null
if (existsSync(evidencePath)) {
  try {
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))
    if (evidence.status === 'passed' && typeof evidence.lifecycleRoot === 'string') recordedRoot = evidence.lifecycleRoot
  } catch {
    recordedRoot = null
  }
}
const root = process.env.W_EDITOR_INSTALLER_LIFECYCLE_ROOT ?? recordedRoot ?? join('G:', 'w-editor-installer-lifecycle-8-10')
const required = [
  ['nsis', 'install', 'w-editor-desktop.exe'],
  ['msi', 'install', 'w-editor-desktop.exe'],
  ['nsis', 'data', 'W-EditorData', 'library.db'],
  ['msi', 'data', 'W-EditorData', 'library.db'],
  ['msi', 'install.log'],
  ['msi', 'uninstall.log'],
  ['msi', 'reinstall.log'],
  ['msi', 'msi-events.json'],
]
const missing = required
  .filter((parts) => !existsSync(join(root, ...parts)))
  .map((parts) => join(root, ...parts))
if (missing.length > 0) throw new Error(`Installed Desktop lifecycle evidence is missing for: ${missing.join(', ')}. Run the real NSIS/MSI lifecycle first.`)
console.log(JSON.stringify({ status: 'passed', root }, null, 2))
