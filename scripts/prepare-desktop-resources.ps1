#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$OutputRoot,
    [Parameter(Mandatory)][string]$PythonArchive,
    [Parameter(Mandatory)][string]$PythonWheelRoot,
    [Parameter(Mandatory)][string]$BrowserSource,
    [Parameter(Mandatory)][string]$AsrSource,
    [Parameter(Mandatory)][string]$AsrModel,
    [Parameter(Mandatory)][string]$VCRedistSource,
    [string]$MediaEnvironmentRelativePath = 'd',
    [string]$PythonManifest = (Join-Path $PSScriptRoot '../dsh-desktop/internal/productruntime/builtin/python-runtime-manifest.json'),
    [string]$NodeManifest = (Join-Path $PSScriptRoot '../dsh-desktop/internal/productruntime/builtin/node-runtime-manifest.json')
)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or [Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'X64') { throw 'This resource recipe requires Windows x64' }
$utf8 = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$OutputRoot = [IO.Path]::GetFullPath($OutputRoot)
$resourceRoot = Join-Path $OutputRoot 'r'
if (Test-Path -LiteralPath $resourceRoot) { throw 'Refusing to overwrite an existing native resource directory' }
if (Test-Path -LiteralPath (Join-Path $OutputRoot 'desktop-resources.json')) { throw 'This product already owns native resources' }
if ($OutputRoot -match '(?i)(^|[\\/])current([\\/]|$)') { throw 'Prepare resources in a new candidate, never current' }
if ([IO.Path]::IsPathRooted($MediaEnvironmentRelativePath) -or $MediaEnvironmentRelativePath -match '(^|[\\/])\.\.([\\/]|$)') { throw 'Media environment must be inside the new product' }
foreach ($path in @($PythonArchive, $AsrModel, $PythonManifest, $NodeManifest)) { if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required resource file is missing: $path" } }
foreach ($path in @($PythonWheelRoot, $BrowserSource, $AsrSource, $VCRedistSource)) { if (-not (Test-Path -LiteralPath $path -PathType Container)) { throw "Required resource directory is missing: $path" } }
$vcLibraries = @()
foreach ($name in @('msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'vcomp140.dll')) {
    $matches = @(Get-ChildItem -LiteralPath $VCRedistSource -Recurse -File -Filter $name)
    if ($matches.Count -ne 1) { throw "Expected exactly one x64 redistributable $name in VCRedistSource" }
    $vcLibraries += $matches[0]
}
$manifest = Get-Content -LiteralPath $PythonManifest -Raw | ConvertFrom-Json -AsHashtable
$nodeLock = Get-Content -LiteralPath $NodeManifest -Raw | ConvertFrom-Json -AsHashtable
$asset = $manifest.assets['windows-amd64']
if ($manifest.schemaVersion -ne 2 -or $asset.archiveRoot -ne 'python') { throw 'Unsupported private Python manifest' }
function Assert-Hash([string]$Path, [string]$Expected) {
    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $Expected) { throw "Locked resource checksum mismatch: $Path" }
}
Assert-Hash $PythonArchive $asset.sha256
Assert-Hash (Join-Path $BrowserSource 'chrome.exe') $nodeLock.environment.browserAutomation.executables['windows-amd64'].sha256
$wheels = @()
foreach ($package in $manifest.environment.packages) {
    $wheel = if ($package.assets.ContainsKey('windows-amd64')) { $package.assets['windows-amd64'] } else { $package.assets.any }
    $filename = [Uri]::UnescapeDataString(([Uri]$wheel.url).Segments[-1])
    $candidates = @(Get-ChildItem -LiteralPath $PythonWheelRoot -Recurse -File -Filter $filename)
    if ($candidates.Count -ne 1) { throw "Expected one cached wheel: $filename" }
    Assert-Hash $candidates[0].FullName $wheel.sha256
    $wheels += @{ name = $package.name; version = $package.version; importName = $package.importName; directory = $candidates[0].DirectoryName; sha256 = $wheel.sha256 }
}
function Invoke-Private([string]$File, [string[]]$Arguments) {
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $File; $start.UseShellExecute = $false; $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
    $start.StandardOutputEncoding = $utf8; $start.StandardErrorEncoding = $utf8
    $start.WorkingDirectory = $resourceRoot
    foreach ($key in @($start.Environment.Keys)) {
        if ($key -match '^(?i:PYTHON|PIP_)' -or $key -in @('VIRTUAL_ENV', 'VIRTUAL_ENV_PROMPT')) { $start.Environment.Remove($key) | Out-Null }
    }
    $start.Environment['PYTHONUTF8'] = '1'; $start.Environment['PYTHONIOENCODING'] = 'utf-8'
    $start.Environment['PIP_CONFIG_FILE'] = 'NUL'; $start.Environment['PIP_NO_INDEX'] = '1'
    foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::new(); $process.StartInfo = $start
    try {
        if (-not $process.Start()) { throw 'Native resource preparation did not start' }
        $stdout = $process.StandardOutput.ReadToEndAsync(); $stderr = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        $out = $stdout.GetAwaiter().GetResult(); $err = $stderr.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) { throw "Native resource command failed ($($process.ExitCode)): $err $out" }
        return $out.Trim()
    } finally { $process.Dispose() }
}

