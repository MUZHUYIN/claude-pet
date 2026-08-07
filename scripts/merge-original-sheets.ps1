# 合并"自嘲熊原版风"素材包为桌宠精灵表 characters/bear-original/pet.png + sprites.json
# 用法: npm run merge:original   （默认指向 D 盘素材 zip；可传 -Source 覆盖）
# 依赖: Win10 自带 PowerShell 5.1 + System.Drawing（无需额外安装）
param(
  [string]$Source = "D:\周靖\下载\自嘲熊\自嘲熊桌宠素材完整包1.zip（参考原图重做，原版风+像素风，132帧单帧PNG + 20张Sprite Sheet + 配置文件 + 文档）.zip",
  [string]$OutName = "bear-original",
  [string]$Style = "original_style"
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.IO.Compression.FileSystem

# 动画定义：行序 = 数组下标；帧数 = zip 实测；fps = pet_config.json
$ANIMS = @('idle', 'blink', 'walk', 'run', 'jump', 'sleep', 'typing', 'thinking', 'happy', 'cry')
$FRAMES = @{ idle = 8; blink = 4; walk = 8; run = 8; jump = 6; sleep = 6; typing = 8; thinking = 6; happy = 6; cry = 6 }
$FPS = @{ idle = 8; blink = 4; walk = 10; run = 16; jump = 12; sleep = 4; typing = 12; thinking = 6; happy = 10; cry = 8 }
# 非循环动画：blink/jump 播完回 idle；happy/cry 播完停在末帧（完成态静态展示）
$FOLLOWUP_IDLE = @('blink', 'jump')
$STAY_LAST = @('happy', 'cry')
# 观感调慢系数（素材 fps 偏快，×2.5 更柔和自然）
$SLOWDOWN = 2.5
# alpha 阈值硬化（实验已证伪：硬化后白框反而更粗，与边缘锐度正相关，非 alpha 根因）。
# 阈值设为 0 时跳过硬化（保留插画风羽化边缘）。
$ALPHA_THRESHOLD = 0

# 素材帧尺寸（源）与目标 tile 尺寸（裁剪后）
$SRC_TILE = 128
# 逐帧裁剪：每帧四周去除 $CROP px 外围（去除素材白色框线 + 贴边内容，内容四周留干净透明边距）
$CROP = 12
$TILE = $SRC_TILE - 2 * $CROP  # 112
$COLS = 8
$W = $TILE * $COLS        # 896
$H = $TILE * $ANIMS.Count # 1120

# 输出目录: 项目 resources/pet-assets/characters/<OutName>/
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$outDir = Join-Path (Join-Path (Split-Path -Parent $scriptDir) 'resources\pet-assets\characters') $OutName
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# 读取源 sheet（zip 直读或目录）
function Get-SheetBitmap([string]$name) {
  $entryPath = "$Style/sprite_sheets/$name/${name}_sheet.png"
  if ($Source -like '*.zip') {
    $zip = [System.IO.Compression.ZipFile]::OpenRead($Source)
    try {
      $entry = $zip.GetEntry($entryPath)
      if (-not $entry) { throw "zip 中找不到条目: $entryPath" }
      $stream = $entry.Open()
      try { return [System.Drawing.Image]::FromStream($stream) }
      finally { $stream.Dispose() }
    }
    finally { $zip.Dispose() }
  } else {
    $file = Join-Path $Source "$name/${name}_sheet.png"
    if (-not (Test-Path $file)) { throw "找不到文件: $file" }
    return [System.Drawing.Image]::FromFile($file)
  }
}

# 合并
$target = New-Object System.Drawing.Bitmap($W, $H, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($target)
try {
  $g.Clear([System.Drawing.Color]::Transparent)
  for ($i = 0; $i -lt $ANIMS.Count; $i++) {
    $name = $ANIMS[$i]
    $bmp = Get-SheetBitmap $name
    try {
      # fail-fast 尺寸校验（防素材缺失/变化时静默错位）
      $expectedW = $SRC_TILE * $FRAMES[$name]
      if ($bmp.Width -ne $expectedW -or $bmp.Height -ne $SRC_TILE) {
        throw "$name sheet 尺寸异常: $($bmp.Width)x$($bmp.Height)（期望 ${expectedW}x${SRC_TILE}）"
      }
      # 逐帧裁剪绘制：src 取内容区（四周裁 $CROP），dest 按新 tile 排列
      for ($f = 0; $f -lt $FRAMES[$name]; $f++) {
        $src = [System.Drawing.Rectangle]::new($f * $SRC_TILE + $CROP, $CROP, $TILE, $TILE)
        $dest = [System.Drawing.Rectangle]::new($f * $TILE, $i * $TILE, $TILE, $TILE)
        # 显式 Rectangle + Pixel 单位，防 DPI 元数据缩放伪影
        $g.DrawImage($bmp, $dest, $src, [System.Drawing.GraphicsUnit]::Pixel)
      }
      Write-Host "  ✓ $name ($($FRAMES[$name]) 帧, 裁 $CROP px)"
    }
    finally { $bmp.Dispose() }
  }
}
finally { $g.Dispose() }

# alpha 阈值硬化（阈值 > 0 时启用；当前 0 = 跳过，保留插画风羽化边缘）
if ($ALPHA_THRESHOLD -gt 0) {
  Write-Host "  alpha 阈值硬化 ($ALPHA_THRESHOLD) ..."
  $hardened = 0
  for ($y = 0; $y -lt $H; $y++) {
    for ($x = 0; $x -lt $W; $x++) {
      $c = $target.GetPixel($x, $y)
      if ($c.A -gt 0 -and $c.A -lt 255) {
        $a = if ($c.A -ge $ALPHA_THRESHOLD) { 255 } else { 0 }
        $target.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($a, $c.R, $c.G, $c.B))
        $hardened++
      }
    }
  }
  Write-Host "  硬化像素数: $hardened"
}

# 白色框线清除：素材帧四周存在白色矩形框线（裁剪残留，x6/x118/y6/y120 附近，
# 与熊身间隔透明、完全分离）。清除帧四周 9px 内的白色像素（熊身在框线内不受影响）。
Write-Host "  清除白色框线 ..."
$cleared = 0
for ($row = 0; $row -lt $ANIMS.Count; $row++) {
  $n = $FRAMES[$ANIMS[$row]]
  for ($col = 0; $col -lt $n; $col++) {
    $fx = $col * $TILE
    $fy = $row * $TILE
    for ($y = 0; $y -lt $TILE; $y++) {
      for ($x = 0; $x -lt $TILE; $x++) {
        $inEdge = ($x -lt 9) -or ($x -ge ($TILE - 9)) -or ($y -lt 9) -or ($y -ge ($TILE - 9))
        if (-not $inEdge) { continue }
        $c = $target.GetPixel($fx + $x, $fy + $y)
        if ($c.A -gt 0 -and $c.R -gt 230 -and $c.G -gt 230 -and $c.B -gt 230) {
          $target.SetPixel($fx + $x, $fy + $y, [System.Drawing.Color]::Transparent)
          $cleared++
        }
      }
    }
  }
}
Write-Host "  清除像素数: $cleared"

$pngPath = Join-Path $outDir 'pet.png'
$target.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$target.Dispose()

# 生成 sprites.json
$animations = [ordered]@{}
for ($i = 0; $i -lt $ANIMS.Count; $i++) {
  $name = $ANIMS[$i]
  $frameList = @(0..($FRAMES[$name] - 1))
  $def = [ordered]@{
    row = $i
    frames = $frameList
    frameMs = [math]::Round(1000 / $FPS[$name] * $SLOWDOWN)
    loop = $true
  }
  if ($FOLLOWUP_IDLE -contains $name) {
    $def.loop = $false
    $def.followUp = 'idle'
  } elseif ($STAY_LAST -contains $name) {
    $def.loop = $false
  }
  $animations[$name] = $def
}

$config = [ordered]@{
  sheet = 'pet.png'
  tile = [ordered]@{ w = $TILE; h = $TILE }
  scale = 1.25
  window = [ordered]@{ w = 320; h = 280 }
  animations = $animations
  logicalMap = [ordered]@{
    idle = 'idle'
    working = 'typing'
    waiting = 'thinking'
    celebrate = 'happy'
    sad = 'cry'
  }
}

$jsonPath = Join-Path $outDir 'sprites.json'
# 无 BOM 写入（JSON 严格规范不允许 BOM，Node JSON.parse 会失败）
$json = $config | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText($jsonPath, $json, [System.Text.UTF8Encoding]::new($false))

Write-Host ""
Write-Host "✔ bear-original 生成完成:"
Write-Host "  $pngPath ($W x $H)"
Write-Host "  $jsonPath ($($ANIMS.Count) 个动画)"
