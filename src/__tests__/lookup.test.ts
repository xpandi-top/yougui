import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanText, fromOpenFacts, fromUpcItemDb, lastCategory, parseProductCode } from '../core/index.ts'
import { LOOKUP_CACHE_KEY, lookupProduct } from '../lib/lookup.ts'
import { updateSettings } from '../lib/settings.ts'
import { setSyncConfig } from '../lib/sync.ts'

const citadels = parseProductCode('841333113513')!

describe('商品库响应解析', () => {
  it('UPCitemdb：Citadels', () => {
    const info = fromUpcItemDb('0841333113513', {
      code: 'OK',
      items: [{ title: 'Citadels (Revised Edition)', brand: 'Z-Man Games', model: 'ZMGZC01', category: 'Toys &amp; Games > Games > Board Games' }],
    })
    expect(info).toEqual({ code: '0841333113513', name: 'Citadels (Revised Edition)', brand: 'Z-Man Games', model: 'ZMGZC01', category: 'Board Games', source: 'upcitemdb' })
    expect(fromUpcItemDb('x', { code: 'OK', total: 0, items: [] })).toBeNull()
  })

  it('Open Food Facts：优先当前语言名称，品牌取第一个，不采用众包分类', () => {
    const json = { status: 1, product: { product_name: 'Nutella', product_name_zh: '能多益', brands: 'Ferrero, Nutella', categories: 'en:spreads, en:sweet-spreads, en:hazelnut-spreads' } }
    expect(fromOpenFacts('openfoodfacts', '3017620422003', json, 'zh')).toEqual({ code: '3017620422003', name: '能多益', brand: 'Ferrero', source: 'openfoodfacts' })
    expect(fromOpenFacts('openfoodfacts', '3017620422003', json, 'en')!.name).toBe('Nutella')
    expect(fromOpenFacts('openfoodfacts', 'x', { status: 0 }, 'zh')).toBeNull()
  })

  it('清理外部文本：实体、控制字符、长度', () => {
    expect(cleanText('A&amp;B\u0007  C')).toBe('A&B C')
    expect(cleanText('x'.repeat(500))!.length).toBe(120)
    expect(lastCategory('Toys & Games > Games > Board Games')).toBe('Board Games')
  })
})

describe('客户端查询顺序', () => {
  const calls: string[] = []
  let replies: Record<string, { status: number; body: unknown }>

  beforeEach(() => {
    calls.length = 0
    localStorage.removeItem(LOOKUP_CACHE_KEY)
    updateSettings({ productLookup: true })
    setSyncConfig(null)
    replies = {}
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      const host = new URL(url).host
      const r = replies[host] ?? { status: 404, body: { status: 0 } }
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } })
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('关闭设置时不发任何请求', async () => {
    updateSettings({ productLookup: false })
    expect(await lookupProduct(citadels, 'zh')).toEqual({ status: 'disabled' })
    expect(calls).toEqual([])
  })

  it('Open Facts 查到即返回，且只发送商品码', async () => {
    replies['world.openfoodfacts.org'] = { status: 200, body: { status: 1, product: { product_name: '测试饼干' } } }
    const r = await lookupProduct(parseProductCode('4006381333931')!, 'zh')
    expect(r).toMatchObject({ status: 'found', info: { name: '测试饼干', source: 'openfoodfacts' } })
    expect(calls.every((u) => u.includes('/api/v2/product/4006381333931.json'))).toBe(true)
    // 第二次走本机缓存
    calls.length = 0
    await lookupProduct(parseProductCode('4006381333931')!, 'zh')
    expect(calls).toEqual([])
  })

  it('Open Facts 没有且未开云同步 → needsSync；开启后经同步服务查到 Citadels', async () => {
    expect((await lookupProduct(citadels, 'zh')).status).toBe('needsSync')
    setSyncConfig({ apiUrl: 'https://sync.example', key: 'abcdefgh.' + 'x'.repeat(40), cursor: 0, lastSyncAt: null, lastError: null, auto: false })
    replies['sync.example'] = { status: 200, body: { status: 'found', info: { code: '0841333113513', name: 'Citadels (Revised Edition)', brand: 'Z-Man Games', source: 'upcitemdb' } } }
    const r = await lookupProduct(citadels, 'zh')
    expect(r).toMatchObject({ status: 'found', info: { name: 'Citadels (Revised Edition)' } })
    expect(calls.at(-1)).toBe('https://sync.example/v1/lookup/0841333113513')
  })
})
