#!/usr/bin/env node
/** Build the existing NWU WebVPN distribution using this checkout's tools. */
import { spawnSync } from 'node:child_process';
import { access, copyFile, cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCompatibilityBundle } from './build-webvpn-compat.mjs';
import { checkWebVpnEntries } from './check-webvpn-entries.mjs';

const source = fileURLToPath(new URL('..', import.meta.url));
const [destination, ...extra] = process.argv.slice(2);
if (!destination || extra.length) throw new Error('Usage: node scripts/build-webvpn.mjs NEW_OUTPUT_DIRECTORY');
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 or newer is required');
const output = resolve(destination);

async function exists(path) {
  try { await access(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd: source,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.signal ?? result.status})`);
  return result.stdout?.trim();
}

// Never let Vite empty an existing checkout or a previous release directory.
if (await exists(output)) throw new Error('Output directory already exists; choose a new directory');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
if (!run(pnpm, ['--version'], true).startsWith('11.')) throw new Error('pnpm 11 is required');
const local = createRequire(new URL('../package.json', import.meta.url));
const rolldownModule = createRequire(local.resolve('vite/package.json')).resolve('rolldown');

run(pnpm, ['exec', 'vite', 'build', '--base=/w-editor/web/assets/', `--outDir=${output}`]);
// Every Vite build needs this step: raw ESM entries restore the WebVPN parse failure.
const work = await mkdtemp(join(dirname(output), `${basename(output)}.webvpn-`));
const packageDir = join(work, 'package');
const manifest = await buildCompatibilityBundle({ sourceDir: output, outputDir: packageDir, rolldownModule });
await writeFile(join(work, 'build.log'), JSON.stringify(manifest, null, 2) + '\n');
run('python3', [join(source, 'scripts/install-webvpn-compat.py'), output, packageDir, join(work, 'before'), '--apply']);
await copyFile(join(packageDir, 'manifest.json'), join(output, 'webvpn-compat-manifest.json'));
console.log(`WebVPN entry check passed: ${await checkWebVpnEntries(output)} scripts`);
await copyFile(join(source, 'LICENSE'), join(output, 'LICENSE'));

// Preserve citation-formatting redistribution notices from the existing build.
const csl = join(source, 'packages/editor-vue/src/services/csl');
if (await exists(csl)) {
  const licenses = join(output, 'licenses/citation-formatting');
  await mkdir(licenses, { recursive: true });
  await cp(csl, licenses, { recursive: true });
}
if (await exists(join(source, '.git'))) {
  await writeFile(join(output, 'source-commit.txt'), run('git', ['rev-parse', 'HEAD'], true) + '\n');
} else {
  await copyFile(join(source, 'source-commit.txt'), join(output, 'source-commit.txt'));
}
const metadata = dirname(source);
if (await exists(join(metadata, 'source-manifest.json'))) {
  await copyFile(join(metadata, 'source-manifest.json'), join(output, 'source-manifest.json'));
  await copyFile(join(metadata, 'source-description.txt'), join(output, 'source-description.txt'));
}
console.log(`WebVPN distribution: ${output}\nCompatibility package and original HTML backup: ${work}`);
