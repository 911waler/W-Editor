import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const configPath = resolve('apps/desktop/src-tauri/tauri.conf.json')
const config = JSON.parse(readFileSync(configPath, 'utf8'))
const associations = config.bundle?.fileAssociations ?? []
const extensions = new Set(associations.flatMap((association) => association.ext ?? []))
const association = associations.find((candidate) => ['md', 'markdown', 'txt'].every((extension) => (candidate.ext ?? []).includes(extension)))
if (association === undefined) throw new Error('The Desktop bundle has no .md/.markdown/.txt file association.')
if (association.role !== 'Editor') throw new Error(`The Markdown association must be an Editor association, got ${association.role ?? '(missing)'}.`)
if (!String(association.description ?? '').toLocaleLowerCase().includes('import')) throw new Error('The file association must describe import into the Library.')
if (![...extensions].some((extension) => extension === 'md')) throw new Error('The Markdown association does not include .md.')
console.log(JSON.stringify({ status: 'passed', extensions: [...extensions].sort(), name: association.name, description: association.description, role: association.role }, null, 2))
