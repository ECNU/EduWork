#Requires -Version 7.0
param([Parameter(Mandatory)][string]$App, [Parameter(Mandatory)][string]$Output)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
if (-not $IsWindows) { throw 'MSI packaging requires Windows' }
$App = (Resolve-Path -LiteralPath $App).Path
$Output = [IO.Path]::GetFullPath($Output)
if (Test-Path -LiteralPath $Output) { throw 'MSI output already exists' }
$identity = Get-Content (Join-Path $App 'resources/app/eduwork.desktop.json') -Raw | ConvertFrom-Json
if ($identity.distribution -ne 'eduwork' -or $identity.shell -ne 'electron' -or $identity.productVersion -notmatch '^(\d+\.\d+\.\d+)(?:-dev\.\d{8}\.[1-9]\d*)?$') { throw 'Expected a public EduWork Electron candidate' }
$version = $Matches[1]
$work = Join-Path ([IO.Path]::GetTempPath()) ('eduwork-msi-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $work | Out-Null
try {
    # Pin the official WiX binaries; do not depend on the runner's installed version.
    $zip = Join-Path $work 'wix.zip'
    Invoke-WebRequest 'https://github.com/wixtoolset/wix3/releases/download/wix3141rtm/wix314-binaries.zip' -OutFile $zip -MaximumRetryCount 3
    if ((Get-FileHash $zip -Algorithm SHA256).Hash -ne '6ac824e1642d6f7277d0ed7ea09411a508f6116ba6fae0aa5f2c7daa2ff43d31') { throw 'WiX checksum mismatch' }
    $wix = Join-Path $work 'wix'
    Expand-Archive $zip $wix
    $files = Join-Path $work 'files.wxs'
    & "$wix/heat.exe" dir $App -nologo -srd -sreg -scom -ag -cg AppFiles -dr INSTALLFOLDER -var var.App -out $files
    [xml]$harvest = Get-Content $files -Raw
    # Configuration belongs to the user after first installation, including on uninstall.
    foreach ($component in $harvest.SelectNodes('//*[local-name()="Component"]')) {
        if ($component.File.Source -like '$(var.App)\config\*') {
            $component.SetAttribute('Permanent', 'yes')
            $component.SetAttribute('NeverOverwrite', 'yes')
        }
    }
    $harvest.Save($files)
    $product = Join-Path $work 'product.wxs'
    @"
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
  <Product Id="*" Name="EduWork" Language="1033" Version="$version" Manufacturer="EduWork" UpgradeCode="9DBD2F2A-F123-4FC4-B6AB-24253BE8CF3D">
    <Package InstallerVersion="500" Compressed="yes" InstallScope="perUser" Platform="x64" />
    <MajorUpgrade AllowSameVersionUpgrades="yes" DowngradeErrorMessage="A newer EduWork version is installed." />
    <MediaTemplate EmbedCab="yes" MaximumUncompressedMediaSize="200" />
    <Directory Id="TARGETDIR" Name="SourceDir">
      <Directory Id="LocalAppDataFolder"><Directory Id="INSTALLFOLDER" Name="EduWork" /></Directory>
      <Directory Id="ProgramMenuFolder">
        <Component Id="StartMenu" Guid="*">
          <Shortcut Id="Launch" Name="EduWork" Target="[INSTALLFOLDER]EduWork-Electron.exe" WorkingDirectory="INSTALLFOLDER" />
          <RegistryValue Root="HKCU" Key="Software\EduWork\Installer" Name="Installed" Type="integer" Value="1" KeyPath="yes" />
        </Component>
      </Directory>
    </Directory>
    <Feature Id="Main" Level="1"><ComponentGroupRef Id="AppFiles" /><ComponentRef Id="StartMenu" /></Feature>
    <Property Id="LIMITUI" Value="1" />
    <Property Id="ARPNOMODIFY" Value="1" />
  </Product>
</Wix>
"@ | Set-Content $product -Encoding utf8NoBOM
    & "$wix/candle.exe" -nologo -arch x64 "-dApp=$App" -out "$work/" $product $files
    # Per-user file components use their files as key paths (ICE38); user data keeps directories (ICE64).
    & "$wix/light.exe" -nologo -sice:ICE38 -sice:ICE64 -out $Output "$work/product.wixobj" "$work/files.wixobj"
    Remove-Item ([IO.Path]::ChangeExtension($Output, '.wixpdb')) -ErrorAction SilentlyContinue
    $hash = (Get-FileHash $Output -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $([IO.Path]::GetFileName($Output))" | Set-Content ($Output + '.sha256') -Encoding ascii
} finally { Remove-Item $work -Recurse -Force }
