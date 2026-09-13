[CmdletBinding()]
param(
  [ValidatePattern('^24\.[0-9]+\.[0-9]+$')][string] $NodeVersion = '24.21.0',
  [switch] $IncludeSubmissionKit
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$distRoot = Join-Path $projectRoot 'dist'
$releaseRoot = Join-Path $distRoot "release-$version"
$companionRoot = Join-Path $releaseRoot 'companion'
$cacheRoot = Join-Path $distRoot 'node-cache'
New-Item -ItemType Directory -Path $releaseRoot, $companionRoot, $cacheRoot -Force | Out-Null

$archiveName = "node-v$NodeVersion-win-x64.zip"
$archivePath = Join-Path $cacheRoot $archiveName
$downloadRoot = "https://nodejs.org/dist/v$NodeVersion"
$checksums = (Invoke-WebRequest -UseBasicParsing -Uri "$downloadRoot/SHASUMS256.txt").Content
$checksumLine = @($checksums -split "`n" | Where-Object { $_ -match ('\s+' + [regex]::Escape($archiveName) + '\s*$') })
if ($checksumLine.Count -ne 1) { throw 'The official Node.js archive checksum was not found.' }
$expectedHash = ($checksumLine[0] -split '\s+')[0]
if (-not (Test-Path -LiteralPath $archivePath)) {
  Invoke-WebRequest -UseBasicParsing -Uri "$downloadRoot/$archiveName" -OutFile $archivePath
}
if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash -ne $expectedHash) {
  throw 'Node.js archive checksum mismatch. No downloaded runtime has been executed.'
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
New-Item -ItemType Directory -Path (Join-Path $companionRoot 'runtime') -Force | Out-Null
$archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
try {
  foreach ($entryName in @('node.exe', 'LICENSE')) {
    $entry = $archive.GetEntry("node-v$NodeVersion-win-x64/$entryName")
    if (-not $entry) { throw "The verified Node.js archive lacks $entryName." }
    $targetName = if ($entryName -eq 'LICENSE') { 'LICENSE.node.txt' } else { $entryName }
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $companionRoot "runtime\$targetName"), $true)
  }
} finally { $archive.Dispose() }
$nodePath = Join-Path $companionRoot 'runtime\node.exe'
$signature = Get-AuthenticodeSignature -LiteralPath $nodePath
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'OpenJS Foundation') {
  throw 'The bundled Node.js executable must carry a valid OpenJS Foundation signature.'
}
if ((& $nodePath --version) -ne "v$NodeVersion") { throw 'The bundled Node.js version does not match the release.' }

$build = & $nodePath (Join-Path $PSScriptRoot 'build-universal-extension.mjs') --edition public
if ($LASTEXITCODE -ne 0) { throw 'The public extension build failed.' }
$extensionDirectory = ($build | ConvertFrom-Json).loadUnpackedDirectory
# Do not distribute a build record containing the developer's local paths.
Remove-Item -LiteralPath (Join-Path $extensionDirectory 'build-metadata.json')
$extensionCopy = Join-Path $companionRoot 'extension'
if (Test-Path -LiteralPath $extensionCopy) {
  $resolvedCopy = (Resolve-Path -LiteralPath $extensionCopy).Path
  if ($resolvedCopy -ne [System.IO.Path]::GetFullPath($extensionCopy) -or -not $resolvedCopy.StartsWith($releaseRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected release output path.' }
  Remove-Item -LiteralPath $resolvedCopy -Recurse -Force
}
Copy-Item -LiteralPath $extensionDirectory -Destination $extensionCopy -Recurse

$runtimeFiles = @(
  'bridge\common.mjs', 'bridge\file-grants.mjs', 'bridge\scoped-filesystem.mjs', 'bridge\windows-uia.mjs',
  'bridge\atomic-json-store.mjs', 'bridge\durable-control.mjs', 'bridge\media-control.mjs', 'bridge\workflow-control.mjs',
  'bridge\assistant.mjs', 'bridge\codex-agent.mjs',
  'bridge\native-host.mjs', 'bridge\mcp-server.mjs', 'local-agent\durable-runner.mjs', 'local-agent\scheduler.mjs',
  'local-agent\media-jobs.mjs', 'local-agent\workflow-learning.mjs',
  'scripts\install-mcp-bridge.ps1', 'scripts\uninstall-mcp-bridge.ps1', 'LICENSE'
)
foreach ($relativePath in $runtimeFiles) {
  $target = Join-Path $companionRoot $relativePath
  New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $projectRoot $relativePath) -Destination $target -Force
}
$cscPath = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $cscPath '/nologo' '/target:exe' '/define:PORTABLE' "/out:$(Join-Path $companionRoot 'bridge\ToolBraidNativeHost.exe')" (Join-Path $projectRoot 'bridge\ToolBraidNativeHostLauncher.cs')
if ($LASTEXITCODE -ne 0) { throw 'The portable native host launcher could not be compiled.' }
Copy-Item -LiteralPath (Join-Path $projectRoot 'release\COMPANION-README.md') -Destination (Join-Path $companionRoot 'README.md') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'release\PRIVACY.md') -Destination (Join-Path $companionRoot 'PRIVACY.md') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'release\RELEASE-NOTES.md') -Destination (Join-Path $companionRoot 'RELEASE-NOTES.md') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'release\STORE-LISTING.md') -Destination (Join-Path $releaseRoot 'STORE-LISTING.md') -Force
foreach ($entryPoint in @('Install.cmd', 'Configure-Codex.cmd')) {
  Copy-Item -LiteralPath (Join-Path $projectRoot "release\$entryPoint") -Destination (Join-Path $companionRoot $entryPoint) -Force
}

