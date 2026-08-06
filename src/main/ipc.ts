import type { BrowserWindow } from 'electron'
import type { BubblePush, StatePush } from '../shared/types'

/** main → renderer 推送封装（统一走 'pet:event' 通道） */

export function pushState(win: BrowserWindow, state: StatePush): void {
  if (win.isDestroyed()) return
  win.webContents.send('pet:event', { type: 'state', payload: state })
}

export function pushBubble(win: BrowserWindow, bubble: BubblePush): void {
  if (win.isDestroyed()) return
  win.webContents.send('pet:event', { type: 'bubble', payload: bubble })
}

export function clearBubble(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  win.webContents.send('pet:event', { type: 'clearBubble', payload: null })
}
