#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$CoreRoot,
    [Parameter(Mandatory)][string]$EditionRoot,
    [Parameter(Mandatory)][string]$Version,
    [string]$PublisherDescriptors,
    [switch]$Stable,
    [switch]$VerifyPublisherBootstrap,
    [Parameter(Mandatory)][string]$Output
)
# Explicit source Alpha artifacts only. Default npm release assembly and update
# feeds are not changed by this entry point. Publication is a separate action.
$ErrorActionPreference='Stop'
$PSNativeCommandUseErrorActionPreference=$true
if (-not ($IsWindows -or $IsMacOS)) { throw 'Use a native Windows or macOS runner' }
$versionPattern=if ($Stable) {'^0\.4\.0$'} else {'^\d+\.\d+\.\d+-dev\.\d{8}\.[1-9]\d*$'}
if ($Version -notmatch $versionPattern) { throw 'Version does not match the explicit source build channel' }
$CoreRoot=[IO.Path]::GetFullPath($CoreRoot);$EditionRoot=[IO.Path]::GetFullPath($EditionRoot);$Output=[IO.Path]::GetFullPath($Output)
if (Test-Path $Output) { throw 'Alpha assembly requires a new output directory' }
$platform=if ($IsWindows) {'windows'} else {'macos'}
$name=if ($CoreRoot -eq $EditionRoot) {'EduWork'} else {'EduWork-ECNU'}
$public=Join-Path $Output 'evidence-public';$publish=Join-Path $Output 'publish'
New-Item -ItemType Directory -Path $public,$publish | Out-Null
$result=[ordered]@{schemaVersion=1;kind=$(if ($Stable) {'eduwork-source-release'} else {'eduwork-source-alpha'});version=$Version;platform=$platform;shell='electron';passed=$false;automaticUpdates=[bool]$Stable;published=$false;checks=@{}}
try {
    $result.coreCommit=(& git -C $CoreRoot rev-parse HEAD).Trim();$result.editionCommit=(& git -C $EditionRoot rev-parse HEAD).Trim()
    & node (Join-Path $CoreRoot 'scripts/audit-eduwork-distribution.mjs') $CoreRoot --verify-receipt
    if ($CoreRoot -ne $EditionRoot) {
        $lock=Get-Content (Join-Path $EditionRoot 'core.lock.json') -Raw | ConvertFrom-Json
        $source=Get-Content (Join-Path $CoreRoot 'source-receipt.json') -Raw | ConvertFrom-Json
        if ($lock.commit -ne $result.coreCommit -or $lock.sourceFileSetSHA256 -ne $source.fileSetSHA256) { throw 'Institution/core snapshot mismatch' }
    }
    $result.checks.sourceSnapshot='passed'
    $candidate=Join-Path $CoreRoot 'third_party/dsh/candidate-v0.2.0-rc.1'
    $runtime=Join-Path $Output 'runtime';$upstream=Join-Path $Output 'upstream';$hostAdapter=Join-Path $Output 'host'
    $sourceStage=Join-Path $Output 'source';$deps=Join-Path $Output 'dependencies';$product=Join-Path $Output 'product';$shell=Join-Path $Output 'shell'
    & git init $upstream
    & git -C $upstream remote add origin https://github.com/deepseek-ai/deepseek-harness.git
    & git -C $upstream fetch --depth=1 origin 4878cdabd87d4041bdaff61d04c966883b9fd07a
    & git -C $upstream checkout --detach FETCH_HEAD
    & node (Join-Path $CoreRoot 'dsh-desktop/scripts/prepare-dsh-runtime.mjs') --source npm --lock (Join-Path $candidate 'LOCK.json') --output $runtime
    & node (Join-Path $CoreRoot 'dsh-host/prepare-native.mjs') --upstream $upstream --output $hostAdapter
    New-Item -ItemType Directory -Path $deps | Out-Null
    Copy-Item (Join-Path $candidate 'source-probe/package*.json') $deps
    & npm ci --prefix $deps --legacy-peer-deps --ignore-scripts --no-audit --no-fund
    & node (Join-Path $CoreRoot 'scripts/build-017-plugin-clients.mjs') --runtime $runtime --dependencies $deps --output $sourceStage --report (Join-Path $public 'client-build.json') --version $Version
    & node (Join-Path $CoreRoot 'scripts/assemble-017-source-product.mjs') --runtime $runtime --source $sourceStage --dependencies $deps --host $hostAdapter --output $product
    $editionArgs=if ($CoreRoot -ne $EditionRoot) {@('--edition',$EditionRoot)} else {@()}
    if ($PublisherDescriptors) { $editionArgs+=@('--publisher-descriptors',[IO.Path]::GetFullPath($PublisherDescriptors)) }
    if ($Stable) { $editionArgs+=@('--channel','stable') }
    & node (Join-Path $CoreRoot 'scripts/prepare-017-alpha-product.mjs') --product $product --version $Version @editionArgs
    & node (Join-Path $CoreRoot 'scripts/verify-product-release-identity.mjs') $product $Version
    $identity=Get-Content (Join-Path $product 'assembly.json') -Raw | ConvertFrom-Json
    $result.dshVersion=$identity.dshVersion;$result.distribution=$identity.distribution;$result.edition=$name
    $tools=Join-Path $Output 'desktop-tools';$desktopTools=Join-Path $tools 'apps/desktop'
    New-Item -ItemType Directory -Path $desktopTools -Force | Out-Null
    Copy-Item (Join-Path $candidate 'desktop-probe/package*.json') $desktopTools
    & npm ci --prefix $desktopTools --ignore-scripts --no-audit --no-fund
    & (Join-Path $CoreRoot 'dsh-electron/scripts/prepare-electron.ps1') -Upstream $tools -Output (Join-Path $Output 'electron')
    & node (Join-Path $CoreRoot 'dsh-electron/scripts/build-shell.mjs') --native-017 --upstream $upstream --runtime $runtime --host $hostAdapter --output $shell
    & (Join-Path $CoreRoot "scripts/prepare-$platform-release-inputs.ps1") -Product $product -Output (Join-Path $Output 'inputs')
    $inputs=Get-Content (Join-Path $Output 'inputs/inputs.json') -Raw | ConvertFrom-Json
    & node (Join-Path $CoreRoot 'scripts/portable-product-links.mjs') $product
    $assembled=Join-Path $Output $(if ($IsWindows) {'desktop/electron-candidate'} else {'desktop'})
    $assembler=@{Product=$product;ShellBuild=$shell;ElectronRuntime=(Join-Path $Output 'electron/runtime');Output=$assembled;Version=$Version;Node=$inputs.node}
    if ($IsMacOS) {
        $assembler.OpenSSL=$inputs.openssl
        if ($Stable) {
            $macConfig=Join-Path $product 'resources/desktop/mac-updates.json'
            if (-not (Test-Path $macConfig)) { throw 'Stable macOS source release requires a trusted appcast configuration' }
            & node (Join-Path $CoreRoot 'scripts/macos-update-feed.mjs') prepare $macConfig (Join-Path $Output 'sparkle')
            $sparkle=Get-Content (Join-Path $Output 'sparkle/inputs.json') -Raw | ConvertFrom-Json
            $assembler.SparkleFramework=$sparkle.framework;$assembler.SparkleFeedURL=$sparkle.feeds.stable
            $assembler.SparkleDevelopmentFeedURL=$sparkle.feeds.development;$assembler.SparklePublicEDKey=$sparkle.publicEDKey
        }
    }
    & (Join-Path $CoreRoot "dsh-electron/scripts/assemble-$platform.ps1") @assembler
    $unpacked=Join-Path $Output 'unpacked';New-Item -ItemType Directory -Path $unpacked | Out-Null
    if ($IsWindows) {
        $archive=Join-Path $publish "$name-$Version-windows-x64-electron.zip"
        if ($Stable) {
            Push-Location (Join-Path $CoreRoot 'dsh-desktop')
            try { & go build -trimpath -ldflags '-s -w -H windowsgui' -o (Join-Path $assembled 'ChatECNU-Work.exe') ./cmd/eduwork-launch }
            finally { Pop-Location }
            Copy-Item (Join-Path $assembled 'ChatECNU-Work.exe') (Join-Path $assembled 'EduWork.exe')
        }
        & (Join-Path $CoreRoot 'scripts/pack-windows-release.ps1') -Candidate $assembled -Output $archive -Development:(-not $Stable) -ForUpdate:$Stable
        $desktop=Join-Path $unpacked $name
        $archiveHash=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
        $result.portableExtractor=& (Join-Path $CoreRoot 'scripts/prepare-windows-portable-extractor.ps1') -Archive $archive -ExpectedSHA256 $archiveHash -OutputDirectory (Join-Path $Output 'portable-extractor') -Target $desktop -PublishDirectory $publish
        $result.checks.portableExtractor='passed'
        $verifyArgs=if ($Stable) {@('--for-update')} else {@()}
        & node (Join-Path $CoreRoot 'scripts/verify-windows-release.mjs') $desktop @verifyArgs
        if ($Stable) { $result.checks.updateContract='passed' }
        $frozen=Join-Path $desktop 'resources/product';$node=Join-Path $desktop 'resources/runtime/node.exe';$exe=Join-Path $desktop 'EduWork-Electron.exe'
    } else {
        $pack=Get-Content (Join-Path $Output 'desktop/release-receipt.json') -Raw | ConvertFrom-Json
        $archive=Join-Path $publish $pack.asset.name
        Copy-Item (Join-Path $Output "desktop/$($pack.asset.name)"),(Join-Path $Output "desktop/$($pack.asset.name).sha256") $publish
        & ditto -x -k $archive $unpacked
        $desktop=Join-Path $unpacked $(if ($Stable) {"$name.app"} else {"$name Alpha.app"})
        & codesign --verify --deep --strict $desktop
        $frozen=Join-Path $desktop 'Contents/Resources/product';$node=Join-Path $desktop 'Contents/Resources/runtime/node';$exe=Join-Path $desktop 'Contents/MacOS/Electron'
        $result.developerIDSigned=$false;$result.notarized=$false;$result.minimumSystemVersion=$pack.minimumSystemVersion
        $result.sparkleEnabled=$pack.sparkleEnabled;$result.bundleVersion=$pack.bundleVersion
    }
    $result.checks.archiveManifest='passed'
    & $node (Join-Path $CoreRoot 'scripts/verify-media-template.mjs') $frozen
    $result.checks.mediaTemplate='passed'
    & $node (Join-Path $CoreRoot 'scripts/check-desktop-runtimes.mjs') $desktop (Join-Path $public 'native-runtimes.json')
    $result.checks.nativeRuntimes='passed'
    # Synthetic profile only: downloaded publisher configuration never enters
    # the public payload or logs. Live bootstrap acceptance runs separately.
    & (Join-Path $CoreRoot 'scripts/test-017-alpha-desktop.ps1') -CoreRoot $CoreRoot -Product $frozen -Executable $exe -Output (Join-Path $Output 'gui') -PublisherBootstrap:$VerifyPublisherBootstrap
    Copy-Item (Join-Path $Output 'gui/result.json') (Join-Path $public 'desktop-ui-result.json')
    $result.checks.desktopLaunch='passed'
    if ($VerifyPublisherBootstrap) { $result.checks.publisherFirstLaunch='passed' }
    if ($IsMacOS) {
        & codesign --verify --deep --strict $desktop;$result.checks.readOnlyApplication='passed'
        $dmg=Join-Path $publish "$name-$Version-macos-arm64-electron.dmg"
        $result.installer=& (Join-Path $CoreRoot 'scripts/prepare-macos-dmg.ps1') -App $desktop -Output $dmg -WorkDirectory (Join-Path $Output 'dmg')
        $result.checks.macosDmg='passed'
    }
    $result.asset=@{name=[IO.Path]::GetFileName($archive);bytes=(Get-Item $archive).Length;sha256=(Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant()}
    $result.passed=$true
    $result | ConvertTo-Json -Depth 16 | Set-Content (Join-Path $publish "$platform-$(if ($Stable) {'release'} else {'alpha'})-receipt.json") -Encoding utf8NoBOM
    if ($Stable -and $IsWindows) {
        & node (Join-Path $CoreRoot 'scripts/github-update-manifest.mjs') (Join-Path $publish 'windows-release-receipt.json') "ECNU/$name"
    }
} catch { $result.error=$_.Exception.Message;Write-Host $_.ScriptStackTrace;throw }
finally { $result | ConvertTo-Json -Depth 16 | Set-Content (Join-Path $public 'desktop-release-result.json') -Encoding utf8NoBOM }
