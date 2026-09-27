#Requires -Version 7.0
param([Parameter(Mandatory)][string]$CoreRoot,[Parameter(Mandatory)][string]$Product,[Parameter(Mandatory)][string]$Executable,[Parameter(Mandatory)][string]$Output)
$ErrorActionPreference='Stop';$PSNativeCommandUseErrorActionPreference=$true
New-Item -ItemType Directory -Path $Output | Out-Null
$config=Join-Path $Output 'eduwork.jsonc'
@{schemaVersion=1;desktop=@{closeAction='exit'};updates=@{provider='disabled'};organizations=@(@{
    schemaVersion='dsh-oidc/v1alpha1';id='ci-example';displayName='CI example';auth=@{
        discoveryUrl='https://identity.example.test/.well-known/openid-configuration';expectedIssuer='https://identity.example.test';experimentalOidcLlm=$true;clientId='replace-with-synthetic-client';identityMode='oidc'
    }
})} | ConvertTo-Json -Depth 8 | Set-Content $config -Encoding utf8NoBOM
$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$listener.Start();$port=$listener.LocalEndpoint.Port;$listener.Stop()
$beforeData=$env:EDUWORK_DESKTOP_TEST_DATA_ROOT;$beforeConfig=$env:EDUWORK_CONFIG_FILE
$env:EDUWORK_DESKTOP_TEST_DATA_ROOT=Join-Path $Output 'data';$env:EDUWORK_CONFIG_FILE=$config
$start=@{FilePath=$Executable;ArgumentList=@("--remote-debugging-port=$port",'--remote-debugging-address=127.0.0.1','--use-mock-keychain');RedirectStandardOutput=(Join-Path $Output 'stdout.log');RedirectStandardError=(Join-Path $Output 'stderr.log');PassThru=$true}
if ($IsWindows) { $start.WindowStyle='Hidden' }
try { $process=Start-Process @start }
finally { $env:EDUWORK_DESKTOP_TEST_DATA_ROOT=$beforeData;$env:EDUWORK_CONFIG_FILE=$beforeConfig }
$failure=$null
try {
    $deadline=[DateTime]::UtcNow.AddMinutes(3);$ready=$false
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($process.HasExited) { throw 'Alpha desktop exited before ready' }
        try { $targets=Invoke-RestMethod "http://127.0.0.1:$port/json/list" -TimeoutSec 3;if (@($targets | Where-Object url -like 'dsh-app://app/*').Count) {$ready=$true;break} } catch {}
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) { throw 'Alpha desktop failed to start within acceptance limit' }
    & node (Join-Path $CoreRoot 'dsh-electron/tests/desktop-smoke.mjs') --shell electron --product $Product --cdp "http://127.0.0.1:$port" --data-root (Join-Path $Output 'data') --evidence $Output --launch-only
    if (-not (Get-Content (Join-Path $Output 'result.json') -Raw | ConvertFrom-Json).passed) { throw 'Alpha GUI smoke failed' }
} catch { $failure=$_;Get-Content (Join-Path $Output 'stderr.log') -Tail 40 -ErrorAction SilentlyContinue;throw }
finally {
    if (-not $process.HasExited) {
        try {
            & node (Join-Path $CoreRoot 'scripts/close-release-test-desktop.mjs') $Product "http://127.0.0.1:$port"
            if (-not $process.WaitForExit(15000)) { throw 'Alpha test desktop did not stop' }
        } catch {
            if (-not $process.HasExited) { $process.Kill($true);[void]$process.WaitForExit(5000) }
            if (-not $failure) { throw }
        }
    }
}
