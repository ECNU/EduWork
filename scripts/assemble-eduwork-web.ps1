#Requires -Version 7.0
[CmdletBinding()]
param(
    [string]$CoreRoot = (Join-Path $PSScriptRoot '..'),
    [string]$EditionRoot = '',
    [string]$DistributionConfig = 'config/distributions/generic.json',
    [Parameter(Mandatory)][string]$Output,
    [Parameter(Mandatory)][string]$Version,
    [string]$RuntimeSource = '',
    [ValidateSet('npm','source')][string]$RuntimeMode = 'npm',
    [ValidateSet('npm','locked')][string]$PluginMode = 'npm',
    [string]$Upstream = '',
    [string]$AssemblyConfig = '',
    [string]$DshLockPath = ''
)
$ErrorActionPreference = 'Stop'
$CoreRoot = [IO.Path]::GetFullPath($CoreRoot)
if (-not $EditionRoot) { $EditionRoot = $CoreRoot }
$EditionRoot = [IO.Path]::GetFullPath($EditionRoot)
$Output = [IO.Path]::GetFullPath($Output)
function Child([string]$Root, [string]$Relative) {
    if (-not $Relative -or [IO.Path]::IsPathRooted($Relative) -or ($Relative -split '[/\\]') -contains '..') { throw "Expected a path inside its declared root: $Relative" }
    $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('/','\')
    $target = [IO.Path]::GetFullPath((Join-Path $rootPath $Relative))
    if (-not $target.StartsWith($rootPath + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Path leaves its declared root' }
    return $target
}
function Owner([object]$Entry) {
    if (-not $Entry.root -or $Entry.root -eq 'core') { return $CoreRoot }
    if ($Entry.root -eq 'edition') { return $EditionRoot }
    throw "Unknown source root: $($Entry.root)"
}
if ($Version -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$') { throw 'Supply an explicit build version' }
if (Test-Path -LiteralPath $Output) { throw "Assembly output already exists: $Output" }
$selected = Get-Content -LiteralPath (Child $EditionRoot $DistributionConfig) -Raw | ConvertFrom-Json
if ($selected.schemaVersion -ne 1) { throw 'Unsupported distribution schema' }
if ($selected.coreBase) {
    $distribution = Get-Content -LiteralPath (Child $CoreRoot $selected.coreBase) -Raw | ConvertFrom-Json
    foreach ($key in @('id','brand','capabilities')) { if ($selected.PSObject.Properties[$key]) { $distribution.$key = $selected.$key } }
    foreach ($key in @('plugins','skills','resources','patches')) { $distribution.$key = @($distribution.$key) + @($selected.$key) }
} else { $distribution = $selected }
if (-not $AssemblyConfig) { $AssemblyConfig = Child $CoreRoot 'config/assembly.eduwork.json' }
if (-not $DshLockPath) {
    $lockFolder = if ($RuntimeMode -eq 'npm') { 'release-v0.1.5-rc.2' } else { 'development-v0.1.5-rc.1' }
    $DshLockPath = Child $CoreRoot "third_party/dsh/$lockFolder/LOCK.json"
}
$assembly = Get-Content -LiteralPath $AssemblyConfig -Raw | ConvertFrom-Json
$lock = Get-Content -LiteralPath $DshLockPath -Raw | ConvertFrom-Json
. (Child $CoreRoot 'scripts/resolve-eduwork-upstream.ps1')
. (Child $CoreRoot 'scripts/with-eduwork-upstream-lock.ps1')
$Upstream = Resolve-EduworkUpstream -Commit $lock.commit -Upstream $Upstream
if (-not $RuntimeSource) {
    $RuntimeSource = Child $CoreRoot "dist/dsh-cache/runtime-$RuntimeMode-$($lock.packageVersion)"
    & (Child $CoreRoot 'scripts/prepare-eduwork-web-runtime.ps1') -CoreRoot $CoreRoot -Output $RuntimeSource -Upstream $Upstream -DshLockPath $DshLockPath -Source $RuntimeMode
    if (-not $?) { throw 'Runtime preparation failed' }
}
$RuntimeSource = [IO.Path]::GetFullPath($RuntimeSource)
$identity = Get-Content -LiteralPath (Join-Path $RuntimeSource '.chatecnu-dsh-runtime.json') -Raw | ConvertFrom-Json
$hostPlatform = (& node -p 'process.platform').Trim()
$hostArch = (& node -p 'process.arch').Trim()
if ($identity.dshVersion -ne $lock.packageVersion -or $identity.dshCommit -ne $lock.commit) { throw 'Runtime does not match the selected DSH baseline' }
if ($RuntimeMode -eq 'npm') {
    $runtimeLockHash = $identity.packageLockSHA256
    if ($identity.source -ne 'npm-lock' -or -not $runtimeLockHash -or $runtimeLockHash -ne $lock.runtime.npm.packageLockSHA256) { throw 'npm mode requires the selected registry package lock; source caches are not a fallback' }
    if ($identity.platform -ne $hostPlatform -or $identity.arch -ne $hostArch) { throw 'npm Runtime cache belongs to another platform or architecture' }
    $npmProofHash = (Get-FileHash -LiteralPath (Join-Path $RuntimeSource '.chatecnu-dsh-npm-install-lock.json') -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($npmProofHash -ne $runtimeLockHash) { throw 'npm Runtime cache install proof differs from the selected lock' }
} else {
    $runtimeLockHash = $identity.sourceInstallLockSHA256
    if ($identity.source -ne 'source-release-pack' -or -not $runtimeLockHash -or $runtimeLockHash -ne $lock.runtime.source.installLockSHA256) { throw 'Runtime does not match the selected source install lock' }
    $sourceProofHash = (Get-FileHash -LiteralPath (Join-Path $RuntimeSource '.chatecnu-dsh-source-install-lock.json') -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($sourceProofHash -ne $runtimeLockHash) { throw 'Source Runtime cache install proof differs from the selected lock' }
}
# Development retains the full research install; shipped products use the
# deterministic, offline runtime projection instead of default external agents.
$projector = Child $CoreRoot 'scripts/project-eduwork-runtime.mjs'
$policyHash = (Get-FileHash -LiteralPath $projector -Algorithm SHA256).Hash.ToLowerInvariant()
$projection = Join-Path $RuntimeSource '.eduwork-distribution-runtime.json'
if (-not (Test-Path -LiteralPath $projection)) {
    $projected = Child $CoreRoot ('dist/dsh-cache/distribution-' + $hostPlatform + '-' + $hostArch + '-' + $runtimeLockHash.Substring(0,12) + '-' + $policyHash.Substring(0,12))
    if (-not (Test-Path -LiteralPath $projected)) {
        & node $projector --source $RuntimeSource --output $projected
        if ($LASTEXITCODE -ne 0) { throw 'Distribution Runtime projection failed' }
    }
    $RuntimeSource = $projected
}
$projection = Get-Content -LiteralPath (Join-Path $RuntimeSource '.eduwork-distribution-runtime.json') -Raw | ConvertFrom-Json
if (($RuntimeMode -eq 'npm' -and $projection.packageLockSHA256 -ne $runtimeLockHash) -or ($RuntimeMode -eq 'source' -and $projection.sourceInstallLockSHA256 -ne $runtimeLockHash)) { throw 'Distribution Runtime belongs to another install lock' }
if ($projection.policySHA256 -ne $policyHash -or $projection.platform -ne $hostPlatform -or $projection.arch -ne $hostArch) { throw 'Distribution Runtime uses another projection policy, platform or architecture; prepare a fresh projection from the original verified install' }
$distributionProof = (Get-FileHash -LiteralPath (Join-Path $RuntimeSource '.eduwork-distribution-lock.json') -Algorithm SHA256).Hash.ToLowerInvariant()
if ($distributionProof -ne $projection.distributionLockSHA256) { throw 'Distribution Runtime lock proof differs from its receipt' }
# Product UI extensions need the pinned upstream compiler workspace even when
# the shipped Runtime is installed from npm. Its artifacts remain build inputs.
& (Child $CoreRoot 'scripts/prepare-eduwork-build-tools.ps1') -CoreRoot $CoreRoot -Upstream $Upstream -DshLockPath $DshLockPath -RuntimePackages (Join-Path $RuntimeSource 'node_modules')
if (-not $?) { throw 'Pinned product build tools preparation failed' }
. (Child $CoreRoot 'scripts/install-locked-dsh-package.ps1')
. (Child $CoreRoot 'scripts/copy-dsh-package-payload.ps1')
. (Child $CoreRoot 'scripts/install-bundled-dsh-skills.ps1')
New-Item -ItemType Directory -Path $Output | Out-Null
Write-Output 'Copying the pinned local runtime'
$runtime = Join-Path $Output 'd'
if ($IsWindows) {
    # Robocopy reports successful copies with non-zero status (1 through 7).
    # CI enables native-command failures globally, so interpret this one tool's
    # documented status ourselves without changing the caller's policy.
    $nativeErrors = $PSNativeCommandUseErrorActionPreference
    try {
        $PSNativeCommandUseErrorActionPreference = $false
        & robocopy.exe $RuntimeSource $runtime /E /XJ /COPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
        $copyStatus = $LASTEXITCODE
    } finally { $PSNativeCommandUseErrorActionPreference = $nativeErrors }
    if ($copyStatus -ge 8) { throw 'Runtime copy failed' }
    $global:LASTEXITCODE = 0
} else { Copy-Item -LiteralPath $RuntimeSource -Destination $runtime -Recurse }
$modules = Join-Path $runtime 'node_modules'
$managed = [ordered]@{}
foreach ($name in $distribution.packages) {
    $entries = @($assembly.externalPackages | Where-Object name -eq $name)
    if ($entries.Count -ne 1) { throw "A package must select one exact lock: $name" }
    $entry = $entries[0]
    if ($PluginMode -eq 'npm') {
        $packageLock = Get-Content -LiteralPath (Child $CoreRoot $entry.lock) -Raw | ConvertFrom-Json
        if ($packageLock.publicationStatus -ne 'published' -or -not $packageLock.npm.integrity -or $packageLock.tarball) { throw "npm mode requires a published registry lock without a local tarball: $name" }
    }
    $managed[$name] = Install-LockedDshPackage -Destination (Child $modules $name) -LockPath (Child $CoreRoot $entry.lock) -RequiredFiles $entry.requiredFiles
    if ($PluginMode -eq 'npm' -and $managed[$name].source -ne 'npm') { throw "Package was not installed from npm: $name" }
}
$selectedPlugins = @($distribution.plugins)
# The skill provider lives in agent presets, rather than as a duplicate host row.
$selectedPlugins += [pscustomobject]@{root='core';source='dsh-plugins/skill-control-native';name='@chatecnu-work/dsh-skill-control-native'}
$local = [ordered]@{}
foreach ($entry in $selectedPlugins) {
    if ($local.Contains($entry.name)) { throw "Duplicate local plugin: $($entry.name)" }
    $pluginSource = $entry.source
    if ($entry.root -ne 'edition') {
        $prepared = @($assembly.localPlugins | Where-Object { $_.package -eq ($entry.name -split '/')[-1] })
        if ($prepared.Count -ne 1) { throw "Local plugin is not selected exactly once: $($entry.name)" }
        $pluginSource = $prepared[0].source
    }
    $source = Child (Owner $entry) $pluginSource
    $manifest = Get-Content -LiteralPath (Join-Path $source 'package.json') -Raw | ConvertFrom-Json
    if ($manifest.name -ne $entry.name) { throw 'Local package identity mismatch' }
    $target = Child $modules $entry.name
    Copy-DshPackagePayload -Source $source -Destination $target
    $builder = Join-Path $source 'build-client.ps1'
    if ($pluginSource -eq $entry.source -and (Test-Path -LiteralPath $builder)) {
        $builderParameters = (Get-Command $builder).Parameters
        $buildOutput = Child $CoreRoot ('dist/eduwork-client-builds/' + [guid]::NewGuid().ToString('N') + '/lib')
        $buildArgs = @{Output=$buildOutput}
        if ($builderParameters.ContainsKey('DshLockPath')) { $buildArgs.DshLockPath=$DshLockPath }
        if ($builderParameters.ContainsKey('Upstream')) { $buildArgs.Upstream=$Upstream }
        if ($builderParameters.ContainsKey('RuntimePackages')) { $buildArgs.RuntimePackages=Join-Path $RuntimeSource 'node_modules' }
        if ($builderParameters.ContainsKey('ArtifactServices')) { $buildArgs.ArtifactServices=Join-Path $modules '@eduwork/dsh-artifact-services' }
        if ($builderParameters.ContainsKey('Version')) { $buildArgs.Version=$Version }
        Invoke-WithEduworkUpstreamLock -Upstream $Upstream -Activity "build $($entry.name)" -Action {
            & $builder @buildArgs
            if (-not $?) { throw "Client build failed: $($entry.name)" }
        }
        Copy-Item -Path (Join-Path $buildOutput '*') -Destination (Join-Path $target 'lib') -Force
    }
    # Record the dependencies actually supplied by this frozen assembly.
    foreach ($peer in @($manifest.peerDependencies.PSObject.Properties)) {
        if ($peer.Name -like '@deepseek-ai/dsh-*' -or $peer.Name -like '@eduwork/*') {
            $dependency = Child $modules ($peer.Name + '/package.json')
            if (Test-Path -LiteralPath $dependency) { $peer.Value=(Get-Content -LiteralPath $dependency -Raw | ConvertFrom-Json).version }
        }
    }
    $manifest | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath (Join-Path $target 'package.json') -Encoding utf8NoBOM
    $local[$entry.name] = @{version=$manifest.version;source=$entry.source;root=$entry.root}
}
$skillNames = [Collections.Generic.HashSet[string]]::new()
foreach ($skill in $distribution.skills) {
    if (-not $skillNames.Add($skill.name)) { throw "Duplicate user-facing Skill: $($skill.name)" }
    if (-not $distribution.capabilities.images -and $skill.name -in @('artifact-images','ecnu-imagegen')) { throw 'Public Skill list includes image generation' }
}
$skills = @()
foreach ($rootName in @('core','edition')) {
    $subset = @($distribution.skills | Where-Object { if ($rootName -eq 'core') { -not $_.root -or $_.root -eq 'core' } else { $_.root -eq 'edition' } })
    if ($subset.Count) { $skills += @(Copy-DshBundledSkills -Repository $(if ($rootName -eq 'core') {$CoreRoot} else {$EditionRoot}) -PackageRoot $modules -SkillRoot (Join-Path $Output 'skills') -Skills $subset) }
}
foreach ($resource in $distribution.resources) {
    $source = Child (Owner $resource) $resource.source
    $target = Child (Join-Path $Output 'resources') $resource.target
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $target -Recurse
}
if ($distribution.brand.product.logoResource) {
    $logo = Child (Join-Path $Output 'resources') $distribution.brand.product.logoResource
    $mime = switch ([IO.Path]::GetExtension($logo).ToLowerInvariant()) {
        '.svg' { 'image/svg+xml' } '.png' { 'image/png' } '.webp' { 'image/webp' }
        default { throw 'Brand logo must be SVG, PNG or WebP' }
    }
    $bytes = [IO.File]::ReadAllBytes($logo)
    if ($bytes.Length -gt 262144) { throw 'Brand logo exceeds 256 KiB' }
    $distribution.brand.product | Add-Member -NotePropertyName logoUrl -NotePropertyValue ('data:' + $mime + ';base64,' + [Convert]::ToBase64String($bytes)) -Force
    $distribution.brand.product.PSObject.Properties.Remove('logoResource')
}
$presets = Join-Path $runtime 'presets'
Copy-Item -LiteralPath (Join-Path $modules '@deepseek-ai/dsh-agent-presets/presets') -Destination $presets -Recurse
$skillSeat = Get-Content -LiteralPath (Child $CoreRoot 'dsh-presets/skill-control.agent.cordis.yml') -Raw
foreach ($presetFile in Get-ChildItem -LiteralPath $presets -Recurse -File -Filter agent.cordis.yml) {
    $text = Get-Content -LiteralPath $presetFile.FullName -Raw
    $text = $text -replace "- id: skill-filesystem\r?\n  name: '@deepseek-ai/dsh-skill-filesystem'(?:\r?\n  config:)?", $skillSeat.TrimEnd()
    Set-Content -LiteralPath $presetFile.FullName -Value $text -Encoding utf8NoBOM
}
$bundle = Join-Path $modules '@eduwork/web-composition'
& node (Child $CoreRoot 'scripts/configure-product-concurrency.mjs') $runtime
if ($LASTEXITCODE -ne 0) { throw 'Built-in workflow concurrency configuration failed' }
New-Item -ItemType Directory -Path $bundle -Force | Out-Null
$bundleDependencies = [ordered]@{}
foreach ($packageName in $local.Keys) { $bundleDependencies[$packageName] = $local[$packageName].version }
@{name='@eduwork/web-composition';version=$Version;private=$true;type='module';dependencies=$bundleDependencies;dsh=@{bundle=@{patch='./cordis.patch.yml'}}} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $bundle 'package.json') -Encoding utf8NoBOM
@'
- id: agent-presets
  config:
    default: standard
    includeShippedRoot: false
    includeUserRoot: true
    roots:
      - path: !!js process.env.DSH_PRODUCT_PRESET_DIR
        trust: system
'@ | Set-Content -LiteralPath (Join-Path $bundle 'cordis.patch.yml') -Encoding utf8NoBOM
# Runtime credentials are supplied through a private launch profile, never baked
# into this immutable artifact. The same public OIDC package handles both editions.
$insert = @(
    @{id='eduwork-artifact-services';name='@eduwork/dsh-artifact-services/dsh';config=@{skills=$false;images=@{enabled=$false}}},
    @{id='eduwork-knowledge-studio';name='@eduwork/dsh-knowledge-studio';config=@{skills=$false}},
    @{id='enterprise-oidc';name='@eduwork/dsh-oidc';config=@{backend='web';uiMode='standard';profilePathEnv='EDUWORK_OIDC_PROFILE';allowEmptyProfiles=$true}}
)
foreach ($plugin in $distribution.plugins) {
    $config = if ($plugin.source -eq 'dsh-plugins/brand-settings-native') { $distribution.brand } elseif ($plugin.config) { $plugin.config } else { @{} }
    $insert += @{id=$plugin.id;name=$plugin.name;config=$config}
}
$composition = @($distribution.patches) + @(@{insert=$insert})
$composition | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $Output 'composition.json') -Encoding utf8NoBOM
[ordered]@{schemaVersion=1;kind='eduwork-web';version=$Version;distribution=$distribution.id;brand=$distribution.brand;capabilities=$distribution.capabilities;dshVersion=$lock.packageVersion;dshCommit=$lock.commit;runtimeMode=$RuntimeMode;pluginMode=$PluginMode;runtimeLockSHA256=$runtimeLockHash;distributionRuntimeLockSHA256=$projection.distributionLockSHA256;managedPackages=$managed;localPlugins=$local;skills=$skills;bundles=@('@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','@eduwork/web-composition','@eduwork/dsh-mail','@eduwork/dsh-memory','@shlv/dsh-literature');assembledAt=[DateTime]::UtcNow.ToString('o');published=$false} | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $Output 'assembly.json') -Encoding utf8NoBOM
Write-Output "EduWork local Web assembly ready: $Output"
