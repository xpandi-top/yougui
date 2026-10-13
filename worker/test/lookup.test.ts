import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { FOUND_TTL } from '../src/lookup.ts'
import { MemoryFiles, MemoryStore } from '../src/memory.ts'

// 2026-10 实测 UPCitemdb 对 Citadels 的响应（节选）
const CITADELS = {
  code: 'OK',
  total: 1,
  items: [
    {
      ean: '0841333113513',
      title: 'Citadels (Revised Edition)',
      upc: '841333113513',
      brand: 'Z-Man Games',
      model: 'ZMGZC01',
      category: 'Toys & Games > Games > Board Games',
    },
  ],
}

type Reply = { status: number; body: unknown }

function setup(replies: Record<string, Reply[]>, extra: { upcdatabaseKey?: string } = {}) {
  const calls: string[] = []
  const fakeFetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    const host = new URL(url).host
    const r = replies[host]?.shift() ?? { status: 500, body: {} }
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  let t = 1_000_000
  const store = new MemoryStore()
  const app = createApp({ store, files: new MemoryFiles(), allowedOrigins: ['*'], maxFileBytes: 1e6, quotaBytes: 1e7, now: () => t, fetch: fakeFetch, ...extra })
  return { app, store, calls, advance: (ms: number) => (t += ms) }
}

async function keyFor(app: ReturnType<typeof createApp>) {
  const res = await app.request('/v1/households', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'h' }) })
  return ((await res.json()) as { key: string }).key
}

async function lookup(app: ReturnType<typeof createApp>, key: string, code: string) {
  const res = await app.request(`/v1/lookup/${code}`, { headers: { Authorization: `Bearer ${key}` } })
  return { status: res.status, body: (await res.json()) as { status: string; info?: Record<string, string>; cached?: boolean } }
}

describe('商品名查询代理', () => {
  it('UPCitemdb 查到 Citadels；12 位与 13 位查同一缓存，第二次不再请求上游', async () => {
    const { app, calls } = setup({ 'api.upcitemdb.com': [{ status: 200, body: CITADELS }] })
    const key = await keyFor(app)
    const r1 = await lookup(app, key, '841333113513')
    expect(r1.body).toMatchObject({ status: 'found', info: { code: '0841333113513', name: 'Citadels (Revised Edition)', brand: 'Z-Man Games', model: 'ZMGZC01', category: 'Board Games', source: 'upcitemdb' } })
    expect(calls[0]).toContain('upc=841333113513')
    const r2 = await lookup(app, key, '0841333113513')
    expect(r2.body).toMatchObject({ status: 'found', cached: true })
    expect(calls).toHaveLength(1)
  })

  it('上游额度用完返回 rateLimited 且不缓存', async () => {
    const { app, calls } = setup({ 'api.upcitemdb.com': [{ status: 429, body: { code: 'EXCEED_LIMIT' } }, { status: 200, body: CITADELS }] })
    const key = await keyFor(app)
    expect((await lookup(app, key, '841333113513')).body.status).toBe('rateLimited')
    expect((await lookup(app, key, '841333113513')).body.status).toBe('found')
    expect(calls).toHaveLength(2)
  })

  it('没查到缓存 7 天，过期后重新查询；查到的缓存 90 天', async () => {
    const { app, calls, advance } = setup({ 'api.upcitemdb.com': [{ status: 200, body: { code: 'OK', total: 0, items: [] } }, { status: 200, body: CITADELS }] })
    const key = await keyFor(app)
    expect((await lookup(app, key, '4006381333931')).body.status).toBe('notFound')
    expect((await lookup(app, key, '4006381333931')).body).toMatchObject({ status: 'notFound', cached: true })
    advance(8 * 24 * 3600 * 1000)
    expect((await lookup(app, key, '4006381333931')).body.status).toBe('found')
    advance(FOUND_TTL - 1000)
    expect((await lookup(app, key, '4006381333931')).body.cached).toBe(true)
    expect(calls).toHaveLength(2)
  })

  it('配置了 upcdatabase key 时作为备选来源', async () => {
    const { app, calls } = setup(
      {
        'api.upcitemdb.com': [{ status: 200, body: { code: 'OK', total: 0, items: [] } }],
        'api.upcdatabase.org': [{ status: 200, body: { success: true, title: 'Some &amp; Thing', brand: 'ACME', category: 'Home' } }],
      },
      { upcdatabaseKey: 'k' },
    )
    const key = await keyFor(app)
    expect((await lookup(app, key, '4006381333931')).body).toMatchObject({ status: 'found', info: { name: 'Some & Thing', brand: 'ACME', source: 'upcdatabase' } })
    expect(calls[1]).toContain('api.upcdatabase.org/product/4006381333931')
  })

  it('需要同步密钥；无效商品码 400', async () => {
    const { app } = setup({})
    expect((await app.request('/v1/lookup/841333113513')).status).toBe(401)
    const key = await keyFor(app)
    expect((await lookup(app, key, '84133311351')).status).toBe(400)
  })
})
