import type { EventLine, PetState } from '../shared/types'

/**
 * 事件 → 逻辑状态的状态机。
 * 状态：hidden | idle | working | waiting | celebrate | sad
 *
 * 设计原则：状态由"真正的切换点"驱动；仅两条时间链自动流转（用户确认的流程）：
 *   ① Stop 展示保持（成功/失败对称）：happy/cry 60s → thinking（等待输入）60s → idle
 *   ② 普通等待输入（"waiting for your input"）→ thinking 60s 无输入 → idle
 * 权限/决策等待（"needs your permission"）→ thinking 一直保持，等用户选择。
 *   PostToolUse/UserPromptSubmit → working（含思考间隙：agent 思考时不触发事件，
 *     但任务仍在进行，应保持 working 直到真正切换）
 *   Notification → waiting + 气泡（celebrate/sad 期间到达的普通等待通知不打断 happy/cry，按剩余时间重建时间链）
 *   Stop(无错) → celebrate + 永久气泡 + 时间链①
 *   Stop(有错) → sad + 永久气泡 + 时间链①
 *   sessionGone（进程消失）→ hidden
 *   sessionBack（进程重新活跃）→ idle
 * 气泡消息仍自动消失（ttl），状态动画按上述规则流转。
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
  /** 延时切换定时器：waiting 的"60 秒回 idle" + celebrate/sad 的"60 秒转 waiting"时间链共用 */
  private idleTimer: NodeJS.Timeout | undefined
  /** Stop 展示保持期开始时刻（完成/失败保护：happy/cry 满 60 秒才转 thinking） */
  private postStopAt: number | null = null

  constructor(private cb: StateCallbacks) {}

  get current(): PetState {
    return this.state
  }

  /** 事件文件最近一条事件的时间戳（进程检测兜底信号） */
  get lastEventTs(): number | null {
    return this.lastActivityTs
  }

  /**
   * @param replay 历史重放（watcher 首次回调）：只恢复状态，不武装时间链定时器。
   *   否则历史 Stop/Notification 武装的 60s 定时器会在重放结束后触发状态切换，
   *   经 onState 绕过 booting 抑制把宠物显示出来（开机后宠物被历史事件拉出）。
   */
  handleEvent(ev: EventLine, replay = false): void {
    if (ev.session_id && ev.session_id !== this.lastSessionId) {
      this.lastSessionId = ev.session_id
      this.cb.onClearBubble()
    }
    this.lastActivityTs = ev.ts
    // 任何新事件清除 waiting 的"回 idle"定时器
    clearTimeout(this.idleTimer)
    this.idleTimer = undefined

    switch (ev.event) {
      case 'PostToolUse':
      case 'UserPromptSubmit':
        // 新任务开始：清掉上一个任务的结果气泡（成功/失败摘要）
        this.cb.onClearBubble()
        this.set('working')
        break
      case 'Notification': {
        const summary = ev.summary || ''
        const isWaitInput = summary.includes('waiting for your input')
        // 展示保持保护：Stop 后庆祝/悲伤中（happy/cry 时间链内）收到普通等待输入通知
        //（claude 回复完成后会发，但经常滞后到达）→ 只弹气泡，不打断 happy/cry；
        // 按剩余时间重建时间链，保证展示满 1 分钟再转 thinking。
        if ((this.state === 'celebrate' || this.state === 'sad') && isWaitInput && this.postStopAt !== null) {
          this.cb.onBubble(ev.summary || '需要你的注意', 'info', 8000)
          if (!replay) {
            this.idleTimer = setTimeout(() => {
              this.set('waiting')
              this.armWaitIdleTimer()
            }, Math.max(0, 60_000 - (Date.now() - this.postStopAt)))
          }
          break
        }
        this.set('waiting')
        this.cb.onBubble(ev.summary || '需要你的注意', 'info', 8000)
        // 区分两种等待：
        //   "waiting for your input"（普通等待输入）→ thinking 60 秒后回 idle
        //   其他（"needs your permission" 等权限/决策等待）→ 一直 thinking 等用户选择，
        //     并清掉 celebrate 时间链可能残留的"回 idle"定时器
        if (isWaitInput) {
          if (!replay) this.armWaitIdleTimer()
        } else {
          clearTimeout(this.idleTimer)
          this.idleTimer = undefined
        }
        break
      }
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
        // 展示保持时间链（成功/失败对称）：happy/cry 保持 60s → 自动转 waiting（thinking）
        // 等输入 → 再 60s 无输入回 idle。期间任何新事件（新任务/Notification）都会在
        // handleEvent 顶部清掉此定时器；普通等待通知走上方展示保持保护，按剩余时间重建。
        // 历史重放不武装：重放结束后定时器触发会绕过 booting 抑制把宠物显示出来。
        if (!replay) this.armPostStopTimer()
        break
      default:
        return
    }
  }

  /** 进程检测判定 claude 已消失：直接隐藏（渲染层停帧省电） */
  sessionGone(): void {
    clearTimeout(this.idleTimer)
    this.idleTimer = undefined
    this.lastSessionId = null
    this.set('hidden')
  }

  /** 进程重新活跃但暂无事件：回到待机 */
  sessionBack(): void {
    if (this.state === 'hidden') {
      this.set('idle')
    }
  }

  /** waiting（普通等待输入）：60 秒无新事件自动回 idle（先清旧定时器防叠加） */
  private armWaitIdleTimer(): void {
    clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.set('idle'), 60_000)
  }

  /** Stop 展示保持时间链：记录开始时刻 + happy/cry 60s 后转 waiting（thinking） */
  private armPostStopTimer(): void {
    this.postStopAt = Date.now()
    this.idleTimer = setTimeout(() => {
      this.set('waiting')
      this.armWaitIdleTimer()
    }, 60_000)
  }

  private set(s: PetState): void {
    if (this.state === s) return
    this.state = s
    this.cb.onState(s, this.lastSessionId ?? undefined)
  }
}
