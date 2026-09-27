[CmdletBinding()]
param([Parameter(Mandatory)][string]$Executable)

$ErrorActionPreference = 'Stop'
$Executable = [IO.Path]::GetFullPath($Executable)
if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { throw "Updater executable is missing: $Executable" }
$manifest = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../native/updater.manifest'), [Text.Encoding]::UTF8)

if (-not ('EduworkUpdaterManifestResource' -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class EduworkUpdaterManifestResource {
    const uint LOAD_LIBRARY_AS_DATAFILE = 2;
    static readonly IntPtr RT_MANIFEST = (IntPtr)24;
    static readonly IntPtr CREATEPROCESS_MANIFEST_RESOURCE_ID = (IntPtr)1;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr BeginUpdateResource(string fileName, bool deleteExistingResources);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool UpdateResource(IntPtr handle, IntPtr type, IntPtr name, ushort language, byte[] data, uint size);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool EndUpdateResource(IntPtr handle, bool discard);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr LoadLibraryEx(string fileName, IntPtr reserved, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr FindResource(IntPtr module, IntPtr name, IntPtr type);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint SizeofResource(IntPtr module, IntPtr resource);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr LoadResource(IntPtr module, IntPtr resource);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr LockResource(IntPtr loadedResource);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool FreeLibrary(IntPtr module);

    static Exception Failure() { return new Win32Exception(Marshal.GetLastWin32Error()); }

    public static string Read(string fileName) {
        IntPtr module = LoadLibraryEx(fileName, IntPtr.Zero, LOAD_LIBRARY_AS_DATAFILE);
        if (module == IntPtr.Zero) throw Failure();
        try {
            IntPtr resource = FindResource(module, CREATEPROCESS_MANIFEST_RESOURCE_ID, RT_MANIFEST);
            if (resource == IntPtr.Zero) return null;
            uint size = SizeofResource(module, resource);
            IntPtr loaded = LoadResource(module, resource);
            IntPtr pointer = LockResource(loaded);
            if (size == 0 || loaded == IntPtr.Zero || pointer == IntPtr.Zero) throw Failure();
            byte[] bytes = new byte[size];
            Marshal.Copy(pointer, bytes, 0, (int)size);
            return Encoding.UTF8.GetString(bytes);
        } finally { FreeLibrary(module); }
    }

    public static void Write(string fileName, string manifest) {
        byte[] bytes = new UTF8Encoding(false).GetBytes(manifest);
        IntPtr handle = BeginUpdateResource(fileName, false);
        if (handle == IntPtr.Zero) throw Failure();
        bool committed = false;
        try {
            if (!UpdateResource(handle, RT_MANIFEST, CREATEPROCESS_MANIFEST_RESOURCE_ID, 0, bytes, (uint)bytes.Length)) throw Failure();
            if (!EndUpdateResource(handle, false)) throw Failure();
            committed = true;
        } finally { if (!committed) EndUpdateResource(handle, true); }
    }
}
'@
}

$existing = [EduworkUpdaterManifestResource]::Read($Executable)
if ($existing -and $existing -ne $manifest) { throw 'Updater already has a different application manifest' }
if (-not $existing) { [EduworkUpdaterManifestResource]::Write($Executable, $manifest) }
if ([EduworkUpdaterManifestResource]::Read($Executable) -ne $manifest) { throw 'Embedded updater manifest differs from the source' }
Write-Output "Verified asInvoker manifest: $Executable"
