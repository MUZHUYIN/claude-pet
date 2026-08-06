/// <reference types="vite/client" />

import type { HitTestResult } from '../shared/types'

declare global {
  interface Window {
    pet: {
      platform: string
      readText: (rel: string) => Promise<string>
      readBase64: (rel: string) => Promise<string>
      onEvent: (callback: (evt: { type: string; payload: unknown }) => void) => () => void
      hitTestResult: (r: HitTestResult) => void
      dragStart: () => void
      dragMove: () => void
      dragEnd: () => void
      openContextMenu: () => void
    }
  }
}

export {}
