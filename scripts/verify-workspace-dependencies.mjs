import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const packages = new Map([
  ['@w-editor/editor-core', 'packages/editor-core'],
  ['@w-editor/editor-vue', 'packages/editor-vue'],
  ['@w-editor/editor-web', 'packages/editor-web'],
  ['@w-editor/playground', 'apps/playground'],
  ['@w-editor/desktop', 'apps/desktop'],
  ['@w-editor/nwu-host', 'examples/nwu-host'],
])

const allowedWorkspaceDependencies = new Map([
  ['@w-editor/editor-core', new Set()],
  ['@w-editor/editor-vue', new Set(['@w-editor/editor-core'])],
  ['@w-editor/editor-web', new Set(['@w-editor/editor-core', '@w-editor/editor-vue'])],
  ['@w-editor/playground', new Set(['@w-editor/editor-core', '@w-editor/editor-vue', '@w-editor/editor-web'])],
  ['@w-editor/desktop', new Set(['@w-editor/editor-core', '@w-editor/editor-vue', '@w-editor/editor-web', '@w-editor/playground'])],
  ['@w-editor/nwu-host', new Set(['@w-editor/editor-web'])],
])

const sharedPackageNames = new Set([
  '@w-editor/editor-core',
  '@w-editor/editor-vue',
  '@w-editor/editor-web',
])

const sourceExtensions = new Set(['.ts', '.tsx', '.vue', '.js', '.mjs'])

function collectSourceFiles(directory) {
  if (!statSync(directory, { throwIfNoEntry: false })) return []
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...collectSourceFiles(entryPath))
    else if (sourceExtensions.has(entry.name.slice(entry.name.lastIndexOf('.')))) files.push(entryPath)
  }
  return files
}

function readManifest(packageName, packagePath) {
  return JSON.parse(readFileSync(join(repositoryRoot, packagePath, 'package.json'), 'utf8'))
}

function workspaceDependencies(manifest) {
  return Object.keys({
    ...(manifest.dependencies ?? {}),
    ...(manifest.devDependencies ?? {}),
    ...(manifest.optionalDependencies ?? {}),
    ...(manifest.peerDependencies ?? {}),
  }).filter((dependency) => packages.has(dependency))
}

function importSpecifiers(source) {
  const specifiers = []
  const importPattern = /(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\()(['"])([^'"\n]+)\1/g
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[2]
    if (specifier !== undefined) specifiers.push(specifier)
  }
  return specifiers
}

function isHostPrivateSpecifier(specifier) {
  return /(?:^|[\\/])(?:apps\/desktop|apps\/playground|examples\/nwu-host)(?:[\\/]|$)/i.test(specifier)
    || /^@w-editor\/(?:desktop|playground|nwu-host)(?:\/|$)/.test(specifier)
}

function checkManifestDirection(errors) {
  for (const [packageName, packagePath] of packages) {
    const manifest = readManifest(packageName, packagePath)
    const allowed = allowedWorkspaceDependencies.get(packageName) ?? new Set()
    for (const dependency of workspaceDependencies(manifest)) {
      if (!allowed.has(dependency)) {
        errors.push(`${packageName}/package.json declares forbidden workspace dependency ${dependency}.`)
      }
    }
  }
}

function checkSourceDirection(errors) {
  for (const [packageName, packagePath] of packages) {
    const sourceRoot = resolve(repositoryRoot, packagePath, 'src')
    for (const filePath of collectSourceFiles(sourceRoot)) {
      const source = readFileSync(filePath, 'utf8')
      const label = relative(repositoryRoot, filePath)
      for (const specifier of importSpecifiers(source)) {
        if (isHostPrivateSpecifier(specifier) && sharedPackageNames.has(packageName)) {
          errors.push(`${label} imports host-private path ${specifier}.`)
        }
        if (specifier.startsWith('.')) {
          const resolvedSpecifier = resolve(dirname(filePath), specifier)
          if (relative(sourceRoot, resolvedSpecifier).startsWith('..')) {
            errors.push(`${label} escapes ${packageName} source root through ${specifier}.`)
          }
        }
      }

      if (packageName === '@w-editor/editor-core') {
        if (importSpecifiers(source).some((specifier) => specifier === 'vue'
          || specifier.startsWith('@vue/')
          || specifier === '@tiptap/vue')) {
          errors.push(`${label} imports Vue, which is forbidden in editor-core.`)
        }
        if (/\b(?:document|window|navigator)\s*\.\s*(?:querySelector(?:All)?|getElementById|create(?:Element|TextNode)|documentElement|body|head|addEventListener|removeEventListener|location|origin|parent|scroll(?:By|To)|inner(?:Width|Height)|devicePixelRatio)\b|\b(?:localStorage|sessionStorage|indexedDB)\b|\b(?:DOMParser|MutationObserver|HTMLElement)\b/.test(source)) {
          errors.push(`${label} references DOM or browser storage, which is forbidden in editor-core.`)
        }
        if (/@tauri|\b(?:sqlite|better-sqlite3|sql\.js)\b|nwu-host|NWU-911/i.test(source)) {
          errors.push(`${label} references Tauri, SQLite, or NWU host implementation details.`)
        }
      }
    }
  }
}

const errors = []
checkManifestDirection(errors)
checkSourceDirection(errors)

if (errors.length > 0) {
  console.error('Workspace dependency direction failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exitCode = 1
} else {
  console.log('Workspace dependency direction passed.')
}
