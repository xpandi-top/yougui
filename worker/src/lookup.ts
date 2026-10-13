// 商品名查询代理：缓存 → UPCitemdb 免费试用 → upcdatabase.org（配置了 key 才用）。
// 浏览器不能直连 UPCitemdb（CORS 只放行其自家域名），所以经 Worker 转发；结果缓存在 D1。
import {
  fromUpcDatabase,
  fromUpcItemDb,
  upcItemDbRateLimited,
  upcQueryForm,
  type LookupResponse,
  type ProductInfo,
} from '../../src/core/productInfo.ts'

export interface CachedProduct {
  status: 'found' | 'notFound'
  info?: ProductInfo
  fetchedAt: number
}

export interface ProductCache {
  getProduct(code: string): Promise<CachedProduct | null>
  putProduct(code: string, entry: CachedProduct): Promise<void>
}

export interface LookupDeps {
  cache: ProductCache
  fetch: typeof fetch
  now: () => number
  /** upcdatabase.org API key（可选，wrangler secret UPCDATABASE_KEY） */
  upcdatabaseKey?: string
}

const DAY = 24 * 3600 * 1000
export const FOUND_TTL = 90 * DAY
export const NOT_FOUND_TTL = 7 * DAY
const UA = 'yougui-sync/0.3 (self-hosted household inventory)'

type Upstream = { kind: 'found'; info: ProductInfo } | { kind: 'notFound' } | { kind: 'rateLimited' } | { kind: 'unavailable' }

async function getJson(deps: LookupDeps, url: string, headers: Record<string, string> = {}): Promise<{ status: number; json: unknown }> {
  const res = await deps.fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(8000) })
  let json: unknown = null
  try {
    json = await res.json()
  } catch {
    /* 非 JSON 响应 */
  }
  return { status: res.status, json }
}

async function upcItemDb(code: string, deps: LookupDeps): Promise<Upstream> {
  try {
    const { status, json } = await getJson(deps, `https://api.upcitemdb.com/prod/trial/lookup?upc=${upcQueryForm(code)}`)
    if (status === 429 || upcItemDbRateLimited(json)) return { kind: 'rateLimited' }
    const info = fromUpcItemDb(code, json)
    if (info) return { kind: 'found', info }
    return status === 200 || status === 400 || status === 404 ? { kind: 'notFound' } : { kind: 'unavailable' }
  } catch {
    return { kind: 'unavailable' }
  }
}

async function upcDatabase(code: string, deps: LookupDeps): Promise<Upstream> {
  if (!deps.upcdatabaseKey) return { kind: 'notFound' }
  try {
    const { status, json } = await getJson(deps, `https://api.upcdatabase.org/product/${code}`, { Authorization: `Bearer ${deps.upcdatabaseKey}` })
    if (status === 429) return { kind: 'rateLimited' }
    const info = fromUpcDatabase(code, json)
    if (info) return { kind: 'found', info }
    return status >= 500 ? { kind: 'unavailable' } : { kind: 'notFound' }
  } catch {
    return { kind: 'unavailable' }
  }
}

export async function lookupProduct(code: string, deps: LookupDeps): Promise<LookupResponse & { cached?: boolean }> {
  const now = deps.now()
  const hit = await deps.cache.getProduct(code)
  if (hit?.status === 'found' && hit.info && now - hit.fetchedAt < FOUND_TTL) return { status: 'found', info: hit.info, cached: true }
  if (hit?.status === 'notFound' && now - hit.fetchedAt < NOT_FOUND_TTL) return { status: 'notFound', cached: true }

  const results: Upstream[] = []
  for (const source of [upcItemDb, upcDatabase]) {
    const r = await source(code, deps)
    if (r.kind === 'found') {
      await deps.cache.putProduct(code, { status: 'found', info: r.info, fetchedAt: now })
      return { status: 'found', info: r.info }
    }
    results.push(r)
  }
  // 只有所有来源都明确「没有」才缓存负结果；额度用完或上游出错不缓存
  if (results.every((r) => r.kind === 'notFound')) {
    await deps.cache.putProduct(code, { status: 'notFound', fetchedAt: now })
    return { status: 'notFound' }
  }
  return { status: results.some((r) => r.kind === 'rateLimited') ? 'rateLimited' : 'unavailable' }
}
