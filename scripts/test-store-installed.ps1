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
$sdk = Get-ChildItem -LiteralPath 'C:\Program Files (x86)\Windows Kits\10\bin' -Directory |
  Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'x64\makeappx.exe') } |
  Sort-Object Name -Descending | Select-Object -First 1
if (-not $sdk) { throw 'Windows packaging SDK is missing.' }
$sdkBin = Join-Path $sdk.FullName 'x64'
& (Join-Path $PSScriptRoot 'build-store.ps1') -PackageName $identity -Publisher $publisher -PublisherDisplayName 'Maharajahu' -EdgeExtensionId 'ailfkkdmjppafngmkobpiogoamidipcl' -SdkBin $sdkBin
if ($LASTEXITCODE -ne 0) { throw 'Store build failed.' }
$build = Get-ChildItem -LiteralPath (Join-Path $projectRoot 'dist') -Directory -Filter 'store-0.3.1-store-submission-*' |
  Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
$unsigned = Join-Path $build.FullName 'ToolBraid-0.3.1-store-submission-x64.msix'
$signed = Join-Path $env:RUNNER_TEMP 'ToolBraid-test-only.msix'
Copy-Item -LiteralPath $unsigned -Destination $signed
$certificate = $null
$installed = $null
$driver = $null
try {
  $certificate = New-SelfSignedCertificate -Type Custom -KeyUsage DigitalSignature -Subject $publisher -CertStoreLocation 'Cert:\CurrentUser\My' -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}') -FriendlyName 'ToolBraid disposable CI test only'
  $publicCertificate = Join-Path $env:RUNNER_TEMP 'ToolBraid-test-only.cer'
  Export-Certificate -Cert $certificate -FilePath $publicCertificate | Out-Null
  Import-Certificate -FilePath $publicCertificate -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null
  & (Join-Path $sdkBin 'signtool.exe') sign /fd SHA256 /s My /sha1 $certificate.Thumbprint $signed
  if ($LASTEXITCODE -ne 0) { throw 'Test signing failed.' }
  Add-AppxPackage -Path $signed
  $installed = Get-AppxPackage -Name $identity
  if (-not $installed -or $installed.PackageFamilyName -ne $family -or $installed.Version -ne '0.3.1.0') {
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
  [ordered]@{ installed = $true; family = $family; version = '0.3.1.0'; unsignedSha256 = (Get-FileHash -LiteralPath $unsigned -Algorithm SHA256).Hash.ToLowerInvariant(); payload = $files } |
    ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $evidence 'installation.json') -Encoding UTF8
  Write-Output "INSTALLED: $family, 0.3.1.0; $($files.Count) payload files verified."
  # WinAppDriver requires Developer Mode on this throwaway machine, not on the owner's PC.
  New-Item -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' -Force | Out-Null
  New-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' -Name 'AllowDevelopmentWithoutDevLicense' -Value 1 -PropertyType DWord -Force | Out-Null
  $driverPath = @('C:\Program Files (x86)\Windows Application Driver\WinAppDriver.exe', 'C:\Program Files\Windows Application Driver\WinAppDriver.exe') |
    Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $driverPath) { throw 'The runner is missing Microsoft WinAppDriver.' }
  $driver = Start-Process -FilePath $driverPath -ArgumentList '4723' -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $env:RUNNER_TEMP 'toolbraid-winappdriver.log') -RedirectStandardError (Join-Path $env:RUNNER_TEMP 'toolbraid-winappdriver-error.log')
  $env:E2E_PLAYWRIGHT_MODULE = Join-Path $env:RUNNER_TEMP 'toolbraid-test-deps\node_modules\playwright-core'
  $env:TOOLBRAID_INSTALLED_ROOT = $installed.InstallLocation
  $env:TOOLBRAID_E2E_EVIDENCE = $evidence
  node (Join-Path $PSScriptRoot 'e2e-store-installed.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Installed user-flow verification failed. See evidence.' }
} finally {
  foreach ($log in @('toolbraid-winappdriver.log', 'toolbraid-winappdriver-error.log')) {
    $logPath = Join-Path $env:RUNNER_TEMP $log
    if (Test-Path -LiteralPath $logPath) {
      Get-Content -LiteralPath $logPath -Tail 30 | Write-Output
      Copy-Item -LiteralPath $logPath -Destination (Join-Path $evidence $log)
    }
  }
  if ($driver -and -not $driver.HasExited) { Stop-Process -Id $driver.Id }
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
