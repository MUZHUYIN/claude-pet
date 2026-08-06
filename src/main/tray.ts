import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron'
import { join } from 'node:path'
import { assetRoot } from './window'

/**
 * 极简托盘：穿透状态下宠物本体收不到右键时的退出兜底。
 * 图标用宠物精灵表缩略图。
 */
export function createTray(win: BrowserWindow): Tray | null {
  try {
    const icon = nativeImage
      .createFromPath(join(assetRoot(), 'pet.png'))
      .resize({ width: 16, height: 16 })
    const tray = new Tray(icon)
    tray.setToolTip('Claude Pet')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '显示宠物', click: () => win.show() },
        { type: 'separator' },
        { label: '退出宠物', click: () => app.quit() }
      ])
    )
    return tray
  } catch {
    return null // 托盘创建失败不阻塞主流程
  }
}
