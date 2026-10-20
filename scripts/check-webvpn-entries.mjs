#!/usr/bin/env node
/** Validate the HTML-selected entries, not merely a compatibility file nearby. */
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

export async function checkWebVpnEntries(directory) {
  const root = resolve(directory);
  let checked = 0;
  for (const page of ['index.html', 'drawio-bridge.html']) {
    let html;
    try { html = await readFile(resolve(root, page), 'utf8'); }
    catch (error) { if (page !== 'index.html' && error.code === 'ENOENT') continue; throw error; }
    const entries = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)];
    if (!entries.length) throw new Error(`${page}: script entry missing`);
    for (const [, url] of entries) {
      const prefix = '/w-editor/web/assets/';
      if (!url.startsWith(prefix)) throw new Error(`${page}: unexpected asset prefix`);
      const path = resolve(root, url.slice(prefix.length));
      if (!path.startsWith(root + sep)) throw new Error(`${page}: entry escapes bundle`);
      new vm.Script(await readFile(path, 'utf8'), { filename: page });
      checked++;
    }
  }
  return checked;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Usage: check-webvpn-entries.mjs WEB_ROOT');
  console.log(`WebVPN entry check passed: ${await checkWebVpnEntries(process.argv[2])} scripts`);
}
