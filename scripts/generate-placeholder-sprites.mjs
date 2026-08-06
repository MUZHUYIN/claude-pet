/**
 * 生成桌宠精灵表 resources/pet-assets/pet.png + sprites.json。
 * 零依赖：手写最小 PNG 编码器（node:zlib），程序化绘制。
 *
 * 角色：自嘲熊风像素熊（32×32）——圆润头身一体、米白配色、慵懒眯眼。
 * 9 行（动画状态）× 6 列（帧），行序对齐 codexpet 社区规范。
 * 当前逻辑状态用到 6 个动画：idle / working / wait / wave / fail / jump
 * （左右跑与 pending 行保留占位帧，后续需要时再补）。
 *
 * 之后用 Aseprite 管线产出正式精灵表时，直接替换 pet.png 并更新 sprites.json 即可，
 * 渲染层零改动。
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 形象名（npm run gen:sprites -- <name>），输出到 resources/pet-assets/characters/<name>/
const CHARACTER = process.argv[2] || 'bear-v3'

const TILE = 32
const COLS = 6
const ROWS = 9
const W = TILE * COLS // 192
const H = TILE * ROWS // 288

// ---------- 形象布局参数（同一套绘制函数，不同形象不同比例/五官位置） ----------
const LAYOUTS = {
  // v2：椭圆身、五官偏上（已验收"还行"的白熊）
  'bear-v2': {
    bodyCx: 16, bodyCy: 17, bodyRx: 12, bodyRy: 11,
    ear: { x: 10, y: 6, rx: 3, ry: 2.6 }, ear2: { x: 22, y: 6 },
    eyeY: 15, eyeGap: 7, noseY: 18, mouthY: 20, legY: 28, shadowY: 25
  },
  // v3：正圆球身、小嘴、五官位置高（脸 1/3 处，避免"俯视/低头"感）
  // 鼻子用 2x2 方块点（与嘴的横线区分，避免"=号"感），嘴与鼻间距拉开
  'bear-v3': {
    bodyCx: 16, bodyCy: 16, bodyRx: 12, bodyRy: 12,
    ear: { x: 10, y: 5, rx: 2.6, ry: 2.4 }, ear2: { x: 22, y: 5 },
    eyeY: 14, eyeGap: 8, noseY: 18, mouthY: 22, legY: 28, shadowY: 24
  }
}
const L = LAYOUTS[CHARACTER] || LAYOUTS['bear-v2']

// ---------- 颜色（自嘲熊真实特征：纯白主体 + 黑色粗描边线条画，无腮红） ----------
const C = {
  outline: [26, 26, 26, 255], // 纯黑描边 #1A1A1A
  body: [250, 248, 244, 255], // 纯白主体 #FAF8F4（极浅暖白防纯白刺眼）
  shadow: [235, 232, 226, 255], // 白影（耳内/底部，极浅灰白）
  dark: [26, 26, 26, 255], // 眼/嘴/鼻纯黑
  tear: [150, 200, 255, 255], // 泪滴浅蓝
  sweat: [170, 215, 255, 255], // 汗滴浅蓝
  clear: [0, 0, 0, 0]
}

// ---------- 迷你绘图 DSL（32x32 网格） ----------
const grid = Array.from({ length: TILE }, () => new Array(TILE).fill(null))

function px(x, y, color) {
  // 浮点坐标取整：奇数间距参数（如 eyeGap=7 → g/2=3.5）会产生半像素坐标，
  // 直接写入 grid[y][12.5] 会落到非整数下标，整数读取时丢失（眼睛消失 bug）
  const xi = Math.round(x)
  const yi = Math.round(y)
  if (xi >= 0 && yi >= 0 && xi < TILE && yi < TILE) grid[yi][xi] = color
}

function rect(x0, y0, x1, y1, color) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px(x, y, color)
}

/** 椭圆填充（含描边：先填外椭圆描边色，再填内椭圆主体色） */
function ellipse(cx, cy, rx, ry, color) {
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const nx = (x - cx) / rx
      const ny = (y - cy) / ry
      if (nx * nx + ny * ny <= 1) px(x, y, color)
    }
  }
}

