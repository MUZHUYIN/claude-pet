import { app, BrowserWindow } from 'electron'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createPetWindow, getPetWindow, initWindowModule, startHitTestLoop } from './window'
import { createTray } from './tray'
import { EventWatcher } from './pet-watcher'
import { PetStateMachine } from './state-machine'
import { ProcessWatcher } from './process-watch'
import { clearBubble, pushBubble, pushState } from './ipc'

/** 主进程全局异常捕获：写诊断日志，不弹 JS 错误对话框 */
function diag(msg: string): void {
  try {
    appendFileSync(
      join(homedir(), '.claude', 'desktop-pet', 'diag.log'),
      `[${new Date().toISOString().slice(11, 23)}] ${msg}\n`
    )
  } catch {
    /* 忽略 */
  }
}

process.on('uncaughtException', (err) => {
  diag(`uncaughtException: ${err.stack ?? err.message}`)
})
process.on('unhandledRejection', (reason) => {
  diag(`unhandledRejection: ${String(reason)}`)
})

/**
 * 应用入口：单实例锁 + 模块装配。
 * 数据流：hooks → events.jsonl → watcher → 状态机 → IPC → 渲染动画；
 * 进程检测只决定显示/隐藏，与状态机解耦。
 */

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = getPetWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    initWindowModule()
    const win = createPetWindow()
    // 渲染进程崩溃：记录并自动重载恢复（不再弹系统崩溃对话框）
    win.webContents.on('render-process-gone', (_e, details) => {
      diag(`render-process-gone: reason=${details.reason} exit=${details.exitCode}`)
      setTimeout(() => {
        if (!win.isDestroyed()) win.webContents.reload()
      }, 500)
    })
    // dev 调试：renderer 控制台转发到终端
    if (!app.isPackaged) {
      win.webContents.on('console-message', (_e, _level, message) => {
        console.log(`[renderer] ${message}`)
      })
    }
    startHitTestLoop()
    createTray(win)

    // 显示/隐藏（200ms 淡入）
    const showPet = (): void => {
      if (win.isVisible()) return
      win.setOpacity(0)
      win.show()
      const t0 = Date.now()
      const step = (): void => {
        if (win.isDestroyed()) return
        const p = Math.min(1, (Date.now() - t0) / 200)
        win.setOpacity(p)
        if (p < 1) setTimeout(step, 16)
      }
      step()
    }

    // 状态机
    const stateMachine = new PetStateMachine({
      onState: (state, sessionId) => {
        pushState(win, { state, sessionId })
        if (state !== 'hidden' && !win.isVisible()) showPet()
      },
      onBubble: (text, kind, ttlMs) => {
        console.log(`[pet:main] bubble -> ${kind}: ${text.slice(0, 30)}`)
        pushBubble(win, { text, kind, ttlMs })
      },
      onClearBubble: () => clearBubble(win)
    })

    // 事件文件 watcher
    const watcher = new EventWatcher((lines) => {
      for (const ev of lines) stateMachine.handleEvent(ev)
    })
    watcher.start()

    // 进程检测（显示/隐藏）
    const procWatch = new ProcessWatcher(() => stateMachine.lastEventTs)
    procWatch.onChanged = (active) => {
      if (active) {
        stateMachine.sessionBack()
        if (!win.isVisible()) showPet()
      } else {
        stateMachine.sessionGone()
        if (win.isVisible()) win.hide()
      }
    }
    procWatch.start()

    // dev 调试后门：PET_SHOT=1 时按时间序列注入模拟事件并截屏到 dev-shots/
    // 用法: PET_SHOT=1 npm run dev；后续替换 Aseprite 资产后同样用此方式做视觉回归
    if (process.env.PET_SHOT === '1') {
      void devScreenshotMode(win, stateMachine)
    }
  })

  app.on('window-all-closed', () => {
    app.quit()
  })
}

async function devScreenshotMode(win: BrowserWindow, sm: PetStateMachine): Promise<void> {
  const dir = join(app.getAppPath(), 'dev-shots')
  mkdirSync(dir, { recursive: true })
  const eventsFile = join(homedir(), '.claude', 'desktop-pet', 'events.jsonl')
  const ev = (event: string, summary = '', error = false): void => {
    const line = { ts: Date.now(), event, session_id: 'dev-shot', cwd: process.cwd(), tool_name: '', error, summary }
    appendFileSync(eventsFile, JSON.stringify(line) + '\n')
  }
  const shot = async (name: string): Promise<void> => {
    console.log(`[dev-shot] ${name}: state=${sm.current}`)
    const img = await win.webContents.capturePage()
    writeFileSync(join(dir, `${name}.png`), img.toPNG())
  }
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  ev('PostToolUse', '读取文件')
  await wait(1500)
  await shot('1-working')
  ev('Notification', '需要你回来查看')
  await wait(1500)
  await shot('2-waiting')
  ev('Stop', '任务完成：格式化了 3 个文件', false)
  await wait(1500)
  await shot('3-celebrate')
  ev('Stop', '工具执行失败：找不到命令', true)
  await wait(1500)
  await shot('4-sad')
  console.log('[dev-shot] done')
}
