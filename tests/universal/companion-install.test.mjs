import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
const companion = process.env.TOOLBRAID_COMPANION_DIR ?? path.join(root, `dist/release-${version}/companion`);
const previousCompanion = process.env.TOOLBRAID_PREVIOUS_COMPANION_DIR ?? companion;
const enabled = process.platform === 'win32' && process.env.TOOLBRAID_INSTALL_TEST === '1';
const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');

function run(args) {
  const result = spawnSync(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 60_000,
    env: { ...process.env, PATH: path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32') },
  });
  assert.equal(result.status, 0, `${result.error?.message ?? ''}\n${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}

function registrations() {
  return JSON.parse(run(['-Command', `@('Google\\Chrome','Microsoft\\Edge') | ForEach-Object {
    $vendor = $_
    @('com.toolbraid.bridge','com.toolbraid.personal_bridge') | ForEach-Object {
      $key = "HKCU:\\Software\\$vendor\\NativeMessagingHosts\\$_"
      if (Test-Path -LiteralPath $key) { [pscustomobject]@{ key=$key; value=(Get-Item -LiteralPath $key).GetValue('') } }
    }
  } | ConvertTo-Json -Compress`]) || 'null') ?? [];
}

test('portable companion installs, updates, configures only the selected client and uninstalls', { skip: !enabled, timeout: 180_000 }, async (t) => {
  assert.ok(existsSync(path.join(companion, 'runtime/node.exe')), 'Build the release companion first.');
  const before = [].concat(registrations());
  assert.equal(before.some((entry) => entry.key.endsWith('com.toolbraid.bridge')), false, 'An existing public installation must not be replaced by this test.');
  const work = await mkdtemp(path.join(os.tmpdir(), 'toolbraid-install-test-'));
  const installRoot = path.join(work, "companion's files");
  const configPath = path.join(work, 'client.toml');
  const initialConfig = 'model = "test-sentinel"\n\n[mcp_servers.unrelated]\ncommand = "keep-me"\n';
  await writeFile(configPath, initialConfig);
  let installed = false;
  t.after(async () => {
    if (installed) run(['-File', path.join(installRoot, 'uninstall.ps1'), '-InstallRoot', installRoot]);
    assert.deepEqual([].concat(registrations()), before, 'Native-host registrations must be restored.');
    assert.equal(path.dirname(work), os.tmpdir());
    assert.ok(path.basename(work).startsWith('toolbraid-install-test-'));
    await rm(work, { recursive: true, force: true });
  });
  const installScript = path.join(companion, 'scripts/install-mcp-bridge.ps1');
  const installArgs = ['-File', installScript, '-Edition', 'public', '-InstallRoot', installRoot, '-ChromeExtensionId', 'a'.repeat(32), '-EdgeExtensionId', 'b'.repeat(32)];
  const firstInstallArgs = [...installArgs];
  firstInstallArgs[1] = path.join(previousCompanion, 'scripts/install-mcp-bridge.ps1');
  const first = JSON.parse(run([...firstInstallArgs, '-Client', 'None']));
  installed = true;
  assert.equal(first.installed, true);
  assert.equal(first.codexConfigured, false);
  assert.equal(await readFile(configPath, 'utf8'), initialConfig);
  const config = JSON.parse(await readFile(path.join(installRoot, 'bridge-config.json'), 'utf8'));
  assert.deepEqual(config.allowedOrigins, [`chrome-extension://${'a'.repeat(32)}/`, `chrome-extension://${'b'.repeat(32)}/`]);
  assert.equal(config.token.length, 64);
  assert.ok(existsSync(path.join(installRoot, 'runtime/node.exe')));
  assert.ok(existsSync(path.join(installRoot, 'runtime/LICENSE.node.txt')));
  assert.equal(existsSync(path.join(installRoot, 'ToolBraidNativeHostLauncher.cs')), false);
  const client = JSON.parse(await readFile(path.join(installRoot, 'mcp-client.json'), 'utf8'));
  assert.equal(client.mcpServers.toolbraid.command, path.join(installRoot, 'runtime/node.exe'));
  assert.equal([].concat(registrations()).filter((entry) => entry.key.endsWith('com.toolbraid.bridge')).length, 2);

  run([...installArgs, '-Client', 'Codex', '-CodexConfigPath', configPath]);
  const hash = async (file) => createHash('sha256').update(await readFile(file)).digest('hex');
  assert.equal(await hash(path.join(installRoot, 'native-host/ToolBraidNativeHost.exe')),
    await hash(path.join(companion, 'bridge/ToolBraidNativeHost.exe')), 'The update must install the candidate launcher.');
  const updated = JSON.parse(await readFile(path.join(installRoot, 'bridge-config.json'), 'utf8'));
  assert.equal(updated.token, config.token, 'An update must preserve the existing token.');
  const configured = await readFile(configPath, 'utf8');
  assert.ok(configured.includes('command = "keep-me"'));
  assert.equal((configured.match(/\[mcp_servers\.toolbraid\]/g) ?? []).length, 1);
  const commandLine = configured.split('[mcp_servers.toolbraid]')[1].match(/^command = (.+)$/m)[1];
  assert.equal(JSON.parse(commandLine), path.join(installRoot, 'runtime/node.exe'));
  run([...installArgs, '-Client', 'None']);
  assert.equal(await readFile(configPath, 'utf8'), configured, 'Client=None must not rewrite an existing client configuration.');
  const marker = JSON.parse(await readFile(path.join(installRoot, 'install-state.json'), 'utf8'));
  assert.equal(marker.codexConfig, configPath, 'A later update must retain ownership of its client entry.');
  run([...installArgs, '-Client', 'None', '-Browsers', 'Edge']);
  const selectedRegistrations = [].concat(registrations()).filter((entry) => entry.key.endsWith('com.toolbraid.bridge'));
  assert.equal(selectedRegistrations.length, 1);
  assert.ok(selectedRegistrations[0].key.includes('Microsoft\\Edge'));
  const selectedConfig = JSON.parse(await readFile(path.join(installRoot, 'bridge-config.json'), 'utf8'));
  assert.deepEqual(selectedConfig.allowedOrigins, [`chrome-extension://${'b'.repeat(32)}/`]);

  const removed = JSON.parse(run(['-File', path.join(installRoot, 'uninstall.ps1'), '-InstallRoot', installRoot]));
  installed = false;
  assert.equal(removed.uninstalled, true);
  assert.equal(removed.settingsAndDataPreserved, true);
  assert.equal(existsSync(path.join(installRoot, 'runtime/node.exe')), false);
  assert.equal(existsSync(path.join(installRoot, 'native-host/ToolBraidNativeHost.exe')), false);
  assert.equal(JSON.parse(await readFile(path.join(installRoot, 'bridge-config.json'), 'utf8')).token, config.token);
  const remainingConfig = await readFile(configPath, 'utf8');
  assert.ok(remainingConfig.includes('[mcp_servers.unrelated]'));
  assert.equal(remainingConfig.includes('[mcp_servers.toolbraid]'), false);
});
