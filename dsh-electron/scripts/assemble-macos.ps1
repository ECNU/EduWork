#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Product,
    [Parameter(Mandatory)][string]$ShellBuild,
    [Parameter(Mandatory)][string]$ElectronRuntime,
    [Parameter(Mandatory)][string]$Output,
    [Parameter(Mandatory)][string]$Version,
    [Parameter(Mandatory)][string]$Node,
    [Parameter(Mandatory)][string]$OpenSSL,
    [string]$ExternalPublisherConfig,
    [ValidateSet('stable','development')][string]$UpdateDefaultPolicy,
    [string]$BundleVersion,
    [string]$SparkleFramework,
    [string]$SparkleFeedURL,
    [string]$SparkleDevelopmentFeedURL,
    [string]$SparklePublicEDKey
)
$ErrorActionPreference = 'Stop'
if (-not $IsMacOS) { throw 'The macOS Electron candidate must be assembled on macOS' }
if ((& node -p 'process.arch').Trim() -ne 'arm64') { throw 'This first macOS packaging flow supports arm64 only' }
$Product = [IO.Path]::GetFullPath($Product)
$ShellBuild = [IO.Path]::GetFullPath($ShellBuild)
$ElectronRuntime = [IO.Path]::GetFullPath($ElectronRuntime)
$Output = [IO.Path]::GetFullPath($Output)
$Node = [IO.Path]::GetFullPath($Node)
$OpenSSL = [IO.Path]::GetFullPath($OpenSSL)
if (Test-Path -LiteralPath $Output) { throw 'macOS output must be a new directory' }
if ($Version -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$') { throw 'An explicit product version is required' }
if (-not $UpdateDefaultPolicy) { $UpdateDefaultPolicy = if ($Version -match '-dev\.') { 'development' } else { 'stable' } }
if ($ExternalPublisherConfig -and -not [IO.Path]::IsPathRooted($ExternalPublisherConfig)) { throw 'External publisher configuration path must be absolute' }
$sparkleEnabled = [bool]($SparkleFramework -or $SparkleFeedURL -or $SparklePublicEDKey)
if ($sparkleEnabled) {
    if (-not ($SparkleFramework -and $SparkleFeedURL -and $SparklePublicEDKey)) { throw 'Sparkle requires framework, HTTPS appcast URL and EdDSA public key together' }
    if (-not [IO.Path]::IsPathRooted($SparkleFramework)) { throw 'Sparkle framework path must be absolute' }
    $SparkleFramework = [IO.Path]::GetFullPath($SparkleFramework)
    if (-not (Test-Path -LiteralPath (Join-Path $SparkleFramework 'Headers/Sparkle.h') -PathType Leaf)) { throw 'Sparkle framework headers are missing' }
    $feed = [uri]$SparkleFeedURL
    if ($feed.Scheme -ne 'https' -or $feed.UserInfo -or $feed.Fragment -or $feed.Query) { throw 'Sparkle appcast must be a fixed HTTPS URL without credentials, query or fragment' }
    try { $keyBytes = [Convert]::FromBase64String($SparklePublicEDKey) } catch { throw 'Sparkle EdDSA public key must be base64' }
    if ($keyBytes.Length -ne 32) { throw 'Sparkle EdDSA public key must decode to 32 bytes' }

}
$expectedBundleVersion = (& node (Join-Path $PSScriptRoot '../../scripts/macos-update-feed.mjs') version $Version).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Unsupported macOS update version' }
if ($BundleVersion -and $BundleVersion -ne $expectedBundleVersion) { throw 'BundleVersion must match the shared release version encoding' }
if ($SparkleDevelopmentFeedURL) {
    $devFeed=[uri]$SparkleDevelopmentFeedURL
    if (-not $sparkleEnabled -or $devFeed.Scheme -ne 'https' -or $devFeed.UserInfo -or $devFeed.Fragment -or $devFeed.Query) { throw 'Development appcast requires a fixed HTTPS URL and the Sparkle trust key' }
}
$identity = Get-Content -LiteralPath (Join-Path $Product 'assembly.json') -Raw | ConvertFrom-Json
& $Node (Join-Path $PSScriptRoot '../../scripts/verify-product-release-identity.mjs') $Product $Version
if ($LASTEXITCODE -ne 0) { throw 'Product release identity verification failed' }
$receipt = Get-Content -LiteralPath (Join-Path $ShellBuild 'source-receipt.json') -Raw | ConvertFrom-Json
if ($identity.dshCommit -ne $receipt.dshCommit -or $identity.dshVersion -ne $receipt.dshVersion) { throw 'Electron and product DSH versions differ' }
if ((& $Node --version).Trim() -ne $receipt.host.nodeVersion) { throw 'Node and qualified Host runtime versions differ' }
$electronApp = Join-Path $ElectronRuntime 'Electron.app'
if (-not (Test-Path -LiteralPath (Join-Path $electronApp 'Contents/MacOS/Electron') -PathType Leaf)) { throw 'ElectronRuntime must contain Electron.app' }
$electronVersion = (& plutil -extract CFBundleShortVersionString raw (Join-Path $electronApp 'Contents/Info.plist')).Trim()
if ($LASTEXITCODE -ne 0 -or $electronVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Electron.app version is invalid' }
$nodeRoot = Split-Path (Split-Path $Node -Parent) -Parent
$nodeLicense = Join-Path $nodeRoot 'LICENSE'
if (-not (Test-Path -LiteralPath $nodeLicense -PathType Leaf)) { throw 'Use the extracted official Node distribution, including LICENSE' }

$editionName = if ($identity.distribution -eq 'eduwork') { 'EduWork' } else { 'EduWork-ECNU' }
$appName = "$editionName.app"
$app = Join-Path $Output $appName
New-Item -ItemType Directory -Path $Output | Out-Null
& ditto --noextattr --noqtn --noacl $electronApp $app
if ($LASTEXITCODE -ne 0) { throw 'Electron.app copy failed' }
$resources = Join-Path $app 'Contents/Resources'
$appPayload = Join-Path $resources 'app'
New-Item -ItemType Directory -Path $appPayload | Out-Null
foreach ($folder in @('lib','renderer','third-party')) {
    New-Item -ItemType Directory -Path (Join-Path $appPayload $folder) | Out-Null
    & rsync -a ((Join-Path $ShellBuild $folder) + '/') ((Join-Path $appPayload $folder) + '/')
    if ($LASTEXITCODE -ne 0) { throw "Shell payload copy failed: $folder" }
}
Copy-Item -LiteralPath (Join-Path $ShellBuild 'LICENSE-DeepSeek') -Destination $appPayload
Copy-Item -LiteralPath (Join-Path $ShellBuild 'source-receipt.json') -Destination $appPayload
$brand = Join-Path $resources 'brand'
New-Item -ItemType Directory -Path $brand | Out-Null
foreach ($asset in @('icon-32.png','icon-256.png','icon-1024.png','icon-blue-1024.png','dock-red-1024.png','dock-blue-1024.png','icon.icns','tray-black.png')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "../../assets/eduwork/$asset") -Destination (Join-Path $brand $asset)
}
New-Item -ItemType Directory -Path (Join-Path $resources 'product') | Out-Null
& rsync -a ($Product + '/') ((Join-Path $resources 'product') + '/')
if ($LASTEXITCODE -ne 0) { throw 'Product copy failed' }
& (Join-Path $PSScriptRoot 'relocate-macos-compositor.ps1') -PackageRoot (Join-Path $resources 'product/d/node_modules/@remotion/compositor-darwin-arm64') -Receipt (Join-Path $resources 'compositor-relocation.json')
$ladybugPackage = Join-Path $resources 'product/d/node_modules/@ladybugdb/core-darwin-arm64'
$ladybugNative = Join-Path $ladybugPackage 'lbugjs.node'
$sslSource = Join-Path $OpenSSL 'lib/libssl.3.dylib'
$cryptoSource = Join-Path $OpenSSL 'lib/libcrypto.3.dylib'
foreach ($required in @($ladybugNative, $sslSource, $cryptoSource)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Missing LadybugDB macOS dependency: $required" }
}
$sslTarget = Join-Path $ladybugPackage 'libssl.3.dylib'
$cryptoTarget = Join-Path $ladybugPackage 'libcrypto.3.dylib'
Copy-Item -LiteralPath $sslSource -Destination $sslTarget
Copy-Item -LiteralPath $cryptoSource -Destination $cryptoTarget
$patchedNative = "$ladybugNative.patched"
& vtool -set-build-version macos 15.0 15.5 -replace -output $patchedNative $ladybugNative
if ($LASTEXITCODE -ne 0) { throw 'LadybugDB minimum macOS version patch failed' }
Move-Item -LiteralPath $patchedNative -Destination $ladybugNative -Force
& install_name_tool -change '@rpath/libssl.3.dylib' '@loader_path/libssl.3.dylib' $ladybugNative
if ($LASTEXITCODE -ne 0) { throw 'LadybugDB libssl install-name patch failed' }
& install_name_tool -change '@rpath/libcrypto.3.dylib' '@loader_path/libcrypto.3.dylib' $ladybugNative
if ($LASTEXITCODE -ne 0) { throw 'LadybugDB libcrypto install-name patch failed' }
$cryptoInstallName = (& otool -D $cryptoTarget | Select-Object -Last 1).Trim()
& install_name_tool -id '@loader_path/libcrypto.3.dylib' $cryptoTarget
if ($LASTEXITCODE -ne 0) { throw 'Bundled libcrypto install-name patch failed' }
& install_name_tool -id '@loader_path/libssl.3.dylib' -change $cryptoInstallName '@loader_path/libcrypto.3.dylib' $sslTarget
if ($LASTEXITCODE -ne 0) { throw 'Bundled libssl install-name patch failed' }
foreach ($nativeFile in @($cryptoTarget, $sslTarget, $ladybugNative)) {
    & codesign --force --sign - --timestamp=none $nativeFile
    if ($LASTEXITCODE -ne 0) { throw "Native dependency ad-hoc signing failed: $nativeFile" }
}
$ladybugSmoke = "const {Database,Connection}=require(process.argv[1]);const db=new Database(':memory:');db.initSync();const connection=new Connection(db);const result=connection.querySync('RETURN 1 AS n');if(result.getAllSync()[0].n!==1)throw new Error('LadybugDB query mismatch');connection.closeSync();db.closeSync();console.log('LADYBUG_QUERY_OK')"
& $Node -e $ladybugSmoke $ladybugPackage
if ($LASTEXITCODE -ne 0) { throw 'Bundled LadybugDB native smoke test failed' }
New-Item -ItemType Directory -Path (Join-Path $resources 'runtime') | Out-Null
Copy-Item -LiteralPath $Node -Destination (Join-Path $resources 'runtime/node')
Copy-Item -LiteralPath $nodeLicense -Destination (Join-Path $resources 'runtime/LICENSE-Node')
& chmod 755 (Join-Path $resources 'runtime/node')

$ownership = 'user'
$policyPath = Join-Path $Product 'resources/desktop/configuration-policy.json'
if (Test-Path -LiteralPath $policyPath) {
    $policy = Get-Content -LiteralPath $policyPath -Raw | ConvertFrom-Json
    if ($policy.schemaVersion -ne 1 -or $policy.ownership -notin @('user','publisher')) { throw 'Invalid desktop configuration ownership policy' }
    $ownership = $policy.ownership
}
if ($ownership -eq 'user') {
    foreach ($relative in @('eduwork.jsonc', 'examples/organization.jsonc', 'examples/updates.jsonc')) {
        if (-not (Test-Path -LiteralPath (Join-Path $resources "product/resources/desktop/$relative") -PathType Leaf)) {
            throw "Missing first-launch user configuration resource: $relative"
        }
    }
}
$desktop = [ordered]@{
    schemaVersion=1; shell='electron'; appId="org.eduwork.$($identity.distribution).electron"
    distribution=$identity.distribution; productName=$identity.brand.product.name; productVersion=$Version
    product='../product'; node='../runtime/node'; configurationOwnership=$ownership
    updateChannel='disabled-candidate'; updates=@{defaultPolicy=$UpdateDefaultPolicy}
}
if ($sparkleEnabled) {
    $desktop.macSparkle=@{enabled=$true;feeds=@{stable=$SparkleFeedURL}}
    if ($SparkleDevelopmentFeedURL) { $desktop.macSparkle.feeds.development=$SparkleDevelopmentFeedURL }
    if ($UpdateDefaultPolicy -eq 'development' -and -not $SparkleDevelopmentFeedURL) { throw 'Development builds require a development appcast' }
}
$bootstrap = (& $Node (Join-Path $PSScriptRoot '../../scripts/check-publisher-bootstrap.mjs') $Product $ownership) | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Publisher bootstrap validation failed' }
if ($ExternalPublisherConfig) {
    if ($ownership -ne 'publisher') { throw 'External publisher configuration requires publisher ownership' }
    $bundledPublisherConfig = Join-Path $resources 'product/resources/desktop/eduwork.jsonc'
    if (Test-Path -LiteralPath $bundledPublisherConfig) { Remove-Item -LiteralPath $bundledPublisherConfig -Force }
    $desktop.publisherConfig=$ExternalPublisherConfig
}
$desktop | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $appPayload 'eduwork.desktop.json') -Encoding utf8NoBOM
@{name='eduwork-desktop-electron';version=$identity.dshVersion;private=$true;type='module';main='lib/main.js';description='EduWork official DSH Electron integration';license='MIT'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $appPayload 'package.json') -Encoding utf8NoBOM

