import { PetSprite } from './pet'
import { Bubble } from './bubble'
import { setupDrag } from './drag'
import type { HitTestResult, PetState } from '../shared/types'

/**
 * 渲染进程入口：Canvas 动画循环 + 状态订阅 + 拖拽 + 穿透 hit-test。
 */

const WINDOW_W = 320
const WINDOW_H = 220
const PET_SCALE = 3 // 与 sprites.json 的 scale 一致
const PET_W = 32 * PET_SCALE
const PET_H = 32 * PET_SCALE
// 宠物脚踩底边、水平居中；上方留给气泡
const PET_X = (WINDOW_W - PET_W) / 2
const PET_Y = WINDOW_H - PET_H

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

  const dpr = window.devicePixelRatio || 1
  canvas.width = WINDOW_W * dpr
  canvas.height = WINDOW_H * dpr
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0) // CSS 像素坐标系

  console.log('[pet:renderer] boot: loading sprites')
  const pet = await PetSprite.load()
  console.log(`[pet:renderer] sprites loaded, anim=${pet.animName}`)
  const bubble = new Bubble(document.body)

  let animating = true

  window.pet.onEvent((evt) => {
    switch (evt.type) {
      case 'state': {
        const s = evt.payload as { state: PetState }
        pet.setLogicalState(s.state)
        animating = s.state !== 'hidden'
        break
      }
      case 'bubble': {
        const b = evt.payload as { text: string; kind: 'info' | 'success' | 'error'; ttlMs?: number }
        console.log(`[pet:renderer] bubble received: ${b.kind} ${b.text.slice(0, 20)}`)
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

  setupDrag(canvas, () => pet.play('jump'))

  const frame = (nowMs: number): void => {
    if (animating) {
      // 每帧强制坐标系：canvas 变换状态可能在窗口被系统改动时丢失，
      // 导致绘制与 hit-test 坐标系不一致（宠物点不到）
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, WINDOW_W, WINDOW_H)
      pet.draw(ctx, nowMs, PET_X, PET_Y, PET_W, PET_H)
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

boot().catch((err) => console.error('[pet:renderer] boot failed', err))
