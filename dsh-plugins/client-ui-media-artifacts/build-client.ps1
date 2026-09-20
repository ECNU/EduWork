[CmdletBinding()]
param(
    [string]$Upstream = (Join-Path $PSScriptRoot '..\..\.research\upstream\deepseek-harness'),
    [string]$DshLockPath = '',
    [string]$ArtifactServices = '',
    [string]$Output = ''
)
$ErrorActionPreference = 'Stop'
$source = [IO.Path]::GetFullPath($PSScriptRoot)
$repository = [IO.Path]::GetFullPath((Join-Path $source '..\..'))
$upstream = [IO.Path]::GetFullPath($Upstream)
if ([string]::IsNullOrWhiteSpace($DshLockPath)) { $DshLockPath = Join-Path $repository 'third_party/dsh/LOCK.json' }
if ([string]::IsNullOrWhiteSpace($ArtifactServices)) { $ArtifactServices = Join-Path $upstream 'node_modules/@eduwork/dsh-artifact-services' }
$artifactSource = [IO.Path]::GetFullPath($ArtifactServices)
$artifactManifest = Get-Content -LiteralPath (Join-Path $artifactSource 'package.json') -Raw | ConvertFrom-Json
if ($artifactManifest.name -ne '@eduwork/dsh-artifact-services' -or -not $artifactManifest.exports.'./office-preview-client') {
    throw 'Select Shared Artifact Services with office-preview-client via -ArtifactServices.'
}
$target = if ([string]::IsNullOrWhiteSpace($Output)) { Join-Path $source 'lib' } else { [IO.Path]::GetFullPath($Output) }
if (-not $target.StartsWith($repository + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Media UI output must stay within the repository' }
$extensions = [IO.Path]::GetFullPath((Join-Path $upstream 'packages/extensions'))
$stage = [IO.Path]::GetFullPath((Join-Path $extensions ('chatecnu-work-client-ui-media-artifacts-' + [guid]::NewGuid().ToString('N'))))
$tsdown = Join-Path $upstream ('node_modules/.bin/' + $(if ($IsWindows) { 'tsdown.cmd' } else { 'tsdown' }))
& (Join-Path $repository 'dsh-desktop/scripts/test-dsh-compatibility.ps1') -Upstream $upstream -LockPath $DshLockPath
if (-not (Test-Path -LiteralPath $tsdown)) { throw "Locked DSH build dependencies are unavailable: $tsdown" }
if (Test-Path -LiteralPath $stage) { throw "Build stage already exists: $stage" }
try {
    New-Item -ItemType Directory -Path $stage | Out-Null
    Copy-Item -LiteralPath (Join-Path $source 'package.json') -Destination $stage
    Copy-Item -LiteralPath (Join-Path $source 'tsdown.config.ts') -Destination $stage
    Copy-Item -LiteralPath (Join-Path $source 'src') -Destination $stage -Recurse
    Rename-Item -LiteralPath (Join-Path $stage 'src/client/index.js') -NewName 'index.ts'
    # Resolve the product remote and browser-only Shared entry inside this
    # disposable stage. Never replace packages in upstream node_modules.
    $previewPackage = Join-Path $stage 'node_modules/@chatecnu-work/dsh-artifact-preview-native'
    New-Item -ItemType Directory -Path (Split-Path -Parent $previewPackage) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $source '../artifact-preview-native') -Destination $previewPackage -Recurse
    $zodSource = Get-ChildItem -LiteralPath (Join-Path $upstream 'node_modules/.pnpm') -Directory -Filter 'zod@*' |
        Sort-Object Name -Descending | Select-Object -First 1 | ForEach-Object { Join-Path $_.FullName 'node_modules/zod' }
    if ([string]::IsNullOrWhiteSpace($zodSource) -or -not (Test-Path -LiteralPath $zodSource)) { throw 'Locked DSH zod dependency is missing' }
    $stageZod = Join-Path $previewPackage 'node_modules/zod'
    New-Item -ItemType Directory -Path (Split-Path -Parent $stageZod) -Force | Out-Null
    Copy-Item -LiteralPath $zodSource -Destination $stageZod -Recurse
    $sharedPackage = Join-Path $stage 'node_modules/@eduwork/dsh-artifact-services'
    New-Item -ItemType Directory -Path (Join-Path $sharedPackage 'lib') -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $artifactSource 'lib/office-preview-client.js') -Destination (Join-Path $sharedPackage 'lib/office-preview-client.js')
    @{ name=$artifactManifest.name; version=$artifactManifest.version; type='module'; exports=@{'./office-preview-client'='./lib/office-preview-client.js'} } |
        ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $sharedPackage 'package.json') -Encoding utf8NoBOM
    Push-Location $stage
    try {
        & $tsdown --config tsdown.config.ts
        if ($LASTEXITCODE -ne 0) { throw "Media artifact client bundle failed with exit code $LASTEXITCODE" }
    } finally { Pop-Location }
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    foreach ($artifact in @('index.js', 'client.js')) {
        $built = Join-Path $stage "lib/$artifact"
        if (-not (Test-Path -LiteralPath $built)) { throw "Missing client artifact: $built" }
        $content = Get-Content -LiteralPath $built -Raw
        $content = $content -replace '(?m)[ \t]+$', '' -replace '(?m)^//# sourceMappingURL=client\.js\.map\s*$', ''
        Set-Content -LiteralPath (Join-Path $target $artifact) -Value $content -Encoding utf8NoBOM -NoNewline
    }
} finally {
    # Check the resolved unique target before deleting our own build stage.
    $resolvedStage = [IO.Path]::GetFullPath($stage)
    if (-not $resolvedStage.StartsWith($extensions + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
        (Split-Path -Leaf $resolvedStage) -notmatch '^chatecnu-work-client-ui-media-artifacts-[a-f0-9]{32}$') { throw 'Unsafe build-stage cleanup target' }
    if (Test-Path -LiteralPath $resolvedStage) { Remove-Item -LiteralPath $resolvedStage -Recurse -Force }
}
& (Join-Path $repository 'scripts/normalize-generated-client.ps1') -Path $target
Write-Host 'Built ChatECNU Work media artifact UI with the shared Office viewer.'
