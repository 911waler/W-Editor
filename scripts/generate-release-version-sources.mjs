import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  EDITOR_WEB_RELEASE_VERSION_SOURCE_PATH,
  readReleaseVersions,
  renderEditorWebReleaseVersionSource,
} from './release-versions.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const targetPath = resolve(repositoryRoot, EDITOR_WEB_RELEASE_VERSION_SOURCE_PATH)
const expected = renderEditorWebReleaseVersionSource(readReleaseVersions(repositoryRoot))
const current = existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : null

if (current !== expected) writeFileSync(targetPath, expected, 'utf8')
console.log(`Release version source generated: ${EDITOR_WEB_RELEASE_VERSION_SOURCE_PATH}`)
