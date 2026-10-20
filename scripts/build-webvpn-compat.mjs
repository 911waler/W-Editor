#!/usr/bin/env node
/** Add classic-script artifacts from an immutable, already deployed Web bundle. */
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const PREFIX = '/w-editor/web/assets/';
const hash = data => createHash('sha256').update(data).digest('hex');
const inside = (parent, child) => child === parent || child.startsWith(parent + sep);

export async function buildCompatibilityBundle({ sourceDir, outputDir, rolldownModule }) {
  const source = await realpath(sourceDir);
  const output = resolve(outputDir);
  if (inside(source, output)) throw new Error('Output must be outside source');
  const entries = {};
  const pages = {};
  for (const page of ['index.html', 'drawio-bridge.html']) {
    let html;
    try { html = await readFile(resolve(source, page), 'utf8'); }
    catch (error) { if (page !== 'index.html' && error.code === 'ENOENT') continue; throw error; }
    const match = html.match(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i);
    if (!match || !match[1].startsWith(PREFIX)) throw new Error('Entry must use the declared asset prefix');
    const input = await realpath(resolve(source, match[1].slice(PREFIX.length)));
    if (!inside(source, input)) throw new Error('Entry escapes asset prefix');
    entries[page] = input;
    pages[page] = { html, entry: match[1] };
  }
  try { await access(output); throw new Error('Output directory already exists'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const { rolldown, VERSION } = await import(pathToFileURL(resolve(rolldownModule)).href);
  if (VERSION !== '1.2.5') throw new Error(`Expected Rolldown 1.2.5, got ${VERSION}`);
  const manifest = { version: 1, compiler: `rolldown@${VERSION}`, entries: {}, sourceHashes: {}, outputHashes: {}, buildHashes: {
    'build-webvpn-compat.mjs': hash(await readFile(new URL(import.meta.url))),
    'preload.js': hash(await readFile(new URL('../frontend/webvpn-compat/preload.js', import.meta.url))),
  } };
  const artifacts = [];
  for (const [page, input] of Object.entries(entries)) {
    const bundle = await rolldown({ input, platform: 'browser', transform: { target: 'es2018' },
      // Profiling duration depends on host load and is not an artifact warning.
      checks: { pluginTimings: false },
      plugins: [{ name: 'classic-css-preload', async load(id) {
        if (!/[/\\]preload-helper-[^/\\]+\.js$/.test(id)) return null;
        const original = await readFile(id, 'utf8');
        if (!original.includes('import.meta') || !original.includes('modulepreload') || !/export\{\w+ as t\}/.test(original)) throw new Error('Unrecognized Vite preload helper');
        return await readFile(new URL('../frontend/webvpn-compat/preload.js', import.meta.url), 'utf8');
      } }],
      onwarn(warning) { throw new Error(`Build warning: ${warning.code}: ${warning.message}`); } });
    try {
      const result = await bundle.generate({ format: 'iife', name: page === 'index.html' ? 'NWU911WebCompat' : 'NWU911DrawioCompat', codeSplitting: false, minify: true });
      if (result.output.length !== 1 || result.output[0].type !== 'chunk') throw new Error('Expected exactly one classic script per entry');
      const chunk = result.output[0];
      new vm.Script(chunk.code); // Reject residual module syntax before publishing.
      for (const id of chunk.moduleIds) {
        if (id.startsWith('\0')) continue;
        const path = await realpath(id);
        if (!inside(source, path)) throw new Error('Dependency escapes source bundle');
        manifest.sourceHashes[relative(source, path)] = hash(await readFile(path));
      }
      const digest = hash(chunk.code);
      const name = `${page.replace('.html', '')}-classic-${digest.slice(0,16)}.js`;
      manifest.entries[page] = name;
      manifest.outputHashes[name] = digest;
      artifacts.push([name, chunk.code]);
      const { html, entry } = pages[page];
      manifest.sourceHashes[page] = hash(html);
      const updated = html.replace(entry, PREFIX + name).replace(/<link\b[^>]*\brel=["']modulepreload["'][^>]*>/gi, '');
      manifest.outputHashes[page] = hash(updated);
      artifacts.push([page, updated]);
    } finally { await bundle.close(); }
  }
  await mkdir(output, { recursive: true });
  for (const [name, code] of artifacts) await writeFile(resolve(output, name), code, { flag: 'wx' });
  await writeFile(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [sourceDir, outputDir, rolldownModule] = process.argv.slice(2);
  if (!sourceDir || !outputDir || !rolldownModule) throw new Error('Usage: build-webvpn-compat.mjs SOURCE_BUNDLE NEW_OUTPUT_DIR ROLLDOWN_MODULE');
  console.log(JSON.stringify(await buildCompatibilityBundle({ sourceDir, outputDir, rolldownModule }), null, 2));
}
