import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const securityErrorPatterns = [
  /\b(?:event(?:\s*id)?\s*[:=]?\s*|error\s*:?\s*)11926\b/i,
  /\berror\s*:?\s*1926\b/i,
  /(?:could not set file security|setting file security failed)/i,
  /\b1926\b.*(?:config\.msi|file security)/i,
]

export function findMsiSecurityErrors(text) {
  const findings = []
  for (const line of text.split(/\r?\n/u)) {
    const normalized = line.trim()
    if (normalized.length === 0 || !securityErrorPatterns.some((pattern) => pattern.test(normalized))) continue
    if (!findings.includes(normalized)) findings.push(normalized)
  }
  return findings
}

export function decodeMsiLog(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.toString('utf16le', 2)
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.alloc(bytes.length - 2)
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      swapped[index - 2] = bytes[index + 1]
      swapped[index - 1] = bytes[index]
    }
    return swapped.toString('utf16le')
  }
  return bytes.toString('utf8')
}

export function assertNoMsiSecurityErrors(text, label = 'MSI log') {
  const findings = findMsiSecurityErrors(text)
  if (findings.length > 0) {
    throw new Error(`${label} contains MSI security failures:\n${findings.join('\n')}`)
  }
  return true
}

function readInput(path) {
  const absolutePath = resolve(path)
  if (!existsSync(absolutePath)) throw new Error(`MSI event input is missing: ${absolutePath}`)
  return { path: absolutePath, text: decodeMsiLog(readFileSync(absolutePath)) }
}

function runCli() {
  const inputPaths = process.argv.slice(2).filter((path, index) => !(index === 0 && path === '--'))
  if (inputPaths.length === 0) {
    console.error('Usage: node scripts/verify-msi-install-events.mjs <verbose-msi-log-or-event-dump> [...]')
    process.exitCode = 2
    return
  }

  const inputs = inputPaths.map(readInput)
  const findings = inputs.flatMap(({ path, text }) => findMsiSecurityErrors(text).map((line) => ({ path, line })))
  const result = {
    status: findings.length === 0 ? 'passed' : 'failed',
    inputs: inputs.map(({ path }) => path),
    findings,
    rule: 'Any MSI 1926/11926 or file-security failure fails the gate even when msiexec returns zero.',
  }
  console.log(JSON.stringify(result, null, 2))
  if (findings.length > 0) process.exitCode = 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) runCli()
