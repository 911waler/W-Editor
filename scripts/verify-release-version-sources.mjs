import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  EDITOR_WEB_RELEASE_VERSION_SOURCE_PATH,
  readReleaseVersions,
  renderEditorWebReleaseVersionSource,
} from './release-versions.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const actual = readFileSync(resolve(repositoryRoot, EDITOR_WEB_RELEASE_VERSION_SOURCE_PATH), 'utf8')
const expected = renderEditorWebReleaseVersionSource(readReleaseVersions(repositoryRoot))

if (actual !== expected) {
  throw new Error(`Generated release version source is stale: ${EDITOR_WEB_RELEASE_VERSION_SOURCE_PATH}. Run corepack pnpm run generate:release-version-sources.`)
}

console.log(`Release version source passed: ${EDITOR_WEB_RELEASE_VERSION_SOURCE_PATH}`)
