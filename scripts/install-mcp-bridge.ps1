[CmdletBinding()]
param(
  [ValidateSet('personal', 'public')][string] $Edition = 'public',
  [ValidateSet('None', 'Codex')][string] $Client = 'None',
  [ValidateSet('Chrome', 'Edge')][string[]] $Browsers = @('Chrome', 'Edge'),
  [ValidatePattern('^[a-p]{32}$')][string] $ChromeExtensionId,
  [ValidatePattern('^[a-p]{32}$')][string] $EdgeExtensionId,
  [string] $InstallRoot,
  [string] $CodexConfigPath
)

$ErrorActionPreference = 'Stop'

function Convert-ToCSharpVerbatimLiteral([string] $Value) { return $Value.Replace('"', '""') }

function Get-ExtensionId([string] $PublicKey) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $hash = $sha.ComputeHash([Convert]::FromBase64String($PublicKey)) } finally { $sha.Dispose() }
  $alphabet = 'abcdefghijklmnop'
  $builder = [System.Text.StringBuilder]::new(32)
  foreach ($byte in $hash[0..15]) {
    [void]$builder.Append($alphabet[[int]($byte -shr 4)])
    [void]$builder.Append($alphabet[[int]($byte -band 15)])
  }
  return $builder.ToString()
}

function Remove-ToolBraidMcpBlock([string[]] $Lines, [string] $Name) {
  $result = [System.Collections.Generic.List[string]]::new()
  $skipping = $false
  $pattern = '^\[mcp_servers\.' + [regex]::Escape($Name) + '(?:\.[^\]]+)?\]\s*$'
  foreach ($line in $Lines) {
    if ($line -match $pattern) { $skipping = $true; continue }
    if ($skipping -and $line -match '^\[') { $skipping = $false }
    if (-not $skipping) { $result.Add($line) }
  }
  return $result.ToArray()
}

