#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Archive,
    [Parameter(Mandatory)][string]$ExpectedSHA256,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [Parameter(Mandatory)][string]$Target,
    [Parameter(Mandatory)][string]$PublishDirectory
)
$ErrorActionPreference = 'Stop'
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$Target = [IO.Path]::GetFullPath($Target)
$PublishDirectory = (Resolve-Path -LiteralPath $PublishDirectory).Path
if (Test-Path -LiteralPath $Target) { throw 'Extractor acceptance requires a new destination' }
& (Join-Path $PSScriptRoot 'pack-portable-extractor.ps1') -Archive $Archive -ExpectedSHA256 $ExpectedSHA256 -OutputDirectory $OutputDirectory | Out-Host
$receipts = @(Get-ChildItem -LiteralPath $OutputDirectory -Filter '*-windows-x64-unpack.zip.json' -File)
if ($receipts.Count -ne 1) { throw 'Expected exactly one extractor receipt' }
$receiptPath = $receipts[0].FullName
$receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
if ($receipt.extractor.sourceDirty) { throw 'CI extractor must be built from a clean source checkout' }
$asset = Join-Path $OutputDirectory $receipt.asset.name
$exe = Join-Path $OutputDirectory $receipt.extractor.name
$zip = [IO.Compression.ZipFile]::OpenRead($asset)
try {
    if ($zip.Entries.Count -ne 1 -or $zip.Entries[0].FullName -cne $receipt.extractor.name -or $zip.Entries[0].Length -ne $receipt.extractor.bytes) { throw 'Outer ZIP must contain exactly the recorded extractor EXE' }
    # Read the delivered ZIP entry and compare it to the EXE that will run.
    # This avoids keeping a second large executable on the build runner.
    $entry = $zip.Entries[0].Open()
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $entryHash = [Convert]::ToHexString($sha.ComputeHash($entry)).ToLowerInvariant() }
    finally { $entry.Dispose(); $sha.Dispose() }
    if ($entryHash -cne $receipt.extractor.sha256 -or (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant() -cne $entryHash) { throw 'Outer ZIP extractor differs from its receipt' }
} finally { $zip.Dispose() }
$report = Join-Path $OutputDirectory 'extraction.json'
$process = Start-Process -FilePath $exe -ArgumentList @('--extract-to',('"'+$Target+'"'),'--report',('"'+$report+'"')) -WindowStyle Hidden -PassThru -Wait
if ($process.ExitCode -ne 0) { throw 'Portable extraction failed; see the extractor build directory for diagnostics' }
$extraction = Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
if (-not $extraction.success -or [IO.Path]::GetFullPath($extraction.target) -cne $Target -or $extraction.identity.sha256 -cne $ExpectedSHA256.ToLowerInvariant()) { throw 'Extraction result does not match the release payload or target' }
$receipt.checks | Add-Member -NotePropertyName outerZIP -NotePropertyValue 'passed'
$receipt.checks | Add-Member -NotePropertyName extraction -NotePropertyValue 'passed'
$receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receiptPath -Encoding utf8NoBOM
foreach ($name in @($receipt.asset.name,($receipt.asset.name+'.sha256'),($receipt.asset.name+'.json'))) {
    $destination = Join-Path $PublishDirectory $name
    if (Test-Path -LiteralPath $destination) { throw "Refusing to overwrite publish output: $name" }
    Copy-Item -LiteralPath (Join-Path $OutputDirectory $name) -Destination $destination
}
# Deliberately omit local paths and synthetic test directories from public receipts.
return [ordered]@{
    asset=$receipt.asset
    receipt=@{name=[IO.Path]::GetFileName($receiptPath);bytes=(Get-Item -LiteralPath $receiptPath).Length;sha256=(Get-FileHash -LiteralPath $receiptPath -Algorithm SHA256).Hash.ToLowerInvariant()}
}
