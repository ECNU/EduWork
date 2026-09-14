[CmdletBinding()]
param([string]$Upstream = (Join-Path $PSScriptRoot '..\..\.research\upstream\deepseek-harness'), [string]$DshLockPath = '', [string]$Output = '')

$ErrorActionPreference = 'Stop'
$source = [IO.Path]::GetFullPath($PSScriptRoot)
$repository = [IO.Path]::GetFullPath((Join-Path $source '..\..'))
$upstream = [IO.Path]::GetFullPath($Upstream)
if ([string]::IsNullOrWhiteSpace($DshLockPath)) { $DshLockPath = Join-Path $repository 'third_party\dsh\LOCK.json' }
$target = if ([string]::IsNullOrWhiteSpace($Output)) { Join-Path $source 'lib' } else { [IO.Path]::GetFullPath($Output) }
if (-not $target.StartsWith($repository + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Component inventory output must stay within the repository' }
$stage = Join-Path $upstream 'packages\extensions\chatecnu-work-component-inventory-ui'
$hostPackage = Join-Path $upstream 'node_modules\@chatecnu-work\dsh-component-inventory-native'
$hostSource = Join-Path $source '..\component-inventory-native'
$managerPackage = Join-Path $upstream 'node_modules\@chatecnu-work\dsh-plugin-manager-native'
$managerSource = Join-Path $source '..\plugin-manager-native'
$tsdown = Join-Path $upstream 'node_modules\.bin\tsdown.cmd'
$zodPackages = @(
    (Join-Path $hostPackage 'node_modules\zod'),
    (Join-Path $managerPackage 'node_modules\zod')
)
$zodSource = Get-ChildItem -LiteralPath (Join-Path $upstream 'node_modules\.pnpm') -Directory -Filter 'zod@*' |
    Sort-Object Name -Descending | Select-Object -First 1 | ForEach-Object { Join-Path $_.FullName 'node_modules\zod' }

& (Join-Path $repository 'dsh-desktop\scripts\test-dsh-compatibility.ps1') -Upstream $upstream -LockPath $DshLockPath
if (-not (Test-Path -LiteralPath $tsdown)) { throw "Locked DSH build dependencies are unavailable: $tsdown" }
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
if (Test-Path -LiteralPath $hostPackage) { Remove-Item -LiteralPath $hostPackage -Recurse -Force }
if (Test-Path -LiteralPath $managerPackage) { Remove-Item -LiteralPath $managerPackage -Recurse -Force }
try {
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $source 'package.json') -Destination $stage
    Copy-Item -LiteralPath (Join-Path $source 'tsdown.config.ts') -Destination $stage
    Copy-Item -LiteralPath (Join-Path $source 'src') -Destination $stage -Recurse
    New-Item -ItemType Directory -Path (Split-Path -Parent $hostPackage) -Force | Out-Null
    Copy-Item -LiteralPath $hostSource -Destination $hostPackage -Recurse
    Copy-Item -LiteralPath $managerSource -Destination $managerPackage -Recurse
    if ([string]::IsNullOrWhiteSpace($zodSource) -or -not (Test-Path -LiteralPath $zodSource)) { throw 'Locked zod dependency is unavailable.' }
    foreach ($zodPackage in $zodPackages) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $zodPackage) -Force | Out-Null
        Copy-Item -LiteralPath $zodSource -Destination $zodPackage -Recurse
    }
    Push-Location $stage
    try {
        & $tsdown --config tsdown.config.ts
        if ($LASTEXITCODE -ne 0) { throw "Component inventory client bundle failed with exit code $LASTEXITCODE" }
    } finally { Pop-Location }
    foreach ($artifact in @('index.js', 'client.js')) {
        $built = Join-Path $stage "lib\$artifact"
        if (-not (Test-Path -LiteralPath $built)) { throw "Missing client artifact: $built" }
        New-Item -ItemType Directory -Path $target -Force | Out-Null
        Copy-Item -LiteralPath $built -Destination (Join-Path $target $artifact) -Force
    }
} finally {
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
    if (Test-Path -LiteralPath $hostPackage) { Remove-Item -LiteralPath $hostPackage -Recurse -Force }
    if (Test-Path -LiteralPath $managerPackage) { Remove-Item -LiteralPath $managerPackage -Recurse -Force }
}
& (Join-Path $repository 'scripts\normalize-generated-client.ps1') -Path $target
Write-Host 'Built DSH component inventory client module.'
