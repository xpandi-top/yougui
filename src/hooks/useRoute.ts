// 轻量 hash 路由：GitHub Pages 刷新不 404；标签深链接 #/l/<token>。
import { useSyncExternalStore } from 'react'

export interface Route {
  hash: string
  path: string
  parts: string[]
  query: URLSearchParams
}

let cached: Route | null = null

function parse(): Route {
  const hash = location.hash.replace(/^#/, '') || '/'
  if (cached && cached.hash === hash) return cached
  const [path, q = ''] = hash.split('?')
  cached = { hash, path, parts: path.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q) }
  return cached
}

function subscribe(fn: () => void) {
  window.addEventListener('hashchange', fn)
  return () => window.removeEventListener('hashchange', fn)
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, parse, parse)
}

export function currentRoute(): Route {
  return parse()
}

/** 应用内前进的层数：>0 时返回键可以 history.back()，否则回到 fallback。 */
let depth = 0

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  const target = to.startsWith('#') ? to : `#${to}`
  if (opts.replace) {
    history.replaceState(history.state, '', target)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  } else if (location.hash !== target) {
    depth++
    location.hash = target
  }
}

export function goBack(fallback = '/'): void {
  if (depth > 0) {
    depth--
    history.back()
  } else {
    navigate(fallback, { replace: true })
  }
}

export function q(params: Record<string, string | number | null | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') sp.set(k, String(v))
  const s = sp.toString()
  return s ? `?${s}` : ''
}