// ---------- 熊形绘制（布局参数来自 LAYOUTS） ----------
function drawBody(dx = 0, dy = 0) {
  ellipse(L.bodyCx + dx, L.bodyCy + dy, L.bodyRx, L.bodyRy, C.outline)
  ellipse(L.bodyCx + dx, L.bodyCy + dy, L.bodyRx - 1, L.bodyRy - 1, C.body)
  // 底部阴影（身体内下缘 1px）
  rect(8 + dx, L.shadowY + dy, 23 + dx, L.shadowY + dy, C.shadow)
  // 耳朵（小圆，头顶两侧）
  ellipse(L.ear.x + dx, L.ear.y + dy, L.ear.rx, L.ear.ry, C.outline)
  ellipse(L.ear.x + dx, L.ear.y + dy, L.ear.rx - 0.8, L.ear.ry - 0.8, C.body)
  ellipse(L.ear2.x + dx, L.ear2.y + dy, L.ear.rx, L.ear.ry, C.outline)
  ellipse(L.ear2.x + dx, L.ear2.y + dy, L.ear.rx - 0.8, L.ear.ry - 0.8, C.body)
  // 腿（短小，脚踩 tile 底边）
  rect(11 + dx, L.legY + dy, 14 + dx, L.legY + 2 + dy, C.outline)
  rect(12 + dx, L.legY + 1 + dy, 13 + dx, L.legY + 2 + dy, C.body)
  rect(17 + dx, L.legY + dy, 20 + dx, L.legY + 2 + dy, C.outline)
  rect(18 + dx, L.legY + 1 + dy, 19 + dx, L.legY + 2 + dy, C.body)
}

/** 手：'none' | 'side'(两侧垂下) | 'wave'(右举) | 'waveLow' | 'chin' */
function drawArms(dx = 0, dy = 0, state = 'side') {
  if (state === 'wave') {
    rect(27 + dx, 11 + dy, 28 + dx, 16 + dy, C.outline) // 右手高举（外移 1px 防贴边）
    rect(27 + dx, 12 + dy, 28 + dx, 13 + dy, C.body)
  } else if (state === 'waveLow') {
    rect(27 + dx, 14 + dy, 28 + dx, 19 + dy, C.outline)
    rect(27 + dx, 15 + dy, 28 + dx, 16 + dy, C.body)
  } else if (state === 'chin') {
    rect(24 + dx, 16 + dy, 25 + dx, 19 + dy, C.outline)
    rect(24 + dx, 17 + dy, 25 + dx, 18 + dy, C.body)
  } else {
    // 手臂加宽并跨身体边缘（外露 1px + 内 1px），避免贴边后视觉上"消失"
    rect(3 + dx, 19 + dy, 5 + dx, 22 + dy, C.outline)
    rect(4 + dx, 20 + dy, 4 + dx, 21 + dy, C.body)
    rect(28 + dx, 19 + dy, 30 + dx, 22 + dy, C.outline)
    rect(29 + dx, 20 + dy, 29 + dx, 21 + dy, C.body)
  }
}

/**
 * 眼睛（参考图特征：小黑圆点眼，无眼白）：
 *   'dot'(小黑圆点 2x2，默认) | 'big'(放大圆点 3x3，wait 盯人) | 'line'(闭眼弧线) | 'sad'(泪眼)
 */
