[CmdletBinding()]
param([Parameter(Mandatory)][string]$Executable, [ValidateSet('wails','electron')][string]$Shell)
$ErrorActionPreference='Stop'
$Executable=[IO.Path]::GetFullPath($Executable)
if ($Executable -match '(?i)(^|[\\/])current([\\/]|$)' -or $Executable -notmatch '\\(?:wails(?:-candidate)?|electron-candidate|electron-ready)\\(?:EduWork(?:-Electron)?|ChatECNU-Work)\.exe$') {throw 'Icon replacement is limited to isolated EduWork candidate executables'}
$icon=Join-Path $PSScriptRoot '../assets/eduwork/icon.ico'
if (-not ('EduworkIconResource' -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class EduworkIconResource {
  [DllImport("kernel32",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr BeginUpdateResource(string file,bool deleteExisting);
  [DllImport("kernel32",SetLastError=true)] static extern bool UpdateResource(IntPtr h,IntPtr type,IntPtr name,ushort language,byte[] bytes,uint size);
  [DllImport("kernel32",SetLastError=true)] static extern bool EndUpdateResource(IntPtr h,bool discard);
  [DllImport("kernel32",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr LoadLibraryEx(string path,IntPtr file,uint flags);
  [DllImport("kernel32")] static extern bool FreeLibrary(IntPtr h);
  [DllImport("user32",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr LoadImage(IntPtr h,IntPtr name,uint type,int width,int height,uint flags);
  [DllImport("user32")] public static extern bool DestroyIcon(IntPtr h);
  public static IntPtr LoadGroup(string exe,int groupId,int size){
    IntPtr lib=LoadLibraryEx(exe,IntPtr.Zero,2);
    if(lib==IntPtr.Zero)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    try { var icon=LoadImage(lib,(IntPtr)groupId,1,size,size,0); if(icon==IntPtr.Zero)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());return icon; }
    finally{FreeLibrary(lib);}
  }
  delegate bool ResourceName(IntPtr h,IntPtr type,IntPtr name,IntPtr arg);
  [DllImport("kernel32",CharSet=CharSet.Unicode)] static extern bool EnumResourceNames(IntPtr h,IntPtr type,ResourceName callback,IntPtr arg);
  static void Check(bool ok){if(!ok)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());}
  public static void Apply(string exe,string icon,int groupId){
    byte[] ico=File.ReadAllBytes(icon); int count=BitConverter.ToUInt16(ico,4);
    if(BitConverter.ToUInt16(ico,2)!=1||count<1)throw new Exception("Invalid ICO");
    // Remove old group entries (Electron uses a different resource name).
    var names=new List<IntPtr>(); var allocated=new List<IntPtr>();
    IntPtr lib=LoadLibraryEx(exe,IntPtr.Zero,2);
    if(lib!=IntPtr.Zero){
      ResourceName callback=(h,t,n,a)=>{if(((ulong)n.ToInt64()>>16)==0)names.Add(n);else{var p=Marshal.StringToHGlobalUni(Marshal.PtrToStringUni(n));allocated.Add(p);names.Add(p);}return true;};
      EnumResourceNames(lib,(IntPtr)14,callback,IntPtr.Zero);FreeLibrary(lib);
    }
    IntPtr handle=BeginUpdateResource(exe,false);if(handle==IntPtr.Zero)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    bool finished=false;
    try{
      foreach(var name in names) Check(UpdateResource(handle,(IntPtr)14,name,1033,null,0));
      byte[] group=new byte[6+count*14];Array.Copy(ico,group,6);
      for(int i=0;i<count;i++){
        int at=6+16*i, length=(int)BitConverter.ToUInt32(ico,at+8), offset=(int)BitConverter.ToUInt32(ico,at+12);
        byte[] png=new byte[length];Array.Copy(ico,offset,png,0,length);
        Check(UpdateResource(handle,(IntPtr)3,(IntPtr)(i+1),1033,png,(uint)png.Length));
        Array.Copy(ico,at,group,6+14*i,12);Array.Copy(BitConverter.GetBytes((ushort)(i+1)),0,group,18+14*i,2);
      }
      Check(UpdateResource(handle,(IntPtr)14,(IntPtr)groupId,1033,group,(uint)group.Length));
      Check(EndUpdateResource(handle,false));finished=true;
    }finally{if(!finished)EndUpdateResource(handle,true);foreach(var p in allocated)Marshal.FreeHGlobal(p);}
  }
}
'@
}
# Wails loads IDI_APPLICATION (32512) explicitly for both native window icons.
# Explorer can display any first icon group, so its extraction alone missed this.
$groupId = if ($Shell -eq 'wails' -or (-not $Shell -and $Executable -match '\\wails(?:-candidate)?\\')) { 32512 } else { 1 }
[EduworkIconResource]::Apply($Executable,[IO.Path]::GetFullPath($icon),$groupId)
Add-Type -AssemblyName System.Drawing
$actual=[Drawing.Icon]::ExtractAssociatedIcon($Executable).ToBitmap()
$expected=[Drawing.Icon]::new([IO.Path]::GetFullPath($icon),32,32).ToBitmap()
try {
 if($actual.Size -ne $expected.Size){throw 'Embedded icon dimensions differ'}
 for($x=0;$x -lt $actual.Width;$x++){for($y=0;$y -lt $actual.Height;$y++){if($actual.GetPixel($x,$y).ToArgb() -ne $expected.GetPixel($x,$y).ToArgb()){throw 'Embedded executable icon differs from EduWork source'}}}
} finally {$actual.Dispose();$expected.Dispose()}
foreach($size in @(16,32)) {
 $handle=[EduworkIconResource]::LoadGroup($Executable,$groupId,$size)
 $loaded=[Drawing.Icon]::FromHandle($handle).ToBitmap()
 $expected=[Drawing.Icon]::new([IO.Path]::GetFullPath($icon),$size,$size).ToBitmap()
 try {
  if($loaded.Size -ne $expected.Size){throw 'Native window icon dimensions differ'}
  for($x=0;$x-lt$size;$x++){for($y=0;$y-lt$size;$y++){if($loaded.GetPixel($x,$y).ToArgb()-ne$expected.GetPixel($x,$y).ToArgb()){throw "Native icon resource $groupId differs from EduWork source"}}}
 }finally{$loaded.Dispose();$expected.Dispose();[EduworkIconResource]::DestroyIcon($handle)|Out-Null}
}
Write-Output "Verified EduWork executable icon: $Executable"
