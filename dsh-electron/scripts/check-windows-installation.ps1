param(
  [Parameter(Mandatory = $true)][string]$Request,
  [switch]$RequireEmpty,
  [switch]$RequireToast,
  [switch]$Removed
)
$ErrorActionPreference = 'Stop'
$state = Get-Content -LiteralPath $Request -Raw | ConvertFrom-Json
$keys = @("HKCU:\$($state.registry.installKey)", "HKCU:\$($state.registry.uninstallKey)")
$toastKey = "HKCU:\Software\Classes\CLSID\$($state.toastCLSID)"
$links = @(
  (Join-Path ([Environment]::GetFolderPath('Programs')) "$($state.shortcutName).lnk"),
  (Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) "$($state.shortcutName).lnk")
)
if ($RequireEmpty -or $Removed) {
  foreach ($path in @($keys) + @($links) + @($toastKey)) {
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
$executable = [IO.Path]::GetFullPath((Join-Path $state.programRoot 'EduWork-Electron.exe'))
foreach ($path in $links) {
  if (!(Test-Path -LiteralPath $path)) { throw "Missing shortcut: $path" }
  if ([IO.Path]::GetFullPath($wsh.CreateShortcut($path).TargetPath) -ine $executable) {
    throw "Shortcut target differs: $path"
  }
}
if ($RequireToast) {
  $server = Get-Item -LiteralPath "$toastKey\LocalServer32"
  if ($server.GetValue('') -ine $executable -or $server.GetValue('ServerExecutable') -ine $executable) {
    throw 'Toast activator does not target the installed app'
  }
}