function Write-JsonFile([string] $Path, $Value) {
  [System.IO.File]::WriteAllText($Path, (($Value | ConvertTo-Json -Depth 8) + "`n"), [System.Text.UTF8Encoding]::new($false))
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$bundledNode = Join-Path $projectRoot 'runtime\node.exe'
$bundledLauncher = Join-Path $projectRoot 'bridge\ToolBraidNativeHost.exe'
$portablePackage = (Test-Path -LiteralPath $bundledNode -PathType Leaf) -and (Test-Path -LiteralPath $bundledLauncher -PathType Leaf)
$nodePath = if ($portablePackage) { $bundledNode } else { (Get-Command node -ErrorAction Stop).Source }
$nodeMajor = [int](& $nodePath -p 'process.versions.node.match(/^[0-9]+/)[0]')
if ($LASTEXITCODE -ne 0 -or $nodeMajor -lt 20) { throw 'ToolBraid requires Node.js 20 or newer. The release companion includes its own runtime.' }

$extensionDirectory = Join-Path $projectRoot 'extension'
if (-not $portablePackage) {
  $buildOutput = & $nodePath (Join-Path $projectRoot 'scripts\build-universal-extension.mjs') '--edition' $Edition
  if ($LASTEXITCODE -ne 0) { throw 'The ToolBraid extension build failed.' }
  $extensionDirectory = ($buildOutput | ConvertFrom-Json).loadUnpackedDirectory
}
$manifest = Get-Content -LiteralPath (Join-Path $extensionDirectory 'manifest.json') -Raw | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($manifest.key)) { throw 'The extension manifest requires a stable public key.' }
if ($Edition -eq 'public' -and $manifest.name -ne 'ToolBraid') { throw 'The public companion requires the public extension bundle.' }
$extensionId = Get-ExtensionId $manifest.key
if (-not $ChromeExtensionId) { $ChromeExtensionId = $extensionId }
if (-not $EdgeExtensionId) { $EdgeExtensionId = $extensionId }
$allowedOrigins = @(@(foreach ($browser in ($Browsers | Select-Object -Unique)) {
  $browserId = if ($browser -eq 'Chrome') { $ChromeExtensionId } else { $EdgeExtensionId }
  "chrome-extension://$browserId/"
}) | Select-Object -Unique)
if ($allowedOrigins.Count -eq 0) { throw 'Select at least one browser.' }
$hostName = if ($Edition -eq 'public') { 'com.toolbraid.bridge' } else { 'com.toolbraid.personal_bridge' }
$mcpName = if ($Edition -eq 'public') { 'toolbraid' } else { 'toolbraid_personal' }
if (-not $InstallRoot) {
  $InstallRoot = if ($Edition -eq 'public') { Join-Path $env:LOCALAPPDATA 'ToolBraid\public' } else { Join-Path $projectRoot '.private\toolbraid-personal\mcp-bridge' }
}
$InstallRoot = [System.IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
if ($InstallRoot -eq [System.IO.Path]::GetPathRoot($InstallRoot).TrimEnd('\')) { throw 'An installation directory, not a drive root, is required.' }
$runtimeRoot = Join-Path $InstallRoot 'runtime'
$nativeHostRoot = Join-Path $InstallRoot 'native-host'
$markerPath = Join-Path $InstallRoot 'install-state.json'
if (Test-Path -LiteralPath $markerPath) {
  $priorInstall = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
  if ($priorInstall.product -ne 'ToolBraid' -or $priorInstall.edition -ne $Edition) { throw 'This directory belongs to a different installation.' }
}

$runtimeFiles = @(
  'bridge\common.mjs', 'bridge\file-grants.mjs', 'bridge\scoped-filesystem.mjs', 'bridge\windows-uia.mjs',
  'bridge\atomic-json-store.mjs', 'bridge\durable-control.mjs', 'bridge\media-control.mjs', 'bridge\workflow-control.mjs',
  'bridge\assistant.mjs', 'bridge\codex-agent.mjs',
  'bridge\native-host.mjs', 'bridge\mcp-server.mjs', 'local-agent\durable-runner.mjs', 'local-agent\scheduler.mjs',
  'local-agent\media-jobs.mjs', 'local-agent\workflow-learning.mjs'
)
foreach ($relativePath in $runtimeFiles) {
  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $relativePath) -PathType Leaf)) { throw "Required runtime module is missing: $relativePath" }
}
$launcherExePath = Join-Path $nativeHostRoot 'ToolBraidNativeHost.exe'
if (Get-Process -Name 'ToolBraidNativeHost' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $launcherExePath }) {
  throw 'Close the ToolBraid browser connection before updating the companion.'
}
New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& "$env:WINDIR\System32\icacls.exe" $InstallRoot '/inheritance:r' '/grant:r' ("*$currentSid`:(OI)(CI)F") '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict the ToolBraid companion directory ACL.' }
New-Item -ItemType Directory -Path $nativeHostRoot -Force | Out-Null
foreach ($relativePath in $runtimeFiles) {
  $destinationPath = Join-Path $runtimeRoot $relativePath
  New-Item -ItemType Directory -Path (Split-Path -Parent $destinationPath) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $projectRoot $relativePath) -Destination $destinationPath -Force
}
$hostScriptPath = Join-Path $runtimeRoot 'bridge\native-host.mjs'
$mcpServerPath = Join-Path $runtimeRoot 'bridge\mcp-server.mjs'
$configPath = Join-Path $InstallRoot 'bridge-config.json'
$token = $null
if (Test-Path -LiteralPath $configPath) {
  $existing = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  if ($existing.token -notmatch '^[a-f0-9]{64}$') { throw 'The existing companion configuration is invalid; it has been preserved.' }
  $token = $existing.token
}
if (-not $token) {
  $random = [byte[]]::new(32)
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($random) } finally { $rng.Dispose() }
  $token = ([BitConverter]::ToString($random)).Replace('-', '').ToLowerInvariant()
}
$pipePrefix = if ($Edition -eq 'public') { 'toolbraid-mcp-' } else { 'toolbraid-personal-mcp-' }
Write-JsonFile $configPath ([ordered]@{
  version = 1; token = $token; pipe = "\\.\pipe\$pipePrefix$($token.Substring(0, 32))"
  allowedOrigin = $allowedOrigins[0]; allowedOrigins = $allowedOrigins
})

if ($portablePackage) {
  $nodePath = Join-Path $runtimeRoot 'node.exe'
  Copy-Item -LiteralPath $bundledNode -Destination $nodePath -Force
  Copy-Item -LiteralPath (Join-Path $projectRoot 'runtime\LICENSE.node.txt') -Destination (Join-Path $runtimeRoot 'LICENSE.node.txt') -Force
  Copy-Item -LiteralPath $bundledLauncher -Destination $launcherExePath -Force
} else {
  $launcherSourcePath = Join-Path $InstallRoot 'ToolBraidNativeHostLauncher.cs'
  $launcherSource = Get-Content -LiteralPath (Join-Path $projectRoot 'bridge\ToolBraidNativeHostLauncher.cs') -Raw
  $launcherSource = $launcherSource.Replace('__TOOLBRAID_NODE_PATH__', (Convert-ToCSharpVerbatimLiteral $nodePath))
  $launcherSource = $launcherSource.Replace('__TOOLBRAID_HOST_SCRIPT_PATH__', (Convert-ToCSharpVerbatimLiteral $hostScriptPath))
  $launcherSource = $launcherSource.Replace('__TOOLBRAID_CONFIG_PATH__', (Convert-ToCSharpVerbatimLiteral $configPath))
  [System.IO.File]::WriteAllText($launcherSourcePath, $launcherSource, [System.Text.UTF8Encoding]::new($false))
  $cscPath = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
  if (-not (Test-Path -LiteralPath $cscPath)) { $cscPath = "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe" }
  if (-not (Test-Path -LiteralPath $cscPath)) { throw 'The Windows C# compiler was not found. Use the prebuilt release companion.' }
  & $cscPath '/nologo' '/target:exe' "/out:$launcherExePath" $launcherSourcePath
  if ($LASTEXITCODE -ne 0) { throw 'The native host launcher could not be built.' }
}
$nativeManifestPath = Join-Path $nativeHostRoot "$hostName.json"
Write-JsonFile $nativeManifestPath ([ordered]@{
  name = $hostName; description = 'Local ToolBraid browser to MCP companion'; path = $launcherExePath
  type = 'stdio'; allowed_origins = $allowedOrigins
})
$registryPaths = @(foreach ($browser in ($Browsers | Select-Object -Unique)) {
  $vendor = if ($browser -eq 'Chrome') { 'Google\Chrome' } else { 'Microsoft\Edge' }
  $registryPath = "HKCU:\Software\$vendor\NativeMessagingHosts\$hostName"
  New-Item -Path $registryPath -Force | Out-Null
  Set-Item -Path $registryPath -Value $nativeManifestPath
  $registryPath
})

