#Requires -Version 7.0
[CmdletBinding()]
param([Parameter(Mandatory)][string]$Candidate, [Parameter(Mandatory)][string]$Output,
 [ValidateSet('legacy-wails-v1','wails-host-v1')][string]$Migration='wails-host-v1')
$ErrorActionPreference = 'Stop'
$Candidate = (Resolve-Path -LiteralPath $Candidate).Path
$Output = [IO.Path]::GetFullPath($Output)
if ($Output.StartsWith($Candidate.TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'ZIP output must be outside the candidate' }
if (Test-Path -LiteralPath $Output) { throw 'Migration ZIP output already exists' }
$identity = Get-Content -LiteralPath (Join-Path $Candidate 'resources/app/eduwork.desktop.json') -Raw | ConvertFrom-Json
if ($identity.schemaVersion -ne 1 -or $identity.shell -ne 'electron' -or $identity.distribution -notmatch '^[a-z0-9][a-z0-9-]{0,79}$' -or $identity.productVersion -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$') { throw 'Invalid Electron release identity' }
if (-not (Test-Path -LiteralPath (Join-Path $Candidate 'EduWork-Electron.exe') -PathType Leaf)) { throw 'Electron entry is missing' }
if ($Migration -eq 'wails-host-v1') {
    foreach ($entry in @('ChatECNU-Work.exe','EduWork.exe')) {
        if (-not (Test-Path -LiteralPath (Join-Path $Candidate $entry) -PathType Leaf)) { throw "Bridge migration requires both historical shortcut launchers: $entry" }
    }
}
$files = [Collections.Generic.List[object]]::new()
function Inventory([string]$Directory, [string]$Prefix) {
    foreach ($entry in Get-ChildItem -LiteralPath $Directory -Force) {
        $relative = if ($Prefix) { "$Prefix/$($entry.Name)" } else { $entry.Name }
        if (-not $Prefix -and $entry.Name -in @('data','.env','.env.local','RELEASE-MANIFEST.json')) { continue }
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Release contains an unresolved link: $relative" }
        if ($entry.PSIsContainer) { Inventory $entry.FullName $relative }
        else { $files.Add([ordered]@{path=$relative;bytes=$entry.Length;sha256=(Get-FileHash -LiteralPath $entry.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}) }
    }
}
Inventory $Candidate ''
$manifest = [ordered]@{
    schemaVersion=1; launcherVersion=$identity.productVersion; flavor='offline'
    launch=[ordered]@{protocol='eduwork-desktop/v1';shell='electron';executable='EduWork-Electron.exe';migration=$Migration;distribution=$identity.distribution}
    files=@($files.ToArray())
}
$parent = Split-Path -Parent $Output
New-Item -ItemType Directory -Path $parent -Force | Out-Null
$stream = [IO.File]::Open($Output,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write)
$zip = [IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in $files) {
        $entry=$zip.CreateEntry("EduWork/$($file.path)",[IO.Compression.CompressionLevel]::Fastest)
        $destination=$entry.Open(); $source=[IO.File]::OpenRead((Join-Path $Candidate $file.path))
        try {$source.CopyTo($destination)} finally {$source.Dispose();$destination.Dispose()}
    }
    $entry=$zip.CreateEntry('EduWork/RELEASE-MANIFEST.json');$destination=$entry.Open()
    try {$bytes=[Text.Encoding]::UTF8.GetBytes(($manifest | ConvertTo-Json -Depth 8));$destination.Write($bytes)} finally {$destination.Dispose()}
} finally {$zip.Dispose();$stream.Dispose()}
$hash=(Get-FileHash -LiteralPath $Output -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $(Split-Path -Leaf $Output)" | Set-Content -LiteralPath ($Output+'.sha256') -Encoding utf8NoBOM
[ordered]@{schemaVersion=1;shell='electron';version=$identity.productVersion;distribution=$identity.distribution;bytes=(Get-Item -LiteralPath $Output).Length;sha256=$hash;fileCount=$files.Count;publicationStatus='local-only'} | ConvertTo-Json | Set-Content -LiteralPath ($Output+'.receipt.json') -Encoding utf8NoBOM
Write-Output "Prepared verified-format Electron migration ZIP: $Output"
