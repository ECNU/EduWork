#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$WebAssembly,
    [Parameter(Mandatory)][string]$HostAdapter,
    [Parameter(Mandatory)][string]$Output,
    [string]$OidcSnapshot = '',
    [string]$StudioSnapshot = '',
    [string]$Version,
    [string]$BrandingBuild = ''
)
$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$WebAssembly = [IO.Path]::GetFullPath($WebAssembly)
$Output = [IO.Path]::GetFullPath($Output)
if (Test-Path -LiteralPath $Output) { throw 'Desktop product output must be a new directory' }
if ($Output -match '(?i)(^|[\\/])current([\\/]|$)') { throw 'Desktop candidates cannot replace current' }
$identity = Get-Content -LiteralPath (Join-Path $WebAssembly 'assembly.json') -Raw | ConvertFrom-Json
if ($identity.pluginMode -eq 'npm' -and ($OidcSnapshot -or $StudioSnapshot)) { throw 'An npm desktop product preserves the tested Web packages; assemble an explicit development Web product to use snapshot overrides' }
$hostReceipt = Get-Content -LiteralPath (Join-Path $HostAdapter 'receipt.json') -Raw | ConvertFrom-Json
if ($identity.kind -ne 'eduwork-web' -or $identity.dshCommit -ne $hostReceipt.upstreamCommit -or $identity.dshVersion -ne $hostReceipt.upstreamVersion) { throw 'Product and desktop Host baselines differ' }
. (Join-Path $PSScriptRoot 'copy-desktop-tree.ps1')
Copy-Tree $WebAssembly $Output
$modules = Join-Path $Output 'd/node_modules'
Copy-Tree (Join-Path $HostAdapter 'desktop-host') (Join-Path $modules '@deepseek-ai/dsh-desktop-host')
. (Join-Path $PSScriptRoot 'copy-dsh-package-payload.ps1')
$adapters = @{}
foreach ($folder in @('desktop-boundary','credentials-native','desktop-services','artifact-preview-native')) {
    $source = Join-Path $repository "dsh-plugins/$folder"
    $manifest = Get-Content -LiteralPath (Join-Path $source 'package.json') -Raw | ConvertFrom-Json
    $destination = Join-Path $modules $manifest.name
    if (Test-Path -LiteralPath $destination) {
        # Existing preview package is already part of the frozen product; only
        # its Host modules change for the new transport, with no client rebuild.
        Copy-Tree (Join-Path $source 'lib') (Join-Path $destination 'lib')
    } else { Copy-DshPackagePayload -Source $source -Destination $destination }
    foreach ($peer in @($manifest.peerDependencies.PSObject.Properties | Where-Object Name -like '@deepseek-ai/dsh-*')) { $peer.Value = $identity.dshVersion }
    $manifest | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $destination 'package.json') -Encoding utf8NoBOM
    $adapters[$manifest.name] = @{version=$manifest.version;source="dsh-plugins/$folder"}
}
if ($OidcSnapshot) {
    . (Join-Path $PSScriptRoot 'install-locked-dsh-package.ps1')
    $result = Install-LockedDshPackage -Destination (Join-Path $modules '@eduwork/dsh-oidc') -LockPath $OidcSnapshot -RequiredFiles @('lib/index.js','lib/client.js')
    $identity.managedPackages.'@eduwork/dsh-oidc' = $result
}
if ($StudioSnapshot) {
    . (Join-Path $PSScriptRoot 'install-locked-dsh-package.ps1')
    $result = Install-LockedDshPackage -Destination (Join-Path $modules '@eduwork/dsh-knowledge-studio') -LockPath $StudioSnapshot -RequiredFiles @('lib/index.js','lib/client.js')
    $identity.managedPackages.'@eduwork/dsh-knowledge-studio' = $result
}
if ($Version) {
    if ($Version -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$') { throw 'An explicit valid product version is required' }
    $identity.version = $Version
}
if ($BrandingBuild) {
    $branding = Join-Path $modules '@chatecnu-work/dsh-client-ui-branding/lib'
    $hashes = @{}
    foreach ($file in @('index.js','theme.js','client.js')) {
        $inputFile = Join-Path ([IO.Path]::GetFullPath($BrandingBuild)) $file
        Copy-Item -LiteralPath $inputFile -Destination (Join-Path $branding $file) -Force
        $hashes[$file] = (Get-FileHash -LiteralPath $inputFile -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    $identity | Add-Member -NotePropertyName brandingBuild -NotePropertyValue $hashes -Force
}
$identity | Add-Member -NotePropertyName desktopAdapters -NotePropertyValue $adapters -Force
$identity | Add-Member -NotePropertyName desktopHost -NotePropertyValue $hostReceipt -Force
$identity | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $Output 'assembly.json') -Encoding utf8NoBOM
Write-Output "Shared desktop product prepared: $Output"
