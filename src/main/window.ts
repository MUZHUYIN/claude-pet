import { app, BrowserWindow, Menu, ipcMain, screen } from 'electron'
import { homedir } from 'node:os'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HitTestResult, PersistedState } from '../shared/types'

/**
 * 宠物窗口：透明无边框置顶悬浮窗 + 点击穿透轮询 + 拖拽 + 位置记忆。
 * 窗口尺寸由当前形象决定（sprites.json 的 window 字段 / tile×scale 推导）。
 */

/** 当前形象的期望窗口尺寸（穿透判定/尺寸回正/创建窗口统一使用） */
let expectedSize = { w: 320, h: 220 }

/** 当前形象名（读 %APPDATA%/claude-pet/state.json 的 character 字段，默认 bear-v3） */
function activeCharacter(): string {
  try {
    const p = stateFilePath()
    if (existsSync(p)) {
      const s = JSON.parse(readFileSync(p, 'utf8')) as { character?: string }
      if (typeof s.character === 'string' && s.character) return s.character
    }
  } catch {
    /* 读取失败用默认 */
  }
  return 'bear-v3'
}

/** characters/ 基础目录 */
function charactersBase(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'pet-assets', 'characters')
    : join(app.getAppPath(), 'resources', 'pet-assets', 'characters')
}

/** 读形象的期望窗口尺寸与宠物显示尺寸（sprites.json 的 window 字段；缺省 h = tile.h*scale + 124、w = 320） */
function loadCharacterSize(name: string): { w: number; h: number } {
  try {
    const def = JSON.parse(readFileSync(join(charactersBase(), name, 'sprites.json'), 'utf8')) as {
      tile?: { h?: number }
      scale?: number
      window?: { w?: number; h?: number }
    }
    const tileH = def.tile?.h ?? 32
    const scale = def.scale ?? 3
    const w = def.window?.w ?? 320
    const h = def.window?.h ?? Math.round(tileH * scale) + 124
    return { w, h }
  } catch {
    return { w: 320, h: 220 }
  }
}

/** 切换形象并持久化（保留位置字段） */
function saveCharacter(name: string): void {
  try {
    const p = stateFilePath()
    const prev = existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>) : {}
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(p, JSON.stringify({ ...prev, character: name }))
  } catch {
    /* 忽略 */
  }
}

