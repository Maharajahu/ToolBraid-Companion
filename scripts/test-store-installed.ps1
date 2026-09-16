$ErrorActionPreference = 'Stop'
# This test changes certificate trust only inside a disposable, GitHub-hosted VM.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or
    $env:GITHUB_REPOSITORY -ne 'Maharajahu/ToolBraid-Companion' -or
    $env:GITHUB_REF -notlike 'refs/heads/test/store-e2e-*') {
  throw 'This installation test is restricted to the approved disposable CI testing branch.'
}
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$evidence = Join-Path $projectRoot 'dist\store-e2e-evidence'
New-Item -ItemType Directory -Path $evidence -Force | Out-Null
$os = Get-CimInstance Win32_OperatingSystem
$identity = 'Maharajahu.ToolBraidCompanion'
$packageVersion = '0.3.2.0'
$publisher = 'CN=E4BF216F-08D0-430A-8F4D-729DDA573ADE'
$family = 'Maharajahu.ToolBraidCompanion_f24v1p0f17va4'
if (Get-AppxPackage -Name $identity) { throw 'A clean test machine is required.' }
foreach ($vendor in @('Google\Chrome', 'Microsoft\Edge')) {
  if (Test-Path -LiteralPath "HKCU:\Software\$vendor\NativeMessagingHosts\com.toolbraid.bridge") {
    throw 'Existing browser registration found; refusing to replace it.'
  }
}
$environment = [ordered]@{ os = $os.Caption; build = $os.Version; architecture = $env:PROCESSOR_ARCHITECTURE;
  commit = $env:GITHUB_SHA; userInteractive = [Environment]::UserInteractive; session = (Get-Process -Id $PID).SessionId;
  storeSigned = $false; submitted = $false; testCertificateOnly = $true }
$environment | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $evidence 'environment.json') -Encoding UTF8
Write-Output ($environment | ConvertTo-Json -Compress)
& (Join-Path $PSScriptRoot 'build-release.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Release build failed.' }
$release = Join-Path $projectRoot 'dist\release-0.3.1'
$extensionRoot = Join-Path $release 'companion\extension'
$edgeZip = Join-Path $release 'ToolBraid-0.3.1-edge-extension.zip'
$edgeArchive = [System.IO.Compression.ZipFile]::OpenRead($edgeZip)
try {
  $entries = @($edgeArchive.Entries | Where-Object { $_.Name })
  if ($entries.Count -ne @(Get-ChildItem -LiteralPath $extensionRoot -File -Recurse).Count) { throw 'Edge ZIP file list differs from the tested extension.' }
  foreach ($entry in $entries) {
    $stream = $entry.Open()
    try {
      $source = Join-Path $extensionRoot $entry.FullName
      if ($entry.FullName -eq 'manifest.json') {
        $reader = [IO.StreamReader]::new($stream)
        $edgeManifest = $reader.ReadToEnd() | ConvertFrom-Json
        $publicManifest = Get-Content -LiteralPath $source -Raw | ConvertFrom-Json
        $publicManifest.PSObject.Properties.Remove('key')
        if (($edgeManifest | ConvertTo-Json -Depth 30 -Compress) -ne ($publicManifest | ConvertTo-Json -Depth 30 -Compress)) { throw 'Unexpected Edge manifest difference.' }
      } elseif ((Get-FileHash -InputStream $stream -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash) {
        throw "Edge ZIP code differs from tested extension: $($entry.FullName)"
      }
    } finally { $stream.Dispose() }
  }
  @{ filesMatched = $entries.Count; onlyManifestDifference = 'Store ZIP omits the public unpacked key'; edgeZipSha256 = (Get-FileHash -LiteralPath $edgeZip -Algorithm SHA256).Hash } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $evidence 'edge-extension-equivalence.json') -Encoding UTF8
} finally { $edgeArchive.Dispose() }
$sdk = Get-ChildItem -LiteralPath 'C:\Program Files (x86)\Windows Kits\10\bin' -Directory |
  Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'x64\makeappx.exe') } |
  Sort-Object Name -Descending | Select-Object -First 1
