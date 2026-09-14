param([string]$InputJson, [string]$OutputWave, [switch]$ListVoices)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $voices = @($synth.GetInstalledVoices() | Where-Object { $_.Enabled })
  if ($ListVoices) {
    ConvertTo-Json -InputObject @($voices | ForEach-Object { @{ id=$_.VoiceInfo.Name; title=$_.VoiceInfo.Name; language=$_.VoiceInfo.Culture.Name } }) -Compress
    exit 0
  }
  $payload = Get-Content -LiteralPath $InputJson -Raw -Encoding UTF8 | ConvertFrom-Json
  $chinese = @($voices | Where-Object { $_.VoiceInfo.Culture.Name -like 'zh-*' })
  if (($payload.segments.text -join '') -match '[\u4e00-\u9fff]' -and $chinese.Count -eq 0) { throw 'Install a Chinese speech voice in Windows language settings.' }
  $preferred = if ($chinese.Count -gt 0) { $chinese } else { $voices }
  if ($preferred.Count -eq 0) { throw 'No system speech voice is available.' }
  $synth.SetOutputToWaveFile($OutputWave)
  foreach ($segment in $payload.segments) {
    $voiceIndex = if ($segment.speaker -eq 'B' -and $preferred.Count -gt 1) { 1 } else { 0 }
    $selected = if ($segment.voice) { [string]$segment.voice } else { $preferred[$voiceIndex].VoiceInfo.Name }
    if ($selected -notin @($voices | ForEach-Object { $_.VoiceInfo.Name })) { throw 'Selected system voice is no longer installed.' }
    $synth.SelectVoice($selected)
    $speed = if ($payload.speed) { [double]$payload.speed } else { 1.0 }
    $synth.Rate = [Math]::Max(-10, [Math]::Min(10, [Math]::Round([Math]::Log($speed, 2) * 5)))
    $synth.Speak([string]$segment.text)
  }
} finally { $synth.Dispose() }
