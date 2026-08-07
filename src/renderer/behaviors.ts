import type { PetState } from '../shared/types'
import { PetSprite } from './pet'

/**
 * 动画行为层：逻辑状态之外的动画增强（blink 随机眨眼 / sleep 长 idle 睡觉 /
 * walk 拖拽行走 / run 拖拽释放奔跑 / jump 戳一下）。
 *
 * 全部经 pet.hasAnimation() 守卫：形象缺少对应动画时自动降级（保持旧行为）。
 * 状态切换即清空所有定时器，由事件流驱动，与状态机"无限保持"语义兼容。
 */

const BLINK_MIN = 5000
const BLINK_RANGE = 10000 // 5-15s 随机
const SLEEP_AFTER = 5 * 60_000 // idle 保持 5 分钟入睡
const RUN_HOLD = 1500 // 拖拽释放后奔跑时长

export class PetBehaviors {
  private logical: PetState = 'idle'
  private blinkTimer: number | undefined
  private sleepTimer: number | undefined
  private overrideTimer: number | undefined // 一次性动画（run/jump）结束后回逻辑状态

  constructor(private pet: PetSprite) {}

  /** 状态推送入口：清全部定时器 → 切逻辑动画 → idle 时挂载 blink/sleep */
  onState(s: PetState): void {
    this.logical = s
    this.clearAll()
    this.pet.setLogicalState(s)
    if (s !== 'idle') return

    if (this.pet.hasAnimation('blink')) {
      this.blinkTimer = window.setTimeout(() => this.tryBlink(), BLINK_MIN + Math.random() * BLINK_RANGE)
    }
    if (this.pet.hasAnimation('sleep')) {
      this.sleepTimer = window.setTimeout(() => {
        if (this.pet.animName === 'idle') {
          this.pet.play('sleep')
        } else {
          // 恰逢 blink 等一次性动画：顺延再试
          this.sleepTimer = window.setTimeout(() => this.pet.play('sleep'), 10_000)
        }
      }, SLEEP_AFTER)
    }
  }

  /** 按住拖拽：行走 */
  onDragStart(): void {
    this.clearAll()
    if (this.pet.hasAnimation('walk')) this.pet.play('walk')
  }

  /** 松开拖拽：奔跑 1.5s 后回逻辑状态 */
  onDragEnd(): void {
    if (this.pet.hasAnimation('run')) {
      this.pet.play('run')
      this.overrideTimer = window.setTimeout(() => this.reapply(), RUN_HOLD)
    } else {
      this.reapply()
    }
  }

  /** 戳一下：跳跃（优先盖过 run） */
  onPoke(): void {
    if (!this.pet.hasAnimation('jump')) return
    clearTimeout(this.overrideTimer)
    this.pet.play('jump')
    const anim = this.pet.currentAnimDef() ?? { frames: [0], frameMs: 83 }
    this.overrideTimer = window.setTimeout(() => this.reapply(), anim.frames.length * anim.frameMs)
  }

  private tryBlink(): void {
    // 守卫：逻辑 idle 且当前视觉是 idle（排除 jump/run/sleep/walk 期间）
    if (this.logical === 'idle' && this.pet.animName === 'idle') {
      this.pet.play('blink') // blink 非循环 followUp idle，播完自动回
    }
    // 链式续期：播 blink 瞬间就排下一轮，不依赖动画结束事件
    this.blinkTimer = window.setTimeout(() => this.tryBlink(), BLINK_MIN + Math.random() * BLINK_RANGE)
  }

  /** 回到当前逻辑状态（含 idle 时重排 blink/sleep 定时器） */
  private reapply(): void {
    this.clearAll()
    this.onState(this.logical)
  }

  private clearAll(): void {
    clearTimeout(this.blinkTimer)
    clearTimeout(this.sleepTimer)
    clearTimeout(this.overrideTimer)
    this.blinkTimer = undefined
    this.sleepTimer = undefined
    this.overrideTimer = undefined
  }
}
