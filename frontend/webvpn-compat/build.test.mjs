import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { buildCompatibilityBundle } from '../../scripts/build-webvpn-compat.mjs';

const local = createRequire(new URL('../../package.json', import.meta.url));
const rolldownModule = createRequire(local.resolve('vite/package.json')).resolve('rolldown');

test('bundles static and lazy imports into an executable classic script without changing original assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vpn-build-test-'));
  const source = join(root, 'source');
  await mkdir(join(source, 'assets'), { recursive: true });
  const entry = "import { value } from './dep.js'; globalThis.answer = import('./late.js').then(m => value + m.value); export const label = 'entry';";
  await writeFile(join(source, 'assets/main.js'), entry);
  await writeFile(join(source, 'assets/dep.js'), 'export const value = 20;');
  await writeFile(join(source, 'assets/late.js'), 'export const value = 22;');
  await writeFile(join(source, 'index.html'), '<script type="module" src="/w-editor/web/assets/assets/main.js"></script><link rel="stylesheet" href="/w-editor/web/assets/assets/main.css">');
  await writeFile(join(source, 'assets/main.css'), 'body{color:red}');
  const result = await buildCompatibilityBundle({ sourceDir: source, outputDir: join(root, 'out'), rolldownModule });
  const code = await readFile(join(root, 'out', result.entries['index.html']), 'utf8');
  const context = vm.createContext({});
  new vm.Script(code).runInContext(context);
  assert.equal(await context.answer, 42);
  assert.equal(context.NWU911WebCompat.label, 'entry');
  assert.equal(await readFile(join(source, 'assets/main.js'), 'utf8'), entry);
  assert.equal(result.sourceHashes['assets/main.js'].length, 64);
  assert.equal(result.outputHashes[result.entries['index.html']].length, 64);
  const html = await readFile(join(root, 'out', 'index.html'), 'utf8');
  assert.ok(html.includes('/w-editor/web/assets/' + result.entries['index.html']));
  assert.ok(html.includes('main.css'));
  assert.ok(!html.includes('assets/main.js'));
  assert.equal(result.sourceHashes['index.html'].length, 64);
  assert.equal(result.buildHashes['preload.js'].length, 64);
});

test('rejects output inside source and entries outside the declared asset root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vpn-build-guard-'));
  await writeFile(join(root, 'index.html'), '<script type="module" src="/elsewhere/main.js"></script>');
  await assert.rejects(buildCompatibilityBundle({ sourceDir: root, outputDir: join(root, 'nested'), rolldownModule }), /output.*source/i);
  await assert.rejects(buildCompatibilityBundle({ sourceDir: root, outputDir: root + '-out', rolldownModule }), /asset prefix/i);
});

test('preserves async loading and CSS while removing module-only Vite preloads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vpn-preload-test-'));
  const source = join(root, 'source');
  await mkdir(join(source, 'assets'), { recursive: true });
  await writeFile(join(source, 'assets/main.js'), "import { t } from './preload-helper-fixture.js'; globalThis.answer=t(()=>import('./late.js'), ['assets/late.js','assets/late.css']).then(m=>m.value);");
  await writeFile(join(source, 'assets/late.js'), 'export const value = 42;');
  await writeFile(join(source, 'assets/preload-helper-fixture.js'), await readFile(new URL('./fixtures/vite-preload-helper.js', import.meta.url)));
  await writeFile(join(source, 'index.html'), '<script type="module" src="/w-editor/web/assets/assets/main.js"></script>');
  const result = await buildCompatibilityBundle({sourceDir:source,outputDir:join(root,'out'),rolldownModule});
  const links=[];
  const context=vm.createContext({URL,Event,window:{dispatchEvent:()=>true},document:{baseURI:'https://example.test/blogs/26',querySelector:()=>null,querySelectorAll:()=>[],head:{appendChild(link){links.push(link); queueMicrotask(()=>link.listeners.load());}},createElement(){return {listeners:{},addEventListener(name,fn){this.listeners[name]=fn;},setAttribute(){}};}}});
  new vm.Script(await readFile(join(root,'out',result.entries['index.html']),'utf8')).runInContext(context);
  assert.equal(await context.answer,42);
  assert.equal(links.length,1);
  assert.equal(links[0].rel,'stylesheet');
  assert.equal(links[0].href,'https://example.test/w-editor/web/assets/assets/late.css');
});
