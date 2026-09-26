import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const psQuote = value => `'${value.replaceAll("'", "''")}'`;
const ps = args => spawnSync(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], {
  encoding: 'utf8', windowsHide: true, timeout: 30000,
  env: { ...process.env, PSModulePath: path.join(path.dirname(powershell), 'Modules') },
});

test('release signing is opt-in, provenance-bound and cannot publish a release', async () => {
  const workflow = await readFile(path.join(root, '.github/workflows/sign-windows.yml'), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /default: false/);
  assert.match(workflow, /github\.repository == 'Maharajahu\/ToolBraid-Companion' && github\.ref == 'refs\/heads\/main'/);
  assert.doesNotMatch(workflow, /contents: write|pull_request|build-store|gh release|SIGNPATH_API_TOKEN:\s*[^$\s]/);
  assert.match(workflow, /github-artifact-id: \$\{\{ steps\.unsigned\.outputs\.artifact-id \}\}/);
  assert.match(workflow, /verify-signed-release\.ps1/);
  for (const action of workflow.matchAll(/uses: (.+)/g)) assert.match(action[1], /@[a-f0-9]{40}(?: |$)/);
  const config = await readFile(path.join(root, '.signpath/artifact-configuration.xml'), 'utf8');
  assert.equal((config.match(/<authenticode-sign\s*\/>/g) ?? []).length, 1);
  assert.match(config, /path="bridge\/ToolBraidNativeHost\.exe"/);
  assert.match(config, /product-name="ToolBraid Companion"/);
  assert.doesNotMatch(config, /node\.exe|powershell-file|msix-file/);
});

test('compiled signing metadata and package rejection checks', { skip: process.platform !== 'win32', timeout: 60000 }, async t => {
  const work = await mkdtemp(path.join(os.tmpdir(), 'toolbraid-signing-test-'));
  t.after(async () => {
    assert.equal(path.dirname(work), path.resolve(os.tmpdir()));
    assert.ok(path.basename(work).startsWith('toolbraid-signing-test-'));
    await rm(work, { recursive: true, force: true });
  });
  const compile = ps(['-Command', `
    $ErrorActionPreference = 'Stop'
    $work = ${psQuote(work)}
    $source = ${psQuote(path.join(root, 'bridge/ToolBraidNativeHostLauncher.cs'))}
    $exe = Join-Path $work 'ToolBraidNativeHost.exe'
    & "$env:WINDIR\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe" /nologo /target:exe /define:PORTABLE "/out:$exe" $source
    if ($LASTEXITCODE -ne 0) { throw 'Compilation failed' }
    [xml]$xml = Get-Content -LiteralPath ${psQuote(path.join(root, '.signpath/artifact-configuration.xml'))} -Raw
    Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
    foreach ($kind in @('original','unsigned','changed','missing','duplicate')) {
      $zip = [IO.Compression.ZipFile]::Open((Join-Path $work "$kind.zip"), [IO.Compression.ZipArchiveMode]::Create)
      try {
        if ($kind -ne 'missing') { [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $exe, 'bridge/ToolBraidNativeHost.exe') | Out-Null }
        $writer = [IO.StreamWriter]::new($zip.CreateEntry('runtime/node.exe').Open())
        try { $writer.Write($(if ($kind -eq 'changed') { 'changed fixture' } else { 'original fixture' })) } finally { $writer.Dispose() }
        if ($kind -eq 'duplicate') { $zip.CreateEntry('RUNTIME/NODE.EXE') | Out-Null }
      } finally { $zip.Dispose() }
    }
    [Diagnostics.FileVersionInfo]::GetVersionInfo($exe) | Select-Object ProductName,CompanyName,ProductVersion,FileVersion | ConvertTo-Json -Compress
  `]);
  assert.equal(compile.status, 0, compile.stderr || compile.error?.message);
  const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
  assert.deepEqual(JSON.parse(compile.stdout.trim()), {
    ProductName: 'ToolBraid Companion', CompanyName: 'Maharajahu', ProductVersion: version, FileVersion: `${version}.0`,
  });
  for (const [kind, reason] of [
    ['unsigned', /signature is not trusted: NotSigned/],
    ['changed', /Unexpected modified file: runtime\/node\.exe/],
    ['missing', /Native host launcher is missing/],
    ['duplicate', /Unsafe or duplicate ZIP entry/],
  ]) {
    await t.test(`rejects ${kind} package`, () => {
      const result = ps(['-File', path.join(root, 'scripts/verify-signed-release.ps1'),
        '-UnsignedPackage', path.join(work, 'original.zip'), '-SignedPackage', path.join(work, `${kind}.zip`)]);
      assert.equal(result.status, 1, result.error?.message ?? result.stdout);
      assert.match(result.stderr, reason);
    });
  }
  await assert.rejects(readFile(path.join(work, 'SHA256SUMS.txt')), { code: 'ENOENT' });
});
