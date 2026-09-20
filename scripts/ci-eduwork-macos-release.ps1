#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$CoreRoot,
    [Parameter(Mandatory)][string]$EditionRoot,
    [Parameter(Mandatory)][string]$DistributionConfig,
    [Parameter(Mandatory)][string]$Version,
    [string]$ReleaseNotesFile,
    [switch]$Development,
    [string]$MacUpdateConfig,
    [switch]$ReleaseNotesApproved,
    [switch]$VerifyPublisherBootstrap,
    [Parameter(Mandatory)][string]$Output
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
if (-not $IsMacOS -or (& node -p 'process.arch').Trim() -ne 'arm64') { throw 'Use a macOS arm64 runner' }
if ($Version -notmatch '^\d+\.\d+\.\d+-dev\.\d{8}\.[1-9]\d*$') { throw 'macOS currently supports development candidates only' }
if (-not $Development -and (-not $ReleaseNotesApproved -or $ReleaseNotesFile -notmatch '^docs/releases/[A-Za-z0-9][A-Za-z0-9._-]*[.]md$')) { throw 'A reviewed release notes file and approval are required' }
$CoreRoot = [IO.Path]::GetFullPath($CoreRoot); $EditionRoot = [IO.Path]::GetFullPath($EditionRoot)
$Output = [IO.Path]::GetFullPath($Output)
if (Test-Path $Output) { throw 'Release build requires a new workspace' }
$notes = if ($Development) { $null } else { Join-Path $EditionRoot $ReleaseNotesFile }
if ($notes -and [string]::IsNullOrWhiteSpace((Get-Content $notes -Raw))) { throw 'Release notes are empty' }
$name = if ($CoreRoot -eq $EditionRoot) { 'EduWork' } else { 'EduWork-ECNU' }
$public = Join-Path $Output 'evidence-public'; $publish = Join-Path $Output 'publish'
New-Item -ItemType Directory -Path $public,$publish | Out-Null
$result = [ordered]@{schemaVersion=1;kind='eduwork-macos-release';version=$Version;edition=$name;platform='macos-arm64';shell='electron';validationProfile='ci-build-and-launch-v1';passed=$false;checks=@{};developerIDSigned=$false;notarized=$false;softwareAutoUpdate=$false}
if ($notes) { $result.releaseNotes=@{approved=$true;file=$ReleaseNotesFile;sha256=(Get-FileHash $notes -Algorithm SHA256).Hash.ToLowerInvariant()} }
try {
    $result.coreCommit=(& git -C $CoreRoot rev-parse HEAD).Trim();$result.editionCommit=(& git -C $EditionRoot rev-parse HEAD).Trim()
    & (Join-Path $CoreRoot 'scripts/ci-eduwork-web.ps1') -CoreRoot $CoreRoot -EditionRoot $EditionRoot -DistributionConfig $DistributionConfig -Version $Version -Output (Join-Path $Output 'web') -VerifySnapshot -BuildOnly
    $result.checks.sourceAndDependencies='passed'
    $web=Join-Path $Output 'web/assembly'
    $identity=Get-Content (Join-Path $web 'assembly.json') -Raw | ConvertFrom-Json
    . (Join-Path $CoreRoot 'scripts/resolve-eduwork-upstream.ps1')
    $upstream=Resolve-EduworkUpstream -Commit $identity.dshCommit
    $hostAdapter=Join-Path $Output 'host';$shellBuild=Join-Path $Output 'shell';$product=Join-Path $Output 'product'
    & node (Join-Path $CoreRoot 'dsh-host/prepare.mjs') --upstream $upstream --output $hostAdapter
    & (Join-Path $CoreRoot 'scripts/prepare-desktop-product.ps1') -WebAssembly $web -HostAdapter $hostAdapter -Output $product -Version $Version
    & node (Join-Path $CoreRoot 'dsh-host/install-product-host.mjs') --product $product --adapter $hostAdapter
    & (Join-Path $CoreRoot 'scripts/prepare-macos-release-inputs.ps1') -Product $product -Output (Join-Path $Output 'inputs')
    $inputs=Get-Content (Join-Path $Output 'inputs/inputs.json') -Raw | ConvertFrom-Json
    & (Join-Path $CoreRoot 'dsh-electron/scripts/prepare-electron.ps1') -Upstream $upstream -Output (Join-Path $Output 'electron')
    & node (Join-Path $CoreRoot 'dsh-electron/scripts/build-shell.mjs') --upstream $upstream --host $hostAdapter --output $shellBuild
    $macOptions=@{}
    if (-not $MacUpdateConfig) { $MacUpdateConfig=Join-Path $product 'resources/desktop/mac-updates.json' }
    if (Test-Path $MacUpdateConfig) {
        $sparkleInput=Join-Path $Output 'sparkle'
        & node (Join-Path $CoreRoot 'scripts/macos-update-feed.mjs') prepare $MacUpdateConfig $sparkleInput
        $sparkle=Get-Content (Join-Path $sparkleInput 'inputs.json') -Raw | ConvertFrom-Json
        $macOptions=@{SparkleFramework=$sparkle.framework;SparkleFeedURL=$sparkle.feeds.stable;SparkleDevelopmentFeedURL=$sparkle.feeds.development;SparklePublicEDKey=$sparkle.publicEDKey}
    }
    & (Join-Path $CoreRoot 'dsh-electron/scripts/assemble-macos.ps1') -Product $product -ShellBuild $shellBuild -ElectronRuntime (Join-Path $Output 'electron/runtime') -Output (Join-Path $Output 'desktop') -Version $Version -Node $inputs.node -OpenSSL $inputs.openssl @macOptions
    $pack=Get-Content (Join-Path $Output 'desktop/release-receipt.json') -Raw | ConvertFrom-Json
    $result.softwareAutoUpdate=$pack.sparkleEnabled;$result.bundleVersion=$pack.bundleVersion;$result.asset=$pack.asset;$result.minimumSystemVersion=$pack.minimumSystemVersion;$result.nativeLockSHA256=$inputs.nativeLockSHA256
    $archive=Join-Path $Output ('desktop/'+$pack.asset.name)
    $unpacked=Join-Path $Output 'unpacked';New-Item -ItemType Directory -Path $unpacked | Out-Null
    & ditto -x -k $archive $unpacked
    $app=Join-Path $unpacked "$name.app"
    & codesign --verify --deep --strict $app
    $result.checks.archiveManifest='passed'
    $frozen=Join-Path $app 'Contents/Resources/product'
    & (Join-Path $app 'Contents/Resources/runtime/node') (Join-Path $CoreRoot 'scripts/check-desktop-runtimes.mjs') $app (Join-Path $public 'native-runtimes.json')
    $result.checks.nativeRuntimes='passed'
    $gui=Join-Path $Output 'gui';New-Item -ItemType Directory -Path $gui | Out-Null
    $config=Join-Path $gui 'eduwork.jsonc'
    @{schemaVersion=1;desktop=@{closeAction='exit'};organizations=@(@{schemaVersion='dsh-oidc/v1alpha1';id='ci-example';displayName='CI example';oidc=@{issuer='https://identity.example.test';clientId='synthetic-ci-client';scopes=@('openid','profile')}})} | ConvertTo-Json -Depth 8 | Set-Content $config -Encoding utf8NoBOM
    $listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$listener.Start();$port=$listener.LocalEndpoint.Port;$listener.Stop()
    $bootstrapEnabled = Test-Path (Join-Path $frozen 'resources/desktop/publisher-bootstrap.json')
    if ($VerifyPublisherBootstrap -and -not $bootstrapEnabled) { throw 'Publisher acceptance requires a bootstrap-enabled edition' }
    $env:EDUWORK_DESKTOP_TEST_DATA_ROOT=Join-Path $gui 'data'
    # Optional maintainer acceptance uses the packaged public feed and a fresh
    # profile, without school credentials or changing any archive bytes. Keep
    # downloaded configuration out of public evidence and the release payload.
    $env:EDUWORK_CONFIG_FILE=if ($VerifyPublisherBootstrap) { $null } else { $config }
    $start=[Diagnostics.ProcessStartInfo]::new()
    $start.FileName=Join-Path $app 'Contents/MacOS/Electron';$start.UseShellExecute=$false
    $start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
    foreach ($arg in @("--remote-debugging-port=$port",'--remote-debugging-address=127.0.0.1','--use-mock-keychain')) { $start.ArgumentList.Add($arg) }
    $process=[Diagnostics.Process]::Start($start)
    $stdout=$process.StandardOutput.ReadToEndAsync();$stderr=$process.StandardError.ReadToEndAsync()
    $env:EDUWORK_DESKTOP_TEST_DATA_ROOT=$null;$env:EDUWORK_CONFIG_FILE=$null
    try {
        $deadline=[DateTime]::UtcNow.AddMinutes(3);$ready=$false
        while ([DateTime]::UtcNow -lt $deadline) {
            if ($process.HasExited) { throw 'macOS desktop exited before ready' }
            try { $targets=Invoke-RestMethod "http://127.0.0.1:$port/json/list" -TimeoutSec 3;if (@($targets | Where-Object url -like 'dsh-app://app/*').Count) { $ready=$true;break } } catch {}
            Start-Sleep -Milliseconds 500
        }
        if (-not $ready) { throw 'macOS desktop failed to start within acceptance limit' }
        & node (Join-Path $CoreRoot 'dsh-electron/tests/desktop-smoke.mjs') --shell electron --product $frozen --cdp "http://127.0.0.1:$port" --data-root (Join-Path $gui 'data') --evidence $gui --launch-only
    } finally {
        if (-not $process.HasExited) {
            & node (Join-Path $CoreRoot 'scripts/close-release-test-desktop.mjs') $frozen "http://127.0.0.1:$port"
            if (-not $process.WaitForExit(15000)) { $process.Kill($true);throw 'macOS test desktop did not stop' }
        }
        [IO.File]::WriteAllText((Join-Path $gui 'stdout.log'),$stdout.GetAwaiter().GetResult())
        [IO.File]::WriteAllText((Join-Path $gui 'stderr.log'),$stderr.GetAwaiter().GetResult())
    }
    if (-not (Get-Content (Join-Path $gui 'result.json') -Raw | ConvertFrom-Json).passed) { throw 'macOS desktop smoke failed' }
    Copy-Item (Join-Path $gui 'result.json') (Join-Path $public 'desktop-ui-result.json')
    $result.checks.desktopLaunch='passed'
    if ($VerifyPublisherBootstrap) {
        $started=Get-Content (Join-Path $gui 'data/logs/desktop-start.json') -Raw | ConvertFrom-Json
        if ($started.configurationRevision -lt 1 -or $started.skillsRevision -lt 1) { throw 'First launch did not activate signed publisher content' }
        $result.checks.publisherFirstLaunch='passed'
        $result.content=@{configurationRevision=$started.configurationRevision;skillsRevision=$started.skillsRevision}
    }
    & codesign --verify --deep --strict $app
    $result.checks.readOnlyApplication='passed'
    Copy-Item $archive,$($archive+'.sha256') $publish
    if ($notes) { Copy-Item $notes (Join-Path $publish 'RELEASE-NOTES.md') }
    $result.passed=$true
    $result | ConvertTo-Json -Depth 16 | Set-Content (Join-Path $publish 'release-receipt.json') -Encoding utf8NoBOM
} catch { $result.error=$_.Exception.Message;throw }
finally {
    $result | ConvertTo-Json -Depth 16 | Set-Content (Join-Path $public 'desktop-release-result.json') -Encoding utf8NoBOM
    $webEvidence=Join-Path $Output 'web/evidence/public'
    if (Test-Path $webEvidence) { Copy-Item (Join-Path $webEvidence '*') $public -Force }
}
