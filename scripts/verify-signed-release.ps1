[CmdletBinding()]
param(
  [Parameter(Mandatory)][string] $UnsignedPackage,
  [Parameter(Mandatory)][string] $SignedPackage
)

$ErrorActionPreference = 'Stop'
$version = (Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\package.json') -Raw | ConvertFrom-Json).version
$unsignedPath = (Resolve-Path -LiteralPath $UnsignedPackage).Path
$signedPath = (Resolve-Path -LiteralPath $SignedPackage).Path
if ($unsignedPath -eq $signedPath) { throw 'Signed and unsigned package paths must differ.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-Entries($Archive) {
  $files = @{}
  foreach ($entry in $Archive.Entries) {
    $name = $entry.FullName.Replace('\', '/')
    if ($name.EndsWith('/')) { continue }
    if ($name.StartsWith('/') -or $name -match '(^|/)\.\.(/|$)|:' -or $files.ContainsKey($name)) {
      throw 'Unsafe or duplicate ZIP entry.'
    }
    $files.Add($name, $entry)
  }
  return $files
}

function Get-EntryHash($Entry) {
  $stream = $Entry.Open()
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($sha.ComputeHash($stream)) }
  finally { $sha.Dispose(); $stream.Dispose() }
}

$original = [System.IO.Compression.ZipFile]::OpenRead($unsignedPath)
$signed = $null
$temporaryDirectory = $null
try {
  $signed = [System.IO.Compression.ZipFile]::OpenRead($signedPath)
  $before = Get-Entries $original
  $after = Get-Entries $signed
  $launcher = 'bridge/ToolBraidNativeHost.exe'
  if (!$before.ContainsKey($launcher) -or !$after.ContainsKey($launcher)) { throw 'Native host launcher is missing.' }
  if ($before.Count -ne $after.Count) { throw 'Package contents changed during signing.' }
  foreach ($name in $before.Keys) {
    if (!$after.ContainsKey($name)) { throw 'Package contents changed during signing.' }
    if ($name -ne $launcher -and (Get-EntryHash $before[$name]) -ne (Get-EntryHash $after[$name])) {
      throw "Unexpected modified file: $name"
    }
  }

  $temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('toolbraid-signature-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
  $executable = Join-Path $temporaryDirectory 'ToolBraidNativeHost.exe'
  [System.IO.Compression.ZipFileExtensions]::ExtractToFile($after[$launcher], $executable, $false)
  $metadata = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($executable)
  if ($metadata.ProductName -cne 'ToolBraid Companion' -or $metadata.CompanyName -cne 'Maharajahu' -or
      $metadata.ProductVersion -cne $version -or $metadata.FileVersion -cne "$version.0") {
    throw 'Signed launcher metadata does not match this release.'
  }
  $signature = Get-AuthenticodeSignature -LiteralPath $executable
  if ($signature.Status -ne 'Valid') { throw "Native host signature is not trusted: $($signature.Status)" }
  if ($signature.SignerCertificate.Subject -notmatch '(^|,\s*)CN=SignPath Foundation(,|$)') {
    throw 'The native host was not signed by SignPath Foundation.'
  }
  if (!$signature.TimeStamperCertificate) { throw 'The native host signature has no timestamp.' }

  $hash = (Get-FileHash -LiteralPath $signedPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $checksumPath = Join-Path (Split-Path -Parent $signedPath) 'SHA256SUMS.txt'
  [System.IO.File]::WriteAllText($checksumPath, "$hash  $([System.IO.Path]::GetFileName($signedPath))`n", [System.Text.UTF8Encoding]::new($false))
  [ordered]@{ verified = $true; version = $version; signer = $signature.SignerCertificate.Subject; timestamped = $true; unchangedFiles = $before.Count - 1; sha256 = $hash } | ConvertTo-Json
} finally {
  if ($temporaryDirectory) {
    $executable = Join-Path $temporaryDirectory 'ToolBraidNativeHost.exe'
    if (Test-Path -LiteralPath $executable) { Remove-Item -LiteralPath $executable -Force }
    Remove-Item -LiteralPath $temporaryDirectory
  }
  if ($signed) { $signed.Dispose() }
  $original.Dispose()
}
