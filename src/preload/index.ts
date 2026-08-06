import { contextBridge, ipcRenderer } from 'electron'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { HitTestResult } from '../shared/types'

/**
 * 渲染进程可用的 API 面（经 contextBridge 暴露为 window.pet）。
 * 约定：main → renderer 的推送统一走 'pet:event' 通道（{ type, ...payload }）。
 */

// 资产根目录动态查询（形象切换后 reload 立即生效）
const getAssetRoot = (): Promise<string> => ipcRenderer.invoke('pet:get-asset-root') as Promise<string>

const api = {
  platform: process.platform,
  /** 资产目录内文本文件读取（sprites.json） */
  readText: async (rel: string): Promise<string> => readFile(join(await getAssetRoot(), rel), 'utf8'),
  /** 资产目录内二进制文件读取为 base64（精灵图走 data URL，规避 file:// 跨协议限制） */
  readBase64: async (rel: string): Promise<string> => {
    const buf = await readFile(join(await getAssetRoot(), rel))
    return buf.toString('base64')
  },
  /** main → renderer 事件订阅（state / bubble / hitTestRequest / poke），返回取消订阅函数 */
  onEvent: (callback: (evt: { type: string; payload: unknown }) => void): (() => void) => {
    const listener = (_e: unknown, evt: { type: string; payload: unknown }): void => callback(evt)
    ipcRenderer.on('pet:event', listener)
    return () => {
      ipcRenderer.removeListener('pet:event', listener)
    }
  },
  /** renderer → main 上报 */
  hitTestResult: (r: HitTestResult): void => {
    ipcRenderer.send('pet:hit-test-result', r)
  },
  dragStart: (): void => {
    ipcRenderer.send('pet:drag-start')
  },
  dragMove: (): void => {
    ipcRenderer.send('pet:drag-move')
  },
  dragEnd: (): void => {
    ipcRenderer.send('pet:drag-end')
  },
  openContextMenu: (): void => {
    ipcRenderer.send('pet:context-menu')
  }
}

export type PetApi = typeof api

contextBridge.exposeInMainWorld('pet', api)
