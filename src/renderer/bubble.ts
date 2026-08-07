/**
 * 气泡消息：DOM 绝对定位在宠物上方，自动淡出，点击立即关闭。
 * 注意：延迟移除必须捕获元素局部引用（this.el 会被 show() 复用，
 * 用 this 引用会在 200ms 后误删新气泡）。
 */
export type BubbleKind = 'info' | 'success' | 'error'

export class Bubble {
  private el: HTMLDivElement | null = null
  private timer: number | undefined

  constructor(
    private container: HTMLElement,
    /** 气泡底部与窗口底边的距离（= 宠物高度 + 间距），按形象动态传入 */
    private bottomPx = 108
  ) {}

  show(text: string, kind: BubbleKind, ttlMs = 8000): void {
    this.clear()
    const el = document.createElement('div')
    el.className = `bubble bubble-${kind}`
    el.textContent = text
    el.style.bottom = `${this.bottomPx}px`
    el.addEventListener('click', () => this.clear())
    this.container.appendChild(el)
    this.el = el
    // ttlMs <= 0 表示永久显示（任务结果气泡），点击可关闭，新任务开始时被清除
    if (ttlMs > 0) {
      this.timer = window.setTimeout(() => this.clear(), ttlMs)
    }
  }

  /** 点 (x, y)（窗口 CSS 坐标）是否落在气泡上（穿透检测用） */
  hit(x: number, y: number): boolean {
    if (!this.el) return false
    const r = this.el.getBoundingClientRect()
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
  }

  clear(): void {
    if (this.timer !== undefined) window.clearTimeout(this.timer)
    this.timer = undefined
    const el = this.el
    this.el = null
    if (el) {
      el.classList.add('bubble-hide')
      setTimeout(() => el.remove(), 200)
    }
  }
}
