import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, parse, resolve } from 'node:path'

import { desktopArtifactFileNames, readReleaseVersions } from './release-versions.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const versions = readReleaseVersions(repositoryRoot)
const targetRoot = resolve(process.env.W_EDITOR_CARGO_TARGET_DIR ?? join(parse(repositoryRoot).root, 'w-editor-tauri-target'))
const bundleRoot = join(targetRoot, 'debug', 'bundle')
const nsisDirectory = join(bundleRoot, 'nsis')
const msiDirectory = join(bundleRoot, 'msi')
const wixSource = join(targetRoot, 'debug', 'wix', 'x64', 'main.wxs')

function requireFile(path, label) {
  if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`)
  return path
}

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase()
}

function packageFile(directory, pattern, label) {
  const files = readdirSync(directory).filter((name) => pattern.test(name))
  if (files.length !== 1) throw new Error(`Expected exactly one ${label}; found ${files.join(', ') || '(none)'}.`)
  return join(directory, files[0])
}

const artifactNames = desktopArtifactFileNames(versions)
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
const nsis = requireFile(packageFile(nsisDirectory, new RegExp(`^${escapeRegExp(artifactNames.nsis)}$`, 'u'), 'NSIS package'), 'NSIS package')
const msi = requireFile(packageFile(msiDirectory, new RegExp(`^${escapeRegExp(artifactNames.msi)}$`, 'u'), 'MSI package'), 'MSI package')
const wix = readFileSync(requireFile(wixSource, 'generated WiX source'), 'utf8')
const nsisBytes = readFileSync(nsis)
const nsisText = `${nsisBytes.toString('latin1')}\n${nsisBytes.toString('utf16le')}`
const invalidTargets = readdirSync(bundleRoot, { withFileTypes: true })
  .filter((entry) => /portable|appx|msix/iu.test(entry.name))
  .map((entry) => entry.name)

if (!nsisText.includes('W-Editor Desktop')) throw new Error('NSIS package does not contain the product name.')
if (!wix.includes('Name="W-Editor Desktop"') || !wix.includes(`Version="${versions.productVersion}"`)) throw new Error('MSI WiX source has incorrect product metadata.')
if (!wix.includes('<MajorUpgrade') || wix.includes('AllowDowngrades="yes"')) throw new Error('MSI upgrade policy is not the configured no-downgrade policy.')
if (wix.includes('ARPNOREPAIR')) throw new Error('MSI repair was disabled.')
for (const extension of ['md', 'markdown', 'txt']) {
  if (!wix.includes(`Extension Id="${extension}"`) || !wix.includes('TargetFile="Path"')) throw new Error(`MSI file association for .${extension} is incomplete.`)
}
if (invalidTargets.length > 0) throw new Error(`Portable/AppX/MSIX output is not allowed: ${invalidTargets.join(', ')}`)

const result = {
  status: 'passed',
  targetRoot,
  product: { name: 'W-Editor Desktop', version: versions.productVersion, architecture: 'x64' },
  packages: {
    nsis: { path: nsis, bytes: statSync(nsis).size, sha256: hashFile(nsis) },
    msi: { path: msi, bytes: statSync(msi).size, sha256: hashFile(msi) },
  },
  installerPolicy: {
    targets: ['nsis', 'msi'],
    fileAssociations: ['md', 'markdown', 'txt'],
    repair: true,
    allowDowngrades: false,
    portable: false,
    appx: false,
  },
}
console.log(JSON.stringify(result, null, 2))
