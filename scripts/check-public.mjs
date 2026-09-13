import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const read = (file) => readFile(new URL(file, root), 'utf8');
const pkg = JSON.parse(await read('package.json'));
const manifest = JSON.parse(await read('extension/manifest.json'));
assert.equal(pkg.name, 'toolbraid-companion');
assert.equal(manifest.name, 'ToolBraid');
assert.equal(manifest.version, pkg.version);
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.background.type, 'module');
assert.ok(manifest.permissions.includes('debugger'));
assert.ok(!manifest.optional_permissions.includes('debugger'));
for (const field of ['content_scripts', 'host_permissions', 'externally_connectable', 'update_url']) {
  assert.ok(!(field in manifest), `Unexpected manifest field: ${field}`);
}
const id = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex')
  .slice(0, 32).replace(/[0-9a-f]/g, (digit) => 'abcdefghijklmnop'[parseInt(digit, 16)]);
assert.equal(id, 'gpjhdlbjfhlaeakphfognpijgmclecmn');
assert.equal(await read('extension/product.js'), "export const PUBLIC_RELEASE = true;\nexport const NATIVE_MCP_HOST = 'com.toolbraid.bridge';\n");
assert.match(await read('scripts/install-mcp-bridge.ps1'), /\$Edition = 'public'/);
console.log('PASS: public identity, version, permissions and installer defaults.');
