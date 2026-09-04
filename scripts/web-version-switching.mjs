import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { relative, resolve, dirname } from 'node:path'

import { readReleaseVersions } from './release-versions.mjs'

const POINTER_SCHEMA_VERSION = 1
const VERSION_SEGMENT = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u
const RELEASE_VERSIONS = readReleaseVersions(resolve(import.meta.dirname, '..'))

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

function fileDigest(path) {
  return digest(readFileSync(path))
}

function assertSafeVersion(version) {
  if (typeof version !== 'string' || !VERSION_SEGMENT.test(version)) throw new TypeError(`Invalid Web version directory: ${String(version)}`)
  return version
}

function assertSafeResourcePath(resourcePath) {
  if (typeof resourcePath !== 'string' || resourcePath.length === 0 || resourcePath.startsWith('/') || resourcePath.includes('\\')) {
    throw new TypeError(`Invalid versioned Web resource path: ${String(resourcePath)}`)
  }
  const normalized = resourcePath.split('/').filter(Boolean)
  if (normalized.length === 0 || normalized.some((segment) => segment === '.' || segment === '..')) {
    throw new TypeError(`Versioned Web resource path escapes its version root: ${resourcePath}`)
  }
  return normalized.join('/')
}

function semverParts(value) {
  if (typeof value !== 'string') return null
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?/u.exec(value)
  return match === null
    ? null
    : { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] }
}

function compatibleMajor(value, expected) {
  const actual = semverParts(value)
  const required = semverParts(expected)
  return actual !== null && required !== null && actual.major === required.major
}

function atLeast(value, minimum) {
  const actual = semverParts(value)
  const required = semverParts(minimum)
  if (actual === null || required === null || actual.major !== required.major) return false
  if (actual.minor !== required.minor) return actual.minor > required.minor
  return actual.patch >= required.patch
}

function manifestFiles(directory, manifest) {
  if (!Array.isArray(manifest.files)) throw new TypeError('Web version manifest files are missing.')
  const root = resolve(directory)
  const files = manifest.files.map((file) => {
    if (typeof file?.path !== 'string' || file.path.startsWith('/') || file.path.includes('\\')) throw new TypeError(`Invalid Web manifest path: ${String(file?.path)}`)
    const absolute = resolve(root, file.path)
    const relativePath = relative(root, absolute).replaceAll('\\', '/')
    if (relativePath === '' || relativePath.startsWith('../') || relativePath === '..') throw new TypeError(`Web manifest path escapes its version root: ${file.path}`)
    if (!existsSync(absolute) || !statSync(absolute).isFile()) throw new Error(`Web version file is missing: ${file.path}`)
    const size = statSync(absolute).size
    if (size !== file.size || fileDigest(absolute) !== file.sha256) throw new Error(`Web version file hash mismatch: ${file.path}`)
    return { path: file.path, sha256: file.sha256, size }
  })
  return files
}

