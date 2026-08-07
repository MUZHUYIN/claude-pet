import type { AnimationDef, SpriteSheetDef } from '../shared/types'

/**
 * 精灵表加载与帧动画渲染。
 * sprites.json 行=动画状态、列=帧（对齐 codexpet 社区规范），
 * 未来 Aseprite 产物直接替换资产文件即可，本模块零改动。
 */

export class PetSprite {
  private img: HTMLImageElement
  private currentAnim = 'idle'
  private animStartMs = 0
  /** 每帧绘制偏移（水平居中 + 底部对齐，消除素材帧间大小/位置跳变；sleep 趴下动画除外） */
  private frameOffsets: Map<string, { dx: number; dy: number }[]> = new Map()

  private constructor(private def: SpriteSheetDef, img: HTMLImageElement) {
    this.img = img
    this.frameOffsets = computeFrameOffsets(img, def)
  }

  static async load(): Promise<PetSprite> {
    const def = JSON.parse(await window.pet.readText('sprites.json')) as SpriteSheetDef
    const img = new Image()
    // data URL 加载：http 页面（dev）不能加载 file:// 资源，data URL 跨 dev/prod 均可靠
    const mime = def.sheet.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/png'
    const b64 = await window.pet.readBase64(def.sheet)
    console.log(`[pet:renderer] sheet base64: len=${b64.length} head=${b64.slice(0, 24)}`)
    img.src = `data:${mime};base64,${b64}`
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error(`精灵表加载失败: ${def.sheet} (mime=${mime}, b64len=${b64.length})`))
    })
    // 显式等待位图解码完成：大图（1024×1280）data URL 的 onload 只保证资源加载，
    // 解码在后台线程异步进行，解码完成前 drawImage 会静默跳过（画不出）
    await img.decode().catch(() => {})
    console.log(
      `[pet:renderer] img decoded: ${img.naturalWidth}x${img.naturalHeight} complete=${img.complete}`
    )
    return new PetSprite(def, img)
  }

  /** 当前精灵动画名 */
  get animName(): string {
    return this.currentAnim
  }

  /** 精灵表定义（tile/scale/animations，供渲染层推导尺寸与行为层守卫） */
  get definition(): SpriteSheetDef {
    return this.def
  }

  /** 是否定义了某动画（行为层降级守卫：缺失时跳过增强，保持旧行为） */
  hasAnimation(name: string): boolean {
    return !!this.def.animations[name]
  }

  /** 切换到某逻辑状态对应的动画（逻辑状态经 logicalMap 解耦） */
  setLogicalState(logical: string): void {
    const name = this.def.logicalMap[logical] ?? 'idle'
    if (name === this.currentAnim) return
    this.currentAnim = name
    this.animStartMs = performance.now()
  }

  /** 直接播放指定动画（如"戳一下"→jump），不映射 */
  play(name: string): void {
    if (name === this.currentAnim && this.def.animations[name]?.loop) return
    this.currentAnim = name
    this.animStartMs = performance.now()
  }

  /** 当前帧索引（main.ts 判断"帧变化才重绘"用） */
  currentFrameIndex(nowMs: number): number {
    const anim = this.def.animations[this.currentAnim] ?? this.def.animations['idle']
    if (!anim) return 0
    let idx = Math.floor((nowMs - this.animStartMs) / anim.frameMs)
    if (anim.loop) idx = idx % anim.frames.length
    else idx = Math.min(idx, anim.frames.length - 1)
    return anim.frames[idx] ?? 0
  }

  /** 每帧调用：推进非循环动画的 followUp 切换（无 followUp 的停在末帧，如 happy/cry 完成态） */
  update(nowMs: number): void {
    const anim = this.def.animations[this.currentAnim]
    if (!anim) return
    if (anim.loop) return
    const total = anim.frames.length * anim.frameMs
    if (nowMs - this.animStartMs >= total && anim.followUp) {
      this.currentAnim = anim.followUp
      this.animStartMs = nowMs
    }
  }

  /** 以脚底为锚点绘制到 canvas（含 idle 呼吸缩放） */
  draw(ctx: CanvasRenderingContext2D, nowMs: number, dx: number, dy: number, targetW: number, targetH: number): void {
    const anim = this.def.animations[this.currentAnim] ?? this.def.animations['idle']
    if (!anim) return

    const { w: tw, h: th } = this.def.tile
    const elapsed = nowMs - this.animStartMs
    // 非循环动画播完停在末帧（happy/cry 完成态静态展示；有 followUp 的由 update 切换）
    let idx = Math.floor(elapsed / anim.frameMs)
    if (anim.loop) idx = idx % anim.frames.length
    else idx = Math.min(idx, anim.frames.length - 1)
    const frame = anim.frames[idx] ?? 0
    const sx = frame * tw
    const sy = anim.row * th

    // 不再叠加代码呼吸缩放：素材 idle 动画自带呼吸，叠加会造成"时大时小"
    // 帧对齐：水平居中 + 底部对齐（消除素材帧间大小/位置跳变）
    const off = this.frameOffsets.get(this.currentAnim)?.[frame]
    const w = tw * this.def.scale
    const h = th * this.def.scale
    const cx = dx + w / 2 + (off?.dx ?? 0) * this.def.scale
    const anchorY = dy + h + (off?.dy ?? 0) * this.def.scale
    ctx.save()
    ctx.translate(cx, anchorY)
    ctx.translate(-w / 2, -h)
    ctx.drawImage(this.img, sx, sy, tw, th, 0, 0, w, h)
    ctx.restore()

    // 供 hit-test 记录本次绘制区域（保存以校验像素命中在绘制区外时快速排除）
    this.lastDrawRect = { x: dx, y: dy, w, h }
  }

  lastDrawRect = { x: 0, y: 0, w: 0, h: 0 }

  /** 当前帧动画定义（供外部查询，如等待时长） */
  currentAnimDef(): AnimationDef | undefined {
    return this.def.animations[this.currentAnim]
  }
}

/**
 * 预计算每个动画每帧的内容边界框偏移：
 *   水平 → tile 中心；底部 → tile 底边（脚贴地，视觉不跳动）。
 * sleep 趴下动画跳过底部对齐（保持趴下的自然形态）。
 */
function computeFrameOffsets(img: HTMLImageElement, def: SpriteSheetDef): Map<string, { dx: number; dy: number }[]> {
  const map = new Map<string, { dx: number; dy: number }[]>()
  const { w: tw, h: th } = def.tile
  const probe = document.createElement('canvas')
  probe.width = img.naturalWidth
  probe.height = img.naturalHeight
  const pctx = probe.getContext('2d', { willReadFrequently: true })
  if (!pctx) return map
  pctx.drawImage(img, 0, 0)
  const data = pctx.getImageData(0, 0, probe.width, probe.height).data

  for (const [name, anim] of Object.entries(def.animations)) {
    const offsets: { dx: number; dy: number }[] = []
    for (const frame of anim.frames) {
      let minX = tw
      let maxX = 0
      let minY = th
      let maxY = 0
      const sx = frame * tw
      const sy = anim.row * th
      for (let y = 0; y < th; y++) {
        for (let x = 0; x < tw; x++) {
          const a = data[((sy + y) * probe.width + (sx + x)) * 4 + 3]
          if (a === 0) continue
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
      if (maxX === 0) {
        offsets.push({ dx: 0, dy: 0 })
        continue
      }
      offsets.push({
        dx: Math.round(tw / 2 - (minX + maxX) / 2),
        dy: name === 'sleep' ? 0 : th - maxY
      })
    }
    map.set(name, offsets)
  }
  return map
}
