// 有归 云同步 API（Hono）。依赖注入存储，生产用 D1/R2，测试用内存实现。
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { parseProductCode } from '../../src/core/codes.ts'
import { lookupProduct } from './lookup.ts'
import { fileKey, parseSyncKey, type FileStore, type Household, type PushRecord, type SyncStore } from './types.ts'

export interface AppOptions {
  store: SyncStore
  files: FileStore
  allowedOrigins: string[]
  /** 设置后，创建家庭需要请求头 X-Setup-Secret 匹配 */
  setupSecret?: string
  maxFileBytes: number
  quotaBytes: number
  now?: () => number
  /** 上游商品库请求（测试注入假实现） */
  fetch?: typeof fetch
  /** upcdatabase.org API key（可选） */
  upcdatabaseKey?: string
}

export const API_VERSION = '1'
const PUSH_MAX = 200
const RECORD_MAX_BYTES = 512 * 1024
const PULL_LIMIT = 500
const KINDS = new Set(['entities', 'types', 'attachments', 'links', 'labels', 'ops', 'household'])
const ID_RE = /^[A-Za-z0-9~_-]{1,200}$/
const ALLOWED_MIME = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/

type Env = { Variables: { household: Household } }

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const d = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

/** 读文件头确认真实类型，防 MIME 伪装。 */
function sniff(buf: ArrayBuffer): string | null {
  const b = new Uint8Array(buf.slice(0, 16))
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  if (hex.startsWith('ffd8ff')) return 'image/jpeg'
  if (hex.startsWith('89504e47')) return 'image/png'
  if (hex.startsWith('25504446')) return 'application/pdf'
  if (hex.startsWith('52494646') && hex.slice(16, 24) === '57454250') return 'image/webp'
  if (hex.slice(8, 16) === '66747970') return 'image/heic'
  return null
}

function fail(status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 507, error: string): never {
  throw new HTTPException(status, { res: Response.json({ error }, { status }) })
}

