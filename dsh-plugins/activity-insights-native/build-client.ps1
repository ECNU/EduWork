#Requires -Version 7.0
[CmdletBinding()]
param([Parameter(Mandatory)][string]$Upstream, [Parameter(Mandatory)][string]$Output, [Parameter(Mandatory)][string]$RuntimePackages, [string]$DshLockPath = '')
$ErrorActionPreference = 'Stop'
$upstreamRoot = (Resolve-Path -LiteralPath $Upstream).Path
$target = [IO.Path]::GetFullPath($Output)
$stage = Join-Path $upstreamRoot ('packages/extensions/activity-insights-build-' + [guid]::NewGuid().ToString('N'))
$tsdown = Join-Path $upstreamRoot ('node_modules/.bin/' + $(if ($IsWindows) { 'tsdown.cmd' } else { 'tsdown' }))
$linkType = if ($IsWindows) { 'Junction' } else { 'SymbolicLink' }
if (-not $stage.StartsWith($upstreamRoot.TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Build stage must stay in the selected toolchain' }
New-Item -ItemType Directory -Path $stage | Out-Null
try {
    $dependencies = (Resolve-Path -LiteralPath $RuntimePackages).Path
    if (-not (Test-Path -LiteralPath (Join-Path $dependencies 'zod/package.json'))) { throw 'The selected runtime must provide zod' }
    New-Item -ItemType $linkType -Path (Join-Path $stage 'node_modules') -Target $dependencies | Out-Null
    foreach ($name in @('src','lib','package.json','tsdown.config.ts')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $stage -Recurse }
    Push-Location $stage
    try { & $tsdown --config tsdown.config.ts; if ($LASTEXITCODE -ne 0) { throw 'Activity insights client build failed' } }
    finally { Pop-Location }
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    foreach ($file in Get-ChildItem -LiteralPath (Join-Path $stage 'lib') -File -Filter 'client.js') {
        $content = [IO.File]::ReadAllText($file.FullName) -replace '(?m)^//# sourceMappingURL=.*$', ''
        [IO.File]::WriteAllText((Join-Path $target $file.Name),$content,[Text.UTF8Encoding]::new($false))
    }
} finally {
    if (Test-Path -LiteralPath (Join-Path $stage 'node_modules')) { Remove-Item -LiteralPath (Join-Path $stage 'node_modules') -Force }
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