New-Item -ItemType Directory -Path (Join-Path $resourceRoot 'p') -Force | Out-Null
Write-Host 'Extracting the locked private Python archive...'
Invoke-Private 'tar.exe' @('-xf', [IO.Path]::GetFullPath($PythonArchive), '-C', (Join-Path $resourceRoot 'p'), '--strip-components', '1') | Out-Null
$basePython = Join-Path $resourceRoot 'p/python.exe'
$venv = Join-Path $resourceRoot 'v'
# Same private-runtime + fresh-venv + verified offline wheels recipe as
# dsh-desktop/internal/productruntime/pythonruntime/venv.go. No copied venv.
Invoke-Private $basePython @('-I', '-B', '-X', 'utf8', '-m', 'venv', '--without-pip', $venv) | Out-Null
$python = Join-Path $venv 'Scripts/python.exe'
Invoke-Private $python @('-I', '-B', '-X', 'utf8', '-m', 'ensurepip', '--upgrade', '--default-pip') | Out-Null
$arguments = @('-I', '-B', '-X', 'utf8', '-m', 'pip', 'install', '--no-index', '--no-deps', '--no-compile', '--no-cache-dir', '--disable-pip-version-check', '--no-warn-script-location')
# Named locked requirements avoid direct_url.json records retaining source paths.
foreach ($directory in @($wheels.directory | Select-Object -Unique)) { $arguments += @('--find-links', $directory) }
foreach ($wheel in $wheels) { $arguments += "$($wheel.name)==$($wheel.version)" }
Write-Host 'Installing verified Office wheels without network access...'
Invoke-Private $python $arguments | Out-Null
$requirements = @($wheels | ForEach-Object { @{ name = $_.name; version = $_.version; importName = $_.importName } }) | ConvertTo-Json -Compress
$probe = 'import importlib,importlib.metadata,json,sys; rows=json.loads(sys.argv[1]); [(importlib.import_module(r["importName"]), None if importlib.metadata.version(r["name"])==r["version"] else sys.exit(2)) for r in rows]; print(json.dumps({"prefix":sys.prefix,"basePrefix":sys.base_prefix,"version":sys.version.split()[0]}))'
$checked = Invoke-Private $python @('-I', '-B', '-X', 'utf8', '-c', $probe, $requirements) | ConvertFrom-Json
if ($checked.prefix -ne $venv -or $checked.basePrefix -ne (Join-Path $resourceRoot 'p') -or $checked.version -ne $manifest.pythonVersion) { throw 'Private Python resolved outside the new product' }

