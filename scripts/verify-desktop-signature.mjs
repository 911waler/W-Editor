import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const manifestPath = resolve(process.env.W_EDITOR_DESKTOP_RELEASE_MANIFEST ?? 'artifacts/desktop/release-manifest.json')
if (!existsSync(manifestPath)) throw new Error(`Desktop release manifest is missing: ${manifestPath}`)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
if (manifest.releaseStatus !== 'TEST/UNSIGNED' && manifest.releaseStatus !== 'formal') throw new Error(`Unknown Desktop release status: ${manifest.releaseStatus}`)
const artifacts = Array.isArray(manifest.artifacts)
  ? manifest.artifacts
  : [manifest.artifacts?.nsis, manifest.artifacts?.msi].filter(Boolean)
if (artifacts.length !== 2 || new Set(artifacts.map(({ kind }) => kind)).size !== 2 || !artifacts.some(({ kind }) => kind === 'nsis') || !artifacts.some(({ kind }) => kind === 'msi')) {
  throw new Error('Desktop release manifest must describe exactly NSIS and MSI artifacts.')
}
if (manifest.commit !== execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()) throw new Error('Desktop release manifest commit does not match HEAD.')
if (!artifacts.every((artifact) => existsSync(resolve(artifact.path)))) throw new Error('Desktop release manifest references a missing artifact.')
for (const artifact of artifacts) {
  const actualHash = createHash('sha256').update(readFileSync(resolve(artifact.path))).digest('hex').toUpperCase()
  if (actualHash !== artifact.sha256) throw new Error(`Desktop release artifact hash changed: ${artifact.kind}.`)
}
if (manifest.releaseStatus === 'formal' && !artifacts.every((artifact) => artifact.signature?.status === 'valid')) {
  throw new Error('Formal Desktop release requires valid signatures for NSIS and MSI.')
}
if (process.argv.includes('--formal') && manifest.releaseStatus !== 'formal') {
  throw new Error('Formal Desktop release is blocked because the current artifacts are TEST/UNSIGNED.')
}
console.log(JSON.stringify({ status: 'passed', releaseStatus: manifest.releaseStatus, formalEligible: manifest.releaseStatus === 'formal', manifestPath }, null, 2))
