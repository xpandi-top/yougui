import { describe, expect, it } from 'vitest'
import { cleanupOrphans, createApp } from '../src/app.ts'
import { MemoryFiles, MemoryStore } from '../src/memory.ts'

function setup(extra: Partial<Parameters<typeof createApp>[0]> = {}) {
  const store = new MemoryStore()
  const files = new MemoryFiles()
  let t = 1_000_000
  const app = createApp({ store, files, allowedOrigins: ['http://localhost:5180'], maxFileBytes: 1024 * 1024, quotaBytes: 4096, now: () => t, ...extra })
  return { app, store, files, advance: (ms: number) => (t += ms) }
}

async function household(app: ReturnType<typeof createApp>, headers: Record<string, string> = {}) {
  const res = await app.request('/v1/households', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ name: '我的家' }) })
  return { res, body: (await res.json()) as { householdId: string; key: string } }
}

const rec = (id: string, extra: Record<string, unknown> = {}) => ({ kind: 'entities', id, data: { id, name: id, rev: 1, updatedAt: 1, createdAt: 1 }, updatedAt: 1, deleted: false, baseVer: 0, ...extra })
const auth = (key: string) => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' })
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1])
const PDF = new TextEncoder().encode('%PDF-1.4\n%%EOF')

describe('家庭与鉴权 (B05)', () => {
  it('创建家庭返回密钥，凭密钥读取', async () => {
    const { app } = setup()
    const { res, body } = await household(app)
    expect(res.status).toBe(201)
    expect(body.key.startsWith(`${body.householdId}.`)).toBe(true)
    const me = await app.request('/v1/household', { headers: auth(body.key) })
    expect(await me.json()).toEqual({ householdId: body.householdId, name: '我的家' })
  })

  it('错误密钥 / 未登录 / 其他家庭一律 401', async () => {
    const { app } = setup()
    const a = await household(app)
    const b = await household(app)
    const forged = `${a.body.householdId}.${b.body.key.split('.')[1]}`
    expect((await app.request('/v1/household', { headers: auth(forged) })).status).toBe(401)
    expect((await app.request('/v1/sync/pull')).status).toBe(401)
    expect((await app.request('/v1/household', { headers: auth('zzzzzzzzzzzz.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') })).status).toBe(401)
  })

  it('设置了 SETUP_SECRET 时创建家庭需要口令', async () => {
    const { app } = setup({ setupSecret: 's3cret' })
    expect((await household(app)).res.status).toBe(403)
    expect((await household(app, { 'X-Setup-Secret': 's3cret' })).res.status).toBe(201)
  })

  it('CORS 只放行白名单来源', async () => {
    const { app } = setup()
    const ok = await app.request('/v1/health', { headers: { Origin: 'http://localhost:5180' } })
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5180')
    const bad = await app.request('/v1/health', { headers: { Origin: 'https://evil.example' } })
    expect(bad.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})

describe('同步 (A07)', () => {
  it('推送后按游标拉取；重复推送同一 baseVer 不会重复应用', async () => {
    const { app } = setup()
    const { body } = await household(app)
    const push = (records: unknown[]) => Promise.resolve(app.request('/v1/sync/push', { method: 'POST', headers: auth(body.key), body: JSON.stringify({ records }) })).then((r: Response) => r.json() as Promise<{ applied: Array<{ ver: number }>; conflicts: unknown[] }>)
    const r1 = await push([rec('a'), rec('b')])
    expect(r1.applied.map((a) => a.ver)).toEqual([1, 2])
    // 响应丢失后重试同一批（baseVer 仍为 0）→ 冲突而不是重复写入
    const retry = await push([rec('a')])
    expect(retry.applied).toEqual([])
    expect(retry.conflicts).toHaveLength(1)
    const pull = await Promise.resolve(app.request('/v1/sync/pull?since=0', { headers: auth(body.key) })).then((r: Response) => r.json() as Promise<{ records: Array<{ id: string; ver: number }>; cursor: number }>)
    expect(pull.records.map((r) => r.id)).toEqual(['a', 'b'])
    expect(pull.cursor).toBe(2)
    const next = await Promise.resolve(app.request(`/v1/sync/pull?since=${pull.cursor}`, { headers: auth(body.key) })).then((r: Response) => r.json() as Promise<{ records: unknown[] }>)
    expect(next.records).toEqual([])
  })

  it('基于旧版本的修改返回冲突，带回云端版本', async () => {
    const { app } = setup()
    const { body } = await household(app)
    const push = (records: unknown[]) => Promise.resolve(app.request('/v1/sync/push', { method: 'POST', headers: auth(body.key), body: JSON.stringify({ records }) })).then((r: Response) => r.json() as Promise<{ applied: Array<{ ver: number }>; conflicts: Array<{ ver: number; data: { name: string } }> }>)
    const v1 = (await push([rec('x')])).applied[0].ver
    await push([rec('x', { baseVer: v1, data: { id: 'x', name: '设备A', rev: 2, updatedAt: 2, createdAt: 1 } })])
    const r = await push([rec('x', { baseVer: v1, data: { id: 'x', name: '设备B', rev: 2, updatedAt: 3, createdAt: 1 } })])
    expect(r.applied).toEqual([])
    expect(r.conflicts[0].data.name).toBe('设备A')
  })

  it('拒绝非法 kind 与 id 不一致的数据', async () => {
    const { app } = setup()
    const { body } = await household(app)
    const res = await app.request('/v1/sync/push', { method: 'POST', headers: auth(body.key), body: JSON.stringify({ records: [rec('a', { kind: 'secrets' })] }) })
    expect(res.status).toBe(400)
    const res2 = await app.request('/v1/sync/push', { method: 'POST', headers: auth(body.key), body: JSON.stringify({ records: [rec('a', { data: { id: 'b' } })] }) })
    expect(res2.status).toBe(400)
  })
})

describe('文件 (B04/B05/B07/B10)', () => {
  async function ready() {
    const s = setup()
    const { body } = await household(s.app)
    const put = (id: string, bytes: Uint8Array, type: string, headers: Record<string, string> = {}) =>
      s.app.request(`/v1/files/${id}`, { method: 'PUT', headers: { Authorization: `Bearer ${body.key}`, 'Content-Type': type, ...headers }, body: bytes })
    const push = (records: unknown[]) => s.app.request('/v1/sync/push', { method: 'POST', headers: auth(body.key), body: JSON.stringify({ records }) })
    return { ...s, key: body.key, put, push }
  }

  it('上传后原字节可下载；附件记录不存在时拒绝读取', async () => {
    const { app, key, put, push } = await ready()
    expect((await put('att1', PDF, 'application/pdf')).status).toBe(201)
    expect((await app.request('/v1/files/att1', { headers: { Authorization: `Bearer ${key}` } })).status).toBe(404)
    await push([{ kind: 'attachments', id: 'att1', data: { id: 'att1', name: 'r' }, updatedAt: 1, deleted: false, baseVer: 0 }])
    const res = await app.request('/v1/files/att1', { headers: { Authorization: `Bearer ${key}` } })
    expect(res.status).toBe(200)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF)
    expect(res.headers.get('Cache-Control')).toContain('no-store')
  })

  it('MIME 伪装、类型不支持、校验和不符、超配额被拒绝', async () => {
    const { put } = await ready()
    expect((await put('f1', PDF, 'image/jpeg')).status).toBe(415)
    expect((await put('f2', new TextEncoder().encode('<svg/>'), 'image/svg+xml')).status).toBe(415)
    expect((await put('f3', JPEG, 'image/jpeg', { 'X-Checksum-Sha256': 'deadbeef' })).status).toBe(400)
    expect((await put('f4', new Uint8Array(5000).fill(0xff).map((v, i) => (i < 3 ? [0xff, 0xd8, 0xff][i] : v)), 'image/jpeg')).status).toBe(507)
  })

  it('重复上传同一内容幂等，不重复计容量', async () => {
    const { put, store } = await ready()
    await put('same', JPEG, 'image/jpeg')
    const r = await put('same', JPEG, 'image/jpeg')
    expect(((await r.json()) as { reused?: boolean }).reused).toBe(true)
    const hid = [...store.households.keys()][0]
    expect(await store.usedBytes(hid)).toBe(JPEG.byteLength)
  })

  it('附件墓碑推送后删除文件；孤儿文件 24 小时后清理', async () => {
    const { put, push, files, store, advance } = await ready()
    await put('gone', JPEG, 'image/jpeg')
    await push([{ kind: 'attachments', id: 'gone', data: { id: 'gone' }, updatedAt: 1, deleted: false, baseVer: 0 }])
    await push([{ kind: 'attachments', id: 'gone', data: { id: 'gone', deletedAt: 2 }, updatedAt: 2, deleted: true, baseVer: 1 }])
    expect(files.objects.size).toBe(0)
    await put('orphan', JPEG, 'image/jpeg')
    expect(await cleanupOrphans(store, files, 1_000_000 + 1000)).toBe(0)
    advance(25 * 3600 * 1000)
    expect(await cleanupOrphans(store, files, 1_000_000 + 25 * 3600 * 1000 + 10)).toBe(1)
    expect(files.objects.size).toBe(0)
  })
})
