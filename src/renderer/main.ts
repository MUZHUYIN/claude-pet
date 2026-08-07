import { PetSprite } from './pet'
import { Bubble } from './bubble'
import { setupDrag } from './drag'
import { PetBehaviors } from './behaviors'
import type { HitTestResult, PetState } from '../shared/types'

/**
 * 渲染进程入口：Canvas 动画循环 + 状态订阅 + 拖拽 + 穿透 hit-test。
 * 尺寸全部从精灵表定义（tile × scale）与窗口实际尺寸推导，支持不同帧尺寸的形象。
 */

function hitTest(canvas: HTMLCanvasElement, bubble: Bubble, x: number, y: number): boolean {
  if (bubble.hit(x, y)) return true
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  // 窗口 CSS 坐标 → 画布物理坐标：先减去 canvas 在窗口内的实际位置（rect），再乘 dpr。
  // 窗口尺寸被系统改动时 canvas 仍贴 (0,0)（见 CSS），但保留 rect 换算做防御。
  const rect = canvas.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const px = Math.round((x - rect.left) * dpr)
  const py = Math.round((y - rect.top) * dpr)
  // 越界保护：canvas 外一律穿透
  if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return false
  try {
    // 本地 data URL 图源不会污染 canvas
    const d = ctx.getImageData(px, py, 1, 1).data
    return d[3] > 0
  } catch {
    return false
  }
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('pet-canvas') as HTMLCanvasElement
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  console.log('[pet:renderer] boot: loading sprites')
  const pet = await PetSprite.load()
  console.log(`[pet:renderer] sprites loaded, anim=${pet.animName}`)

  // 尺寸推导：宠物 = tile × scale（如 128×1.25=160px），窗口由主进程按形象开好
  const def = pet.definition
  const petW = def.tile.w * def.scale
  const petH = def.tile.h * def.scale
  const winW = window.innerWidth
  const winH = window.innerHeight
  const PET_X = (winW - petW) / 2 // 水平居中
  // 底部留 18px 边距：内容不贴窗口/视口底边（贴边时 DWM 边缘合成触发白框伪影）
  const PET_Y = winH - petH - 18
  const bubble = new Bubble(document.body, petH + 12 + 18) // 气泡悬于头顶（含底部边距）
  const behaviors = new PetBehaviors(pet)

  const dpr = window.devicePixelRatio || 1
  canvas.width = winW * dpr
  canvas.height = winH * dpr

  let animating = true

  window.pet.onEvent((evt) => {
    switch (evt.type) {
      case 'state': {
        const s = evt.payload as { state: PetState }
        behaviors.onState(s.state)
        animating = s.state !== 'hidden'
        break
      }
      case 'bubble': {
        const b = evt.payload as { text: string; kind: 'info' | 'success' | 'error'; ttlMs?: number }
        bubble.show(b.text, b.kind, b.ttlMs)
        break
      }
      case 'hitTestRequest': {
        const r = evt.payload as { id: number; x: number; y: number }
        const hit = hitTest(canvas, bubble, r.x, r.y)
        const result: HitTestResult = { id: r.id, x: r.x, y: r.y, hit }
        if (!hit) {
          // 诊断：命中失败时带上 canvas 布局状态
          const rect = canvas.getBoundingClientRect()
          result.canvas = { w: canvas.width, h: canvas.height, left: rect.left, top: rect.top }
        }
        window.pet.hitTestResult(result)
        break
      }
      case 'clearBubble': {
        bubble.clear()
        break
      }
    }
  })

  setupDrag(
    canvas,
    () => behaviors.onDragStart(),
    () => behaviors.onDragEnd(),
    () => behaviors.onPoke()
  )

  // 全量重绘：layered window 的"局部区域更新"会触发 DWM 全窗重合成并闪现窗口轮廓
  //（白框伪影）——v3 时代全量重绘无白框，帧缓存局部重绘反而引入；恢复全量
  const frame = (nowMs: number): void => {
    if (animating) {
      // 每帧强制坐标系：canvas 变换状态可能在窗口被系统改动时丢失，
      // 导致绘制与 hit-test 坐标系不一致（宠物点不到）
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, winW, winH)
      pet.update(nowMs) // 推进非循环动画的 followUp 回切（blink/jump 播完回 idle）
      pet.draw(ctx, nowMs, PET_X, PET_Y, petW, petH)
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

boot().catch((err) => console.error('[pet:renderer] boot failed', err))
