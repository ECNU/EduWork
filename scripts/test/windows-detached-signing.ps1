#Requires -Version 7.0
[CmdletBinding()]
param([Parameter(Mandatory)][string]$Output)
$ErrorActionPreference='Stop'
$versions=Get-ChildItem 'C:/Program Files (x86)/Windows Kits/10/bin' -Directory | Sort-Object {try{[version]$_.Name}catch{[version]'0.0'}} -Descending
$tool=$null
foreach($version in $versions){$p=Join-Path $version.FullName 'x64/signtool.exe';if(Test-Path -LiteralPath $p){$tool=$p;break}}
if(-not $tool){throw 'Windows SDK SignTool missing'}
$cer=Join-Path $Output 'publisher.cer'
$exe=Join-Path $Output 'EduWork-Updater.exe'
$requestPath=Join-Path $Output 'request.json'
function Hash([string]$Path){(Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()}
if(-not $env:PARENT_RUN){
 if(Test-Path -LiteralPath $Output){throw 'Expected a new probe directory'}
 New-Item -ItemType Directory -Path $Output | Out-Null
 if($env:PUBLIC_CERTIFICATE.Length -gt 16384 -or $env:SIGNED_DIGEST){throw 'Invalid generation inputs'}
 [IO.File]::WriteAllBytes($cer,[Convert]::FromBase64String($env:PUBLIC_CERTIFICATE))
 $cert=[Security.Cryptography.X509Certificates.X509Certificate2]::new($cer)
 if($cert.HasPrivateKey -or $cert.NotAfter -lt (Get-Date)){throw 'Use a currently valid PUBLIC certificate'}
 $matches=@(Get-ChildItem Cert:/CurrentUser/My,Cert:/LocalMachine/My | Where-Object Thumbprint -eq $cert.Thumbprint)
 if($matches.Count){throw 'The public-only probe requires no matching personal-store certificate'}
 Push-Location (Join-Path $PSScriptRoot '../../dsh-desktop')
 try{go build -buildvcs=false -trimpath -ldflags '-s -w -H windowsgui' -o $exe ./cmd/eduwork-updater;if($LASTEXITCODE -ne 0){throw 'Probe build failed'}}finally{Pop-Location}
 $original=Hash $exe
 & $tool sign /v /fd SHA256 /f $cer $exe *> (Join-Path $Output 'normal-sign-negative.log')
 $negative=$LASTEXITCODE
 if($negative -eq 0 -or (Hash $exe) -ne $original){throw 'Unexpected private-key access or mutation'}
 & $tool sign /v /dg $Output /fd SHA256 /f $cer $exe *> (Join-Path $Output 'generate.log')
 if($LASTEXITCODE -ne 0 -or (Get-AuthenticodeSignature -LiteralPath $exe).Status -ne 'NotSigned'){throw 'Public-only digest generation failed'}
 # /dg can align the PE. Bind the exact emitted unsigned bytes, not the input.
 [ordered]@{schemaVersion=1;kind='detached-signing-probe';repository=$env:GITHUB_REPOSITORY;commit=$env:GITHUB_SHA;runId=$env:GITHUB_RUN_ID;thumbprint=$cert.Thumbprint;subject=$cert.Subject;certificateSHA256=(Hash $cer);unsignedSHA256=(Hash $exe);digestSHA256=(Hash ($exe+'.dig'));pkcs7SHA256=(Hash ($exe+'.p7u'));normalSignExit=$negative;digestExit=0;matchingPersonalCertificates=0;hasPrivateKey=$false;signTool=$tool} | ConvertTo-Json | Set-Content -LiteralPath $requestPath -Encoding utf8NoBOM
}else{
 $request=Get-Content -Raw -LiteralPath $requestPath | ConvertFrom-Json
 if($request.kind -ne 'detached-signing-probe' -or $request.repository -ne $env:GITHUB_REPOSITORY -or $request.commit -ne $env:GITHUB_SHA -or $request.runId -ne $env:PARENT_RUN){throw 'Probe source mismatch'}
 if((Hash $cer) -ne $request.certificateSHA256 -or (Hash $exe) -ne $request.unsignedSHA256 -or (Hash ($exe+'.dig')) -ne $request.digestSHA256 -or (Hash ($exe+'.p7u')) -ne $request.pkcs7SHA256){throw 'Probe inputs changed'}
 $cert=[Security.Cryptography.X509Certificates.X509Certificate2]::new($cer)
 if($cert.HasPrivateKey -or @(Get-ChildItem Cert:/CurrentUser/My,Cert:/LocalMachine/My | Where-Object Thumbprint -eq $cert.Thumbprint).Count){throw 'Ingestion runner has a matching personal certificate'}
 if($env:SIGNED_DIGEST -notmatch '^[A-Za-z0-9+/]+={0,2}$' -or $env:SIGNED_DIGEST.Length -gt 4096){throw 'Invalid signature response'}
 $signature=[Convert]::FromBase64String($env:SIGNED_DIGEST)
 $public=[Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPublicKey($cert)
 try {
  $digest=[Convert]::FromBase64String([IO.File]::ReadAllText($exe+'.dig').Trim())
  if(-not $public.VerifyHash($digest,$signature,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1)){throw 'Digest signature mismatch'}
 }finally{$public.Dispose()}
 [IO.File]::WriteAllText($exe+'.dig.signed',$env:SIGNED_DIGEST,[Text.UTF8Encoding]::new($false))
 & $tool sign /v /di $Output $exe *> (Join-Path $Output 'ingest.log')
 if($LASTEXITCODE -ne 0){throw 'Signature ingestion failed'}
 & $tool timestamp /tr http://timestamp.globalsign.com/tsa/r45standard /td SHA256 $exe *> (Join-Path $Output 'timestamp.log')
 if($LASTEXITCODE -ne 0){throw 'Timestamp failed'}
 & $tool verify /pa /all /v /tw $exe *> (Join-Path $Output 'verify.log')
 if($LASTEXITCODE -ne 0){throw 'Signature/timestamp chain verification failed'}
 $actual=Get-AuthenticodeSignature -LiteralPath $exe
 if($actual.Status -ne 'Valid' -or $actual.SignerCertificate.Thumbprint -ne $request.thumbprint -or $actual.SignerCertificate.Subject -cne $request.subject -or -not $actual.TimeStamperCertificate){throw 'Unexpected publisher or missing timestamp'}
 [ordered]@{schemaVersion=1;passed=$true;parentRun=$env:PARENT_RUN;runId=$env:GITHUB_RUN_ID;commit=$env:GITHUB_SHA;sha256=(Hash $exe);thumbprint=$actual.SignerCertificate.Thumbprint;subject=$actual.SignerCertificate.Subject;timestampSubject=$actual.TimeStamperCertificate.Subject;requestSHA256=(Hash $requestPath);matchingPersonalCertificates=0;hasPrivateKey=$false} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Output 'result.json') -Encoding utf8NoBOM
}