export function inspectWebVersion({ directory, hostAdapterVersion = RELEASE_VERSIONS.minimumHostAdapterVersion, version }) {
  try {
    const safeVersion = assertSafeVersion(version)
    const manifestPath = resolve(directory, 'manifest.json')
    if (!existsSync(manifestPath)) throw new Error('Web version manifest is missing.')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (manifest.manifestVersion !== RELEASE_VERSIONS.manifestVersion
      || manifest.productName !== 'w-editor'
      || manifest.productVersion !== RELEASE_VERSIONS.productVersion
      || manifest.apiVersion !== RELEASE_VERSIONS.webApiVersion
      || manifest.schemaVersion !== RELEASE_VERSIONS.webSchemaVersion
      || manifest.hostContractsVersion !== RELEASE_VERSIONS.hostContractsVersion
      || manifest.minimumHostAdapterVersion !== RELEASE_VERSIONS.minimumHostAdapterVersion
      || manifest.markdownDialectVersion !== RELEASE_VERSIONS.markdownDialectVersion
      || manifest.databaseSchemaVersion !== RELEASE_VERSIONS.databaseSchemaVersion) {
      throw new Error('Web version manifest identity or API/schema/dialect version is incompatible.')
    }
    if (!compatibleMajor(manifest.apiVersion, RELEASE_VERSIONS.webApiVersion)
      || !compatibleMajor(manifest.schemaVersion, RELEASE_VERSIONS.webSchemaVersion)
      || !atLeast(hostAdapterVersion, RELEASE_VERSIONS.minimumHostAdapterVersion)) {
      throw new Error('Web version API/schema or host adapter version is incompatible.')
    }
    if (manifest.testSeam?.status !== 'absent' || manifest.drawio?.lazy !== true) throw new Error('Web version manifest is not a releasable closure.')
    const files = manifestFiles(directory, manifest)
    const fingerprint = Buffer.from(files.map(({ path, sha256, size }) => `${path}\0${size}\0${sha256}`).join('\n'), 'utf8')
    if (digest(fingerprint) !== manifest.contentSha256) throw new Error('Web version content hash does not match its manifest.')
    return Object.freeze({
      contentSha256: manifest.contentSha256,
      directory: resolve(directory),
      fileCount: files.length,
      manifestSha256: fileDigest(manifestPath),
      status: 'compatible',
      version: safeVersion,
    })
  } catch (failure) {
    return Object.freeze({
      reason: failure instanceof Error ? failure.message : String(failure),
      status: 'incompatible',
      version,
    })
  }
}

export function versionedAssetUrl(origin, version, resourcePath) {
  const url = new URL(origin)
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username.length > 0 || url.password.length > 0) throw new TypeError('Web version origin must be an HTTP(S) origin without credentials.')
  const safeVersion = assertSafeVersion(version)
  const safeResourcePath = assertSafeResourcePath(resourcePath)
  return new URL(`/static/vendor/w-editor/${safeVersion}/${safeResourcePath}`, `${url.origin}/`).href
}

function pointerPayload(activeVersion) {
  return Object.freeze({
    activeVersion: assertSafeVersion(activeVersion),
    schemaVersion: POINTER_SCHEMA_VERSION,
  })
}

export function createAtomicVersionPointer(pointerPath, initialVersion) {
  const path = resolve(pointerPath)
  mkdirSync(dirname(path), { recursive: true })
  if (!existsSync(path)) writeFileSync(path, `${JSON.stringify(pointerPayload(initialVersion))}\n`, 'utf8')

  const read = async () => {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    if (value?.schemaVersion !== POINTER_SCHEMA_VERSION) throw new Error('Web version pointer schema is invalid.')
    return pointerPayload(value.activeVersion)
  }

  const switchTo = async (candidate, verify) => {
    const previous = await read()
    const candidateVersion = assertSafeVersion(candidate.version)
    let temporaryPath = null
    try {
      const verification = await verify(Object.freeze({ ...candidate, version: candidateVersion }))
      if (verification?.ok !== true) {
        return Object.freeze({
          activeVersion: previous.activeVersion,
          candidateVersion,
          reason: verification?.reason ?? 'Candidate verification failed.',
          status: 'rolled-back',
        })
      }
      temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`
      writeFileSync(temporaryPath, `${JSON.stringify(pointerPayload(candidateVersion))}\n`, { encoding: 'utf8', flag: 'wx' })
      renameSync(temporaryPath, path)
      temporaryPath = null
      return Object.freeze({ activeVersion: candidateVersion, candidateVersion, status: 'switched' })
    } catch (failure) {
      if (temporaryPath !== null) rmSync(temporaryPath, { force: true })
      return Object.freeze({
        activeVersion: previous.activeVersion,
        candidateVersion,
        reason: failure instanceof Error ? failure.message : String(failure),
        status: 'rolled-back',
      })
    }
  }

  return Object.freeze({ read, switchTo })
}
