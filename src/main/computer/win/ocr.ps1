# Fabro Computer Use — text recognition with the OCR built into Windows 10/11 (Windows.Media.Ocr).
# One JSON request per line on stdin: {"id":1,"path":"C:\\...\\shot.png","scale":2}
# One JSON reply per line on stdout: {"id":1,"ok":true,"lang":"fr-FR","lines":[{"text":"…","rect":[x,y,w,h]}]}
# Coordinates are divided by "scale" (the caller may upscale the picture for small text).
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics, ContentType = WindowsRuntime]

$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($op, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $null = $task.Wait(-1)
  $task.Result
}

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) {
  $en = New-Object Windows.Globalization.Language 'en-US'
  if ([Windows.Media.Ocr.OcrEngine]::IsLanguageSupported($en)) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($en) }
}
[Console]::Out.WriteLine((@{ event = 'ready'; ok = ($null -ne $engine); lang = $(if ($engine) { $engine.RecognizerLanguage.LanguageTag } else { $null }) } | ConvertTo-Json -Compress))
[Console]::Out.Flush()

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim().Length -eq 0) { continue }
  $id = $null
  try {
    $q = $line | ConvertFrom-Json
    $id = $q.id
    if ($null -eq $engine) { throw 'No OCR language is installed in Windows (Settings > Time & language > Language).' }
    $scale = if ($q.scale) { [double]$q.scale } else { 1.0 }
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($q.path)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    try {
      $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
      $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
      $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    } finally { $stream.Dispose() }
    $lines = New-Object System.Collections.ArrayList
    foreach ($l in $result.Lines) {
      # one OCR line can join things far apart on the same row (a button and a label): split at big gaps
      $seg = $null
      foreach ($w in $l.Words) {
        $r = $w.BoundingRect
        if ($seg -and ($r.X - $seg.x2) -gt [Math]::Max(18, 1.3 * [Math]::Max($r.Height, $seg.y2 - $seg.y1))) {
          $null = $lines.Add(@{ text = ($seg.t -join ' '); rect = @([int]($seg.x1 / $scale), [int]($seg.y1 / $scale), [int](($seg.x2 - $seg.x1) / $scale), [int](($seg.y2 - $seg.y1) / $scale)) })
          $seg = $null
        }
        if (-not $seg) { $seg = @{ x1 = $r.X; y1 = $r.Y; x2 = $r.X + $r.Width; y2 = $r.Y + $r.Height; t = New-Object System.Collections.ArrayList } }
        else {
          if ($r.X -lt $seg.x1) { $seg.x1 = $r.X }; if ($r.Y -lt $seg.y1) { $seg.y1 = $r.Y }
          if ($r.X + $r.Width -gt $seg.x2) { $seg.x2 = $r.X + $r.Width }; if ($r.Y + $r.Height -gt $seg.y2) { $seg.y2 = $r.Y + $r.Height }
        }
        $null = $seg.t.Add($w.Text)
      }
      if ($seg) { $null = $lines.Add(@{ text = ($seg.t -join ' '); rect = @([int]($seg.x1 / $scale), [int]($seg.y1 / $scale), [int](($seg.x2 - $seg.x1) / $scale), [int](($seg.y2 - $seg.y1) / $scale)) }) }
    }
    $out = @{ id = $id; ok = $true; lang = $engine.RecognizerLanguage.LanguageTag; lines = $lines }
  } catch {
    $out = @{ id = $id; ok = $false; error = "$($_.Exception.Message)" }
  }
  [Console]::Out.WriteLine(($out | ConvertTo-Json -Compress -Depth 6))
  [Console]::Out.Flush()
}
