#Requires -Version 7.0
[CmdletBinding()]
param([Parameter(Mandatory)][string]$Candidate,[Parameter(Mandatory)][string]$Output)
$ErrorActionPreference='Stop'
$Candidate=(Resolve-Path -LiteralPath $Candidate).Path
$Output=[IO.Path]::GetFullPath($Output)
if(Test-Path -LiteralPath $Output){throw 'ZIP already exists'}
if($Output.StartsWith($Candidate.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'ZIP must be outside candidate'}
$identity=Get-Content -LiteralPath (Join-Path $Candidate 'eduwork.desktop.json') -Raw|ConvertFrom-Json
if(-not $identity.bridge -or $identity.shell -ne 'wails'){throw 'Not a qualified Wails bridge'}
foreach($file in @('EduWork.exe','ChatECNU-Work.exe','release.json','config/update.bridge.json')){if(-not(Test-Path -LiteralPath (Join-Path $Candidate $file))){throw "Missing bridge file: $file"}}
$files=[Collections.Generic.List[object]]::new()
function Walk([string]$Dir,[string]$Prefix){
 foreach($entry in Get-ChildItem -LiteralPath $Dir -Force){
  $path=if($Prefix){"$Prefix/$($entry.Name)"}else{$entry.Name}
  if(-not $Prefix -and $entry.Name -in @('data','.env','.env.local','RELEASE-MANIFEST.json')){continue}
  if($entry.Attributes -band [IO.FileAttributes]::ReparsePoint){throw "Unresolved package link: $path"}
  if($entry.PSIsContainer){Walk $entry.FullName $path}else{$files.Add([ordered]@{path=$path;bytes=$entry.Length;sha256=(Get-FileHash -LiteralPath $entry.FullName -Algorithm SHA256).Hash.ToLowerInvariant()});if($files.Count%2000-eq0){Write-Host "Verified $($files.Count) package files"}}
 }
}
Walk $Candidate ''
# Deliberately no launch extension: the old updater must restart its known EXE.
$manifest=[ordered]@{schemaVersion=1;launcherVersion=$identity.productVersion;flavor='offline';files=@($files.ToArray())}
$manifest|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $Candidate 'RELEASE-MANIFEST.json') -Encoding utf8NoBOM
New-Item -ItemType Directory -Path (Split-Path $Output -Parent) -Force|Out-Null
$stream=[IO.File]::Open($Output,[IO.FileMode]::CreateNew)
$zip=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create)
try{
 foreach($relative in @($files|ForEach-Object path)+@('RELEASE-MANIFEST.json')){
  $entry=$zip.CreateEntry("App/$relative",[IO.Compression.CompressionLevel]::Fastest)
  $destination=$entry.Open();$source=[IO.File]::OpenRead((Join-Path $Candidate $relative))
  try{$source.CopyTo($destination)}finally{$source.Dispose();$destination.Dispose()}
 }
}finally{$zip.Dispose();$stream.Dispose()}
$hash=(Get-FileHash -LiteralPath $Output -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $([IO.Path]::GetFileName($Output))"|Set-Content -LiteralPath ($Output+'.sha256') -Encoding utf8NoBOM
[ordered]@{schemaVersion=1;shell='wails';kind='legacy-transition';version=$identity.productVersion;bytes=(Get-Item -LiteralPath $Output).Length;sha256=$hash;files=$files.Count;publication='local-only'}|ConvertTo-Json|Set-Content -LiteralPath ($Output+'.receipt.json') -Encoding utf8NoBOM
Write-Output "Prepared old-updater-compatible bridge ZIP: $Output"
