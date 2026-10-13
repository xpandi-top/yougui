import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import zh from '../../assets/locales/zh.json'
import en from '../../assets/locales/en.json'
import { DomainError } from '../core/index.ts'
import { useSettings, type LangPref } from '../lib/settings.ts'

export type UiKey = keyof typeof zh
export type Lang = 'zh' | 'en'
export type Vars = Record<string, string | number>
export type TFn = (key: UiKey, vars?: Vars) => string

const DICTS: Record<Lang, Record<string, string>> = { zh, en }

function interpolate(s: string, vars?: Vars): string {
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
}

export function resolveLang(pref: LangPref): Lang {
  if (pref !== 'auto') return pref
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'zh'
  return nav.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

/** 纯函数用的 t（非组件）。缺 key 时回退中文，再回退 key 本身。 */
export function makeT(lang: Lang): TFn {
  const d = DICTS[lang]
  return (key, vars) => interpolate(d[key] ?? (zh as Record<string, string>)[key] ?? key, vars)
}

export function hasKey(key: string): key is UiKey {
  return key in zh
}

/** 把错误翻译成给用户看的一句话。DomainError 用 err.<code>。 */
export function errorText(t: TFn, err: unknown): string {
  if (err instanceof DomainError) {
    const k = `err.${err.code}`
    const params: Vars = { ...err.params }
    if (typeof params.code === 'string' && hasKey(`err.${params.code}`)) params.reason = t(`err.${params.code}` as UiKey, params)
    return hasKey(k) ? t(k, params) : t('err.generic', { code: err.code })
  }
  if (err instanceof Error && err.name === 'QuotaExceededError') return t('err.quota')
  return t('err.unexpected', { message: err instanceof Error ? err.message : String(err) })
}

interface I18nValue {
  lang: Lang
  t: TFn
}

const Ctx = createContext<I18nValue>({ lang: 'zh', t: makeT('zh') })

export function I18nProvider({ children }: { children: ReactNode }) {
  const { lang: pref } = useSettings()
  const lang = resolveLang(pref)
  const value = useMemo(() => ({ lang, t: makeT(lang) }), [lang])
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  }, [lang])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useI18n(): I18nValue {
  return useContext(Ctx)
}

export function useT(): TFn {
  return useContext(Ctx).t
}
