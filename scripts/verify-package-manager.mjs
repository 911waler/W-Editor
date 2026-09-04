import { existsSync } from 'node:fs'

const forbiddenLockfiles = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
]

const present = forbiddenLockfiles.filter((path) => existsSync(path))
if (present.length > 0) {
  throw new Error(`Only pnpm-lock.yaml is permitted; remove: ${present.join(', ')}`)
}

if (process.argv.includes('--install')) {
  const userAgent = process.env.npm_config_user_agent ?? ''
  if (!userAgent.startsWith('pnpm/11.19.0 ')) {
    throw new Error('Install dependencies with the declared pnpm@11.19.0 package manager.')
  }
}
