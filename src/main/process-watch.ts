import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

/**
 * claude 进程检测：决定宠物显示/隐藏，与状态机解耦。
 * 每 3s 一轮：
 *   1. 事件新鲜度兜底（events.jsonl 最近事件 <30s → 活跃，跳过进程查询）
 *   2. tasklist 查 claude.exe（原生安装）
 *   3. PowerShell 查命令行含 claude 的 node.exe（npm 全局安装）
 * 显示/隐藏节流：连续 3 轮无信号（≈9s）才判定消失。
 */

const execFileP = promisify(execFile)
const POLL_MS = 3000
const MISS_LIMIT = 3
const EVENT_FRESH_MS = 30_000

const PS_QUERY =
  "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'claude' } | Select-Object -First 1"

export class ProcessWatcher {
  private active = false
  private misses = 0
  private timer: NodeJS.Timeout | null = null

  /** 显示/隐藏状态变化回调 */
  onChanged: ((active: boolean) => void) | null = null

  constructor(private lastEventTs: () => number | null) {}

  get isActive(): boolean {
    return this.active
  }

  start(): void {
    this.check()
    this.timer = setInterval(() => {
      this.check()
    }, POLL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async check(): Promise<void> {
    const active = await this.detect()
    if (active) {
      this.misses = 0
      if (!this.active) {
        this.active = true
        this.onChanged?.(true)
      }
    } else {
      this.misses++
      if (this.active && this.misses >= MISS_LIMIT) {
        this.active = false
        this.onChanged?.(false)
      }
    }
  }

  private async detect(): Promise<boolean> {
    // 兜底信号：事件新鲜度（进程检测盲区覆盖：终端包装进程、无进程名的场景）
    const lastTs = this.lastEventTs()
    if (lastTs !== null && Date.now() - lastTs < EVENT_FRESH_MS) return true

    // 快速路径：tasklist 查 claude.exe（无匹配时 tasklist 仍返回 0，
    // 且中文 locale 的提示文案是本地化的，所以只判 CSV 行内 ASCII 映像名）
    try {
      const { stdout } = await execFileP('tasklist', ['/FO', 'CSV', '/FI', 'IMAGENAME eq claude.exe'], {
        windowsHide: true,
        maxBuffer: 1 << 20
      })
      if (stdout.includes('claude.exe')) return true
    } catch {
      // tasklist 失败不阻断，继续查 node 路径
    }

    // node 路径：npm 全局安装的 claude 以 node.exe 运行，必须过滤命令行防误报
    try {
      const { stdout } = await execFileP('powershell', ['-NoProfile', '-Command', PS_QUERY], {
        windowsHide: true,
        maxBuffer: 1 << 20
      })
      if (stdout.trim().length > 0) return true
    } catch {
      // 忽略
    }
    return false
  }
}
