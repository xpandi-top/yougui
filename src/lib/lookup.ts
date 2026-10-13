// 商品码 → 商品名建议。顺序：本机缓存 → Open Facts 系（免费、浏览器直连）→ 自己的同步服务（UPCitemdb 等，需开启云同步）。
// 只发送商品码本身；查到的结果只作为建议，由用户确认后才写入。设置里可关闭。
import { fromOpenFacts, type LookupResponse, type LookupSource, type ProductCode, type ProductInfo } from '../core/index.ts'
import { getSettings, readJSON, writeJSON } from './settings.ts'
import { getSyncConfig, syncApi, SyncHttpError } from './sync.ts'

export type ClientLookupStatus = LookupResponse['status'] | 'disabled' | 'offline' | 'needsSync'

export interface ClientLookup {
  status: ClientLookupStatus
  info?: ProductInfo
}

const OPEN_FACTS: Array<[LookupSource, string]> = [
  ['openfoodfacts', 'https://world.openfoodfacts.org'],
  ['openbeautyfacts', 'https://world.openbeautyfacts.org'],
  ['openpetfoodfacts', 'https://world.openpetfoodfacts.org'],
  ['openproductsfacts', 'https://world.openproductsfacts.org'],
]
const FIELDS = 'product_name,product_name_zh,product_name_en,generic_name,brands'

export const LOOKUP_CACHE_KEY = 'yg-lookup-v1'
const CACHE_MAX = 300
const NOT_FOUND_TTL = 24 * 3600 * 1000

interface CacheEntry {
  at: number
  status: 'found' | 'notFound'
  info?: ProductInfo
}

function cacheGet(code: string): CacheEntry | null {
  const all = readJSON<Record<string, CacheEntry>>(LOOKUP_CACHE_KEY, {})
  const e = all[code]
  if (!e) return null
  if (e.status === 'notFound' && Date.now() - e.at > NOT_FOUND_TTL) return null
  return e
}

function cachePut(code: string, e: CacheEntry): void {
  const all = readJSON<Record<string, CacheEntry>>(LOOKUP_CACHE_KEY, {})
  all[code] = e
  const keys = Object.keys(all)
  if (keys.length > CACHE_MAX) {
    for (const k of keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - CACHE_MAX)) delete all[k]
  }
  writeJSON(LOOKUP_CACHE_KEY, all)
}

async function openFacts(code: string, lang: 'zh' | 'en'): Promise<ProductInfo | null> {
  const tries = OPEN_FACTS.map(async ([source, base]) => {
    const res = await fetch(`${base}/api/v2/product/${code}.json?fields=${FIELDS}`, { signal: AbortSignal.timeout(8000) })
    if (!res.ok && res.status !== 404) throw new Error(String(res.status))
    return fromOpenFacts(source, code, await res.json(), lang)
  })
  const settled = await Promise.allSettled(tries)
  for (const s of settled) if (s.status === 'fulfilled' && s.value) return s.value
  if (settled.every((s) => s.status === 'rejected')) throw new Error('open facts unavailable')
  return null
}

const inflight = new Map<string, Promise<ClientLookup>>()

export function lookupProduct(product: ProductCode, lang: 'zh' | 'en'): Promise<ClientLookup> {
  if (!getSettings().productLookup) return Promise.resolve({ status: 'disabled' })
  const code = product.normalized
  const hit = cacheGet(code)
  if (hit) return Promise.resolve(hit.status === 'found' ? { status: 'found', info: hit.info } : { status: 'notFound' })
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve({ status: 'offline' })
  let p = inflight.get(code)
  if (!p) {
    p = doLookup(code, lang).finally(() => inflight.delete(code))
    inflight.set(code, p)
  }
  return p
}

async function doLookup(code: string, lang: 'zh' | 'en'): Promise<ClientLookup> {
  let openFactsDown = false
  try {
    const info = await openFacts(code, lang)
    if (info) {
      cachePut(code, { at: Date.now(), status: 'found', info })
      return { status: 'found', info }
    }
  } catch {
    openFactsDown = true
  }
  // 没开云同步：Open Facts 没查到就提示可开启同步查更多（不缓存负结果，开启同步后能马上重查）
  if (!getSyncConfig()) return { status: openFactsDown ? 'unavailable' : 'needsSync' }
  try {
    const r = await syncApi<LookupResponse>(`/v1/lookup/${code}`)
    if (r?.status === 'found' && r.info) {
      cachePut(code, { at: Date.now(), status: 'found', info: r.info })
      return { status: 'found', info: r.info }
    }
    if (r?.status === 'notFound' && !openFactsDown) cachePut(code, { at: Date.now(), status: 'notFound' })
    return { status: r?.status ?? 'unavailable' }
  } catch (err) {
    // 旧版同步服务没有这个接口（404）时按「没查到」处理
    if (err instanceof SyncHttpError && err.status === 404) return { status: 'notFound' }
    return { status: 'unavailable' }
  }
}
