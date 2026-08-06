import type { EventLine, PetState } from '../shared/types'

/**
 * 事件 → 逻辑状态的状态机。
 * 状态：hidden | idle | working | waiting | celebrate | sad
 *
 * 设计原则：状态只由"真正的切换点"驱动，无定时器干预。
 *   PostToolUse/UserPromptSubmit → working（含思考间隙：agent 思考时不触发事件，
 *     但任务仍在进行，应保持 working 直到真正切换）
 *   Notification → waiting + 气泡
 *   Stop(无错) → celebrate + 气泡
 *   Stop(有错) → sad + 气泡
 *   sessionGone（进程消失）→ hidden
 *   sessionBack（进程重新活跃）→ idle
 * 气泡消息仍自动消失（ttl），但状态动画无限保持到切换。
 */

export interface StateCallbacks {
  onState: (state: PetState, sessionId?: string) => void
  onBubble: (text: string, kind: 'info' | 'success' | 'error', ttlMs?: number) => void
  onClearBubble: () => void
}

export class PetStateMachine {
  private state: PetState = 'idle'
  private lastSessionId: string | null = null
  private lastActivityTs: number | null = null

  constructor(private cb: StateCallbacks) {}

  get current(): PetState {
    return this.state
  }

  /** 事件文件最近一条事件的时间戳（进程检测兜底信号） */
  get lastEventTs(): number | null {
    return this.lastActivityTs
  }

  handleEvent(ev: EventLine): void {
    if (ev.session_id && ev.session_id !== this.lastSessionId) {
      this.lastSessionId = ev.session_id
      this.cb.onClearBubble()
    }
    this.lastActivityTs = ev.ts

    switch (ev.event) {
      case 'PostToolUse':
      case 'UserPromptSubmit':
        // 新任务开始：清掉上一个任务的结果气泡（成功/失败摘要）
        this.cb.onClearBubble()
        this.set('working')
        break
      case 'Notification':
        this.set('waiting')
        this.cb.onBubble(ev.summary || '需要你的注意', 'info', 8000)
        break
      case 'Stop':
        if (ev.error) {
          this.set('sad')
          // ttl=0：失败气泡永久显示（点击可关闭，新任务开始时清除）
          this.cb.onBubble(ev.summary || '任务出错了', 'error', 0)
        } else {
          this.set('celebrate')
          // ttl=0：完成气泡永久显示（点击可关闭，新任务开始时清除）
          this.cb.onBubble(ev.summary || '任务完成 ✨', 'success', 0)
        }
        break
      default:
        return
    }
  }

  /** 进程检测判定 claude 已消失：直接隐藏（渲染层停帧省电） */
  sessionGone(): void {
    this.lastSessionId = null
    this.set('hidden')
  }

  /** 进程重新活跃但暂无事件：回到待机 */
  sessionBack(): void {
    if (this.state === 'hidden') {
      this.set('idle')
    }
  }

  private set(s: PetState): void {
    if (this.state === s) return
    this.state = s
    this.cb.onState(s, this.lastSessionId ?? undefined)
  }
}
