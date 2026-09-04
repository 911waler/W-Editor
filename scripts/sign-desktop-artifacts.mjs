import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, parse, resolve } from 'node:path'

import { desktopArtifactPaths, readReleaseVersions } from './release-versions.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const targetRoot = resolve(process.env.W_EDITOR_CARGO_TARGET_DIR ?? join(parse(repositoryRoot).root, 'w-editor-tauri-target'))
const artifacts = Object.values(desktopArtifactPaths(targetRoot, readReleaseVersions(repositoryRoot)))
const thumbprint = process.env.W_EDITOR_CERT_THUMBPRINT?.trim() ?? ''
if (thumbprint.length === 0) {
  console.log(JSON.stringify({ status: 'passed', signingStatus: 'TEST/UNSIGNED', formalAllowed: false, reason: 'W_EDITOR_CERT_THUMBPRINT is not configured.' }, null, 2))
  process.exit(0)
}
if (process.platform !== 'win32') throw new Error('Authenticode signing requires Windows signtool.')
let signtool
try {
  signtool = execFileSync('where.exe', ['signtool.exe'], { encoding: 'utf8' }).trim().split(/\r?\n/u)[0]
} catch {
  throw new Error('Authenticode signing was requested but signtool.exe is unavailable.')
}
if (!signtool) throw new Error('Authenticode signing was requested but signtool.exe is unavailable.')
for (const artifact of artifacts) {
  if (!existsSync(artifact)) throw new Error(`Cannot sign missing Desktop artifact: ${artifact}`)
  const args = ['sign', '/sha1', thumbprint, ...(process.env.W_EDITOR_TIMESTAMP_URL ? ['/tr', process.env.W_EDITOR_TIMESTAMP_URL, '/td', 'sha256'] : []), '/fd', 'sha256', artifact]
  execFileSync(signtool, args, { cwd: repositoryRoot, stdio: 'inherit' })
}
console.log(JSON.stringify({ status: 'passed', signingStatus: 'signed', formalAllowed: false, reason: 'Regenerate and verify the release manifest before any formal claim.' }, null, 2))
