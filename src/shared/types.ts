/**
 * 主进程与渲染进程共享的类型定义。
 * 注意：此文件会被 main/preload（Node 侧）与 renderer（浏览器侧）同时引用，
 * 只能包含纯类型与常量，不能 import Node/browser 专属模块。
 */

/** 宠物逻辑状态（与精灵动画状态经 logicalMap 解耦） */
export type PetState = 'hidden' | 'idle' | 'working' | 'waiting' | 'celebrate' | 'sad'

/** pet-hook.js 写入事件文件的一行 */
export interface EventLine {
  ts: number
  event: 'PostToolUse' | 'UserPromptSubmit' | 'Notification' | 'Stop'
  session_id?: string
  cwd?: string
  tool_name?: string
  /** 仅 Stop 事件有意义：msg.stop_reason === 'error' */
  error?: boolean
  /** hook 侧截取的气泡文本（已截断，主进程只透传） */
  summary?: string
}

/** main → renderer：逻辑状态推送 */
export interface StatePush {
  state: PetState
  sessionId?: string
}

/** main → renderer：气泡推送 */
export interface BubblePush {
  text: string
  kind: 'info' | 'success' | 'error'
  /** 自动消失时长，缺省 8000 */
  ttlMs?: number
}

/** main → renderer：请求像素命中检测（id 用于匹配与超时重发） */
export interface HitTestRequest {
  id: number
  x: number
  y: number
}

/** renderer → main：像素命中检测结果 */
export interface HitTestResult {
  id: number
  x: number
  y: number
  hit: boolean
  /** 诊断用：canvas 实际布局状态（hit=false 时随结果回传） */
  canvas?: { w: number; h: number; left: number; top: number }
}

/** renderer → main：拖拽移动（屏幕坐标） */
export interface DragMove {
  x: number
  y: number
}

/** 持久化状态（位置记忆） */
export interface PersistedState {
  x?: number
  y?: number
}

// ---------- 精灵图资产定义（resources/pet-assets/sprites.json） ----------

export interface AnimationDef {
  row: number
  frames: number[]
  frameMs: number
  loop?: boolean
  /** 非循环动画播完自动切换到的动画名 */
  followUp?: string
}

export interface SpriteSheetDef {
  sheet: string
  tile: { w: number; h: number }
  scale: number
  /** 形象对应的窗口尺寸（缺省 h = tile.h*scale + 124，w = 320） */
  window?: { w?: number; h?: number }
  animations: Record<string, AnimationDef>
  /** 逻辑状态（PetState）→ 精灵动画名 */
  logicalMap: Record<string, string>
}
