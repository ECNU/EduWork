#Requires -Version 7.0
[CmdletBinding()]
param([Parameter(Mandatory)][string]$PackageRoot,[Parameter(Mandatory)][string]$Receipt)
$ErrorActionPreference='Stop'
$PSNativeCommandUseErrorActionPreference=$true
if (-not $IsMacOS) { throw 'Mach-O relocation requires macOS' }
$PackageRoot=[IO.Path]::GetFullPath($PackageRoot)
$manifest=Get-Content (Join-Path $PackageRoot 'package.json') -Raw | ConvertFrom-Json
if ($manifest.name -ne '@remotion/compositor-darwin-arm64') { throw 'Expected the pinned arm64 compositor package' }
$records=@()
foreach ($entry in Get-ChildItem -LiteralPath $PackageRoot -File | Sort-Object Name) {
    if ($entry.LinkType) { throw 'Native compositor inputs must be real files' }
    $kind=(& file -b $entry.FullName) -join ' '
    if ($kind -notmatch 'Mach-O') { continue }
    $before=(Get-FileHash $entry.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $dependencies=@(& otool -L $entry.FullName | Select-Object -Skip 1)
    $changes=@()
    foreach ($line in $dependencies) {
        if ($line -notmatch '^\s+(.+?) \(') { continue }
        $dependency=$Matches[1]
        if ($dependency.StartsWith('/System/Library/') -or $dependency.StartsWith('/usr/lib/')) { continue }
        $name=[IO.Path]::GetFileName($dependency)
        if ($name -eq $entry.Name -and $entry.Extension -eq '.dylib') { continue }
        $sibling=Join-Path $PackageRoot $name
        if (-not (Test-Path -LiteralPath $sibling -PathType Leaf) -or (Get-Item -LiteralPath $sibling).LinkType) { throw "Unbundled compositor dependency: $dependency" }
        $relative='@loader_path/'+$name
        if ($dependency -ne $relative) {
            & install_name_tool -change $dependency $relative $entry.FullName
            $changes+=@{from=$dependency;to=$relative}
        }
    }
    if ($entry.Extension -eq '.dylib') { & install_name_tool -id ('@loader_path/'+$entry.Name) $entry.FullName }
    & codesign --force --sign - --timestamp=none $entry.FullName
    $records+=@{file=$entry.Name;beforeSHA256=$before;afterSHA256=(Get-FileHash $entry.FullName -Algorithm SHA256).Hash.ToLowerInvariant();dependencies=$changes}
}
if (-not ($records.file -contains 'ffmpeg')) { throw 'Compositor FFmpeg was not found' }
@{schemaVersion=1;package=$manifest.name;version=$manifest.version;files=$records} | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $Receipt -Encoding utf8NoBOM
# Exercise the executable outside its own directory, as Office and media tools do.
Push-Location ([IO.Path]::GetTempPath())
try { $versionOutput=@(& (Join-Path $PackageRoot 'ffmpeg') -version); Write-Output $versionOutput[0] }
finally { Pop-Location }
