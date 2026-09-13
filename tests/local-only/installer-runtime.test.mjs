import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const installerPath = path.join(root, 'scripts', 'install-mcp-bridge.ps1');

async function localModuleClosure(entries) {
  const pending = [...entries];
  const found = new Set();
  while (pending.length) {
    const relative = pending.pop();
    if (found.has(relative)) continue;
    found.add(relative);
    const source = await readFile(path.join(root, relative), 'utf8');
    for (const match of source.matchAll(/(?:from\s+|import\(\s*)['"]([^'"]+)['"]/g)) {
      if (!match[1].startsWith('.')) continue;
      const dependency = path.relative(root, path.resolve(root, path.dirname(relative), match[1]));
      pending.push(dependency);
    }
  }
  return [...found].sort();
}

test('installer copies the complete native host and MCP module closure', async () => {
  const installer = await readFile(installerPath, 'utf8');
  const closure = await localModuleClosure(['bridge/native-host.mjs', 'bridge/mcp-server.mjs']);

  for (const relative of closure) {
    assert.ok(installer.includes(relative.replaceAll('/', '\\')), `installer is missing ${relative}`);
  }
  assert.match(installer, /\$hostScriptPath = Join-Path \$runtimeRoot 'bridge\\native-host\.mjs'/);
  assert.match(installer, /\$mcpServerPath = Join-Path \$runtimeRoot 'bridge\\mcp-server\.mjs'/);
  assert.match(installer, /\$nativeHostRoot = Join-Path \$InstallRoot 'native-host'/i);
  assert.doesNotMatch(installer, /\$nativeHostRoot = Join-Path \$projectRoot 'dist/);
});

test('installer remains local-only', async () => {
  const installer = await readFile(installerPath, 'utf8');
  assert.doesNotMatch(installer, /Invoke-WebRequest|Invoke-RestMethod|Start-BitsTransfer|\bcurl\b|\bwget\b|npm\s+(?:install|publish)|\bgit\s+(?:clone|pull|push)\b/i);
});

test('installer changes only the selected edition MCP registration and defaults to public', async () => {
  const installer = await readFile(installerPath, 'utf8');
  const pattern = installer.match(/\$pattern = '([^']+)' \+ \[regex\]::Escape\(\$Name\) \+ '([^']+)'/);
  assert.ok(pattern);
  assert.match(installer, /\$Edition = 'public'/);
  assert.match(installer, /\$mcpName = if \(\$Edition -eq 'public'\) \{ 'toolbraid' \} else \{ 'toolbraid_personal' \}/);
  for (const name of ['toolbraid', 'toolbraid_personal']) {
    const section = new RegExp(pattern[1] + name + pattern[2]);
    const other = name === 'toolbraid' ? 'toolbraid_personal' : 'toolbraid';
    assert.equal(section.test(`[mcp_servers.${name}]`), true);
    assert.equal(section.test(`[mcp_servers.${name}.env]`), true);
    assert.equal(section.test(`[mcp_servers.${other}]`), false);
    assert.equal(section.test(`[mcp_servers.${other}.env]`), false);
    assert.equal(section.test('[mcp_servers.other]'), false);
  }
});
