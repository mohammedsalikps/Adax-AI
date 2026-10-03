# Reads the English consultations of this set aloud with the offline Windows text-to-speech voices and writes one 16 kHz mono WAV per turn
# (data/eval/audio/<id>/tNN.wav, git-ignored). Nothing is downloaded or sent anywhere: the voices ship with Windows and run on this machine.
#
#   powershell -ExecutionPolicy Bypass -File data/eval/consultations-v1/synthesise-audio.ps1 [-Only c01,c09]
#
# Doctor turns are read by "Microsoft David Desktop" (en-US, male); Patient turns alternate by file between "Microsoft Zira Desktop" (en-US,
# female) and "Microsoft Hazel Desktop" (en-GB, female). This is clean, studio-quiet, one-voice-at-a-time synthetic speech: it says nothing
# about accents, noise, overlap, a distant microphone or children, and it is NOT representative of clinic audio. See README.md.
param(
  [string]$Out = (Join-Path $PSScriptRoot '..\audio'),
  [string[]]$Only = @()
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$doctorVoice = 'Microsoft David Desktop'
$patientVoices = @('Microsoft Zira Desktop', 'Microsoft Hazel Desktop')
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)

$files = Get-ChildItem -Path $PSScriptRoot -Filter 'c*.json' | Sort-Object Name
$n = 0
foreach ($f in $files) {
  $c = Get-Content -Path $f.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($c.language -ne 'en' -or -not $c.audio) { continue }
  if ($Only.Count -gt 0 -and $Only -notcontains $c.id) { continue }
  $patientVoice = $patientVoices[$n % 2]
  $n++
  $dir = Join-Path $Out $c.id
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  for ($i = 0; $i -lt $c.turns.Count; $i++) {
    $turn = $c.turns[$i]
    $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $synth.SelectVoice($(if ($turn.speaker -eq 'Doctor') { $doctorVoice } else { $patientVoice }))
    $synth.SetOutputToWaveFile((Join-Path $dir ('t{0:D2}.wav' -f $i)), $format)
    $synth.Speak($turn.text)
    $synth.Dispose()
  }
  Write-Host ('{0}: {1} turns, patient voice {2}' -f $c.id, $c.turns.Count, $patientVoice)
}
