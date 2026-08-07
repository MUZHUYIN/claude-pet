/**
 * 内部洞填充后处理：解码 pet.png → 每帧 flood fill 标记外部透明 →
 * 内部透明洞用 4 邻域不透明色填充 → 编码写回。
 * 目的：硬化把淡阴影/渐变变透明形成"内部洞"，洞透出桌面 = 水渍灰。
 */
import { deflateSync, inflateSync } from 'node:zlib'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PET = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'pet-assets', 'characters', 'bear-original', 'pet.png')
const T = 104 // tile 尺寸（与合并脚本一致）

// ---------- PNG 解码（含滤波还原） ----------
function decodePNG(file) {
  const buf = readFileSync(file)
  let off = 8, w = 0, h = 0, idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    if (type === 'IHDR') { w = buf.readUInt32BE(off + 8); h = buf.readUInt32BE(off + 12) }
    if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len))
    off += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = w * 4
  const px = new Uint8Array(w * h * 4)
  const prev = new Uint8Array(stride)
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
  }
  for (let y = 0; y < h; y++) {
    const row = y * (stride + 1)
    const f = raw[row]
    const cur = new Uint8Array(stride)
    for (let x = 0; x < stride; x++) {
      const v = raw[row + 1 + x]
      const a = x >= 4 ? cur[x - 4] : 0
      const b = prev[x]
      const c = x >= 4 ? prev[x - 4] : 0
      cur[x] = (f === 1 ? v + a : f === 2 ? v + b : f === 3 ? v + ((a + b) >> 1) : f === 4 ? v + paeth(a, b, c) : v) & 0xff
    }
    px.set(cur, y * stride)
    prev.set(cur)
  }
  return { w, h, px }
}

// ---------- PNG 编码（filter 0 + deflate） ----------
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
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}
function encodePNG(width, height, px) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    Buffer.from(px.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))])
}

// ---------- 填洞 ----------
const { w, h, px } = decodePNG(PET)
const COLS = w / T
const ROWS = h / T
let totalFilled = 0

for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    const fx = col * T
    const fy = row * T
    const isOpaque = (x, y) => px[((fy + y) * w + (fx + x)) * 4 + 3] > 0

    // BFS 标记外部透明（4 连通）
    const visited = new Uint8Array(T * T)
    const queue = []
    const seed = (x, y) => {
      if (!isOpaque(x, y) && !visited[y * T + x]) {
        visited[y * T + x] = 1
        queue.push(x, y)
      }
    }
    for (let x = 0; x < T; x++) { seed(x, 0); seed(x, T - 1) }
    for (let y = 0; y < T; y++) { seed(0, y); seed(T - 1, y) }
    for (let qi = 0; qi < queue.length; qi += 2) {
      const x = queue[qi]
      const y = queue[qi + 1]
      if (x > 0) seed(x - 1, y)
      if (x < T - 1) seed(x + 1, y)
      if (y > 0) seed(x, y - 1)
      if (y < T - 1) seed(x, y + 1)
    }

    // 填充内部洞（4 邻域取不透明色）
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        if (isOpaque(x, y) || visited[y * T + x]) continue
        let fill = null
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= T || ny >= T) continue
          if (isOpaque(nx, ny)) {
            const i = ((fy + ny) * w + (fx + nx)) * 4
            fill = [px[i], px[i + 1], px[i + 2], px[i + 3]]
            break
          }
        }
        if (!fill) continue
        const di = ((fy + y) * w + (fx + x)) * 4
        px[di] = fill[0]
        px[di + 1] = fill[1]
        px[di + 2] = fill[2]
        px[di + 3] = fill[3]
        totalFilled++
      }
    }
  }
}

writeFileSync(PET, encodePNG(w, h, px))
console.log(`填洞完成: ${totalFilled} 像素 → ${PET}`)