$environmentLock = (Get-FileHash -LiteralPath $PythonManifest -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $venv '.eduwork-venv.json'), (@{ schemaVersion = 1; environmentLockSHA256 = $environmentLock } | ConvertTo-Json), $utf8)
# The application never invokes activation scripts or pip console shims. Remove
# their build-directory references; Python is always invoked explicitly with -I.
Get-ChildItem -LiteralPath (Join-Path $venv 'Scripts') -File | Where-Object { $_.Name -notin @('python.exe', 'pythonw.exe') } | Remove-Item -Force
# Leave a neutral shipped template. prepareNativeResources repairs this owned
# file before the first invocation and after each directory move.
[IO.File]::WriteAllText((Join-Path $venv 'pyvenv.cfg'), "home = ../p`ninclude-system-site-packages = false`nversion = $($manifest.pythonVersion)`nexecutable = ../p/python.exe`n", $utf8)
# Bytecode created by ensurepip can retain the build machine's absolute path.
# All entries below belong to this newly-created venv, never a user's Python.
foreach ($cache in @(Get-ChildItem -LiteralPath $venv -Recurse -Directory -Filter '__pycache__')) {
    $target = [IO.Path]::GetFullPath($cache.FullName)
    if (-not $target.StartsWith($venv + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Python cache escaped the new environment' }
    Remove-Item -LiteralPath $target -Recurse -Force
}

Write-Host 'Copying the offline browser and CPU transcription engine...'
Copy-Item -LiteralPath $BrowserSource -Destination (Join-Path $resourceRoot 'b') -Recurse
New-Item -ItemType Directory -Path (Join-Path $resourceRoot 'a') | Out-Null
foreach ($name in @('whisper-cli.exe', 'whisper.dll', 'ggml.dll', 'ggml-base.dll', 'ggml-cpu.dll')) {
    Copy-Item -LiteralPath (Join-Path $AsrSource $name) -Destination (Join-Path $resourceRoot "a/$name")
}
Copy-Item -LiteralPath $AsrModel -Destination (Join-Path $resourceRoot 'a/model.bin')
foreach ($library in $vcLibraries) { Copy-Item -LiteralPath $library.FullName -Destination (Join-Path $resourceRoot "a/$($library.Name)") }
$asrHashes = [ordered]@{}
Get-ChildItem -LiteralPath (Join-Path $resourceRoot 'a') -File | ForEach-Object { $asrHashes[$_.Name] = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
$receipt = [ordered]@{
    schemaVersion = 1; platform = 'win32-x64'
    environment = [ordered]@{ DSH_OFFICE_PYTHON = 'r/v/Scripts/python.exe'; DSH_MEDIA_BROWSER = 'r/b/chrome.exe'; DSH_MEDIA_NODE_ENV = $MediaEnvironmentRelativePath.Replace('\', '/') }
    python = [ordered]@{ baseRoot = 'r/p'; venvRoot = 'r/v'; version = $manifest.pythonVersion; runtimeId = $manifest.runtimeId; archiveSHA256 = $asset.sha256; environmentLockSHA256 = $environmentLock }
    browser = @{ executableSHA256 = $nodeLock.environment.browserAutomation.executables['windows-amd64'].sha256; version = $nodeLock.environment.browserAutomation.browserVersion }
    asr = @{ model = 'whisper-tiny-q5_1'; filesSHA256 = $asrHashes }
    pluginConfig = @{ 'eduwork-artifact-services' = @{ transcription = @{ local = @{ executablePath = 'r/a/whisper-cli.exe'; modelPath = 'r/a/model.bin' } } } }
}
[IO.File]::WriteAllText((Join-Path $OutputRoot 'desktop-resources.json'), ($receipt | ConvertTo-Json -Depth 12), $utf8)
Write-Host "Native resources prepared: $(Join-Path $OutputRoot 'desktop-resources.json')"
