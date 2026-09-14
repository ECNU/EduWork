#Requires -Version 7.0
[CmdletBinding()]
param(
 [Parameter(Mandatory)][string]$Product,
 [Parameter(Mandatory)][string]$HostAdapter,
 [Parameter(Mandatory)][string]$Output,
 [Parameter(Mandatory)][string]$Version,
 [Parameter(Mandatory)][string]$UpdateConfig,
 [ValidateSet('stable','development')][string]$UpdateDefaultPolicy,
 [string]$Node=(Get-Command node.exe -ErrorAction Stop).Source
)
$ErrorActionPreference='Stop'
$core=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$Output=[IO.Path]::GetFullPath($Output)
$edition=Get-Content -LiteralPath $UpdateConfig -Raw|ConvertFrom-Json
if($edition.schemaVersion -ne 1 -or -not $edition.allowShellMigration){throw 'Bridge requires an explicit migration-capable update configuration'}
if(-not $UpdateDefaultPolicy){$UpdateDefaultPolicy=if($Version -match '-dev[.]'){'development'}else{'stable'}}
$edition.defaultPolicy=$UpdateDefaultPolicy
& (Join-Path $PSScriptRoot 'assemble-official-host.ps1') -Product $Product -HostAdapter $HostAdapter -Output $Output -Version $Version -Node $Node
if(-not $?){throw 'Wails build failed'}
$path=Join-Path $Output 'eduwork.desktop.json'
$identity=Get-Content -LiteralPath $path -Raw|ConvertFrom-Json
if($identity.productVersion -ne $Version){throw 'Product and bridge versions must agree'}
$identity.appId="org.eduwork.$($identity.distribution).wails"
$identity|Add-Member -NotePropertyName bridge -NotePropertyValue $true
$identity|Add-Member -NotePropertyName updateDefaultPolicy -NotePropertyValue $UpdateDefaultPolicy
$identity|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $path -Encoding utf8NoBOM
$edition|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $Output 'config/update.bridge.json') -Encoding utf8NoBOM
Push-Location (Join-Path $core 'dsh-desktop')
try {
 & go build -trimpath -ldflags '-s -w -H windowsgui' -o (Join-Path $Output 'ChatECNU-Work.exe') ./cmd/eduwork-launch
 if($LASTEXITCODE -ne 0){throw 'Legacy shortcut launcher build failed'}
}finally{Pop-Location}
& (Join-Path $core 'scripts/set-desktop-icon.ps1') -Executable (Join-Path $Output 'ChatECNU-Work.exe') -Shell wails
$productIdentity=Get-Content -LiteralPath (Join-Path $Product 'assembly.json') -Raw|ConvertFrom-Json
[ordered]@{schemaVersion=1;product=$identity.productName;version=$Version;platform='windows-amd64';packageFlavor='offline';desktopShell='Wails';dshVersion=$productIdentity.dshVersion;migration='wails-host-v1';entry='ChatECNU-Work.exe'}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $Output 'release.json') -Encoding utf8NoBOM
@'
EduWork@ECNU Go 过渡版

运行 ChatECNU-Work.exe（兼容旧快捷方式）或 EduWork.exe。
旧 data/dsh 的历史在首次启动时导入 data/eduwork-chatecnu-wails/dsh；原数据保留。
升级后需要重新登录。外部工作区文件仍在原位置。
更新入口位于设置及系统托盘；配置见 config/update.bridge.json。
后续 Electron 迁移包必须使用 wails-host-v1，且版本高于当前 Go 版。
请勿手工覆盖 data、config，或把普通 Electron 新安装 ZIP 放入旧更新渠道。
'@|Set-Content -LiteralPath (Join-Path $Output 'README-过渡升级.txt') -Encoding utf8NoBOM
Write-Output "Prepared legacy-compatible Wails bridge: $Output"
