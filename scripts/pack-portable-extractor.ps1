#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Archive,
    [Parameter(Mandatory)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedSHA256,
    [Parameter(Mandatory)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Build the Windows extractor on Windows' }
$Archive = (Resolve-Path -LiteralPath $Archive).Path
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $OutputDirectory) { throw 'Use a new output directory to preserve existing artifacts' }
$hash = (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($hash -ne $ExpectedSHA256.ToLowerInvariant()) { throw 'Input release ZIP does not match the expected SHA256' }
$zip = [IO.Compression.ZipFile]::OpenRead($Archive)
try {
    $matches = @($zip.Entries | Where-Object FullName -Match '^[^/]+/resources/app/eduwork.desktop.json$')
    if ($matches.Count -ne 1) { throw 'Expected exactly one desktop identity' }
    $reader = [IO.StreamReader]::new($matches[0].Open())
    try { $desktop = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    $rootName = $matches[0].FullName.Split('/')[0]
    $expectedDistribution = switch ($rootName) { 'EduWork' {'eduwork'} 'EduWork-ECNU' {'eduwork-chatecnu'} default {throw 'Unsupported release root'} }
    if ($desktop.shell -ne 'electron' -or $desktop.distribution -cne $expectedDistribution -or $desktop.productVersion -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-dev\.\d{8}\.[1-9]\d*)?$') { throw 'Unsupported release identity' }
    $identity = [ordered]@{product=$desktop.productName;version=$desktop.productVersion;distribution=$desktop.distribution;root=$rootName;sha256=$hash;bytes=(Get-Item -LiteralPath $Archive).Length}
    $iconEntry = $zip.GetEntry("$rootName/resources/brand/icon.ico")
    if (-not $iconEntry -or $iconEntry.Length -gt 2MB) { throw 'Missing or oversized product icon' }
    New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
    $icon = Join-Path $OutputDirectory 'brand.ico'
    $inputStream = $iconEntry.Open(); $outputStream = [IO.File]::Create($icon)
    try { $inputStream.CopyTo($outputStream) } finally { $inputStream.Dispose(); $outputStream.Dispose() }
} finally { $zip.Dispose() }

$exe = Join-Path $OutputDirectory "$rootName-Setup.exe"
$encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($identity | ConvertTo-Json -Compress)))
$module = Join-Path $PSScriptRoot '../dsh-desktop'
Push-Location $module
try {
    $compiler = (& go env GOVERSION).Trim()
    & go build -buildvcs=false -trimpath -ldflags "-H=windowsgui -s -w -X main.buildIdentity=$encoded" -o $exe ./cmd/eduwork-extract
    if ($LASTEXITCODE -ne 0) { throw 'Extractor compilation failed' }
} finally { Pop-Location }

# Embed resources before appending the unchanged payload. No UPX or obfuscation.
if (-not ('EduWorkExtractorResources' -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
public static class EduWorkExtractorResources {
    [DllImport("kernel32", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr BeginUpdateResource(string file, bool deleteExisting);
    [DllImport("kernel32", SetLastError=true)] static extern bool UpdateResource(IntPtr h, IntPtr type, IntPtr name, ushort language, byte[] data, uint length);
    [DllImport("kernel32", SetLastError=true)] static extern bool EndUpdateResource(IntPtr h, bool discard);
    static void Check(bool ok) { if(!ok) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
    public static void Write(string exe, string icon, string manifest) {
        byte[] ico=File.ReadAllBytes(icon); int count=BitConverter.ToUInt16(ico,4);
        if(ico.Length<6 || BitConverter.ToUInt16(ico,2)!=1 || count<1 || 6+count*16>ico.Length) throw new Exception("Invalid product icon");
        IntPtr h=BeginUpdateResource(exe,false); if(h==IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        bool done=false;
        try {
            byte[] xml=File.ReadAllBytes(manifest);
            Check(UpdateResource(h,(IntPtr)24,(IntPtr)1,0,xml,(uint)xml.Length));
            byte[] group=new byte[6+count*14]; Array.Copy(ico,group,6);
            for(int i=0;i<count;i++) {
                int at=6+i*16, size=(int)BitConverter.ToUInt32(ico,at+8), offset=(int)BitConverter.ToUInt32(ico,at+12);
                byte[] img=new byte[size]; Array.Copy(ico,offset,img,0,size);
                Check(UpdateResource(h,(IntPtr)3,(IntPtr)(i+1),0,img,(uint)img.Length));
                Array.Copy(ico,at,group,6+i*14,12); Array.Copy(BitConverter.GetBytes((ushort)(i+1)),0,group,18+i*14,2);
            }
            Check(UpdateResource(h,(IntPtr)14,(IntPtr)1,0,group,(uint)group.Length));
            Check(EndUpdateResource(h,false)); done=true;
        } finally { if(!done) EndUpdateResource(h,true); }
    }
}
'@
}
[EduWorkExtractorResources]::Write($exe,$icon,(Join-Path $PSScriptRoot 'portable-extractor.manifest'))
& (Join-Path $PSScriptRoot '../dsh-electron/scripts/set-updater-manifest.ps1') -Executable $exe -VerifyOnly
$dest = [IO.File]::Open($exe,[IO.FileMode]::Append,[IO.FileAccess]::Write)
$source = [IO.File]::OpenRead($Archive)
try {
    $offset = $dest.Position
    $source.CopyTo($dest)
    $footer = [byte[]]::new(32)
    [Text.Encoding]::ASCII.GetBytes("EDUWORK-SFX-v1`0`0").CopyTo($footer,0)
    [BitConverter]::GetBytes([uint64]$offset).CopyTo($footer,16)
    [BitConverter]::GetBytes([uint64]$identity.bytes).CopyTo($footer,24)
    $dest.Write($footer)
} finally { $source.Dispose(); $dest.Dispose() }

$verification = Join-Path $OutputDirectory 'verification.json'
$process = Start-Process -FilePath $exe -ArgumentList @('--verify','--report',('"'+$verification+'"')) -WindowStyle Hidden -PassThru -Wait
if ($process.ExitCode -ne 0 -or -not (Get-Content -LiteralPath $verification -Raw | ConvertFrom-Json).success) { throw 'Embedded payload verification failed' }
$asset = Join-Path $OutputDirectory "$rootName-$($desktop.productVersion)-windows-x64-setup.zip"
$file = [IO.File]::Open($asset,[IO.FileMode]::CreateNew)
$outer = [IO.Compression.ZipArchive]::new($file,[IO.Compression.ZipArchiveMode]::Create)
try { [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($outer,$exe,[IO.Path]::GetFileName($exe),[IO.Compression.CompressionLevel]::NoCompression) | Out-Null }
finally { $outer.Dispose(); $file.Dispose() }
$assetHash = (Get-FileHash -LiteralPath $asset -Algorithm SHA256).Hash.ToLowerInvariant()
"$assetHash  $([IO.Path]::GetFileName($asset))" | Set-Content -LiteralPath ($asset+'.sha256') -Encoding utf8NoBOM
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$receipt = [ordered]@{
    schemaVersion=1; kind='eduwork-portable-extractor'; format='zip-containing-self-extracting-exe';
    product=$identity.product; version=$identity.version; distribution=$identity.distribution;
    payload=@{name=[IO.Path]::GetFileName($Archive);sha256=$hash;bytes=$identity.bytes};
    extractor=@{name=[IO.Path]::GetFileName($exe);sha256=(Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant();bytes=(Get-Item -LiteralPath $exe).Length;sourceCommit=(& git -C $repo rev-parse HEAD).Trim();sourceDirty=[bool](& git -C $repo status --porcelain);compiler=$compiler};
    asset=@{name=[IO.Path]::GetFileName($asset);sha256=$assetHash;bytes=(Get-Item -LiteralPath $asset).Length};
    checks=@{embeddedArchive='passed';manifestIdentity='passed';executionLevel='asInvoker'}
}
$receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath ($asset+'.json') -Encoding utf8NoBOM
Write-Output $asset
