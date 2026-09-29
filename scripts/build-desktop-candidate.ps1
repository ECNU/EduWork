#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$CoreRoot,
    [Parameter(Mandatory)][string]$EditionRoot,
    [Parameter(Mandatory)][string]$Version,
    [Parameter(Mandatory)][string]$Output
)
$ErrorActionPreference='Stop'
$PSNativeCommandUseErrorActionPreference=$true
$CoreRoot=(Resolve-Path -LiteralPath $CoreRoot).Path
$EditionRoot=(Resolve-Path -LiteralPath $EditionRoot).Path
$plan = (& node (Join-Path $CoreRoot 'scripts/desktop-build-plan.mjs') --core $CoreRoot --edition $EditionRoot --version $Version) | ConvertFrom-Json
& node (Join-Path $CoreRoot 'scripts/check-source-docs.mjs') $CoreRoot
if ($CoreRoot -ne $EditionRoot) { & node (Join-Path $CoreRoot 'scripts/check-source-docs.mjs') $EditionRoot }
# Keep the qualified native implementation; the workflow no longer selects
# version-specific branches or duplicates institution validation commands.
& (Join-Path $CoreRoot 'scripts/ci-017-alpha-desktop.ps1') -CoreRoot $CoreRoot -EditionRoot $EditionRoot -Version $Version -Output $Output -Stable:($plan.channel -eq 'stable') -PublisherDescriptors $plan.publisherDescriptors -VerifyPublisherBootstrap:$plan.verifyPublisherBootstrap
if ($plan.validationScript) {
    & $plan.validationScript -CoreRoot $CoreRoot -EditionRoot $EditionRoot -Product (Join-Path $Output 'product')
}
