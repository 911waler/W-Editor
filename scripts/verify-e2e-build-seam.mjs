import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const expected = process.argv[2]
if (expected !== 'absent' && expected !== 'present') {
  throw new Error('Usage: verify-e2e-build-seam.mjs <absent|present>')
}

function listFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry)
    return statSync(path).isDirectory() ? listFiles(path) : [path]
  })
}

const marker = '__W_EDITOR_AUTHORITY__'
const found = listFiles(resolve('dist')).some((path) => readFileSync(path).includes(marker))
if (found !== (expected === 'present')) {
  throw new Error(`Expected the E2E authority marker to be ${expected} in dist.`)
}

console.log(`E2E authority marker is ${expected} in dist.`)
