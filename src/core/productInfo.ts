// 商品码 → 商品名：解析各公开商品库的响应（纯函数，前端与 Worker 共用）。
// 查到的信息只作为名称建议，由用户确认后才写入；不缓存图片、不抓取网页。

export type LookupSource =
  | 'openfoodfacts'
  | 'openbeautyfacts'
  | 'openpetfoodfacts'
  | 'openproductsfacts'
  | 'upcitemdb'
  | 'upcdatabase'

export interface ProductInfo {
  /** 规范化商品码（EAN-13 / EAN-8） */
  code: string
  name: string
  brand?: string
  model?: string
  category?: string
  source: LookupSource
}

/** found：查到；notFound：各来源都没有；rateLimited：上游额度用完；unavailable：上游出错或不可达 */
export type LookupStatus = 'found' | 'notFound' | 'rateLimited' | 'unavailable'

export interface LookupResponse {
  status: LookupStatus
  info?: ProductInfo
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' }

/** 清理外部文本：解码常见 HTML 实体、去控制字符与多余空白、限长。 */
export function cleanText(v: unknown, max = 120): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v
    .replace(/&(amp|quot|#39|apos|lt|gt|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return s ? s.slice(0, max) : undefined
}

/** 「Toys & Games > Games > Board Games」→「Board Games」；OFF 的逗号列表取最后一项。 */
export function lastCategory(path: unknown): string | undefined {
  const s = cleanText(path, 300)
  if (!s) return undefined
  const parts = s.split(/\s*[>,]\s*/).filter(Boolean)
  return cleanText(parts.at(-1)?.replace(/^[a-z]{2}:/, ''), 40)
}

function firstOf(v: unknown): string | undefined {
  return cleanText(typeof v === 'string' ? v.split(',')[0] : undefined, 60)
}

/** Open Food Facts 系（同一套 API）：/api/v2/product/<code>.json */
export function fromOpenFacts(source: LookupSource, code: string, json: unknown, lang: 'zh' | 'en'): ProductInfo | null {
  const j = json as { status?: number; product?: Record<string, unknown> } | null
  if (!j || j.status !== 1 || !j.product) return null
  const p = j.product
  const name =
    cleanText(p[`product_name_${lang}`]) ?? cleanText(p.product_name) ?? cleanText(p.product_name_en) ?? cleanText(p.generic_name)
  if (!name) return null
  // Open Facts 的分类是众包自由文本，质量参差，不用于自动填分类
  return { code, name, brand: firstOf(p.brands), source }
}

/** UPCitemdb：/prod/trial/lookup?upc=<code> */
export function fromUpcItemDb(code: string, json: unknown): ProductInfo | null {
  const j = json as { code?: string; items?: Array<Record<string, unknown>> } | null
  const item = j?.code === 'OK' ? j.items?.[0] : undefined
  const name = item && cleanText(item.title)
  if (!item || !name) return null
  return { code, name, brand: cleanText(item.brand, 60), model: cleanText(item.model, 60), category: lastCategory(item.category), source: 'upcitemdb' }
}

/** UPCitemdb 的错误码：额度/频率超限 */
export function upcItemDbRateLimited(json: unknown): boolean {
  const c = (json as { code?: string } | null)?.code
  return c === 'EXCEED_LIMIT' || c === 'TOO_FAST'
}

/** upcdatabase.org v4：/product/<code> */
export function fromUpcDatabase(code: string, json: unknown): ProductInfo | null {
  const j = json as Record<string, unknown> | null
  if (!j || j.success !== true) return null
  const name = cleanText(j.title) ?? cleanText(j.description)
  if (!name) return null
  return {
    code,
    name,
    brand: cleanText(j.brand, 60) ?? cleanText(j.manufacturer, 60),
    category: lastCategory(j.category),
    source: 'upcdatabase',
  }
}

/** UPC-A 原生库优先用 12 位形式查询。 */
export function upcQueryForm(normalized: string): string {
  return normalized.length === 13 && normalized.startsWith('0') ? normalized.slice(1) : normalized
}
