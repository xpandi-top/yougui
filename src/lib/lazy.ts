import { lazy, type ComponentType } from 'react'

const FLAG = 'yg-chunk-reload'

/** 部署新版本后旧 chunk 可能 404：失败时整页刷新一次。 */
export function lazyWithRetry<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  return lazy<ComponentType<P>>(async () => {
    try {
      const m = await load()
      sessionStorage.removeItem(FLAG)
      return m
    } catch (err) {
      if (!sessionStorage.getItem(FLAG)) {
        sessionStorage.setItem(FLAG, '1')
        location.reload()
        return new Promise<{ default: ComponentType<P> }>(() => {})
      }
      throw err
    }
  })
}
