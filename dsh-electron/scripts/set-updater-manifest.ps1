#Requires -Version 7.0
[CmdletBinding()]
param([Parameter(Mandatory)][string]$Executable, [switch]$VerifyOnly)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Updater manifest resources require Windows' }
$Executable = (Resolve-Path -LiteralPath $Executable).Path

function Assert-InvokerManifest([byte[]]$Bytes) {
    $settings = [Xml.XmlReaderSettings]::new()
    $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $stream = [IO.MemoryStream]::new($Bytes, $false)
    $reader = [Xml.XmlReader]::Create($stream, $settings)
    try {
        $document = [Xml.XmlDocument]::new()
        $document.XmlResolver = $null
        $document.Load($reader)
        $namespaces = [Xml.XmlNamespaceManager]::new($document.NameTable)
        $namespaces.AddNamespace('asm', 'urn:schemas-microsoft-com:asm.v1')
        $namespaces.AddNamespace('uac', 'urn:schemas-microsoft-com:asm.v3')
        $levels = $document.SelectNodes('/asm:assembly/uac:trustInfo/uac:security/uac:requestedPrivileges/uac:requestedExecutionLevel', $namespaces)
        if ($levels.Count -ne 1 -or $document.SelectNodes('//*[local-name()="requestedExecutionLevel"]').Count -ne 1 -or
            $levels[0].GetAttribute('level') -cne 'asInvoker' -or $levels[0].GetAttribute('uiAccess') -cne 'false') {
            throw 'Updater manifest must explicitly request asInvoker with uiAccess=false'
        }
    } finally { $reader.Dispose(); $stream.Dispose() }
}

if (-not ('EduWorkUpdaterManifestResource' -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class EduWorkUpdaterManifestResource {
    [DllImport("kernel32", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr BeginUpdateResource(string file, bool deleteExisting);
    [DllImport("kernel32", SetLastError=true)] static extern bool UpdateResource(IntPtr handle, IntPtr type, IntPtr name, ushort language, byte[] bytes, uint length);
    [DllImport("kernel32", SetLastError=true)] static extern bool EndUpdateResource(IntPtr handle, bool discard);
    [DllImport("kernel32", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);
    [DllImport("kernel32")] static extern bool FreeLibrary(IntPtr library);
    delegate bool ResourceLanguage(IntPtr library, IntPtr type, IntPtr name, ushort language, IntPtr context);
    [DllImport("kernel32", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool EnumResourceLanguages(IntPtr library, IntPtr type, IntPtr name, ResourceLanguage callback, IntPtr context);
    [DllImport("kernel32", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr FindResourceEx(IntPtr library, IntPtr type, IntPtr name, ushort language);
    [DllImport("kernel32", SetLastError=true)] static extern uint SizeofResource(IntPtr library, IntPtr resource);
    [DllImport("kernel32", SetLastError=true)] static extern IntPtr LoadResource(IntPtr library, IntPtr resource);
    [DllImport("kernel32", SetLastError=true)] static extern IntPtr LockResource(IntPtr resource);
    static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }

    public static void Write(string file, byte[] bytes) {
        // RT_MANIFEST=24, application manifest ID=1, neutral language. Embed
        // immediately after compiling, before any future Authenticode signing.
        IntPtr handle = BeginUpdateResource(file, false);
        if (handle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        bool finished = false;
        try {
            Check(UpdateResource(handle, (IntPtr)24, (IntPtr)1, 0, bytes, (uint)bytes.Length));
            Check(EndUpdateResource(handle, false));
            finished = true;
        } finally { if (!finished) EndUpdateResource(handle, true); }
    }

    public static byte[][] Read(string file) {
        // Map only resources; verification must never execute the helper.
        IntPtr library = LoadLibraryEx(file, IntPtr.Zero, 2);
        if (library == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            var languages = new List<ushort>();
            ResourceLanguage callback = (h, t, n, language, context) => { languages.Add(language); return true; };
            Check(EnumResourceLanguages(library, (IntPtr)24, (IntPtr)1, callback, IntPtr.Zero));
            if (languages.Count == 0) throw new Exception("Updater has no embedded application manifest");
            var manifests = new List<byte[]>();
            foreach (ushort language in languages) {
                IntPtr resource = FindResourceEx(library, (IntPtr)24, (IntPtr)1, language);
                if (resource == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
                uint size = SizeofResource(library, resource);
                if (size == 0 || size > 65536) throw new Exception("Invalid updater manifest resource size");
                IntPtr loaded = LoadResource(library, resource);
                if (loaded == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
                IntPtr data = LockResource(loaded);
                if (data == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
                byte[] bytes = new byte[size];
                Marshal.Copy(data, bytes, 0, (int)size);
                manifests.Add(bytes);
            }
            return manifests.ToArray();
        } finally { FreeLibrary(library); }
    }
}
'@
}
if (-not $VerifyOnly) {
    $manifest = [IO.File]::ReadAllBytes((Join-Path $PSScriptRoot 'updater.manifest'))
    Assert-InvokerManifest $manifest
    [EduWorkUpdaterManifestResource]::Write($Executable, $manifest)
}
foreach ($manifest in [EduWorkUpdaterManifestResource]::Read($Executable)) {
    Assert-InvokerManifest $manifest
}
Write-Output 'Verified embedded updater manifest: asInvoker, uiAccess=false'
