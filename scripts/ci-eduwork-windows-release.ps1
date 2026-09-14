#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$CoreRoot,
    [Parameter(Mandatory)][string]$EditionRoot,
    [Parameter(Mandatory)][string]$DistributionConfig,
    [Parameter(Mandatory)][string]$Version,
    [string]$ReleaseNotesFile,
    [switch]$ReleaseNotesApproved,
    [switch]$Development,
    [Parameter(Mandatory)][string]$Output
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$CoreRoot = [IO.Path]::GetFullPath($CoreRoot)
$EditionRoot = [IO.Path]::GetFullPath($EditionRoot)
if ($Development) {
    if ($Version -notmatch '^\d+\.\d+\.\d+-dev\.\d{8}\.[1-9]\d*$') { throw 'Development artifacts require X.Y.Z-dev.YYYYMMDD.N' }
    if ($ReleaseNotesFile -or $ReleaseNotesApproved) { throw 'Development artifacts do not publish Release notes.' }
} else {
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'GitHub Releases require X.Y.Z' }
if (-not $ReleaseNotesApproved) { throw 'Release notes must be discussed and approved before publication.' }
if ($ReleaseNotesFile -notmatch '^docs/releases/[A-Za-z0-9][A-Za-z0-9._-]*[.]md$') { throw 'Use a reviewed Markdown file under docs/releases in the edition repository.' }
$notesPath = Join-Path $EditionRoot $ReleaseNotesFile
if (-not (Test-Path -LiteralPath $notesPath -PathType Leaf) -or [string]::IsNullOrWhiteSpace((Get-Content -LiteralPath $notesPath -Raw))) { throw 'Approved release notes are missing or empty.' }
}
$Output = [IO.Path]::GetFullPath($Output)
if (Test-Path -LiteralPath $Output) { throw 'Release build requires a new workspace' }
New-Item -ItemType Directory -Path $Output | Out-Null
$name = if ($CoreRoot -eq $EditionRoot) {'EduWork'} else {'EduWork-ECNU'}
$receipt = [ordered]@{schemaVersion=1;kind='eduwork-windows-release';version=$Version;edition=$name;shell='electron';platform='windows-x64';validationProfile='ci-build-and-launch-v1';passed=$false;checks=[ordered]@{}}
if ($Development) { $receipt.kind='eduwork-windows-development'; $receipt.publication='artifact-only' }
else { $receipt.releaseNotes = @{approved=$true;file=$ReleaseNotesFile;sha256=(Get-FileHash -LiteralPath $notesPath -Algorithm SHA256).Hash.ToLowerInvariant()} }
$evidence = Join-Path $Output 'evidence'
$publicEvidence = Join-Path $Output 'evidence-public'
New-Item -ItemType Directory -Path $evidence,$publicEvidence | Out-Null
try {
    $receipt.coreCommit = (& git -C $CoreRoot rev-parse HEAD).Trim()
    $receipt.editionCommit = (& git -C $EditionRoot rev-parse HEAD).Trim()
    $source = Get-Content (Join-Path $CoreRoot 'source-receipt.json') -Raw | ConvertFrom-Json
    $receipt.sourceVersion=$source.version
    if (-not $Development -and $source.version -ne $Version) { throw 'Core source receipt version differs from the requested Release' }
    if ($CoreRoot -ne $EditionRoot) {
        $lock = Get-Content (Join-Path $EditionRoot 'core.lock.json') -Raw | ConvertFrom-Json
        if ($lock.version -ne $source.version) { throw 'Institution/core source versions must agree' }
    }
    & (Join-Path $CoreRoot 'scripts/ci-eduwork-web.ps1') -CoreRoot $CoreRoot -EditionRoot $EditionRoot -DistributionConfig $DistributionConfig -Version $Version -Output (Join-Path $Output 'web') -VerifySnapshot -BuildOnly
    $receipt.checks.sourceAndDependencies = 'passed'
    Copy-Item (Join-Path $Output 'web/evidence/public/*') -Destination $publicEvidence
    $web = Join-Path $Output 'web/assembly'
    $identity = Get-Content (Join-Path $web 'assembly.json') -Raw | ConvertFrom-Json
    $receipt.distribution = $identity.distribution
    $receipt.dshVersion = $identity.dshVersion
    $receipt.dshCommit = $identity.dshCommit
    $receipt.managedPackages = $identity.managedPackages
    . (Join-Path $CoreRoot 'scripts/resolve-eduwork-upstream.ps1')
    $upstream = Resolve-EduworkUpstream -Commit $identity.dshCommit
    $hostAdapter = Join-Path $Output 'host'
    $shellBuild = Join-Path $Output 'shell'
    $electronCache = Join-Path $Output 'electron'
    $product = Join-Path $Output 'product'
    & node (Join-Path $CoreRoot 'dsh-host/prepare.mjs') --upstream $upstream --output $hostAdapter
    & (Join-Path $CoreRoot 'scripts/prepare-desktop-product.ps1') -WebAssembly $web -HostAdapter $hostAdapter -Output $product -Version $Version
    & (Join-Path $CoreRoot 'scripts/prepare-windows-release-inputs.ps1') -Product $product -Output (Join-Path $Output 'inputs')
    $inputs = Get-Content (Join-Path $Output 'inputs/inputs.json') -Raw | ConvertFrom-Json
    $receipt.nativeInputs = @{vcRedist=$inputs.vcRedist;asrSHA256=$inputs.asrSHA256;modelSHA256=$inputs.modelSHA256;browserVersion=$inputs.browserVersion;browserURL=$inputs.browserURL;browserArchiveSHA256=$inputs.browserArchiveSHA256}
    & (Join-Path $CoreRoot 'dsh-electron/scripts/prepare-electron.ps1') -Upstream $upstream -Output $electronCache
    & node (Join-Path $CoreRoot 'dsh-electron/scripts/build-shell.mjs') --upstream $upstream --host $hostAdapter --output $shellBuild
    & (Join-Path $CoreRoot 'scripts/assemble-desktop-candidate.ps1') -Shell electron -Product $product -HostAdapter $hostAdapter -ElectronShellBuild $shellBuild -ElectronRuntime (Join-Path $electronCache 'runtime') -Node $inputs.node -OutputRoot (Join-Path $Output 'desktop') -Version $Version
    $candidate = Join-Path $Output 'desktop/electron-candidate'
    $metadataPath = Join-Path $candidate 'release.json'
    $metadata = Get-Content $metadataPath -Raw | ConvertFrom-Json
    $metadata.pluginPolicy = 'npm-exact-locks'
    $metadata | Add-Member -NotePropertyName releaseKind -NotePropertyValue $(if ($Development) {'portable-development'} else {'portable-public-test'})
    $metadata | ConvertTo-Json -Depth 12 | Set-Content $metadataPath -Encoding utf8NoBOM
    $releaseLabel = if ($Development) {'开发版 / Development'} else {'公测版 / Public beta'}
    @"
$name $Version — Windows x64 Electron $releaseLabel

解压整个目录后运行 EduWork-Electron.exe。公版可在模型设置中填写自己的 API Key；企业服务见 config/eduwork.jsonc 和 config/examples。
数据保存在本目录 data 下。移动整个目录前请退出程序。首次使用原生组件不需要另外安装 Node/Python/Office。
此包支持全新安装与现有 Windows 更新器安装。公版默认从 GitHub 获取更新，设置中可选择公测或开发渠道；机构可通过 config/eduwork.jsonc 配置自己的更新源。自动更新保留 data 和 config；不要手工覆盖工作目录。仓库未公开或没有已发布版本时，不会提供在线更新。

Extract the complete folder and run EduWork-Electron.exe. Configure a model API key or consult config/eduwork.jsonc and config/examples for enterprise services.
Keep the data and config folders; close the app before moving the whole directory. This ZIP supports new installations and the Windows updater. The public edition uses GitHub with public-beta/development channel selection; institutions can configure another source. Private repositories and draft releases are unavailable to the anonymous updater.
"@ | Set-Content (Join-Path $candidate 'README.txt') -Encoding utf8NoBOM
    $publish = Join-Path $Output 'publish'
    $asset = "$name-$Version-windows-x64-electron.zip"
    $archive = Join-Path $publish $asset
    Push-Location (Join-Path $CoreRoot 'dsh-desktop')
    try {
        & go build -trimpath -ldflags '-s -w -H windowsgui' -o (Join-Path $candidate 'ChatECNU-Work.exe') ./cmd/eduwork-launch
        if ($LASTEXITCODE -ne 0) { throw 'Legacy shortcut launcher build failed' }
    } finally { Pop-Location }
    Copy-Item (Join-Path $candidate 'ChatECNU-Work.exe') (Join-Path $candidate 'EduWork.exe')
    if ($Development) {
        $metadata.releaseKind='portable-development'
        $metadata | ConvertTo-Json -Depth 12 | Set-Content $metadataPath -Encoding utf8NoBOM
        @"
$name $Version — Windows x64 Electron 开发版

解压后运行 EduWork-Electron.exe。配置见 config/eduwork.jsonc 和 config/examples。
此包由 GitHub CI 构建，包含 Go 过渡版到 Electron 的更新契约；开发包不创建 GitHub Release。
由维护者完成实包升级验收后配置开发更新清单，不能投放到 0.2 旧入口。
"@ | Set-Content (Join-Path $candidate 'README.txt') -Encoding utf8NoBOM
    }
    & (Join-Path $CoreRoot 'scripts/pack-windows-release.ps1') -Candidate $candidate -Output $archive -Development:$Development -ForUpdate
    # Test the extracted ZIP, not the input directory. This also exercises
    # relocation of the private Python environment and all native paths.
    $extracted = Join-Path $Output 'unpacked'
    New-Item -ItemType Directory -Path $extracted | Out-Null
    & tar.exe -xf $archive -C $extracted
    $desktop = Join-Path $extracted $name
    & node (Join-Path $CoreRoot 'scripts/verify-windows-release.mjs') $desktop --for-update
    $frozenProduct = Join-Path $desktop 'resources/product'
    $gui = Join-Path $evidence 'gui'
    New-Item -ItemType Directory -Path $gui | Out-Null
    Copy-Item -LiteralPath (Join-Path $desktop 'config') -Destination (Join-Path $gui 'config') -Recurse
    $config = Join-Path $gui 'config/eduwork.jsonc'
    $text = [IO.File]::ReadAllText($config)
    if ($text -notmatch '"closeAction"\s*:\s*"tray"') { throw 'Expected shipped close-to-tray default' }
    [IO.File]::WriteAllText($config,($text -replace '"closeAction"\s*:\s*"tray"','"closeAction": "exit"'),[Text.UTF8Encoding]::new($false))
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
    $listener.Start(); $port=$listener.LocalEndpoint.Port; $listener.Stop()
    $env:EDUWORK_DESKTOP_TEST_DATA_ROOT = Join-Path $gui 'data'
    $env:EDUWORK_CONFIG_FILE = $config
    $appProcess = Start-Process -FilePath (Join-Path $desktop 'EduWork-Electron.exe') -ArgumentList @("--remote-debugging-port=$port",'--remote-debugging-address=127.0.0.1') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $gui 'app.stdout.log') -RedirectStandardError (Join-Path $gui 'app.stderr.log') -PassThru
    $env:EDUWORK_DESKTOP_TEST_DATA_ROOT = $null; $env:EDUWORK_CONFIG_FILE = $null
    try {
        $deadline=[DateTime]::UtcNow.AddMinutes(3); $ready=$false
        while ([DateTime]::UtcNow -lt $deadline) {
            if ($appProcess.HasExited) { Get-Content (Join-Path $gui 'app.stderr.log') -Tail 60; throw 'Packaged desktop exited before ready' }
            try { $targets=Invoke-RestMethod "http://127.0.0.1:$port/json/list" -TimeoutSec 3; if (@($targets | Where-Object url -like 'dsh-app://app/*').Count) {$ready=$true;break} } catch {}
            Start-Sleep -Milliseconds 500
        }
        if (-not $ready) { throw 'Packaged desktop failed to start within acceptance limit' }
        & node (Join-Path $CoreRoot 'dsh-electron/tests/desktop-smoke.mjs') --shell electron --product $frozenProduct --cdp "http://127.0.0.1:$port" --data-root (Join-Path $gui 'data') --evidence $gui --launch-only
    } finally {
        if (-not $appProcess.HasExited) {
            & node (Join-Path $CoreRoot 'scripts/close-release-test-desktop.mjs') $frozenProduct "http://127.0.0.1:$port"
            if (-not $appProcess.WaitForExit(15000)) { throw "Test desktop did not stop: $($appProcess.Id)" }
        }
    }
    if ((Get-Content (Join-Path $gui 'app.stderr.log') -Raw) -match 'EBADF|request pipe is unavailable') { throw 'Desktop teardown reported a pipe failure' }
    if (-not (Get-Content (Join-Path $gui 'result.json') -Raw | ConvertFrom-Json).passed) { throw 'Desktop GUI acceptance failed' }
    $receipt.checks.desktopLaunch = 'passed'
    $receipt.checks.archiveManifest = 'passed'
    $receipt.asset = @{name=$asset;bytes=(Get-Item $archive).Length;sha256=(Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant()}
    $receipt.passed = $true
    $receipt | ConvertTo-Json -Depth 20 | Set-Content (Join-Path $publish 'release-receipt.json') -Encoding utf8NoBOM
    if (-not $Development) {
        Copy-Item -LiteralPath $notesPath -Destination (Join-Path $publish 'RELEASE-NOTES.md')
        & node (Join-Path $CoreRoot 'scripts/github-update-manifest.mjs') (Join-Path $publish 'release-receipt.json') "ecnu/$name"
        if ($LASTEXITCODE -ne 0) { throw 'GitHub update manifest generation failed' }
    }
} catch {
    $receipt.error = $_.Exception.Message
    Write-Host $_.ScriptStackTrace
    throw
} finally {
    # Preserve the Web runner's redacted failure report too. Raw test homes,
    # credentials and process logs remain on the disposable runner.
    $webReports = Join-Path $Output 'web/evidence/public'
    if (Test-Path -LiteralPath $webReports -PathType Container) {
        Copy-Item (Join-Path $webReports '*') -Destination $publicEvidence -Force
    }
    $guiReport = Join-Path $evidence 'gui/result.json'
    if (Test-Path -LiteralPath $guiReport -PathType Leaf) {
        Copy-Item -LiteralPath $guiReport -Destination (Join-Path $publicEvidence 'desktop-ui-result.json')
    }
    foreach ($filename in @('failed-desktop.png','failed-desktop-ui.json')) {
        $diagnostic = Join-Path $evidence "gui/$filename"
        if (Test-Path -LiteralPath $diagnostic -PathType Leaf) {
            Copy-Item -LiteralPath $diagnostic -Destination (Join-Path $publicEvidence $filename)
        }
    }
    $receipt | ConvertTo-Json -Depth 20 | Set-Content (Join-Path $publicEvidence 'desktop-release-result.json') -Encoding utf8NoBOM
}
