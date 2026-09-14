#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('electron','wails','both')][string]$Shell,
    [Parameter(Mandatory)][string]$Product,
    [Parameter(Mandatory)][string]$HostAdapter,
    [Parameter(Mandatory)][string]$OutputRoot,
    [Parameter(Mandatory)][string]$Version,
    [string]$ElectronShellBuild,
    [string]$ElectronRuntime,
    [string]$Node = (Get-Command node.exe -ErrorAction Stop).Source
)
$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$OutputRoot = [IO.Path]::GetFullPath($OutputRoot)
if ($OutputRoot -match '(?i)(^|[\\/])current([\\/]|$)') { throw 'Candidates must be assembled separately from current' }
if ($Shell -in @('electron','both') -and (-not $ElectronShellBuild -or -not $ElectronRuntime)) { throw 'ElectronShellBuild and ElectronRuntime are required for Electron' }
$selected = if ($Shell -eq 'both') { @('wails','electron') } else { @($Shell) }
# Preflight both outputs before creating either. No promotion, backup, or cleanup
# is implicit in this entry point; it only consumes the same frozen product.
foreach ($entry in $selected) {
    if (Test-Path -LiteralPath (Join-Path $OutputRoot "$entry-candidate")) { throw "Candidate already exists: $entry" }
}
& $Node (Join-Path $repository 'dsh-host/install-product-host.mjs') --product $Product --adapter $HostAdapter
if ($LASTEXITCODE -ne 0) { throw 'Desktop Host product preparation failed' }
foreach ($entry in $selected) {
    $destination = Join-Path $OutputRoot "$entry-candidate"
    if ($entry -eq 'wails') {
        & (Join-Path $repository 'dsh-desktop/scripts/assemble-official-host.ps1') -Product $Product -HostAdapter $HostAdapter -Output $destination -Version $Version -Node $Node
    } else {
        & (Join-Path $repository 'dsh-electron/scripts/assemble-windows.ps1') -Product $Product -ShellBuild $ElectronShellBuild -ElectronRuntime $ElectronRuntime -Output $destination -Version $Version -Node $Node
    }
}
Write-Output "Desktop candidates assembled from the same product: $OutputRoot"