function drawEyes(dx = 0, dy = 0, state = 'dot') {
  const ey = L.eyeY
  const g = L.eyeGap // 双眼中心间距
  if (state === 'line') {
    // 闭眼：两端上翘的弧线（简笔画闭眼风格）
    px(16 - g / 2 - 2 + dx, ey + dy, C.dark)
    px(16 - g / 2 - 1 + dx, ey - 1 + dy, C.dark)
    px(16 - g / 2 + dx, ey - 1 + dy, C.dark)
    px(16 - g / 2 + 1 + dx, ey + dy, C.dark)
    px(16 + g / 2 - 2 + dx, ey + dy, C.dark)
    px(16 + g / 2 - 1 + dx, ey - 1 + dy, C.dark)
    px(16 + g / 2 + dx, ey - 1 + dy, C.dark)
    px(16 + g / 2 + 1 + dx, ey + dy, C.dark)
  } else if (state === 'big') {
    rect(16 - g / 2 - 1 + dx, ey + dy, 16 - g / 2 + 1 + dx, ey + 2 + dy, C.dark)
    rect(16 + g / 2 - 1 + dx, ey + dy, 16 + g / 2 + 1 + dx, ey + 2 + dy, C.dark)
  } else if (state === 'sad') {
    rect(16 - g / 2 - 1 + dx, ey + dy, 16 - g / 2 + dx, ey + 2 + dy, C.dark)
    rect(16 + g / 2 - 1 + dx, ey + dy, 16 + g / 2 + dx, ey + 2 + dy, C.dark)
  } else {
    rect(16 - g / 2 + dx, ey + dy, 16 - g / 2 + 1 + dx, ey + 1 + dy, C.dark) // 小黑圆点 2x2
    rect(16 + g / 2 - 1 + dx, ey + dy, 16 + g / 2 + dx, ey + 1 + dy, C.dark)
  }
}

/** 鼻子：2x1 短横线（中心 15.5 与嘴/眼完全对齐；与嘴拉开间距避免"=号"感） */
function drawNose(dx = 0, dy = 0) {
  rect(15 + dx, L.noseY + dy, 16 + dx, L.noseY + dy, C.dark)
}

/** 嘴：'flat'(平静短横) | 'smile'(弧形微笑线，参考图特征) | 'open'(微开) | 'frown'(下弯) */
function drawMouth(dx = 0, dy = 0, state = 'flat') {
  const my = L.mouthY
  const small = CHARACTER === 'bear-v3' // v3：嘴更小更平（短横线，贴下巴）
  if (state === 'smile') {
    if (small) {
      px(15 + dx, my + dy, C.dark)
      px(16 + dx, my + dy, C.dark)
    } else {
      px(14 + dx, my + 1 + dy, C.dark)
      px(15 + dx, my + dy, C.dark)
      px(16 + dx, my + dy, C.dark)
      px(17 + dx, my + 1 + dy, C.dark)
    }
  } else if (state === 'open') {
    rect(15 + dx, my + dy, 16 + dx, my + 1 + dy, C.dark)
  } else if (state === 'frown') {
    px(14 + dx, my + dy, C.dark)
    px(15 + dx, my + 1 + dy, C.dark)
    px(16 + dx, my + 1 + dy, C.dark)
    px(17 + dx, my + dy, C.dark)
  } else {
    px(15 + dx, my + dy, C.dark)
    px(16 + dx, my + dy, C.dark)
  }
}

/** 附加物：'none' | 'sweat'(汗滴, 4 位置旋转) | 'tear'(泪) */
function drawExtra(dx = 0, dy = 0, kind = 'none', pos = 0) {
  if (kind === 'sweat') {
    // 加大汗滴（3x4）增强可辨识度，绕头顶旋转
    const sx = [26, 27, 26, 25][pos]
    const sy = [7, 8, 9, 8][pos]
    rect(sx + dx, sy + dy, sx + 2 + dx, sy + 3 + dy, C.sweat)
    px(sx + 1 + dx, sy - 1 + dy, C.sweat)
  } else if (kind === 'tear') {
    rect(9 + dx, 19 + dy, 10 + dx, 22 + dy, C.tear)
    px(10 + dx, 23 + dy, C.tear)
  }
}

/** 腿：'stand' | 'squat'(下蹲短腿) | 'tuck'(腾空收腿) */
function drawLegs(dx = 0, dy = 0, state = 'stand') {
  if (state === 'squat') {
    rect(11 + dx, 29 + dy, 14 + dx, 30 + dy, C.outline)
    rect(12 + dx, 29 + dy, 13 + dx, 30 + dy, C.body)
    rect(17 + dx, 29 + dy, 20 + dx, 30 + dy, C.outline)
    rect(18 + dx, 29 + dy, 19 + dx, 30 + dy, C.body)
  } else if (state === 'tuck') {
    rect(12 + dx, 27 + dy, 15 + dx, 28 + dy, C.outline)
    rect(13 + dx, 27 + dy, 14 + dx, 28 + dy, C.body)
    rect(16 + dx, 27 + dy, 19 + dx, 28 + dy, C.outline)
    rect(17 + dx, 27 + dy, 18 + dx, 28 + dy, C.body)
  } else {
    rect(11 + dx, 28 + dy, 14 + dx, 30 + dy, C.outline)
    rect(12 + dx, 29 + dy, 13 + dx, 30 + dy, C.body)
    rect(17 + dx, 28 + dy, 20 + dx, 30 + dy, C.outline)
    rect(18 + dx, 29 + dy, 19 + dx, 30 + dy, C.body)
  }
}

