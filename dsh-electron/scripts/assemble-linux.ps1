#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Product,
    [Parameter(Mandatory)][string]$ShellBuild,
    [Parameter(Mandatory)][string]$ElectronRuntime,
    [Parameter(Mandatory)][string]$Output,
    [Parameter(Mandatory)][string]$Version,
    [Parameter(Mandatory)][string]$Node,
    [ValidateSet('stable','development')][string]$UpdateDefaultPolicy
)
$ErrorActionPreference = 'Stop'
if (-not $IsLinux -or (& node -p 'process.arch').Trim() -ne 'x64') { throw 'The Linux Electron candidate must be assembled on linux x64' }
$Product = [IO.Path]::GetFullPath($Product)
$ShellBuild = [IO.Path]::GetFullPath($ShellBuild)
$ElectronRuntime = [IO.Path]::GetFullPath($ElectronRuntime)
$Output = [IO.Path]::GetFullPath($Output)
$Node = [IO.Path]::GetFullPath($Node)
if (Test-Path -LiteralPath $Output) { throw 'Linux output must be a new directory' }
if ($Version -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$') { throw 'An explicit product version is required' }
if (-not $UpdateDefaultPolicy) { $UpdateDefaultPolicy = if ($Version.Contains('-')) { 'development' } else { 'stable' } }
if (-not (Test-Path -LiteralPath (Join-Path $ElectronRuntime 'electron') -PathType Leaf)) { throw 'ElectronRuntime must contain the linux electron binary' }
$identity = Get-Content -LiteralPath (Join-Path $Product 'assembly.json') -Raw | ConvertFrom-Json
& $Node (Join-Path $PSScriptRoot '../../scripts/verify-product-release-identity.mjs') $Product $Version
if ($LASTEXITCODE -ne 0) { throw 'Product release identity verification failed' }
$receipt = Get-Content -LiteralPath (Join-Path $ShellBuild 'source-receipt.json') -Raw | ConvertFrom-Json
if ($identity.dshCommit -ne $receipt.dshCommit) { throw 'Electron and product DSH versions differ' }
$nodeVersion = (& $Node --version).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersion -ne $receipt.host.nodeVersion) { throw 'Node and qualified Host runtime versions differ' }
$nodeRoot = Split-Path (Split-Path $Node -Parent) -Parent
$nodeLicense = Join-Path $nodeRoot 'LICENSE'
if (-not (Test-Path -LiteralPath $nodeLicense -PathType Leaf)) { throw 'Use the extracted official Node distribution, including LICENSE' }
New-Item -ItemType Directory -Path $Output | Out-Null
& rsync -a --exclude '*.map' --exclude '*.pdb' --exclude '*.pyc' --exclude '__pycache__' --exclude 'default_app.asar' ($ElectronRuntime + '/') ($Output + '/')
if ($LASTEXITCODE -ne 0) { throw 'Electron payload copy failed' }
$app = Join-Path $Output 'resources/app'
New-Item -ItemType Directory -Path $app -Force | Out-Null
foreach ($folder in @('lib','renderer','third-party')) {
    if ($folder -eq 'renderer' -and -not (Test-Path -LiteralPath (Join-Path $ShellBuild $folder))) { continue }
    & rsync -a ((Join-Path $ShellBuild $folder) + '/') ((Join-Path $app $folder) + '/')
    if ($LASTEXITCODE -ne 0) { throw "Shell payload copy failed: $folder" }
}
Copy-Item -LiteralPath (Join-Path $ShellBuild 'LICENSE-DeepSeek') -Destination $app
Copy-Item -LiteralPath (Join-Path $ShellBuild 'source-receipt.json') -Destination $app
& rsync -a ($Product + '/') ((Join-Path $Output 'resources/product') + '/')
if ($LASTEXITCODE -ne 0) { throw 'Product copy failed' }
New-Item -ItemType Directory -Path (Join-Path $Output 'resources/runtime') -Force | Out-Null
Copy-Item -LiteralPath $Node -Destination (Join-Path $Output 'resources/runtime/node')
Copy-Item -LiteralPath $nodeLicense -Destination (Join-Path $Output 'resources/runtime/LICENSE-Node')
& chmod 755 (Join-Path $Output 'resources/runtime/node')
@{ name = 'eduwork-desktop-electron'; version = $identity.dshVersion; private = $true; type = 'module'; main = 'lib/main.js'; description = 'EduWork official DSH Electron integration'; license = 'MIT' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $app 'package.json') -Encoding utf8NoBOM
$config = @{ schemaVersion = 1; shell = 'electron'; appId = "org.eduwork.$($identity.distribution).electron"; distribution = $identity.distribution; productName = $identity.brand.product.name; productVersion = $Version; product = '../product'; node = '../runtime/node'; updateChannel = 'disabled-candidate' }
$policyPath = Join-Path $Product 'resources/desktop/configuration-policy.json'
$config.configurationOwnership = 'user'
if (Test-Path -LiteralPath $policyPath) {
    $policy = Get-Content -LiteralPath $policyPath -Raw | ConvertFrom-Json
    if ($policy.schemaVersion -ne 1 -or $policy.ownership -notin @('user','publisher')) { throw 'Invalid desktop configuration ownership policy' }
    $config.configurationOwnership = $policy.ownership
}
# Linux has no update feed yet. Keep the channel disabled so a stable package
# does not advertise the Windows GitHub manifest.
$config.updates = @{ provider = 'disabled'; defaultPolicy = $UpdateDefaultPolicy }
$config.updateChannel = 'disabled-candidate'
if ($identity.sourceAlpha) { $config.sourceAlpha = $true; $config.appId += '.alpha' }
$bootstrap = (& $Node (Join-Path $PSScriptRoot '../../scripts/check-publisher-bootstrap.mjs') $Product $config.configurationOwnership) | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Publisher bootstrap validation failed' }
if ($bootstrap.enabled) { $config.updateChannel = if ($bootstrap.softwareUpdates) { 'publisher-bootstrap' } else { 'disabled-candidate' } }
$config | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $app 'eduwork.desktop.json') -Encoding utf8NoBOM
$updaterPath = Join-Path $Output 'resources/update/eduwork-updater'
New-Item -ItemType Directory -Path (Split-Path $updaterPath) -Force | Out-Null
Push-Location (Join-Path $PSScriptRoot '../../dsh-desktop')
try {
    $env:GOTOOLCHAIN = 'go1.26.6'
    & go build -trimpath -ldflags '-s -w' -o $updaterPath ./cmd/eduwork-updater
    if ($LASTEXITCODE -ne 0) { throw 'Linux update helper build failed' }
} finally { Pop-Location }
& chmod 755 $updaterPath
# A non-root chrome-sandbox makes Electron abort before it can use a namespace
# sandbox, and a tarball cannot keep the root-owned setuid bit.
Remove-Item -LiteralPath (Join-Path $Output 'chrome-sandbox') -Force -ErrorAction SilentlyContinue
Rename-Item -LiteralPath (Join-Path $Output 'electron') -NewName 'eduwork.bin'
$launcher = @'
#!/bin/sh
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
restrict=0
if [ -r /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]; then
    restrict=$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns)
