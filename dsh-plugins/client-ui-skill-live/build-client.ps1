[CmdletBinding()]
param(
    [string]$Upstream = (Join-Path $PSScriptRoot '..\..\.research\upstream\deepseek-harness'),
    [string]$RuntimePackages = '',
    [string]$DshLockPath = '',
    [string]$Output = ''
)

$ErrorActionPreference = 'Stop'
$upstreamName = '@deepseek-ai/dsh-client-ui-skill'
$productName = '@chatecnu-work/dsh-client-ui-skill-live'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if ([string]::IsNullOrWhiteSpace($DshLockPath)) { $DshLockPath = Join-Path $repository 'third_party\dsh\LOCK.json' }
$lock = Get-Content -Raw -LiteralPath $DshLockPath | ConvertFrom-Json
$source = if ([string]::IsNullOrWhiteSpace($RuntimePackages)) {
    & (Join-Path $repository 'dsh-desktop\scripts\test-dsh-compatibility.ps1') -Upstream $Upstream -LockPath $DshLockPath
    Join-Path $Upstream 'packages\client\ui-skill\lib\client.js'
} else {
    $runtimePackage = Join-Path ([IO.Path]::GetFullPath($RuntimePackages)) '@deepseek-ai\dsh-client-ui-skill'
    $manifest = Get-Content -Raw -LiteralPath (Join-Path $runtimePackage 'package.json') | ConvertFrom-Json
    if ([string]$manifest.version -ne [string]$lock.packageVersion) {
        throw "Official DSH Skill UI package version mismatch: expected $($lock.packageVersion), got $($manifest.version)"
    }
    Join-Path $runtimePackage 'lib\client.js'
}
$target = if ([string]::IsNullOrWhiteSpace($Output)) { Join-Path $PSScriptRoot 'lib\client.js' } else { Join-Path ([IO.Path]::GetFullPath($Output)) 'client.js' }
if (-not $target.StartsWith($repository + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Skill UI output must stay within the repository' }
New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null

if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "Locked upstream Skill UI artifact is missing: $source"
}

$content = Get-Content -Raw -LiteralPath $source
if ($content.Contains('chatecnu-skills')) {
    throw 'Locked upstream Skill UI unexpectedly already contains the product settings namespace'
}
$identityCount = ([regex]::Matches($content, [regex]::Escape($upstreamName))).Count
if ($identityCount -lt 3) {
    throw "Unexpected upstream Skill UI module identity count: $identityCount"
}
$content = $content.Replace($upstreamName, $productName)

$anchor = 'ctx.remote.$on("agent-preset/selected", invalidate);'
$replacement = @'
ctx.remote.$on("agent-preset/selected", invalidate);
			ctx.remote.$on("settings/document-updated", (namespace) => {
				if (namespace === "chatecnu-skills") clearAll();
			});
'@.TrimEnd()
$anchorCount = ([regex]::Matches($content, [regex]::Escape($anchor))).Count
if ($anchorCount -ne 1) {
    throw "Unexpected upstream Skill UI invalidation anchor count: $anchorCount"
}
$content = $content.Replace($anchor, $replacement)
$content = $content -replace '(?m)^//# sourceMappingURL=client\.js\.map\s*$', ''
Set-Content -LiteralPath $target -Value $content.TrimEnd() -Encoding utf8NoBOM -NoNewline

& (Join-Path $PSScriptRoot '..\..\scripts\normalize-generated-client.ps1') -Path (Split-Path -Parent $target)

Write-Host 'Built product-owned live Skill UI compatibility plugin.'
