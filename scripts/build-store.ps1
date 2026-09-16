[CmdletBinding(DefaultParameterSetName = 'Store')]
param(
  [Parameter(Mandatory, ParameterSetName = 'Store')][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9.-]{2,49}$')][string] $PackageName,
  [Parameter(Mandatory, ParameterSetName = 'Store')][ValidatePattern('^CN=.+$')][string] $Publisher,
  [Parameter(Mandatory, ParameterSetName = 'Store')][ValidateLength(1, 256)][string] $PublisherDisplayName,
  [Parameter(Mandatory, ParameterSetName = 'Store')][ValidatePattern('^[a-p]{32}$')][string] $EdgeExtensionId,
  [Parameter(Mandatory, ParameterSetName = 'LocalValidation')][switch] $LocalValidation,
  [ValidatePattern('^\d+\.\d+\.\d+\.0$')][string] $PackageVersion,
  [string] $SdkBin = 'C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64'
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$packageLabel = if ($PackageVersion) { $PackageVersion } else { $version }
if (-not $PackageVersion) { $PackageVersion = "$version.0" }
$companion = Join-Path $projectRoot "dist\release-$version\companion"
if (-not (Test-Path -LiteralPath (Join-Path $companion 'runtime\node.exe'))) {
  throw 'Build the matching Windows companion first with scripts/build-release.ps1.'
}
$manifest = Get-Content -LiteralPath (Join-Path $companion 'extension\manifest.json') -Raw | ConvertFrom-Json
if ($manifest.name -ne 'ToolBraid' -or $manifest.version -ne $version) { throw 'A matching public companion is required.' }
$nodeSignature = Get-AuthenticodeSignature -LiteralPath (Join-Path $companion 'runtime\node.exe')
if ($nodeSignature.Status -ne 'Valid' -or $nodeSignature.SignerCertificate.Subject -notmatch 'OpenJS Foundation') { throw 'The bundled runtime signature is invalid.' }
$sha = [Security.Cryptography.SHA256]::Create()
try { $bytes = $sha.ComputeHash([Convert]::FromBase64String($manifest.key)) } finally { $sha.Dispose() }
$alphabet = 'abcdefghijklmnop'
$chromeId = -join ($bytes[0..15] | ForEach-Object { $alphabet[[int]($_ -shr 4)]; $alphabet[[int]($_ -band 15)] })
$displayName = 'ToolBraid Companion'
if ($LocalValidation) {
  $PackageName = 'ToolBraid.LocalValidation'
  $Publisher = 'CN=ToolBraid Local Validation'
  $PublisherDisplayName = 'Local validation only'
  $EdgeExtensionId = $chromeId
  $displayName = 'ToolBraid Companion (local validation)'
}
$mode = if ($LocalValidation) { 'local-validation' } else { 'store-submission' }
$output = Join-Path $projectRoot ("dist\store-$packageLabel-$mode-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$payload = Join-Path $output 'payload'
$assets = Join-Path $payload 'Assets'
New-Item -ItemType Directory -Path $assets -Force | Out-Null
foreach ($directory in @('bridge', 'local-agent', 'runtime')) {
  Copy-Item -LiteralPath (Join-Path $companion $directory) -Destination (Join-Path $payload $directory) -Recurse
}
foreach ($document in @('LICENSE', 'PRIVACY.md', 'RELEASE-NOTES.md')) {
  $documentRoot = if ($document -eq 'LICENSE') { $projectRoot } else { Join-Path $projectRoot 'release' }
  Copy-Item -LiteralPath (Join-Path $documentRoot $document) -Destination (Join-Path $payload $document)
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'store\README.md') -Destination (Join-Path $payload 'README.md')
New-Item -ItemType Directory -Path (Join-Path $payload 'store') | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'store\diagnostics.mjs') -Destination (Join-Path $payload 'store\diagnostics.mjs')
# Only the runtime allowlist above is packaged: no installer, developer history, extension profile or signing key.
$encoding = [Text.UTF8Encoding]::new($false)
$metadata = Join-Path $output 'AssemblyInfo.cs'
[IO.File]::WriteAllText($metadata, @"
using System.Reflection;
[assembly: AssemblyTitle("ToolBraid Companion")]
[assembly: AssemblyProduct("ToolBraid")]
[assembly: AssemblyCompany("Maharajahu")]
[assembly: AssemblyVersion("$PackageVersion")]
[assembly: AssemblyFileVersion("$PackageVersion")]
"@, $encoding)
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$source = Join-Path $projectRoot 'bridge\ToolBraidNativeHostLauncher.cs'
& $csc /nologo /target:exe /platform:x64 /optimize+ /define:STORE "/out:$(Join-Path $payload 'bridge\ToolBraidNativeHost.exe')" $metadata $source
if ($LASTEXITCODE -ne 0) { throw 'Could not compile the Store connection launcher.' }
& $csc /nologo /target:winexe /platform:x64 /optimize+ /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll "/out:$(Join-Path $payload 'ToolBraidCompanion.exe')" $metadata (Join-Path $projectRoot 'store\StoreConnection.cs') (Join-Path $projectRoot 'store\StoreApp.cs')
if ($LASTEXITCODE -ne 0) { throw 'Could not compile the Store companion window.' }
$settings = @{ preview = [bool]$LocalValidation; edgeExtensionId = $EdgeExtensionId; chromeExtensionId = $chromeId } | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $payload 'store-settings.json'), $settings, $encoding)
$xml = Get-Content -LiteralPath (Join-Path $projectRoot 'store\AppxManifest.xml') -Raw
$replacements = @{ PACKAGE_NAME = $PackageName; PUBLISHER = $Publisher; VERSION = $PackageVersion; DISPLAY_NAME = $displayName; PUBLISHER_DISPLAY_NAME = $PublisherDisplayName }
foreach ($key in $replacements.Keys) { $xml = $xml.Replace("@@$key@@", [Security.SecurityElement]::Escape($replacements[$key])) }
if ($xml -match '@@[A-Z_]+@@') { throw 'An unresolved Store identity field remains.' }
[IO.File]::WriteAllText((Join-Path $payload 'AppxManifest.xml'), $xml, $encoding)

