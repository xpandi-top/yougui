// Service Worker 更新：发现新版本先提示，用户点「更新」才切换（不在编辑中途自动刷新）。
// 检查时机：启动、切回前台、每小时，以及用户手动「检查更新」。
import { useSyncExternalStore } from 'react'
import { recordError } from './errors.ts'

export interface UpdateState {
  /** 新版本已下载，等待切换 */
  available: boolean
  checking: boolean
  /** 开发模式或浏览器不支持 Service Worker */
  supported: boolean
}

let state: UpdateState = { available: false, checking: false, supported: false }
const listeners = new Set<() => void>()
let registration: ServiceWorkerRegistration | undefined
let applySW: ((reload?: boolean) => Promise<void>) | undefined

function set(patch: Partial<UpdateState>) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => state,
    () => state,
  )
}

const HOUR = 3600 * 1000

export async function initPwa(): Promise<void> {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return
  try {
    const { registerSW } = await import('virtual:pwa-register')
    applySW = registerSW({
      immediate: true,
      onNeedRefresh: () => set({ available: true }),
      onRegisteredSW: (_url, reg) => {
        registration = reg
        set({ supported: !!reg })
        if (!reg) return
        setInterval(() => void reg.update().catch(() => undefined), HOUR)
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible' && navigator.onLine) void reg.update().catch(() => undefined)
        })
      },
      onRegisterError: recordError,
    })
  } catch (err) {
    recordError(err)
  }
}

function waitInstalled(sw: ServiceWorker, timeoutMs = 20_000): Promise<void> {
  return new Promise((resolve) => {
    const done = () => resolve()
    const timer = setTimeout(done, timeoutMs)
    sw.addEventListener('statechange', () => {
      if (sw.state === 'installed' || sw.state === 'activated' || sw.state === 'redundant') {
        clearTimeout(timer)
        done()
      }
    })
  })
}

export type CheckResult = 'available' | 'latest' | 'offline' | 'unsupported' | 'error'

/** 手动检查更新：向服务器重新取 Service Worker 脚本，有新版本则等它下载完。 */
export async function checkForUpdate(): Promise<CheckResult> {
  if (!registration) return 'unsupported'
  if (!navigator.onLine) return 'offline'
  set({ checking: true })
  try {
    await registration.update()
    const installing = registration.installing
    if (installing) await waitInstalled(installing)
    const available = !!registration.waiting || state.available
    if (available) set({ available: true })
    return available ? 'available' : 'latest'
  } catch (err) {
    recordError(err)
    return 'error'
  } finally {
    set({ checking: false })
  }
}

/** 切换到新版本并刷新页面。 */
export async function applyUpdate(): Promise<void> {
  if (applySW && state.available) await applySW(true)
  else location.reload()
}

/** 兜底：注销 Service Worker、清空网页缓存后重新加载（IndexedDB 里的物品数据不受影响）。 */
export async function hardReload(): Promise<void> {
  try {
    for (const r of (await navigator.serviceWorker?.getRegistrations()) ?? []) await r.unregister()
    for (const k of (await caches?.keys()) ?? []) await caches.delete(k)
  } catch (err) {
    recordError(err)
  }
  location.reload()
}