fi
# Ubuntu 23.10 and newer block the user-namespace sandbox. Elsewhere, keep it.
# Credentials use the unlocked GNOME keyring. Name the store so a headless
# acceptance session does not fall back to plaintext.
if [ "$restrict" = 1 ]; then
    exec "$here/eduwork.bin" --no-sandbox --password-store=gnome-libsecret "$@"
fi
exec "$here/eduwork.bin" --password-store=gnome-libsecret "$@"
'@
[IO.File]::WriteAllText((Join-Path $Output 'eduwork'), ($launcher -replace "`r`n","`n"))
& chmod 755 (Join-Path $Output 'eduwork.bin') (Join-Path $Output 'eduwork')
$defaultConfig = Join-Path $Product 'resources/desktop/eduwork.jsonc'
if (-not (Test-Path -LiteralPath $defaultConfig -PathType Leaf)) { $defaultConfig = '' }
& (Join-Path $PSScriptRoot '../../scripts/install-desktop-config.ps1') -Output $Output -DefaultConfig $defaultConfig
@{ schemaVersion = 1; shell = 'electron'; version = $Version; dshVersion = $identity.dshVersion; dshCommit = $identity.dshCommit; distribution = $identity.distribution; productName = $identity.brand.product.name; nodeVersion = $nodeVersion; nodeSHA256 = (Get-FileHash -LiteralPath $Node -Algorithm SHA256).Hash.ToLowerInvariant(); published = $false; automaticUpdates = $false; pluginPolicy = 'frozen-candidate'; assembledAt = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Output 'release.json') -Encoding utf8NoBOM
@"
$($identity.brand.product.name) — Linux x64 $Version

Run ./eduwork from this directory. The package targets Ubuntu 22.04 and newer
glibc systems, including Ubuntu 24.04. On Ubuntu 23.10 and newer, AppArmor
blocks the user-namespace sandbox, so ./eduwork adds --no-sandbox there.
Credential storage uses the unlocked GNOME keyring from the desktop session.
Local data stays under data/.
Software update is not enabled for this package.
"@ | Set-Content -LiteralPath (Join-Path $Output 'README.txt') -Encoding utf8NoBOM
Write-Output "Linux Electron candidate assembled: $Output"
