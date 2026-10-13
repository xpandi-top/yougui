// localStorage 适配层：设置与小型偏好。key 带版本号，见 docs/STORAGE.md。
import { useSyncExternalStore } from 'react'

export type LangPref = 'auto' | 'zh' | 'en'
export type ThemePref = 'system' | 'light' | 'dark'
export type LabelSize = '40x30' | '30x20' | '50x30' | '62x29'

export interface Settings {
  lang: LangPref
  theme: ThemePref
  /** 标签二维码中的应用地址；空 = 当前页面地址 */
  labelBaseUrl: string
  labelSize: LabelSize
  labelShowName: boolean
  labelShowPath: boolean
  scanSound: boolean
  /** 扫到新商品码时联网查商品名（只发送商品码） */
  productLookup: boolean
}

export const SETTINGS_KEY = 'yg-settings-v1'

const DEFAULTS: Settings = {
  lang: 'auto',
  theme: 'system',
  labelBaseUrl: '',
  labelSize: '40x30',
  labelShowName: true,
  labelShowPath: false,
  scanSound: false,
  productLookup: true,
}

export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback
  } catch {
    return fallback
  }
}

export function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 隐私模式或容量满：设置不保存，不影响使用 */
  }
}

let current: Settings = readJSON(SETTINGS_KEY, DEFAULTS)
const listeners = new Set<() => void>()

export function getSettings(): Settings {
  return current
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch }
  writeJSON(SETTINGS_KEY, current)
  for (const l of listeners) l()
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  const onStorage = (e: StorageEvent) => {
    if (e.key === SETTINGS_KEY) {
      current = readJSON(SETTINGS_KEY, DEFAULTS)
      fn()
    }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(fn)
    window.removeEventListener('storage', onStorage)
  }
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings, getSettings)
}

/** 标签二维码使用的应用地址。 */
export function appUrl(): string {
  const configured = getSettings().labelBaseUrl.trim() || (import.meta.env.VITE_PUBLIC_URL as string | undefined) || ''
  if (configured) return configured
  return location.origin + location.pathname
}
