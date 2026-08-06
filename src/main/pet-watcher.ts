import { closeSync, fstatSync, openSync, readSync, watch } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { EventLine } from '../shared/types'

/**
 * events.jsonl 尾部增量读取。
 * fs.watch + 1s 轮询双保险（Windows 上单文件 watch 偶发丢事件）；
 * 文件 size 回退（hook 侧 5MB 轮转 rename）时重置偏移；
 * 残留半行缓存到下轮补全。
 */
export class EventWatcher {
  private filePath: string
  private offset = 0
  private fd: number | null = null
  private partial = ''
  private watcher: ReturnType<typeof watch> | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(private onEvents: (lines: EventLine[]) => void) {
    this.filePath = join(homedir(), '.claude', 'desktop-pet', 'events.jsonl')
  }

  start(): void {
    this.pump()
    try {
      this.watcher = watch(this.filePath, () => this.pump())
    } catch {
      // 文件还不存在：等待轮询路径打开
    }
    this.timer = setInterval(() => this.pump(), 1000)
  }

  stop(): void {
    this.watcher?.close()
    this.watcher = null
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.fd !== null) closeSync(this.fd)
    this.fd = null
  }

  private ensureOpen(): boolean {
    if (this.fd !== null) return true
    try {
      this.fd = openSync(this.filePath, 'r')
      return true
    } catch {
      this.fd = null
      return false
    }
  }

  private pump(): void {
    if (!this.ensureOpen()) return
    const fd = this.fd as number
    let size: number
    try {
      size = fstatSync(fd).size
    } catch {
      this.fd = null
      return
    }
    if (size < this.offset) {
      // 轮转/重建：从头读，清掉可能残留的半行
      this.offset = 0
      this.partial = ''
    }
    if (size === this.offset) return

    const buf = Buffer.alloc(size - this.offset)
    const n = readSync(fd, buf, 0, buf.length, this.offset)
    if (n <= 0) return
    this.offset += n

    const text = this.partial + buf.toString('utf8', 0, n)
    const lines = text.split('\n')
    // 末尾无换行 = 半行，留给下一轮
    this.partial = lines.pop() ?? ''
    const parsed: EventLine[] = []
    for (const ln of lines) {
      if (!ln.trim()) continue
      try {
        parsed.push(JSON.parse(ln) as EventLine)
      } catch {
        // 坏行丢弃（可能写了一半）
      }
    }
    if (parsed.length > 0) this.onEvents(parsed)
  }
}
