# 生成应用图标：从 bear-original 精灵表提取 idle 帧 → 多尺寸 → PNG-in-ICO
# 输出: resources/icon/icon.ico（electron-builder 的 win.icon 使用）
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$srcPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) '..\resources\pet-assets\characters\bear-original\pet.png'
$outDir = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) '..\resources\icon'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# 读取 idle 帧（tile 104x104，第一帧）
$src = [System.Drawing.Image]::FromFile($srcPath)
$TILE = 104
$frame = New-Object System.Drawing.Bitmap($TILE, $TILE, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($frame)
$g.Clear([System.Drawing.Color]::Transparent)
$srcRect = New-Object System.Drawing.Rectangle(0, 0, $TILE, $TILE)
$destRect = New-Object System.Drawing.Rectangle(0, 0, $TILE, $TILE)
$g.DrawImage($src, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()
$src.Dispose()

# 多尺寸缩放并保存 PNG（高质量插值）
$sizes = @(256, 128, 64, 32, 16)
$pngFiles = @{}
foreach ($s in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap($s, $s, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $gg = [System.Drawing.Graphics]::FromImage($bmp)
  $gg.Clear([System.Drawing.Color]::Transparent)
  $gg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $gg.DrawImage($frame, 0, 0, $s, $s)
  $gg.Dispose()
  $tmp = Join-Path $env:TEMP ("icon_" + $s + ".png")
  $bmp.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $pngFiles[$s] = [System.IO.File]::ReadAllBytes($tmp)
}
$frame.Dispose()

# 封装 PNG-in-ICO（Vista+ 支持）：ICONDIR + ICONDIRENTRY×N + PNG 数据
$count = $sizes.Count
$headerLen = 6 + 16 * $count
$offset = $headerLen
$ico = New-Object System.Collections.Generic.List[byte]
# ICONDIR
$ico.Add(0); $ico.Add(0)             # reserved
$ico.Add(1); $ico.Add(0)             # type = icon
$ico.Add([byte]$count); $ico.Add(0)  # count
foreach ($s in $sizes) {
  $data = $pngFiles[$s]
  # ICONDIRENTRY
  $b = if ($s -ge 256) { 0 } else { [byte]$s }  # ICO 规范：256 用 0 表示
  $ico.Add($b)                       # width
  $ico.Add($b)                       # height
  $ico.Add(0)                        # colors
  $ico.Add(0)                        # reserved
  $ico.Add(1); $ico.Add(0)           # planes
  $ico.Add(32); $ico.Add(0)          # bitcount
  $ico.Add([byte]($data.Length -band 0xFF))
  $ico.Add([byte](($data.Length -shr 8) -band 0xFF))
  $ico.Add([byte](($data.Length -shr 16) -band 0xFF))
  $ico.Add([byte](($data.Length -shr 24) -band 0xFF))
  $ico.Add([byte]($offset -band 0xFF))
  $ico.Add([byte](($offset -shr 8) -band 0xFF))
  $ico.Add([byte](($offset -shr 16) -band 0xFF))
  $ico.Add([byte](($offset -shr 24) -band 0xFF))
  $offset += $data.Length
}
foreach ($s in $sizes) {
  foreach ($b in $pngFiles[$s]) { $ico.Add($b) }
}

$icoPath = Join-Path $outDir 'icon.ico'
[System.IO.File]::WriteAllBytes($icoPath, $ico.ToArray())
Write-Host "✔ 图标已生成: $icoPath ($($ico.Count) 字节, $count 尺寸)"
