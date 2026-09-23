#Requires -Version 7.0
[CmdletBinding()]
param([Parameter(Mandatory)][string]$Upstream, [Parameter(Mandatory)][string]$Output, [Parameter(Mandatory)][string]$RuntimePackages, [string]$DshLockPath = '')
$ErrorActionPreference = 'Stop'
$upstreamRoot = (Resolve-Path -LiteralPath $Upstream).Path
$target = [IO.Path]::GetFullPath($Output)
$stage = Join-Path $upstreamRoot ('packages/extensions/eduwork-workbench-build-' + [guid]::NewGuid().ToString('N'))
$tsdown = Join-Path $upstreamRoot ('node_modules/.bin/' + $(if ($IsWindows) { 'tsdown.cmd' } else { 'tsdown' }))
$linkType = if ($IsWindows) { 'Junction' } else { 'SymbolicLink' }
if (-not $stage.StartsWith($upstreamRoot.TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Build stage must stay in the selected toolchain' }
New-Item -ItemType Directory -Path $stage | Out-Null
try {
    $dependencies = (Resolve-Path -LiteralPath $RuntimePackages).Path
    if (-not (Test-Path -LiteralPath (Join-Path $dependencies 'zod/package.json'))) { throw 'The selected runtime must provide zod' }
    New-Item -ItemType Directory -Path (Join-Path $stage 'node_modules/@chatecnu-work') -Force | Out-Null
    New-Item -ItemType $linkType -Path (Join-Path $stage 'node_modules/zod') -Target (Join-Path $dependencies 'zod') | Out-Null
    foreach ($folder in @('skill-manager-native','skill-settings-native')) {
        $support = Join-Path $stage "node_modules/@chatecnu-work/dsh-$folder"
        New-Item -ItemType Directory -Path $support | Out-Null
        foreach ($file in @('lib','package.json')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot "../$folder/$file") -Destination $support -Recurse }
    }
    foreach ($name in @('src','lib','package.json','tsdown.config.ts','tsconfig.json')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $stage -Recurse }
    Push-Location $stage
    try { & $tsdown --config tsdown.config.ts; if ($LASTEXITCODE -ne 0) { throw 'EduWork workbench client build failed' } }
    finally { Pop-Location }
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    foreach ($file in Get-ChildItem -LiteralPath (Join-Path $stage 'lib') -File -Filter '*.js') {
        $content = [IO.File]::ReadAllText($file.FullName) -replace '(?m)^//# sourceMappingURL=.*$', ''
        # Rolldown region comments can contain resolved dependency paths outside
        # the toolchain. Keep build-machine paths out of the shipped source.
        $content = $content -replace '(?m)^[ \t]*//#(?:end)?region\b[^\r\n]*\r?\n', ''
        $content = ($content -replace '(?m)[ \t]+(?=\r?$)', '').TrimEnd("`r", "`n") + "`n"
        [IO.File]::WriteAllText((Join-Path $target $file.Name),$content,[Text.UTF8Encoding]::new($false))
    }
} finally {
    if (Test-Path -LiteralPath (Join-Path $stage 'node_modules/zod')) { Remove-Item -LiteralPath (Join-Path $stage 'node_modules/zod') -Force }
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
