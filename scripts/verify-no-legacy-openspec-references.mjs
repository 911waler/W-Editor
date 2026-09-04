import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const repositoryRoot = resolve(new URL('..', import.meta.url).pathname)
const legacyChangeName = ['bootstrap', 'executable', 'w-editor'].join('-')
const scanRoots = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'docs',
  'openspec',
  'scripts',
  'src',
  'tests',
]
const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'coverage', '.tmp'])
const textExtensions = new Set(['.json', '.md', '.mjs', '.ts', '.tsx', '.vue', '.yaml', '.yml', '.html', '.css'])

function collectFiles(path) {
  if (!existsSync(path)) return []
  const entry = statSync(path)
  if (entry.isFile()) return [path]
  return readdirSync(path, { withFileTypes: true }).flatMap((child) => {
    if (child.isDirectory() && ignoredDirectories.has(child.name)) return []
    return collectFiles(join(path, child.name))
  })
}

const findings = scanRoots
  .flatMap((root) => collectFiles(resolve(repositoryRoot, root)))
  .filter((path) => textExtensions.has(path.slice(path.lastIndexOf('.')).toLowerCase()) || path.endsWith('package.json'))
  .flatMap((path) => {
    const source = readFileSync(path, 'utf8')
    if (!source.includes(legacyChangeName)) return []
    const lines = source.split(/\r?\n/u)
    return lines.flatMap((line, index) => line.includes(legacyChangeName)
      ? [{ file: relative(repositoryRoot, path).replaceAll('\\', '/'), line: index + 1 }]
      : [])
  })

if (findings.length > 0) {
  console.error(JSON.stringify({ status: 'failed', legacyChangeName, findings }, null, 2))
  process.exitCode = 1
} else {
  console.log('Legacy OpenSpec change reference gate passed: zero references in scoped repository inputs.')
}
