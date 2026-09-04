import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const canonicalEntries = [
  'packages/editor-web/src/editorEntry.ts',
  'packages/editor-web/src/rendererEntry.ts',
  'packages/editor-web/src/iifeBuildEntry.ts',
].map((path) => resolve(repositoryRoot, path))

function validateEntry(filePath) {
  if (!existsSync(filePath)) throw new Error(`Web entry façade is missing: ${filePath}`)
  const source = readFileSync(filePath, 'utf8')
  const file = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const invalid = file.statements.filter((statement) => (
    !ts.isImportDeclaration(statement)
      && !ts.isExportDeclaration(statement)
  ))
  if (invalid.length > 0) {
    throw new Error(`${filePath} must contain only imports and re-exports; found ${invalid.length} implementation statement(s).`)
  }
}

const requestedEntries = process.argv.slice(2)
const entries = requestedEntries.length === 0 ? canonicalEntries : requestedEntries.map((path) => resolve(path))
for (const entry of entries) validateEntry(entry)
console.log(`Web entry façade gate passed: ${entries.length} entries contain only imports and re-exports.`)
