[CmdletBinding()]
param([string] $InstallRoot)

$ErrorActionPreference = 'Stop'
if (-not $InstallRoot) {
  $InstallRoot = if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'install-state.json')) {
    $PSScriptRoot
  } else { Join-Path $env:LOCALAPPDATA 'ToolBraid\public' }
}
$InstallRoot = [System.IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
$markerPath = Join-Path $InstallRoot 'install-state.json'
$marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
if ($marker.product -ne 'ToolBraid' -or $marker.edition -notin @('personal', 'public') -or $marker.installRoot -ne $InstallRoot) {
  throw 'This is not a matching ToolBraid installation.'
}
$hostName = if ($marker.edition -eq 'public') { 'com.toolbraid.bridge' } else { 'com.toolbraid.personal_bridge' }
$mcpName = if ($marker.edition -eq 'public') { 'toolbraid' } else { 'toolbraid_personal' }
$nativeManifest = Join-Path $InstallRoot "native-host\$hostName.json"
$launcherPath = Join-Path $InstallRoot 'native-host\ToolBraidNativeHost.exe'
if (Get-Process -Name 'ToolBraidNativeHost' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $launcherPath }) {
  throw 'Close the ToolBraid browser connection before uninstalling the companion.'
}
$registryAllowlist = @(
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName",
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName"
)
foreach ($registryPath in $marker.registryPaths) {
  if ($registryPath -notin $registryAllowlist) { throw 'An unexpected registry path was found; nothing has been removed.' }
}
$ownedPaths = @(foreach ($relativePath in $marker.ownedFiles) {
  if ([System.IO.Path]::IsPathRooted($relativePath)) { throw 'An unexpected absolute installation path was found.' }
  $target = [System.IO.Path]::GetFullPath((Join-Path $InstallRoot $relativePath))
  if (-not $target.StartsWith($InstallRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) { throw 'An installation path escapes its directory.' }
  if ($relativePath -notmatch '^(runtime\\(?:bridge|local-agent)\\[a-z-]+\.mjs|runtime\\(?:node\.exe|LICENSE\.node\.txt)|native-host\\(?:ToolBraidNativeHost\.exe|com\.toolbraid\.(?:personal_)?bridge\.json)|mcp-client\.json|ToolBraidNativeHostLauncher\.cs)$') {
    throw 'The installation manifest contains an unexpected program file.'
  }
  $target
})
foreach ($registryPath in $marker.registryPaths) {
  if (Test-Path -LiteralPath $registryPath) {
    if ((Get-Item -LiteralPath $registryPath).GetValue('') -eq $nativeManifest) {
      Remove-Item -LiteralPath $registryPath
    }
  }
}
if ($marker.codexConfig -and (Test-Path -LiteralPath $marker.codexConfig -PathType Leaf)) {
  $lines = [System.IO.File]::ReadAllLines($marker.codexConfig)
  $pattern = '^\[mcp_servers\.' + [regex]::Escape($mcpName) + '(?:\.[^\]]+)?\]\s*$'
  $block = [System.Collections.Generic.List[string]]::new()
  $inside = $false
  foreach ($line in $lines) {
    if ($line -match $pattern) { $inside = $true }
    elseif ($line -match '^\[') { $inside = $false }
    if ($inside) { $block.Add($line) }
  }
  $blockText = $block -join "`n"
  $encodedRoot = ($InstallRoot | ConvertTo-Json -Compress).Trim('"')
  if ($blockText.Contains($InstallRoot) -or $blockText.Contains($encodedRoot)) {
    Copy-Item -LiteralPath $marker.codexConfig -Destination "$($marker.codexConfig).toolbraid-uninstall-$(Get-Date -Format 'yyyyMMdd-HHmmss-fff').bak"
    $kept = [System.Collections.Generic.List[string]]::new()
    $inside = $false
    foreach ($line in $lines) {
      if ($line -match $pattern) { $inside = $true; continue }
      if ($inside -and $line -match '^\[') { $inside = $false }
      if (-not $inside) { $kept.Add($line) }
    }
    [System.IO.File]::WriteAllLines($marker.codexConfig, $kept.ToArray(), [System.Text.UTF8Encoding]::new($false))
  }
}
# Remove only recorded program files, never user data or directories recursively.
foreach ($target in $ownedPaths) {
  if (Test-Path -LiteralPath $target -PathType Leaf) { Remove-Item -LiteralPath $target }
}
[ordered]@{ uninstalled = $true; installRoot = $InstallRoot; settingsAndDataPreserved = $true } | ConvertTo-Json
