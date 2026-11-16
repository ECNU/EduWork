#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Upstream,
    [Parameter(Mandatory)][string]$Output,
    [Parameter(Mandatory)][string]$RuntimePackages
)

& node (Join-Path $PSScriptRoot 'build-client.mjs') --upstream $Upstream --output $Output --runtime-packages $RuntimePackages
if ($LASTEXITCODE -ne 0) { throw 'Calendar client build failed' }
