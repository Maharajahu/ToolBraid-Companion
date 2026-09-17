param([switch] $ManifestOnly)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
[xml]$storeManifest = Get-Content -LiteralPath (Join-Path $projectRoot 'store\AppxManifest.xml') -Raw
$storeApps = @($storeManifest.Package.Applications.Application)
if ($storeApps.Count -ne 1 -or $storeApps[0].Id -ne 'Companion' -or $storeApps[0].VisualElements.AppListEntry -eq 'none') { throw 'The Store package must expose one visible companion, not headless helper applications.' }
$storeExtensions = @($storeApps[0].Extensions.Extension)
if ($storeExtensions.Count -ne 1 -or $storeExtensions[0].Category -ne 'windows.appExecutionAlias' -or $storeExtensions[0].Executable -ne 'bridge\ToolBraidNativeHost.exe') { throw 'Store aliases must share one connection launcher extension.' }
$storeAliases = @($storeExtensions[0].AppExecutionAlias.ExecutionAlias)
if ($storeAliases.Count -ne 2) { throw 'The Store package must expose both connection aliases.' }
foreach ($launcher in @('ToolBraidNativeHost.exe', 'ToolBraidMcp.exe')) {
  if (@($storeAliases | Where-Object { $_.Alias -eq $launcher }).Count -ne 1) { throw "Incorrect Store alias: $launcher" }
}
if ($storeExtensions[0].AppExecutionAlias.GetAttribute('Subsystem', 'http://schemas.microsoft.com/appx/manifest/uap/windows10/10') -ne 'console') { throw 'The Store aliases must retain console transport.' }
if ($storeApps[0].GetAttribute('SupportsMultipleInstances', 'http://schemas.microsoft.com/appx/manifest/uap/windows10/10') -ne 'true') { throw 'Concurrent browser/MCP connections require multiple instances.' }
$namespaces = [Xml.XmlNamespaceManager]::new($storeManifest.NameTable)
$namespaces.AddNamespace('m', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10')
$namespaces.AddNamespace('v', 'http://schemas.microsoft.com/appx/manifest/virtualization/windows10')
$namespaces.AddNamespace('r', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities')
$namespaces.AddNamespace('legacy', 'http://schemas.microsoft.com/appx/manifest/desktop/windows10/6')
if ($storeManifest.Package.Dependencies.TargetDeviceFamily.Name -ne 'Windows.Desktop' -or
    [version]$storeManifest.Package.Dependencies.TargetDeviceFamily.MinVersion -lt [version]'10.0.22000.0') {
  throw 'Scoped Store virtualization requires Windows 11 or later; Windows 10 must not be admitted.'
}
if ($storeManifest.SelectNodes('//legacy:RegistryWriteVirtualization | //legacy:FileSystemWriteVirtualization', $namespaces).Count) {
  throw 'Broad legacy registry/AppData virtualization switches must not be declared.'
}
$expectedKeys = @(
  'HKEY_CURRENT_USER\Software\Microsoft\Edge\NativeMessagingHosts\com.toolbraid.bridge',
  'HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\com.toolbraid.bridge'
)
$actualKeys = @($storeManifest.SelectNodes('/m:Package/m:Properties/v:RegistryWriteVirtualization/v:ExcludedKeys/v:ExcludedKey', $namespaces) | ForEach-Object InnerText)
if ($actualKeys.Count -ne 2 -or (Compare-Object $expectedKeys $actualKeys -CaseSensitive)) { throw 'Only the two exact ToolBraid native-host keys may be excluded.' }
$directories = @($storeManifest.SelectNodes('/m:Package/m:Properties/v:FileSystemWriteVirtualization/v:ExcludedDirectories/v:ExcludedDirectory', $namespaces) | ForEach-Object InnerText)
if ($directories.Count -ne 1 -or $directories[0] -cne '$(KnownFolder:LocalAppData)\ToolBraid\store') { throw 'Only the ToolBraid Store data folder may be excluded.' }
$capabilities = @($storeManifest.SelectNodes('/m:Package/m:Capabilities/r:Capability', $namespaces) | ForEach-Object { $_.Name })
if ($capabilities.Count -ne 2 -or (Compare-Object @('runFullTrust', 'unvirtualizedResources') $capabilities -CaseSensitive)) { throw 'Unexpected restricted Store capability.' }
Write-Output 'Store manifest checks passed: Windows 11+, no legacy virtualization switches, two exact registry keys, one data folder, two console aliases.'
if ($ManifestOnly) { return }
$testRoot = Join-Path $projectRoot ('dist\store-tests-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
$testExe = Join-Path $testRoot 'StoreConnectionTests.exe'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $csc /nologo /target:exe /r:System.Web.Extensions.dll "/out:$testExe" (Join-Path $projectRoot 'store\StoreConnection.cs') (Join-Path $projectRoot 'tests\universal\store-connection-tests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Store test compilation failed.' }
& $testExe $testRoot
if ($LASTEXITCODE -ne 0) { throw 'Store connection integration checks failed.' }
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$runtime = Join-Path $projectRoot "dist\release-$version\companion\runtime\node.exe"
if (-not (Test-Path -LiteralPath $runtime)) { throw 'Build the matching release runtime before testing Store launchers.' }
foreach ($directory in @('bridge', 'local-agent', 'runtime')) {
  New-Item -ItemType Directory -Path (Join-Path $testRoot $directory) | Out-Null
}
foreach ($directory in @('bridge', 'local-agent')) {
  Get-ChildItem -LiteralPath (Join-Path $projectRoot $directory) -Filter '*.mjs' -File | Copy-Item -Destination (Join-Path $testRoot $directory)
}
Copy-Item -LiteralPath $runtime -Destination (Join-Path $testRoot 'runtime\node.exe')
& $csc /nologo /target:exe /platform:x64 /optimize+ /define:STORE "/out:$(Join-Path $testRoot 'bridge\ToolBraidNativeHost.exe')" (Join-Path $projectRoot 'bridge\ToolBraidNativeHostLauncher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Store launcher test compilation failed.' }
& $csc /nologo /target:exe /platform:x64 "/out:$(Join-Path $testRoot 'bridge\StoreLauncherHarness.exe')" (Join-Path $projectRoot 'tests\universal\store-launcher-harness.cs')
if ($LASTEXITCODE -ne 0) { throw 'Store launcher harness compilation failed.' }
$previousTestRoot = $env:TOOLBRAID_STORE_TEST_ROOT
try {
  $env:TOOLBRAID_STORE_TEST_ROOT = $testRoot
  & $runtime --test (Join-Path $projectRoot 'tests\universal\store-diagnostics.test.mjs') (Join-Path $projectRoot 'tests\universal\store-launchers.test.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Store diagnostic or launcher integration checks failed.' }
} finally { $env:TOOLBRAID_STORE_TEST_ROOT = $previousTestRoot }
# Remove only this generated test directory, never the project's real connection data.
$resolved = (Resolve-Path -LiteralPath $testRoot).Path
$expectedParent = [IO.Path]::GetFullPath((Join-Path $projectRoot 'dist'))
if ((Split-Path -Parent $resolved) -ne $expectedParent -or (Split-Path -Leaf $resolved) -notmatch '^store-tests-[a-f0-9]{32}$') { throw 'Unexpected test cleanup path.' }
Remove-Item -LiteralPath $resolved -Recurse -Force
