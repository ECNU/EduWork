param(
  [Parameter(Mandatory)][ValidateSet('digest','sign','ingest','verify','inventory')][string]$Mode,
  [Parameter(Mandatory)][string]$Job
)
$ErrorActionPreference = 'Stop'
$jobData = Get-Content -LiteralPath $Job -Raw | ConvertFrom-Json
$tools = @(Get-ChildItem -Path "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction Stop | Sort-Object { [version]$_.Directory.Parent.Name } -Descending)
if (!$tools.Count) { throw 'Windows SDK SignTool is required' }
$signTool = $tools[0].FullName
$toolSignature = Get-AuthenticodeSignature -LiteralPath $signTool
if ($toolSignature.Status -ne 'Valid' -or $toolSignature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw 'Untrusted SignTool' }
function Invoke-SignTool([string[]]$Arguments) {
  & $signTool @Arguments
  if ($LASTEXITCODE -ne 0) { throw "SignTool failed ($LASTEXITCODE)" }
}
if ($Mode -eq 'inventory') {
  $rows = @(Get-ChildItem -LiteralPath $jobData.root -File -Recurse | Where-Object { $_.Extension -in @('.exe','.dll','.node') -and [IO.Path]::GetRelativePath($jobData.root,$_.FullName).Replace('\','/') -notin $jobData.exclude } | ForEach-Object {
    $signature = Get-AuthenticodeSignature -LiteralPath $_.FullName
    if ($signature.Status -notin @('Valid','NotSigned')) { throw "Invalid existing signature: $($_.FullName): $($signature.Status)" }
    [pscustomobject]@{path=[IO.Path]::GetRelativePath($jobData.root,$_.FullName).Replace('\','/'); sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(); status=[string]$signature.Status; thumbprint=$signature.SignerCertificate.Thumbprint}
  })
  ConvertTo-Json -InputObject $rows -Depth 6 | Set-Content -LiteralPath $jobData.output -Encoding utf8NoBOM
  exit 0
}
$policy = $jobData.policy
if ($Mode -eq 'digest') {
  if ($env:GITHUB_ACTIONS -eq 'true') {
    $matches = @(Get-ChildItem Cert:\CurrentUser\My,Cert:\LocalMachine\My | Where-Object { $_.Thumbprint -eq $policy.thumbprint -and $_.HasPrivateKey })
    if ($matches.Count) { throw 'Hosted digest generation must not have the signing private key' }
  }
  Invoke-SignTool @('sign','/dg',$jobData.directory,'/fd','SHA256','/f',$jobData.certificate,$jobData.file)
} elseif ($Mode -eq 'sign') {
  if ($env:GITHUB_ACTIONS -eq 'true') { throw 'Hardware signing is local only' }
  $cert = Get-Item -LiteralPath ("Cert:\CurrentUser\My\" + $policy.thumbprint)
  if (!$cert.HasPrivateKey -or $cert.Subject -cne $policy.subject -or $cert.NotAfter -le (Get-Date) -or $cert.NotBefore -gt (Get-Date)) { throw 'Signing certificate does not match policy or is not current' }
  # The provider handles any PIN prompt. No PIN or password is an input here.
  Invoke-SignTool @('sign','/ds','/fd','SHA256','/s','My','/sha1',$policy.thumbprint,$jobData.digest)
} elseif ($Mode -eq 'ingest') {
  Invoke-SignTool @('sign','/di',$jobData.directory,$jobData.file)
  Invoke-SignTool @('timestamp','/tr',$policy.timestampURL,'/td','SHA256',$jobData.file)
}
if ($Mode -in @('verify','ingest')) {
  Invoke-SignTool @('verify','/pa','/all','/v','/tw',$jobData.file)
  $signature = Get-AuthenticodeSignature -LiteralPath $jobData.file
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -cne $policy.thumbprint -or $signature.SignerCertificate.Subject -cne $policy.subject -or !$signature.TimeStamperCertificate) { throw 'Expected signer and timestamp required' }
  [pscustomobject]@{status='Valid';thumbprint=$signature.SignerCertificate.Thumbprint;subject=$signature.SignerCertificate.Subject;timestampThumbprint=$signature.TimeStamperCertificate.Thumbprint;sha256=(Get-FileHash -LiteralPath $jobData.file -Algorithm SHA256).Hash.ToLowerInvariant();bytes=(Get-Item -LiteralPath $jobData.file).Length} | ConvertTo-Json | Set-Content -LiteralPath $jobData.output -Encoding utf8NoBOM
}
