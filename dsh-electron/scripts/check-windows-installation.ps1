param(
  [Parameter(Mandatory = $true)][string]$Request,
  [switch]$RequireEmpty,
  [switch]$Removed
)
$ErrorActionPreference = 'Stop'
$state = Get-Content -LiteralPath $Request -Raw | ConvertFrom-Json
$keys = @("HKCU:\$($state.registry.installKey)", "HKCU:\$($state.registry.uninstallKey)")
$links = @(
  (Join-Path ([Environment]::GetFolderPath('Programs')) "$($state.shortcutName).lnk"),
  (Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) "$($state.shortcutName).lnk")
)
if ($RequireEmpty -or $Removed) {
  foreach ($path in @($keys) + @($links)) {
    if (Test-Path -LiteralPath $path) { throw "Existing installation or shortcut: $path" }
  }
  exit 0
}
foreach ($key in $keys) {
  if (!(Test-Path -LiteralPath $key)) { throw "Missing installation registry: $key" }
}
$location = (Get-ItemProperty -LiteralPath $keys[0]).InstallLocation
if ([IO.Path]::GetFullPath($location) -ine [IO.Path]::GetFullPath($state.programRoot)) { throw 'InstallLocation differs' }
$wsh = New-Object -ComObject WScript.Shell
foreach ($path in $links) {
  if (!(Test-Path -LiteralPath $path)) { throw "Missing shortcut: $path" }
  if ([IO.Path]::GetFullPath($wsh.CreateShortcut($path).TargetPath) -ine [IO.Path]::GetFullPath((Join-Path $state.programRoot 'EduWork-Electron.exe'))) {
    throw "Shortcut target differs: $path"
  }
}
