import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkWebVpnEntries } from '../../scripts/check-webvpn-entries.mjs';

test('rejects a new ESM entry even when an old compatible script remains in the bundle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vpn-entry-test-'));
  await writeFile(join(root, 'classic.js'), '(function(){ return 1; })();');
  await writeFile(join(root, 'new.js'), 'import { value } from "./dep.js";');
  await writeFile(join(root, 'index.html'), '<script type="module" src="/w-editor/web/assets/new.js"></script>');
  await assert.rejects(checkWebVpnEntries(root), SyntaxError);
  await writeFile(join(root, 'index.html'), '<script type="module" src="/w-editor/web/assets/classic.js"></script>');
  assert.equal(await checkWebVpnEntries(root), 1);
  await writeFile(join(root, 'drawio-bridge.html'), '<script type="module" src="/w-editor/web/assets/new.js"></script>');
  await assert.rejects(checkWebVpnEntries(root), SyntaxError);
});
