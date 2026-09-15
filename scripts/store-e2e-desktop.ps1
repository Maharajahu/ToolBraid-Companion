param([ValidateSet('prepare', 'launch', 'capture', 'diagnostic')][string]$Action, [string]$ImageName)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or
    $env:GITHUB_REPOSITORY -ne 'Maharajahu/ToolBraid-Companion' -or $env:GITHUB_REF -notlike 'refs/heads/test/store-e2e-*') {
  throw 'Desktop testing is restricted to the approved disposable CI runner.'
}
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$desktop = [System.Windows.Automation.AutomationElement]::RootElement
function Named($parent, [string]$name) {
  $condition = New-Object System.Windows.Automation.PropertyCondition -ArgumentList @([System.Windows.Automation.AutomationElement]::NameProperty, $name)
  $parent.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
}
function Window([string]$name) {
  $condition = New-Object System.Windows.Automation.PropertyCondition -ArgumentList @([System.Windows.Automation.AutomationElement]::NameProperty, $name)
  $desktop.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
}
switch ($Action) {
  'prepare' {
    # Complete only the known first-login privacy page in this disposable image.
    for ($step = 0; $step -lt 6; $step++) {
      $account = Window 'Microsoft account'
      if (-not $account) { break }
      $privacy = Named $account 'Choose privacy settings for your device'
      if (-not $privacy) { break }
      foreach ($control in $privacy.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
        $toggle = $null
        if (-not $control.Current.IsOffscreen -and $control.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$toggle) -and
            $toggle.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On) { $toggle.Toggle() }
      }
      $condition = New-Object System.Windows.Automation.PropertyCondition -ArgumentList @([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'OobeSettingsAcceptButton')
      $next = $account.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
      if (-not $next) { throw 'Unknown runner privacy page.' }
      $next.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
      Start-Sleep -Milliseconds 500
    }
    @{ prepared = $true } | ConvertTo-Json -Compress
  }
  'launch' {
    Start-Process -FilePath "$env:WINDIR\explorer.exe" -ArgumentList 'shell:AppsFolder\Maharajahu.ToolBraidCompanion_f24v1p0f17va4!Companion' -WindowStyle Hidden
    @{ launched = $true } | ConvertTo-Json -Compress
  }
  'diagnostic' {
    $window = Window 'ToolBraid connection check'
    if (-not $window) { throw 'Connection check dialog is not open.' }
    $control = Named $window 'Connection check results'
    $value = $control.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value
    @{ text = $value } | ConvertTo-Json -Compress
  }
  'capture' {
    if ($ImageName -notmatch '^[a-zA-Z0-9-]+\.png$') { throw 'Invalid screenshot filename.' }
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
      $bitmap.Save((Join-Path $env:TOOLBRAID_E2E_EVIDENCE $ImageName), [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
    @{ captured = $true } | ConvertTo-Json -Compress
  }
}