export function createApp(opts: AppOptions) {
  const now = opts.now ?? (() => Date.now())
  const app = new Hono<Env>()

  app.use(
    '*',
    cors({
      origin: (origin) => (opts.allowedOrigins.includes('*') || opts.allowedOrigins.includes(origin) ? origin : null),
      allowHeaders: ['Authorization', 'Content-Type', 'X-Setup-Secret', 'X-Checksum-Sha256'],
      allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
      maxAge: 86400,
    }),
  )

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse()
    console.error(err)
    return c.json({ error: 'internal' }, 500)
  })

  app.get('/v1/health', (c) => c.json({ ok: true, api: API_VERSION }))

  app.post('/v1/households', async (c) => {
    if (opts.setupSecret && !safeEqual(c.req.header('X-Setup-Secret') ?? '', opts.setupSecret)) fail(403, 'setup secret required')
    const body = (await c.req.json().catch(() => ({}))) as { name?: unknown }
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : ''
    if (!name) fail(400, 'name required')
    const idBytes = crypto.getRandomValues(new Uint8Array(12))
    const id = [...idBytes].map((b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('')
    const secret = b64url(crypto.getRandomValues(new Uint8Array(32)))
    await opts.store.createHousehold({ id, name, tokenHash: await sha256Hex(secret), createdAt: now() })
    return c.json({ householdId: id, key: `${id}.${secret}` }, 201)
  })

  // 之后的接口都需要同步密钥
  app.use('/v1/*', async (c, next) => {
    if (c.req.path === '/v1/health' || (c.req.path === '/v1/households' && c.req.method === 'POST')) return next()
    const auth = c.req.header('Authorization') ?? ''
    const parsed = parseSyncKey(auth.replace(/^Bearer\s+/i, ''))
    if (!parsed) fail(401, 'missing or malformed key')
    const h = await opts.store.getHousehold(parsed.householdId)
    // 家庭不存在与密钥错误返回相同结果，不泄露存在性
    if (!h || !safeEqual(h.tokenHash, await sha256Hex(parsed.secret))) fail(401, 'invalid key')
    c.set('household', h)
    await next()
  })

  app.get('/v1/household', (c) => {
    const h = c.get('household')
    return c.json({ householdId: h.id, name: h.name })
  })

  app.post('/v1/sync/push', async (c) => {
    const h = c.get('household')
    const body = (await c.req.json().catch(() => null)) as { records?: unknown } | null
    if (!body || !Array.isArray(body.records)) fail(400, 'records[] required')
    if (body.records.length > PUSH_MAX) fail(413, `at most ${PUSH_MAX} records per push`)
    const records: PushRecord[] = []
    for (const raw of body.records as PushRecord[]) {
      if (!raw || typeof raw !== 'object' || !KINDS.has(raw.kind) || typeof raw.id !== 'string' || !ID_RE.test(raw.id)) fail(400, 'bad record')
      if (!raw.data || typeof raw.data !== 'object' || (raw.data as { id?: unknown }).id !== raw.id) fail(400, 'bad record data')
      if (JSON.stringify(raw.data).length > RECORD_MAX_BYTES) fail(413, 'record too large')
      records.push({
        kind: raw.kind,
        id: raw.id,
        data: raw.data,
        updatedAt: Number(raw.updatedAt) || 0,
        deleted: !!raw.deleted,
        baseVer: Number.isInteger(raw.baseVer) && raw.baseVer >= 0 ? raw.baseVer : 0,
      })
    }
    const result = await opts.store.push(h.id, records)
    // 附件被删除（墓碑）→ 删除 R2 文件；失败不影响记录同步，定时任务会再清理
    const applied = new Set(result.applied.map((a) => `${a.kind}:${a.id}`))
    for (const r of records) {
      if (r.kind === 'attachments' && r.deleted && applied.has(`attachments:${r.id}`)) {
        try {
          await opts.files.delete(fileKey(h.id, r.id))
          await opts.store.deleteFile(h.id, r.id)
        } catch (err) {
          console.error('file delete failed', err)
        }
      }
    }
    return c.json(result)
  })

  app.get('/v1/sync/pull', async (c) => {
    const h = c.get('household')
    const since = Math.max(0, Number(c.req.query('since') ?? 0) || 0)
    const limit = Math.min(PULL_LIMIT, Math.max(1, Number(c.req.query('limit') ?? PULL_LIMIT) || PULL_LIMIT))
    return c.json(await opts.store.pull(h.id, since, limit))
  })

  // 商品名查询：需同步密钥（保护上游免费额度），结果在 D1 中跨家庭缓存（公开商品信息）
  app.get('/v1/lookup/:code', async (c) => {
    const product = parseProductCode(c.req.param('code'))
    if (!product) fail(400, 'invalid product code')
    const r = await lookupProduct(product.normalized, {
      cache: opts.store,
      fetch: opts.fetch ?? ((input, init) => fetch(input, init)),
      now,
      upcdatabaseKey: opts.upcdatabaseKey,
    })
    return c.json(r, 200, { 'Cache-Control': 'private, no-store' })
  })

  app.put('/v1/files/:id', async (c) => {
    const h = c.get('household')
    const id = c.req.param('id')
    if (!ID_RE.test(id)) fail(400, 'bad id')
    const declared = (c.req.header('Content-Type') ?? '').split(';')[0].trim().toLowerCase()
    if (!ALLOWED_MIME.test(declared)) fail(415, 'unsupported type')
    const len = Number(c.req.header('Content-Length') ?? 0)
    if (len > opts.maxFileBytes) fail(413, 'file too large')
    const buf = await c.req.arrayBuffer()
    if (buf.byteLength > opts.maxFileBytes) fail(413, 'file too large')
    if (!buf.byteLength) fail(400, 'empty body')
    const real = sniff(buf)
    if (!real || real.split('/')[0] !== declared.split('/')[0]) fail(415, 'content does not match type')
    const checksum = await sha256Hex(buf)
    const expected = c.req.header('X-Checksum-Sha256')
    if (expected && expected.toLowerCase() !== checksum) fail(400, 'checksum mismatch')
    const prev = await opts.store.getFile(h.id, id)
    if (prev && prev.checksum === checksum) return c.json({ ok: true, size: prev.size, checksum, reused: true })
    const used = (await opts.store.usedBytes(h.id)) - (prev?.size ?? 0)
    if (used + buf.byteLength > opts.quotaBytes) fail(507, 'quota exceeded')
    await opts.files.put(fileKey(h.id, id), buf, { contentType: declared, checksum })
    await opts.store.putFile(h.id, { attachmentId: id, size: buf.byteLength, mime: declared, checksum, createdAt: now() })
    return c.json({ ok: true, size: buf.byteLength, checksum }, 201)
  })

  app.get('/v1/files/:id', async (c) => {
    const h = c.get('household')
    const id = c.req.param('id')
    if (!ID_RE.test(id)) fail(400, 'bad id')
    // 读取同时校验附件记录仍有效，不凭对象 key 授权
    if (!(await opts.store.attachmentLive(h.id, id))) fail(404, 'not found')
    const o = await opts.files.get(fileKey(h.id, id))
    if (!o) fail(404, 'not found')
    return new Response(o.body, {
      headers: {
        'Content-Type': o.contentType,
        'Content-Length': String(o.size),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    })
  })

  app.notFound((c) => c.json({ error: 'not found' }, 404))
  return app
}

/** 定时清理孤儿文件（上传后 24 小时仍无附件记录，或附件已删除）。 */
export async function cleanupOrphans(store: SyncStore, files: FileStore, now: number): Promise<number> {
  const list = await store.orphanFiles(now - 24 * 3600 * 1000, 500)
  for (const f of list) {
    await files.delete(fileKey(f.householdId, f.attachmentId))
    await store.deleteFile(f.householdId, f.attachmentId)
  }
  return list.length
}