// ---------- 每个 (row, col) 的姿势 ----------
// 返回 { dx, dy, eyes, mouth, legs, arms, extra, pos }
function poseAt(row, col) {
  const base = { dx: 0, dy: 0, eyes: 'dot', mouth: 'smile', legs: 'stand', arms: 'side', extra: 'none', pos: 0 }
  switch (row) {
    case 0: // idle：呼吸（1px 起伏）+ 周期眨眼
      return [
        { ...base },
        { ...base, dy: 1 },
        { ...base, eyes: 'line' },
        { ...base, dy: 1 },
        { ...base },
        { ...base, dy: 1 }
      ][col]
    case 1: // left-run（占位：左右摇动）
      return [
        { ...base, dx: -1 },
        { ...base, dx: -1, dy: 1 },
        { ...base },
        { ...base, dx: 1, dy: 1 },
        { ...base },
        { ...base, dx: -1 }
      ][col]
    case 2: // right-run（占位：镜像）
      return [
        { ...base, dx: 1 },
        { ...base, dx: 1, dy: 1 },
        { ...base },
        { ...base, dx: -1, dy: 1 },
        { ...base },
        { ...base, dx: 1 }
      ][col]
    case 3: // jump：下蹲 → 腾空（收腿上移）→ 落地 → 站立
      return [
        { ...base, dy: 1, legs: 'squat', eyes: 'line' },
        { ...base, dy: -3, legs: 'tuck', mouth: 'open' },
        { ...base, dy: -4, legs: 'tuck', mouth: 'open' },
        { ...base, dy: -2, legs: 'tuck' },
        { ...base, legs: 'stand' },
        { ...base }
      ][col]
    case 4: // wave：慵懒眯眼 + 右手举起挥动
      return [
        { ...base, arms: 'wave', mouth: 'smile' },
        { ...base, arms: 'wave', dy: -1, mouth: 'smile' },
        { ...base, arms: 'waveLow', mouth: 'smile' },
        { ...base, arms: 'waveLow', dy: 1, mouth: 'smile' },
        { ...base, arms: 'side' },
        { ...base }
      ][col]
    case 5: // fail：泪眼 + 嘴角下弯 + 泪滴
      return [
        { ...base, eyes: 'sad', mouth: 'frown', extra: 'tear' },
        { ...base, eyes: 'sad', mouth: 'frown', extra: 'tear', dx: 1 },
        { ...base, eyes: 'sad', mouth: 'frown', extra: 'tear' },
        { ...base, eyes: 'sad', mouth: 'frown' },
        { ...base, eyes: 'sad', mouth: 'frown', dy: 1 },
        { ...base, eyes: 'sad', mouth: 'frown' }
      ][col]
    case 6: // wait：放大圆眼盯视 + 偶尔眨眼
      return [
        { ...base, eyes: 'big', mouth: 'flat' },
        { ...base, eyes: 'big', mouth: 'flat', dy: 1 },
        { ...base, eyes: 'line', mouth: 'flat' },
        { ...base, eyes: 'big', mouth: 'flat' },
        { ...base, eyes: 'big', mouth: 'flat', dy: 1 },
        { ...base, eyes: 'line', mouth: 'flat' }
      ][col]
    case 7: // working：慵懒眼 + 汗滴旋转 + 身体微抖
      return [
        { ...base, extra: 'sweat', pos: 0, dx: -1, mouth: 'flat' },
        { ...base, extra: 'sweat', pos: 1, dx: 1, mouth: 'flat' },
        { ...base, extra: 'sweat', pos: 2, dx: -1, mouth: 'flat' },
        { ...base, extra: 'sweat', pos: 3, dx: 1, mouth: 'flat' },
        { ...base, extra: 'sweat', pos: 0, dx: 0, mouth: 'flat' },
        { ...base, extra: 'sweat', pos: 1, dx: 0, mouth: 'flat' }
      ][col]
    case 8: // pending（占位：托腮思考）
      return [
        { ...base, arms: 'chin', eyes: 'line' },
        { ...base, arms: 'chin', dy: 1 },
        { ...base, arms: 'chin', eyes: 'line' },
        { ...base, arms: 'chin', dy: 1 },
        { ...base, arms: 'chin', eyes: 'line' },
        { ...base, arms: 'chin', eyes: 'big' }
      ][col]
    default:
      return base
  }
}