$extensionZip = Join-Path $releaseRoot "ToolBraid-$version-extension.zip"
$edgeExtensionZip = Join-Path $releaseRoot "ToolBraid-$version-edge-extension.zip"
$companionZip = Join-Path $releaseRoot "ToolBraid-$version-windows-x64.zip"
Compress-Archive -Path (Join-Path $extensionDirectory '*') -DestinationPath $extensionZip -Force
# Edge Add-ons rejects the key used to keep Chrome's unpacked extension ID stable.
Copy-Item -LiteralPath $extensionZip -Destination $edgeExtensionZip -Force
$edgeArchive = [System.IO.Compression.ZipFile]::Open($edgeExtensionZip, [System.IO.Compression.ZipArchiveMode]::Update)
try {
  $manifestEntry = $edgeArchive.GetEntry('manifest.json')
  $manifestReader = [System.IO.StreamReader]::new($manifestEntry.Open())
  try { $edgeManifest = $manifestReader.ReadToEnd() | ConvertFrom-Json } finally { $manifestReader.Dispose() }
  $edgeManifest.PSObject.Properties.Remove('key')
  $manifestEntry.Delete()
  $manifestWriter = [System.IO.StreamWriter]::new($edgeArchive.CreateEntry('manifest.json').Open(), [System.Text.UTF8Encoding]::new($false))
  try { $manifestWriter.WriteLine(($edgeManifest | ConvertTo-Json -Depth 30)) } finally { $manifestWriter.Dispose() }
} finally { $edgeArchive.Dispose() }
Compress-Archive -Path (Join-Path $companionRoot '*') -DestinationPath $companionZip -Force
$releaseArchives = @($extensionZip, $edgeExtensionZip, $companionZip)
$hashes = @(Get-FileHash -LiteralPath $releaseArchives -Algorithm SHA256 | ForEach-Object { "$($_.Hash.ToLowerInvariant())  $(Split-Path -Leaf $_.Path)" })
$submissionZip = $null
if ($IncludeSubmissionKit) {
  $kitFiles = @(
    @{ Source = $extensionZip; Name = (Split-Path -Leaf $extensionZip) },
    @{ Source = $edgeExtensionZip; Name = (Split-Path -Leaf $edgeExtensionZip) },
    @{ Source = (Join-Path $projectRoot 'release\SUBMISSION-README.md'); Name = 'README.md' },
    @{ Source = (Join-Path $projectRoot 'LICENSE'); Name = 'LICENSE' }
  )
  foreach ($document in @('PRIVACY.md', 'STORE-LISTING.md', 'REVIEWER-INSTRUCTIONS.md', 'COMPANION-README.md', 'RELEASE-NOTES.md')) {
    $kitFiles += @{ Source = (Join-Path $projectRoot "release\$document"); Name = $document }
  }
  foreach ($asset in @('01-connect-your-ai.jpg', '02-x-direct-control.jpg', 'promo-small-440x280.jpg', 'logo-128.png', 'logo-300.png')) {
    $kitFiles += @{ Source = (Join-Path $projectRoot "release\store-assets\$asset"); Name = "assets/$asset" }
  }
  foreach ($file in $kitFiles) {
    if (-not (Test-Path -LiteralPath $file.Source -PathType Leaf)) { throw "Submission file missing: $($file.Source)" }
  }
  $submissionZip = Join-Path $releaseRoot "ToolBraid-$version-submission-kit.zip"
  if (Test-Path -LiteralPath $submissionZip) { Remove-Item -LiteralPath $submissionZip }
  $kitArchive = [System.IO.Compression.ZipFile]::Open($submissionZip, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($file in $kitFiles) {
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($kitArchive, $file.Source, $file.Name, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
    $checksumEntry = $kitArchive.CreateEntry('RUNTIME-SHA256SUMS.txt')
    $checksumWriter = [System.IO.StreamWriter]::new($checksumEntry.Open(), [System.Text.UTF8Encoding]::new($false))
    try { foreach ($hash in $hashes) { $checksumWriter.WriteLine($hash) } } finally { $checksumWriter.Dispose() }
  } finally { $kitArchive.Dispose() }
  $kitHash = Get-FileHash -LiteralPath $submissionZip -Algorithm SHA256
  $hashes += "$($kitHash.Hash.ToLowerInvariant())  $(Split-Path -Leaf $submissionZip)"
}
[System.IO.File]::WriteAllLines((Join-Path $releaseRoot 'SHA256SUMS.txt'), $hashes, [System.Text.UTF8Encoding]::new($false))
[ordered]@{ version = $version; nodeVersion = $NodeVersion; extensionZip = $extensionZip; edgeExtensionZip = $edgeExtensionZip; companionZip = $companionZip; companionDirectory = $companionRoot; submissionKitZip = $submissionZip; published = $false } | ConvertTo-Json
