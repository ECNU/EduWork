#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Product,
    [Parameter(Mandatory)][string]$ShellBuild,
    [Parameter(Mandatory)][string]$ElectronRuntime,
    [Parameter(Mandatory)][string]$Output,
    [Parameter(Mandatory)][string]$Version,
    [string]$Node = (Get-Command node.exe).Source,
    [string]$UpdateManifestURL = '',
    [ValidateSet('stable','development')][string]$UpdateDefaultPolicy
)
$ErrorActionPreference = 'Stop'
if (-not $UpdateDefaultPolicy) { $UpdateDefaultPolicy = if ($Version -match '-dev[.]') { 'development' } else { 'stable' } }
if (-not (Test-Path -LiteralPath (Join-Path $ElectronRuntime 'electron.exe') -PathType Leaf)) { throw 'ElectronRuntime must point to the extracted runtime containing electron.exe, not its cache parent' }
$Output = [IO.Path]::GetFullPath($Output)
if (Test-Path -LiteralPath $Output) { throw 'Electron output must be a new directory' }
if ($Output -match '(?i)(^|[\\/])current([\\/]|$)') { throw 'Electron cannot replace current' }
if ($Version -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$') { throw 'An explicit product version is required' }
$identity = Get-Content -LiteralPath (Join-Path $Product 'assembly.json') -Raw | ConvertFrom-Json
& $Node (Join-Path $PSScriptRoot '../../scripts/verify-product-release-identity.mjs') $Product $Version
if ($LASTEXITCODE -ne 0) { throw 'Product release identity verification failed' }
$receipt = Get-Content -LiteralPath (Join-Path $ShellBuild 'source-receipt.json') -Raw | ConvertFrom-Json
if ($identity.dshCommit -ne $receipt.dshCommit) { throw 'Electron and product DSH versions differ' }
$nodeVersion = (& $Node --version).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersion -ne $receipt.host.nodeVersion) { throw 'Node and qualified Host runtime versions differ' }
$nodeLicense = Join-Path (Split-Path $Node) 'LICENSE'
if (-not (Test-Path -LiteralPath $nodeLicense -PathType Leaf)) { throw 'Use the extracted official Node distribution, including its LICENSE beside node.exe' }
function Copy-Tree([string]$Source,[string]$Destination) {
    $nativeErrors = $PSNativeCommandUseErrorActionPreference
    try {
        $PSNativeCommandUseErrorActionPreference = $false
        & robocopy.exe $Source $Destination /E /XJ /XF *.map *.pdb *.pyc default_app.asar /XD __pycache__ /COPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { throw 'Electron payload copy failed' }
        $global:LASTEXITCODE = 0
    } finally { $PSNativeCommandUseErrorActionPreference = $nativeErrors }
}
Copy-Tree $ElectronRuntime $Output
$app = Join-Path $Output 'resources/app'
New-Item -ItemType Directory -Path $app -Force | Out-Null
Copy-Tree (Join-Path $ShellBuild 'lib') (Join-Path $app 'lib')
Copy-Tree (Join-Path $ShellBuild 'renderer') (Join-Path $app 'renderer')
Copy-Tree (Join-Path $ShellBuild 'third-party') (Join-Path $app 'third-party')
Copy-Item -LiteralPath (Join-Path $ShellBuild 'LICENSE-DeepSeek') -Destination (Join-Path $app 'LICENSE-DeepSeek')
Copy-Tree $Product (Join-Path $Output 'resources/product')
New-Item -ItemType Directory -Path (Join-Path $Output 'resources/runtime') -Force | Out-Null
Copy-Item -LiteralPath $Node -Destination (Join-Path $Output 'resources/runtime/node.exe')
Copy-Item -LiteralPath $nodeLicense -Destination (Join-Path $Output 'resources/runtime/LICENSE-Node')
Copy-Item -LiteralPath (Join-Path $ShellBuild 'source-receipt.json') -Destination (Join-Path $app 'source-receipt.json')
$name = $identity.brand.product.name
@{name='eduwork-desktop-electron';version=$identity.dshVersion;private=$true;type='module';main='lib/main.js';description='EduWork official DSH Electron integration';license='MIT'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $app 'package.json') -Encoding utf8NoBOM
$config = @{schemaVersion=1;shell='electron';appId="org.eduwork.$($identity.distribution).electron";distribution=$identity.distribution;productName=$name;productVersion=$Version;product='../product';node='../runtime/node.exe';updateChannel='disabled-candidate'}
$policyPath = Join-Path $Product 'resources/desktop/configuration-policy.json'
$config.configurationOwnership = 'user'
if (Test-Path -LiteralPath $policyPath) {
    $policy = Get-Content -LiteralPath $policyPath -Raw | ConvertFrom-Json
    if ($policy.schemaVersion -ne 1 -or $policy.ownership -notin @('user','publisher')) { throw 'Invalid desktop configuration ownership policy' }
    $config.configurationOwnership = $policy.ownership
}
$config.updates = @{defaultPolicy=$UpdateDefaultPolicy}
if ($identity.distribution -eq 'eduwork') {
    $config.updates.provider='github'; $config.updates.repository='ecnu/EduWork'; $config.updateChannel='github'
}
if ($UpdateManifestURL) { $config.updates = @{provider='static';manifestURL=$UpdateManifestURL;defaultPolicy=$UpdateDefaultPolicy}; $config.updateChannel='configured' }
$bootstrap = (& $Node (Join-Path $PSScriptRoot '../../scripts/check-publisher-bootstrap.mjs') $Product $config.configurationOwnership) | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Publisher bootstrap validation failed' }
if ($bootstrap.enabled) { $config.updateChannel = if ($bootstrap.softwareUpdates) { 'publisher-bootstrap' } else { 'disabled-candidate' } }
$config | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $app 'eduwork.desktop.json') -Encoding utf8NoBOM
$updaterPath = Join-Path $Output 'resources/update/EduWork-Updater.exe'
New-Item -ItemType Directory -Path (Split-Path $updaterPath) -Force | Out-Null
Push-Location (Join-Path $PSScriptRoot '../../dsh-desktop')
try {
    & go build -trimpath -ldflags '-s -w -H windowsgui' -o $updaterPath ./cmd/eduwork-updater
    if ($LASTEXITCODE -ne 0) { throw 'Portable update helper build failed' }
} finally { Pop-Location }
Rename-Item -LiteralPath (Join-Path $Output 'electron.exe') -NewName 'EduWork-Electron.exe'
& (Join-Path $PSScriptRoot '../../scripts/set-desktop-icon.ps1') -Executable (Join-Path $Output 'EduWork-Electron.exe') -Shell electron
$defaultConfig = Join-Path $Product 'resources/desktop/eduwork.jsonc'
if (-not (Test-Path -LiteralPath $defaultConfig -PathType Leaf)) { $defaultConfig = '' }
& (Join-Path $PSScriptRoot '../../scripts/install-desktop-config.ps1') -Output $Output -DefaultConfig $defaultConfig
@{schemaVersion=1;shell='electron';version=$Version;dshVersion=$identity.dshVersion;dshCommit=$identity.dshCommit;distribution=$identity.distribution;productName=$name;nodeVersion=$nodeVersion;nodeSHA256=(Get-FileHash -LiteralPath $Node -Algorithm SHA256).Hash.ToLowerInvariant();published=$false;automaticUpdates=($config.updateChannel -ne 'disabled-candidate');pluginPolicy='frozen-candidate';assembledAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Output 'release.json') -Encoding utf8NoBOM
@"
$name — Electron candidate $Version

Run EduWork-Electron.exe. Local data stays under data/$($identity.distribution)-electron.
Close the application before moving the entire folder. When an update feed is
configured, use Settings to check/download updates and choose when to restart.
To merge history from another installation, select its program root under
Settings > Import history. Existing credentials and settings remain unchanged.
"@ | Set-Content -LiteralPath (Join-Path $Output 'README.txt') -Encoding utf8NoBOM
Write-Output "Independent Electron candidate assembled: $Output"