// ---------- 渲染 ----------
const pixels = new Uint8Array(W * H * 4) // 初始全透明

function clearGrid() {
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) grid[y][x] = null
}

for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    clearGrid()
    const pose = poseAt(row, col)
    drawBody(pose.dx, pose.dy)
    drawArms(pose.dx, pose.dy, pose.arms)
    drawLegs(pose.dx, pose.dy, pose.legs)
    drawEyes(pose.dx, pose.dy, pose.eyes)
    drawNose(pose.dx, pose.dy)
    drawMouth(pose.dx, pose.dy, pose.mouth)
    drawExtra(pose.dx, pose.dy, pose.extra, pose.pos)

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const c = grid[y][x]
        if (!c) continue
        const di = ((row * TILE + y) * W + col * TILE + x) * 4
        pixels[di] = c[0]
        pixels[di + 1] = c[1]
        pixels[di + 2] = c[2]
        pixels[di + 3] = c[3]
      }
    }
  }
}

// ---------- 最小 PNG 编码器 ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0) // len
  out.write(type, 4, 'ascii') // type
  data.copy(out, 8) // data 紧跟 type（len 4 + type 4 = 8）
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length) // crc 覆盖 type+data
  return out
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))])
}

// ---------- 写出（characters/<name>/ 目录） ----------
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'pet-assets', 'characters', CHARACTER)
mkdirSync(outDir, { recursive: true })

const png = encodePNG(W, H, pixels)
writeFileSync(join(outDir, 'pet.png'), png)

const sprites = {
  sheet: 'pet.png',
  tile: { w: TILE, h: TILE },
  scale: 3,
  animations: {
    idle: { row: 0, frames: [0, 1, 2, 1], frameMs: 400, loop: true },
    'left-run': { row: 1, frames: [0, 1, 2, 3, 4, 5], frameMs: 120, loop: true },
    'right-run': { row: 2, frames: [0, 1, 2, 3, 4, 5], frameMs: 120, loop: true },
    jump: { row: 3, frames: [0, 1, 2, 3, 4], frameMs: 110, loop: false, followUp: 'idle' },
    // wave/fail 循环播放：celebrate/sad 状态由状态机控制时长（无限保持），
    // 非循环会导致画面很快回到 idle 脸；wave 只循环挥手的 3 帧（帧 3 是手放下）
    wave: { row: 4, frames: [0, 1, 2], frameMs: 240, loop: true },
    fail: { row: 5, frames: [0, 1, 2, 3], frameMs: 280, loop: true },
    wait: { row: 6, frames: [0, 1, 2, 3], frameMs: 650, loop: true },
    working: { row: 7, frames: [0, 1, 2, 3, 4, 5], frameMs: 130, loop: true },
    pending: { row: 8, frames: [0, 1, 2, 3], frameMs: 500, loop: true }
  },
  logicalMap: {
    idle: 'idle',
    working: 'working',
    waiting: 'wait',
    celebrate: 'wave',
    sad: 'fail'
  }
}
writeFileSync(join(outDir, 'sprites.json'), JSON.stringify(sprites, null, 2) + '\n')

console.log(`生成完成: ${join(outDir, 'pet.png')} (${W}x${H}, ${png.length} bytes)`)
console.log(`生成完成: ${join(outDir, 'sprites.json')}`)
