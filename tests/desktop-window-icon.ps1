[CmdletBinding()]
param([Parameter(Mandatory)][int]$ProcessId,[Parameter(Mandatory)][string]$Executable,[Parameter(Mandatory)][string]$Evidence)
$ErrorActionPreference='Stop'
$expectedExe=[IO.Path]::GetFullPath($Executable)
if($expectedExe -notmatch '\\wails-candidate\\EduWork\.exe$' -or $expectedExe -match '\\current\\'){throw 'Select an isolated Wails candidate'}
$process=Get-Process -Id $ProcessId
if($process.Path -ne $expectedExe){throw 'Candidate process does not match executable'}
if($process.MainWindowHandle -eq 0){throw 'Candidate window is not ready'}
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class EduworkWindowIcon {
 [DllImport("user32.dll",EntryPoint="GetClassLongPtrW")] public static extern IntPtr ClassValue(IntPtr hwnd,int index);
 [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hwnd,uint msg,IntPtr wparam,IntPtr lparam);
 [DllImport("user32.dll")] public static extern IntPtr CopyIcon(IntPtr icon);
 [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr icon);
 public static IntPtr Get(IntPtr window,bool small) {
   var icon=SendMessage(window,0x7f,(IntPtr)(small?0:1),IntPtr.Zero);
   if(icon==IntPtr.Zero)icon=ClassValue(window,small?-34:-14);
   if(icon==IntPtr.Zero)throw new Exception("Native window has no application icon");
   return CopyIcon(icon);
 }
}
'@
New-Item -ItemType Directory -Path $Evidence -Force | Out-Null
$ico=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../assets/eduwork/icon.ico'))
$rows=foreach($kind in @('large','small')){
 $handle=[EduworkWindowIcon]::Get($process.MainWindowHandle,($kind -eq 'small'))
 $icon=[Drawing.Icon]::FromHandle($handle)
 $actual=$icon.ToBitmap()
 $expectedIcon=[Drawing.Icon]::new($ico,$actual.Width,$actual.Height)
 $expected=$expectedIcon.ToBitmap()
 try {
  if($actual.Size -ne $expected.Size){throw 'Native icon dimensions differ'}
  for($x=0;$x -lt $actual.Width;$x++){for($y=0;$y -lt $actual.Height;$y++){
   if($actual.GetPixel($x,$y).ToArgb() -ne $expected.GetPixel($x,$y).ToArgb()){throw "Native $kind icon differs from EduWork"}
  }}
  $actual.Save((Join-Path ([IO.Path]::GetFullPath($Evidence)) "$kind.png"))
  [pscustomobject]@{kind=$kind;passed=$true;width=$actual.Width;height=$actual.Height}
 }finally{$actual.Dispose();$expected.Dispose();$expectedIcon.Dispose();$icon.Dispose();[void][EduworkWindowIcon]::DestroyIcon($handle)}
}
[pscustomobject]@{passed=$true;pid=$ProcessId;checks=$rows}|ConvertTo-Json -Depth 4|Set-Content -LiteralPath (Join-Path $Evidence 'result.json') -Encoding utf8
$rows|ConvertTo-Json
