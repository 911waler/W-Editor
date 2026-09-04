import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = resolve(repositoryRoot, 'tests/fixtures/ownership/code-ownership.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const sourceExtensions = new Set(['.ts', '.tsx', '.vue', '.js', '.mjs'])
const errors = []

function collectFiles(directory) {
  if (!statSync(directory, { throwIfNoEntry: false })) return []
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...collectFiles(path))
    else if (sourceExtensions.has(entry.name.slice(entry.name.lastIndexOf('.')))) files.push(path)
  }
  return files
}

for (const [owner, ownerPath] of Object.entries(manifest.canonicalOwners)) {
  if (!statSync(resolve(repositoryRoot, ownerPath), { throwIfNoEntry: false })) {
    errors.push(`Canonical owner ${owner} is missing: ${ownerPath}.`)
  }
}

const duplicateNames = new Set(manifest.duplicateImplementationNames)
const duplicateDeclarations = new RegExp(`\\b(?:class|function|const|let|var)\\s+(?:${[...duplicateNames].join('|')})\\b`)
const localImplementationFile = /(?:command|codec|renderer|formula|table|tiptap|visual(?:editor)?|source(?:editor)?|preview|toolbar)/iu
const approvedHostContractFiles = new Set((manifest.approvedHostContractFiles ?? []).map((file) => file.split('\\').join('/')))

for (const rootPath of manifest.forbiddenDuplicateRoots) {
  const root = resolve(repositoryRoot, rootPath)
  for (const filePath of collectFiles(root)) {
    const label = relative(repositoryRoot, filePath)
    const source = readFileSync(filePath, 'utf8')
    if (duplicateDeclarations.test(source)) errors.push(`${label} declares a duplicate shared implementation.`)
    if (localImplementationFile.test(relative(root, filePath)) && !filePath.endsWith('index.ts') && !approvedHostContractFiles.has(label.split('\\').join('/'))) {
      errors.push(`${label} has a shared implementation-shaped filename outside its owner.`)
    }
  }
}

const ownerFiles = new Map()
for (const ownerPath of Object.values(manifest.canonicalOwners)) {
  for (const filePath of collectFiles(resolve(repositoryRoot, ownerPath))) {
    const name = filePath.slice(filePath.lastIndexOf('\\') + 1)
    if (!ownerFiles.has(name)) ownerFiles.set(name, [])
    ownerFiles.get(name).push(relative(repositoryRoot, filePath))
  }
}
for (const [name, files] of ownerFiles) {
  if (files.length > 1 && duplicateNames.has(name.replace(/\.[^.]+$/u, ''))) {
    errors.push(`Duplicate canonical owner filename ${name}: ${files.join(', ')}.`)
  }
}

if (errors.length > 0) {
  console.error('Code ownership failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exitCode = 1
} else {
  console.log('Code ownership passed.')
}
