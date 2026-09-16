[CmdletBinding()]
param([string]$Upstream, [string]$DshLockPath = '', [string]$Output = '')

$ErrorActionPreference = 'Stop'
$Upstream = if ([string]::IsNullOrWhiteSpace($Upstream)) { Join-Path $PSScriptRoot '..\..\.research\upstream\deepseek-harness' } else { $Upstream }
$source = [IO.Path]::GetFullPath($PSScriptRoot)
$repository = [IO.Path]::GetFullPath((Join-Path $source '..\..'))
$upstream = [IO.Path]::GetFullPath($Upstream)
if ([string]::IsNullOrWhiteSpace($DshLockPath)) { $DshLockPath = Join-Path $repository 'third_party\dsh\LOCK.json' }
$target = if ([string]::IsNullOrWhiteSpace($Output)) { Join-Path $source 'lib' } else { [IO.Path]::GetFullPath($Output) }
if (-not $target.StartsWith($repository + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Branding output must stay within the repository' }
$stage = Join-Path $upstream 'packages\extensions\chatecnu-work-client-ui-branding'
$tsdown = Join-Path $upstream ('node_modules/.bin/' + $(if ($IsWindows) { 'tsdown.cmd' } else { 'tsdown' }))

& (Join-Path $repository 'dsh-desktop\scripts\test-dsh-compatibility.ps1') -Upstream $upstream -LockPath $DshLockPath
if (-not (Test-Path -LiteralPath $tsdown)) { throw "Locked DSH build dependencies are unavailable: $tsdown" }
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }

try {
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $source 'package.json') -Destination $stage
    Copy-Item -LiteralPath (Join-Path $source 'tsdown.config.ts') -Destination $stage
    Copy-Item -LiteralPath (Join-Path $source 'src') -Destination $stage -Recurse
    Push-Location $stage
    try {
        & $tsdown --config tsdown.config.ts
        if ($LASTEXITCODE -ne 0) { throw "Branding client bundle failed with exit code $LASTEXITCODE" }
    } finally { Pop-Location }
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    foreach ($artifact in @('index.js', 'theme.js', 'client.js')) {
        $built = Join-Path $stage "lib\$artifact"
        if (-not (Test-Path -LiteralPath $built)) { throw "Missing client artifact: $built" }
        $destination = Join-Path $target $artifact
        Copy-Item -LiteralPath $built -Destination $destination -Force
        $content = [IO.File]::ReadAllText($destination, [Text.UTF8Encoding]::new($false, $true))
        $content = $content -replace '(?m)^//# sourceMappingURL=client\.js\.map\s*$', ''
        [IO.File]::WriteAllText($destination, $content.TrimEnd(), [Text.UTF8Encoding]::new($false))
    }
} finally {
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
}

& (Join-Path $repository 'scripts\normalize-generated-client.ps1') -Path $target

Write-Host 'Built configurable EduWork branding client module.'