foreach ($vendor in @('Google\Chrome', 'Microsoft\Edge')) {
  $previousKey = "HKCU:\Software\$vendor\NativeMessagingHosts\$hostName"
  if ($previousKey -notin $registryPaths -and $previousKey -in $priorInstall.registryPaths -and (Test-Path -LiteralPath $previousKey)) {
    if ((Get-Item -LiteralPath $previousKey).GetValue('') -eq $nativeManifestPath) { Remove-Item -LiteralPath $previousKey }
  }
}

$clientConfig = @{ mcpServers = @{ $mcpName = @{ command = $nodePath; args = @($mcpServerPath, '--config', $configPath) } } }
$clientConfigPath = Join-Path $InstallRoot 'mcp-client.json'
Write-JsonFile $clientConfigPath $clientConfig
if ($Client -eq 'Codex') {
  if (-not $CodexConfigPath) { $CodexConfigPath = Join-Path $env:USERPROFILE '.codex\config.toml' }
  $CodexConfigPath = [System.IO.Path]::GetFullPath($CodexConfigPath)
  New-Item -ItemType Directory -Path (Split-Path -Parent $CodexConfigPath) -Force | Out-Null
  $existingLines = @()
  if (Test-Path -LiteralPath $CodexConfigPath) {
    Copy-Item -LiteralPath $CodexConfigPath -Destination "$CodexConfigPath.toolbraid-$(Get-Date -Format 'yyyyMMdd-HHmmss-fff').bak"
    $existingLines = [System.IO.File]::ReadAllLines($CodexConfigPath)
  }
  $block = @('', "[mcp_servers.$mcpName]", ('command = ' + ($nodePath | ConvertTo-Json -Compress)),
    ('args = ' + (@($mcpServerPath, '--config', $configPath) | ConvertTo-Json -Compress)), 'startup_timeout_sec = 10', 'tool_timeout_sec = 60')
  [System.IO.File]::WriteAllLines($CodexConfigPath, @((Remove-ToolBraidMcpBlock $existingLines $mcpName)) + $block, [System.Text.UTF8Encoding]::new($false))
}
Write-JsonFile $markerPath ([ordered]@{
  product = 'ToolBraid'; edition = $Edition; version = $manifest.version; installRoot = $InstallRoot
  hostName = $hostName; nativeManifest = $nativeManifestPath; registryPaths = $registryPaths
  client = $Client; codexConfig = $(if ($Client -eq 'Codex') { $CodexConfigPath } else { $priorInstall.codexConfig }); mcpName = $mcpName
  ownedFiles = @(@($runtimeFiles | ForEach-Object { "runtime\$_" }) + @(
    "native-host\ToolBraidNativeHost.exe", "native-host\$hostName.json", 'mcp-client.json'
  ) + $(if ($portablePackage) { @('runtime\node.exe', 'runtime\LICENSE.node.txt') } else { @('ToolBraidNativeHostLauncher.cs') }))
})
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\uninstall-mcp-bridge.ps1') -Destination (Join-Path $InstallRoot 'uninstall.ps1') -Force
[ordered]@{
  installed = $true; edition = $Edition; extensionId = $extensionId; extensionDirectory = $extensionDirectory
  installRoot = $InstallRoot; nativeHostManifest = $nativeManifestPath; browsers = $Browsers
  mcpClientConfig = $clientConfigPath; codexConfigured = ($Client -eq 'Codex'); requiresBrowserReload = $true
} | ConvertTo-Json -Depth 4
