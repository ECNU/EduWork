[CmdletBinding()]
param([Parameter(Mandatory)][string]$OutputExe,[string]$Node=(Get-Command node.exe -ErrorAction Stop).Source)
$ErrorActionPreference='Stop'
$core=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$OutputExe=[IO.Path]::GetFullPath($OutputExe)
$Node=[IO.Path]::GetFullPath($Node)
if ($OutputExe -match '(?i)(^|[\\/])current([\\/]|$)') {throw 'Candidate build cannot replace current'}
if (-not (Test-Path -LiteralPath (Split-Path $OutputExe -Parent) -PathType Container)) {throw 'Candidate output directory must exist'}
Push-Location (Join-Path $core 'dsh-desktop')
try {
    $module=(& go list -m -f '{{.Dir}}' github.com/wailsapp/go-webview2).Trim()
    if ($LASTEXITCODE -ne 0) {throw 'Could not resolve locked WebView dependency'}
    $buildRoot=Join-Path $core ('dist/wails-candidate-build-'+[guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path (Split-Path $buildRoot -Parent) -Force | Out-Null
    & $Node (Join-Path $PSScriptRoot 'prepare-webview-candidate.mjs') --module $module --output $buildRoot
    if ($LASTEXITCODE -ne 0) {throw 'Could not prepare isolated WebView dependency'}
    $modFile=Join-Path $buildRoot 'candidate.mod'
    Copy-Item -LiteralPath 'go.mod' -Destination $modFile
    Copy-Item -LiteralPath 'go.sum' -Destination (Join-Path $buildRoot 'candidate.sum')
    & go mod edit "-modfile=$modFile" "-replace=github.com/wailsapp/go-webview2=$(Join-Path $buildRoot 'go-webview2')"
    if ($LASTEXITCODE -ne 0) {throw 'Could not configure isolated Go dependency'}
    & go test "-modfile=$modFile" github.com/wailsapp/go-webview2/pkg/edge -run TestEduworkCDPIsExplicitAndLoopbackOnly -count=1
    if ($LASTEXITCODE -ne 0) {throw 'Candidate CDP boundary test failed'}
    & go build "-modfile=$modFile" -tags production -ldflags '-H windowsgui' -o $OutputExe ./cmd/eduwork-wails-candidate
    if ($LASTEXITCODE -ne 0) {throw 'Wails candidate executable build failed'}
    & (Join-Path $core 'scripts/set-desktop-icon.ps1') -Executable $OutputExe -Shell wails
    Copy-Item -LiteralPath (Join-Path $buildRoot 'webview-candidate-receipt.json') -Destination (Join-Path (Split-Path $OutputExe -Parent) 'webview-candidate-receipt.json')
    $licenseRoot=Join-Path (Split-Path $OutputExe -Parent) 'resources/licenses'
    New-Item -ItemType Directory -Path $licenseRoot -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $module 'LICENSE') -Destination (Join-Path $licenseRoot 'LICENSE-go-webview2') -Force
    $wailsModule=(& go list -m -f '{{.Dir}}' github.com/wailsapp/wails/v2).Trim()
    Copy-Item -LiteralPath (Join-Path $wailsModule 'LICENSE') -Destination (Join-Path $licenseRoot 'LICENSE-Wails') -Force
    $candidateReceipt=Join-Path (Split-Path $OutputExe -Parent) 'candidate-receipt.json'
    if(Test-Path -LiteralPath $candidateReceipt){
        $receipt=Get-Content -LiteralPath $candidateReceipt -Raw|ConvertFrom-Json
        if($receipt.schemaVersion -ne 1 -or $receipt.shell -ne 'wails'){throw 'Unexpected existing candidate receipt'}
        $receipt.executableSha256=(Get-FileHash $OutputExe -Algorithm SHA256).Hash.ToLowerInvariant()
        $receipt|ConvertTo-Json -Depth 15|Set-Content -LiteralPath $candidateReceipt -Encoding utf8NoBOM
    }
} finally {Pop-Location}