if (-not $sdk) { throw 'Windows packaging SDK is missing.' }
$sdkBin = Join-Path $sdk.FullName 'x64'
& (Join-Path $PSScriptRoot 'build-store.ps1') -PackageName $identity -Publisher $publisher -PublisherDisplayName 'Maharajahu' -EdgeExtensionId 'ailfkkdmjppafngmkobpiogoamidipcl' -PackageVersion $packageVersion -SdkBin $sdkBin
if ($LASTEXITCODE -ne 0) { throw 'Store build failed.' }
$build = Get-ChildItem -LiteralPath (Join-Path $projectRoot 'dist') -Directory -Filter "store-$packageVersion-store-submission-*" |
  Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
$unsigned = Join-Path $build.FullName "ToolBraid-$packageVersion-store-submission-x64.msix"
$signed = Join-Path $env:RUNNER_TEMP 'ToolBraid-test-only.msix'
Copy-Item -LiteralPath $unsigned -Destination $signed
$certificate = $null
$installed = $null
try {
  $certificate = New-SelfSignedCertificate -Type Custom -KeyUsage DigitalSignature -Subject $publisher -CertStoreLocation 'Cert:\CurrentUser\My' -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}') -FriendlyName 'ToolBraid disposable CI test only'
  $publicCertificate = Join-Path $env:RUNNER_TEMP 'ToolBraid-test-only.cer'
  Export-Certificate -Cert $certificate -FilePath $publicCertificate | Out-Null
  Import-Certificate -FilePath $publicCertificate -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null
  & (Join-Path $sdkBin 'signtool.exe') sign /fd SHA256 /s My /sha1 $certificate.Thumbprint $signed
  if ($LASTEXITCODE -ne 0) { throw 'Test signing failed.' }
  Add-AppxPackage -Path $signed
  $installed = Get-AppxPackage -Name $identity
  if (-not $installed -or $installed.PackageFamilyName -ne $family -or $installed.Version -ne $packageVersion) {
    throw 'Windows did not install the expected package identity and version.'
  }
  $payload = Join-Path $build.FullName 'payload'
  $files = @(Get-ChildItem -LiteralPath $payload -Recurse -File | ForEach-Object {
    $relative = $_.FullName.Substring($payload.Length + 1)
    $expected = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    $actual = (Get-FileHash -LiteralPath (Join-Path $installed.InstallLocation $relative) -Algorithm SHA256).Hash
    if ($expected -ne $actual) { throw "Installed payload mismatch: $relative" }
    [ordered]@{ file = $relative; sha256 = $expected.ToLowerInvariant() }
  })
  [ordered]@{ installed = $true; family = $family; version = $packageVersion; unsignedSha256 = (Get-FileHash -LiteralPath $unsigned -Algorithm SHA256).Hash.ToLowerInvariant(); payload = $files } |
    ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $evidence 'installation.json') -Encoding UTF8
  Write-Output "INSTALLED: $family, $packageVersion; $($files.Count) payload files verified."
  $env:E2E_PLAYWRIGHT_MODULE = Join-Path $env:RUNNER_TEMP 'toolbraid-test-deps\node_modules\playwright-core'
  $env:TOOLBRAID_INSTALLED_ROOT = $installed.InstallLocation
  $env:TOOLBRAID_E2E_EVIDENCE = $evidence
  node (Join-Path $PSScriptRoot 'e2e-store-installed.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Installed user-flow verification failed. See evidence.' }
  # Preserve the unsigned candidate whose exact payload passed. Never export the private test key.
  Copy-Item -LiteralPath $unsigned -Destination (Join-Path $evidence "ToolBraid-$packageVersion-unsigned-tested.msix")
  Copy-Item -LiteralPath $edgeZip -Destination $evidence
} finally {
  if ($installed) {
    Remove-AppxPackage -Package $installed.PackageFullName
    [ordered]@{ packageRemoved = -not [bool](Get-AppxPackage -Name $identity) } | ConvertTo-Json |
      Set-Content -LiteralPath (Join-Path $evidence 'uninstall.json') -Encoding UTF8
  }
  if ($certificate) {
    foreach ($store in @('Cert:\LocalMachine\TrustedPeople', 'Cert:\CurrentUser\My')) {
      $leaf = Join-Path $store $certificate.Thumbprint
      if (Test-Path -LiteralPath $leaf) { Remove-Item -LiteralPath $leaf }
    }
  }
}