/** 可用形象列表（characters/ 下的目录） */
function listCharacters(): string[] {
  try {
    const { readdirSync } = require('node:fs') as typeof import('node:fs')
    return readdirSync(charactersBase(), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return ['bear-v3']
  }
}

/** 资产目录：dev 用项目内 resources/pet-assets/characters/<name>，prod 用 resourcesPath 对应目录 */
export function assetRoot(): string {
  return join(charactersBase(), activeCharacter())
}

let petWindow: BrowserWindow | null = null
let isDragging = false
let pendingHit: { id: number; x: number; y: number } | null = null
let savePosTimer: NodeJS.Timeout | undefined
// 期望窗口位置：高频 setPosition 下 Windows 可能丢弃部分移动，
// getPosition() 与实际位置不一致会导致穿透判定错位（光标在宠物上却被判为窗外）。
// 穿透判定一律用 trackedPos（期望值），并周期性用 getPosition 校准。
let trackedPos = { x: 0, y: 0 }
let hitSeq = 0 // hitTestRequest 序号（超时重发/自愈用）
let lastHitWasFalse = false // 最近一次命中检测结果
let abnormalRounds = 0 // "窗内但无命中"连续轮数
let forcedInteractiveUntil = 0 // 强制可交互截止时间
let lastNearDiag = 0 // 近窗诊断限流
let hitTimeoutCount = 0 // 连续超时无回复计数（渲染层无响应检测）
let lastDragActivity = 0 // 拖拽心跳（pointerup 丢失时强制结束拖拽）

/** 诊断日志（~/.claude/desktop-pet/diag.log），用于定位穿透卡死 */
function diag(msg: string): void {
  try {
    appendFileSync(
      join(homedir(), '.claude', 'desktop-pet', 'diag.log'),
      `[${new Date().toISOString().slice(11, 23)}] ${msg}\n`
    )
  } catch {
    /* 诊断失败不影响运行 */
  }
}

export function getPetWindow(): BrowserWindow | null {
  return petWindow
}

// ---------- 位置记忆 ----------

function stateFilePath(): string {
  return join(app.getPath('userData'), 'state.json')
}

function loadPosition(): PersistedState | null {
  try {
    const p = stateFilePath()
    if (!existsSync(p)) return null
    return JSON.parse(readFileSync(p, 'utf8')) as PersistedState
  } catch {
    return null
  }
}

/** 钳制窗口：允许最多一半出屏（贴边停住，可藏在屏幕边缘），
 * 只防止完全拖出屏幕后找不回。以窗口中心点所在显示器为准。
 * 防御：屏幕边缘/显示器边界场景下坐标可能非有限值（NaN），直接跳过钳制。 */
function clampToWorkArea(win: BrowserWindow): void {
  try {
    const [x, y] = win.getPosition()
    const [w, h] = win.getSize()
    const display = screen.getDisplayNearestPoint({ x: x + w / 2, y: y + h / 2 })
    const area = display?.workArea
    if (!area || !isFinite(x) || !isFinite(y) || !isFinite(w) || !isFinite(h)) return
    const cx = Math.min(Math.max(x, area.x - w / 2), area.x + area.width - w / 2)
    const cy = Math.min(Math.max(y, area.y - h / 2), area.y + area.height - h / 2)
    if (isFinite(cx) && isFinite(cy) && (cx !== x || cy !== y)) {
      win.setPosition(Math.round(cx), Math.round(cy))
    }
  } catch (err) {
    diag(`clampToWorkArea 异常: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function scheduleSavePosition(win: BrowserWindow): void {
  if (savePosTimer) clearTimeout(savePosTimer)
  savePosTimer = setTimeout(() => {
    try {
      const [x, y] = win.getPosition()
      // 合并写入：保留 character 等已有字段（直接 {x,y} 会覆盖形象配置）
      const p = stateFilePath()
      const prev = existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>) : {}
      mkdirSync(app.getPath('userData'), { recursive: true })
      writeFileSync(p, JSON.stringify({ ...prev, x, y }))
    } catch {
      /* 位置记忆失败不影响运行 */
    }
  }, 1000)
}

/** 窗口尺寸被系统偷偷改动时回正（Windows 透明窗 + 拖拽/边缘吸附偶发）。
 * 用 setBounds 只改尺寸（省略 x/y 保持当前位置）；getSize 可能返回内部缓存值，
 * 故 resize 事件路径无条件强制。 */
function forceWindowSize(win: BrowserWindow, force = false): void {
  const [w, h] = win.getSize()
  if (force || w !== expectedSize.w || h !== expectedSize.h) {
    win.setBounds({ width: expectedSize.w, height: expectedSize.h })
  }
}

// ---------- 点击穿透 ----------

function setClickThrough(win: BrowserWindow, on: boolean): void {
  // 每次强制同步（setIgnoreMouseEvents 幂等，开销可忽略）：
  // 节流缓存会导致拖拽/请求竞态下穿透状态卡死（宠物点不到）
  win.setIgnoreMouseEvents(on, { forward: true })
}

/** 光标在窗内 → 请求渲染层像素命中；出窗 → 全穿透（判定用 trackedPos 期望位置） */
function refreshClickThrough(win: BrowserWindow): void {
  const cursor = screen.getCursorScreenPoint()
  const { x: wx, y: wy } = trackedPos
  if (cursor.x >= wx && cursor.x <= wx + expectedSize.w && cursor.y >= wy && cursor.y <= wy + expectedSize.h) {
    pendingHit = { id: ++hitSeq, x: Math.round(cursor.x - wx), y: Math.round(cursor.y - wy) }
    win.webContents.send('pet:event', { type: 'hitTestRequest', payload: pendingHit })
    // 超时重发：500ms 无回复则再发一次（渲染层可能丢事件）
    setTimeout(() => {
      if (pendingHit && pendingHit.id === hitSeq && !isDragging && !win.isDestroyed()) {
        hitTimeoutCount++
        diag(`hit-test 超时重发 id=${pendingHit.id} at (${pendingHit.x},${pendingHit.y})`)
        win.webContents.send('pet:event', { type: 'hitTestRequest', payload: pendingHit })
      }
    }, 500)
  } else {
    setClickThrough(win, true)
  }
}

/** 100ms 轮询光标：驱动点击穿透；每 30 轮用 getPosition 校准 trackedPos；异常累计自愈 */
export function startHitTestLoop(): void {
  let loopCount = 0
  setInterval(() => {
    const win = petWindow
    if (!win || win.isDestroyed() || !win.isVisible()) return

    // 拖拽心跳：pointerup 丢失（Windows 偶发）时强制结束拖拽，恢复穿透轮询
    if (isDragging) {
      if (Date.now() - lastDragActivity > 10_000) {
        diag('拖拽超时 10s 强制结束（pointerup 丢失）')
        isDragging = false
        win.setIgnoreMouseEvents(true, { forward: true })
        refreshClickThrough(win)
      }
      return
    }

    if (++loopCount % 30 === 0) {
      const [gx, gy] = win.getPosition()
      trackedPos = { x: gx, y: gy }
      forceWindowSize(win, true) // 周期强制回正：resize 事件可能漏掉系统偷偷改的尺寸
    }

    const cursor = screen.getCursorScreenPoint()
    const { x: wx, y: wy } = trackedPos
    const inWindow =
      cursor.x >= wx && cursor.x <= wx + expectedSize.w && cursor.y >= wy && cursor.y <= wy + expectedSize.h

    if (!inWindow) {
      abnormalRounds = 0
      setClickThrough(win, true)
      // 诊断：光标离期望窗口很近（疑似窗口位置错位），每秒限流一条
      if (
        Math.abs(cursor.x - wx) < 80 &&
        Math.abs(cursor.y - wy) < 80 &&
        Date.now() > lastNearDiag + 1000
      ) {
        lastNearDiag = Date.now()
        diag(`光标(${cursor.x},${cursor.y}) 在期望窗(${wx},${wy})外但距离近（怀疑位置错位）`)
      }
      return
    }

    // 光标在窗内：请求命中检测
    refreshClickThrough(win)

    // 自愈 1：光标在窗内但连续 ~1s 无命中（穿透卡死）→ 强制可交互 3s
    if (lastHitWasFalse) abnormalRounds++
    else abnormalRounds = 0
    // 自愈 2：渲染层连续无响应（超时重发 ≥5 次）→ 强制可交互 3s
    if (hitTimeoutCount >= 5) {
      hitTimeoutCount = 0
      if (Date.now() > forcedInteractiveUntil) forcedInteractiveUntil = Date.now() + 3000
      setClickThrough(win, false)
      diag('自愈：渲染层无响应，强制可交互 3s')
      return
    }
    if (abnormalRounds >= 10 && Date.now() > forcedInteractiveUntil) {
      forcedInteractiveUntil = Date.now() + 3000
      abnormalRounds = 0
      setClickThrough(win, false)
      diag(`自愈：强制可交互 3s（光标在窗内但连续无命中，trackedPos=(${wx},${wy})）`)
    }
  }, 100)
}

// ---------- IPC（拖拽 / 右键 / hit-test 结果） ----------

function setupIpc(): void {
  ipcMain.handle('pet:get-asset-root', () => assetRoot())

  let dragOffset = { dx: 0, dy: 0 }
  let lastDragMove = 0

  ipcMain.on('pet:drag-start', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    // 偏移基于主进程光标坐标（DIP 单位），与 setPosition 一致
    const cursor = screen.getCursorScreenPoint()
    const [wx, wy] = win.getPosition()
    dragOffset = { dx: cursor.x - wx, dy: cursor.y - wy }
    isDragging = true
    lastDragActivity = Date.now()
    win.setIgnoreMouseEvents(false, { forward: true }) // 拖拽中全收
    diag(`drag-start offset=(${dragOffset.dx},${dragOffset.dy}) getPos=(${wx},${wy})`)
  })

  ipcMain.on('pet:drag-move', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win || !isDragging) return
    // 16ms 节流：pointermove 高频触发，防高频 setPosition 与系统拖动动画打架
    const now = Date.now()
    if (now - lastDragMove < 16) return
    lastDragMove = now
    lastDragActivity = now
    const cursor = screen.getCursorScreenPoint()
    trackedPos = { x: Math.round(cursor.x - dragOffset.dx), y: Math.round(cursor.y - dragOffset.dy) }
    win.setPosition(trackedPos.x, trackedPos.y)
  })

  ipcMain.on('pet:drag-end', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    isDragging = false
    if (win) {
      forceWindowSize(win)
      // 校准：高频移动下 Windows 可能丢弃最后的 setPosition，
      // 强制对齐期望位置并延时验证（setPosition 异步生效）
      win.setPosition(trackedPos.x, trackedPos.y)
      clampToWorkArea(win)
      const [ax, ay] = win.getPosition()
      trackedPos = { x: ax, y: ay }
      diag(`drag-end tracked=(${trackedPos.x},${trackedPos.y}) getPos=(${ax},${ay})`)
      scheduleSavePosition(win)
      refreshClickThrough(win)
      setTimeout(() => {
        if (win.isDestroyed()) return
        const [gx, gy] = win.getPosition()
        if (Math.abs(gx - trackedPos.x) > 2 || Math.abs(gy - trackedPos.y) > 2) {
          diag(`drag-end 校准重试：期望(${trackedPos.x},${trackedPos.y}) 实际(${gx},${gy})`)
          win.setPosition(trackedPos.x, trackedPos.y)
        }
        refreshClickThrough(win)
      }, 60)
    }
  })

  ipcMain.on('pet:hit-test-result', (e, r: HitTestResult) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win || isDragging) return
    // 回复竞态：渲染层回复慢时 id 已被新请求覆盖。只要 pendingHit 存在就接受，
    // 保证穿透状态持续更新不卡死（100ms 后新请求会修正瞬时偏差）
    if (pendingHit) {
      hitTimeoutCount = 0 // 有回复即重置无响应计数
      lastHitWasFalse = !r.hit
      if (!r.hit && pendingHit.id === r.id) {
        abnormalRounds = 0 // 命中 false 由轮询侧累计，这里重置避免双计
        const c = r.canvas
        diag(
          `hit=false id=${r.id} 请求(${r.x},${r.y})` +
            (c ? ` canvas(w=${c.w},h=${c.h},left=${c.left},top=${c.top})` : '')
        )
      }
      pendingHit = null // 已回复，清空防止 500ms 定时器误报"超时重发"
      setClickThrough(win, !r.hit)
    }
  })

  ipcMain.on('pet:context-menu', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    Menu.buildFromTemplate([
      {
        label: '切换形象',
        submenu: listCharacters().map((name) => ({
          label: name,
          type: 'radio' as const,
          checked: name === activeCharacter(),
          click: () => {
            saveCharacter(name)
            // 底部锚定切换窗口尺寸（宠物脚底视觉不跳动）：
            // 先更新期望值，20ms 后的 resize 回正即变为 no-op，不会与新尺寸打架
            const size = loadCharacterSize(name)
            const [x, y] = win.getPosition()
            const [, ch] = win.getSize()
            expectedSize = size
            win.setBounds({ x, y: y + (ch - size.h), width: size.w, height: size.h })
            clampToWorkArea(win)
            win.webContents.reload() // 重新加载渲染层（preload 会重新读 assetRoot）
          }
        }))
      },
      { type: 'separator' },
      {
        label: '开机自启',
        type: 'checkbox' as const,
        // portable 版的 process.execPath 指向临时解压目录（重启后失效），
        // 必须用 PORTABLE_EXECUTABLE_FILE（启动器真实路径）；检查也须传 path，
        // 否则默认查临时路径永远返回未勾选
        checked: (() => {
          const launchPath = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath
          return app.getLoginItemSettings({ path: launchPath }).openAtLogin
        })(),
        click: (item) => {
          const launchPath = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath
          app.setLoginItemSettings({ openAtLogin: item.checked, path: launchPath })
          diag(`开机自启 ${item.checked ? '开启' : '关闭'} → ${launchPath}`)
          // 反馈气泡（菜单点击后立即关闭，用户看不到勾选状态）
          if (!win.isDestroyed()) {
            win.webContents.send('pet:event', {
              type: 'bubble',
              payload: {
                text: item.checked ? '开机自启已开启 ✓' : '开机自启已关闭',
                kind: item.checked ? 'success' : 'info',
                ttlMs: 3000
              }
            })
          }
        }
      },
      { type: 'separator' },
      { label: '退出宠物', click: () => app.quit() }
    ]).popup({ window: win })
  })
}

// ---------- 创建窗口 ----------

export function createPetWindow(): BrowserWindow {
  expectedSize = loadCharacterSize(activeCharacter())
  const win = new BrowserWindow({
    width: expectedSize.w,
    height: expectedSize.h,
    transparent: true,
    frame: false,
    thickFrame: false, // 移除 frameless 窗口残留的粗边框样式（WS_THICKFRAME）→ 窗口边缘线消失
    resizable: false,
    hasShadow: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      backgroundThrottling: false, // 透明窗被遮挡时 rAF 不能节流
      contextIsolation: true,
      sandbox: false
    }
  })

  petWindow = win
  // 显式透明背景：缓解 Windows 透明窗白框/矩形轮廓闪现
  win.setBackgroundColor('#00000000')
  win.setAlwaysOnTop(true, 'screen-saver')
  // 置顶加固：全屏应用/其他置顶窗可能抢层
  setInterval(() => {
    if (!win.isDestroyed() && win.isVisible()) win.setAlwaysOnTop(true, 'screen-saver')
  }, 30000)

  const pos = loadPosition()
  if (pos && pos.x !== undefined && pos.y !== undefined) win.setPosition(pos.x, pos.y)
  clampToWorkArea(win)
  const [ix, iy] = win.getPosition()
  trackedPos = { x: ix, y: iy }

  // 默认全穿透（透明区域不挡桌面点击）
  win.setIgnoreMouseEvents(true, { forward: true })

  // 尺寸防御：系统若改动窗口尺寸（拖拽/边缘吸附偶发），20ms 后强制回正
  let resizeTimer: NodeJS.Timeout | undefined
  win.on('resize', () => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => forceWindowSize(win, true), 20)
  })

  win.on('closed', () => {
    petWindow = null
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

export function initWindowModule(): void {
  setupIpc()
}