$plist = Join-Path $app 'Contents/Info.plist'
$marketingVersion = ($Version -split '-')[0]
$effectiveBundleVersion = $expectedBundleVersion
foreach ($row in @(
    @('CFBundleExecutable','Electron'), @('CFBundleName',$editionName),
    @('CFBundleDisplayName',$identity.brand.product.name), @('CFBundleIdentifier',$desktop.appId),
    @('CFBundleShortVersionString',$marketingVersion), @('CFBundleVersion',$effectiveBundleVersion), @('CFBundleIconFile','brand/icon.icns'),
    @('LSMinimumSystemVersion','15.0')
)) {
    & plutil -replace $row[0] -string $row[1] $plist
    if ($LASTEXITCODE -ne 0) { throw "Info.plist update failed: $($row[0])" }
}
if ($sparkleEnabled) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../LICENSE-Sparkle') -Destination (Join-Path $resources 'LICENSE-Sparkle')
    $frameworkTarget = Join-Path $app 'Contents/Frameworks/Sparkle.framework'
    & ditto --noextattr --noqtn --noacl $SparkleFramework $frameworkTarget
    if ($LASTEXITCODE -ne 0) { throw 'Sparkle framework copy failed' }
    $headers = Join-Path $nodeRoot 'include/node'
    if (-not (Test-Path -LiteralPath (Join-Path $headers 'node_api.h') -PathType Leaf)) { throw 'Official Node distribution must include N-API headers' }
    $native = Join-Path $appPayload 'native'
    New-Item -ItemType Directory -Path $native | Out-Null
    & clang++ -std=c++17 -fobjc-arc -dynamiclib -undefined dynamic_lookup -I $headers -F (Join-Path $app 'Contents/Frameworks') -framework Sparkle -framework AppKit '-Wl,-rpath,@loader_path/../../../Frameworks' (Join-Path $PSScriptRoot '../native/sparkle-addon.mm') -o (Join-Path $native 'sparkle.node')
    if ($LASTEXITCODE -ne 0) { throw 'Sparkle native bridge compilation failed' }
    & plutil -replace SUFeedURL -string $(if ($UpdateDefaultPolicy -eq 'development') { $SparkleDevelopmentFeedURL } else { $SparkleFeedURL }) $plist
    & plutil -replace SUPublicEDKey -string $SparklePublicEDKey $plist
    & plutil -replace SUEnableAutomaticChecks -bool NO $plist
    if ($LASTEXITCODE -ne 0) { throw 'Sparkle Info.plist setup failed' }
}
# Finder and FileProvider can attach resource forks and extended attributes to
# an app copied through Desktop/Finder. They invalidate the code signature and
# make Sparkle reject the replacement during relaunch, so keep the archive
# deterministic and explicitly remove those attributes before signing.
& xattr -cr $app
if ($LASTEXITCODE -ne 0) { throw 'macOS app metadata cleanup failed' }
$release = [ordered]@{
    schemaVersion=1; shell='electron'; version=$Version; dshVersion=$identity.dshVersion; dshCommit=$identity.dshCommit
    distribution=$identity.distribution; productName=$identity.brand.product.name; platform='darwin-arm64'
    electronVersion=$electronVersion; nodeVersion=$receipt.host.nodeVersion
    minimumSystemVersion='15.0'; ladybugNativePatched=$true; bundledOpenSSL='3.5.8'
    configurationMode=$(if ($bootstrap.enabled) {'downloaded-publisher'} elseif ($ExternalPublisherConfig) {'external-publisher'} elseif ($ownership -eq 'publisher') {'bundled-publisher'} else {'user'})
    developerIDSigned=$false; adHocSigned=$true; notarized=$false
    sparkleEnabled=$sparkleEnabled; bundleVersion=$effectiveBundleVersion
    published=$false; assembledAt=[DateTime]::UtcNow.ToString('o')
}
$release | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $resources 'release.json') -Encoding utf8NoBOM
# Seal the immutable Skill baseline into the app before signing. Mutable content
# updates live in Application Support and never rewrite the signed bundle.
& $Node (Join-Path $PSScriptRoot '../../scripts/write-bundled-skills-manifest.mjs') --root $app --product (Join-Path $resources 'product') --output (Join-Path $resources 'bundled-skills.json')
if ($LASTEXITCODE -ne 0) { throw 'Bundled Skills integrity manifest failed' }
$archiveQualifier = if ($ExternalPublisherConfig) { '-external-config' } else { '' }
$archive = Join-Path $Output "$editionName-$Version-macos-arm64-electron$archiveQualifier.zip"
$signingRoot = Join-Path ([IO.Path]::GetTempPath()) ('eduwork-macos-' + [guid]::NewGuid().ToString('N'))
$signingApp = Join-Path $signingRoot $appName
$temporaryArchive = Join-Path $signingRoot ([IO.Path]::GetFileName($archive))
New-Item -ItemType Directory -Path $signingApp -Force | Out-Null
try {
    & rsync -a ($app + '/') ($signingApp + '/')
    if ($LASTEXITCODE -ne 0) { throw 'Signing-stage copy failed' }
    & xattr -cr $signingApp
    if ($LASTEXITCODE -ne 0) { throw 'Signing-stage metadata cleanup failed' }
    & codesign --force --deep --sign - --timestamp=none $signingApp
    if ($LASTEXITCODE -ne 0) { throw 'Local ad-hoc signing failed' }
    & codesign --verify --deep --strict $signingApp
    if ($LASTEXITCODE -ne 0) { throw 'Local ad-hoc signature verification failed' }
    Push-Location $signingRoot
    try { & ditto -c -k --sequesterRsrc --keepParent $appName $temporaryArchive }
    finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw 'macOS ZIP creation failed' }
    Copy-Item -LiteralPath $temporaryArchive -Destination $archive
} finally { Remove-Item -LiteralPath $signingRoot -Recurse -Force -ErrorAction SilentlyContinue }
$sha = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
"$sha  $([IO.Path]::GetFileName($archive))" | Set-Content -LiteralPath ($archive + '.sha256') -Encoding utf8NoBOM
$release.asset = @{name=[IO.Path]::GetFileName($archive);bytes=(Get-Item $archive).Length;sha256=$sha}
$release | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $Output 'release-receipt.json') -Encoding utf8NoBOM
Write-Output "Unsigned macOS arm64 candidate ready: $app"
Write-Output "ZIP: $archive"
