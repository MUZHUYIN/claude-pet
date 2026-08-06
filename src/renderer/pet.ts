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

  private constructor(private def: SpriteSheetDef, img: HTMLImageElement) {
    this.img = img
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
    return new PetSprite(def, img)
  }

  /** 当前精灵动画名 */
  get animName(): string {
    return this.currentAnim
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

  /** 每帧调用：推进非循环动画的 followUp 切换 */
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
    const idx = Math.floor(elapsed / anim.frameMs) % anim.frames.length
    const frame = anim.frames[idx] ?? 0
    const sx = frame * tw
    const sy = anim.row * th

    // idle 呼吸：以脚底为锚点的微小缩放
    let scale = 1
    if (this.currentAnim === 'idle') {
      scale = 1 + 0.02 * Math.sin((2 * Math.PI * nowMs) / 2000)
    }

    const w = tw * this.def.scale
    const h = th * this.def.scale
    const cx = dx + w / 2
    ctx.save()
    ctx.translate(cx, dy + h)
    ctx.scale(scale, scale)
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