# Generate the required icon sizes from the existing approved mark as a normal packaging step.
Add-Type -AssemblyName System.Drawing
$logo = [Drawing.Image]::FromFile((Join-Path $projectRoot 'release\store-assets\logo-300.png'))
try {
  foreach ($icon in @(@{Name='StoreLogo'; Size=50}, @{Name='Square44x44Logo'; Size=44}, @{Name='Square150x150Logo'; Size=150})) {
    $bitmap = [Drawing.Bitmap]::new($icon.Size, $icon.Size)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.DrawImage($logo, 0, 0, $icon.Size, $icon.Size)
      $bitmap.Save((Join-Path $assets ($icon.Name + '.png')), [Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
  }
} finally { $logo.Dispose() }
$package = Join-Path $output "ToolBraid-$packageLabel-$mode-x64.msix"
& (Join-Path $SdkBin 'makeappx.exe') pack /d $payload /p $package /o
if ($LASTEXITCODE -ne 0) { throw 'MSIX package validation failed.' }
$hash = (Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $output 'SHA256SUMS.txt'), "$hash  $(Split-Path -Leaf $package)`n", $encoding)
$submission = Join-Path $output 'submission'
New-Item -ItemType Directory -Path $submission | Out-Null
foreach ($document in @('LISTING.md', 'REVIEWER-INSTRUCTIONS.md')) {
  Copy-Item -LiteralPath (Join-Path $projectRoot ('store\' + $document)) -Destination (Join-Path $submission $document)
}
[ordered]@{ package = $package; payload = $payload; submission = $submission; sha256 = $hash; localValidation = [bool]$LocalValidation; storeSigned = $false; submitted = $false; identityVerifiedByThisScript = $false } | ConvertTo-Json
