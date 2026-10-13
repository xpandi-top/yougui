// 可选云同步客户端（Cloudflare Worker + D1 + R2）。没有配置时应用完全本地运行。
// 协议：先上传附件文件 → 推送脏记录（baseVer 乐观并发）→ 按游标拉取。冲突保留双方，不静默覆盖。
import { useSyncExternalStore } from 'react'
import {
  decideRemote,
  parseSyncKey,
  toPush,
  type Attachment,
  type BaseRecord,
  type PullResult,
  type PushResult,
  type WireRecord,
} from '../core/index.ts'
import type { StoredFile } from './db.ts'
import { readJSON, writeJSON } from './settings.ts'
import type { AppStore, ConflictEntry, SyncKind } from './store.ts'

export const SYNC_STORAGE_KEY = 'yg-sync-v1'

export interface SyncConfig {
  apiUrl: string
  /** 家庭同步密钥 <householdId>.<secret>：等同密码，只存在本机 */
  key: string
  householdName?: string
  cursor: number
  lastSyncAt: number | null
  lastError: string | null
  auto: boolean
}

const API_ENV = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').trim()

/** VITE_API_URL=off 时整体隐藏云同步。 */
export function syncFeatureEnabled(): boolean {
  return API_ENV.toLowerCase() !== 'off'
}

export function defaultApiUrl(): string {
  return API_ENV && API_ENV.toLowerCase() !== 'off' ? API_ENV : ''
}

let config: SyncConfig | null = readJSON<SyncConfig | null>(SYNC_STORAGE_KEY, null)
const listeners = new Set<() => void>()

export function getSyncConfig(): SyncConfig | null {
  return config
}

export function setSyncConfig(next: SyncConfig | null): void {
  config = next
  if (next) writeJSON(SYNC_STORAGE_KEY, next)
  else {
    try {
      localStorage.removeItem(SYNC_STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }
  for (const l of listeners) l()
}

function patchConfig(patch: Partial<SyncConfig>): void {
  if (config) setSyncConfig({ ...config, ...patch })
}

export function useSyncConfig(): SyncConfig | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    getSyncConfig,
    getSyncConfig,
  )
}

export class SyncHttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + path
}

async function request<T>(apiUrl: string, path: string, init: RequestInit & { key?: string; timeoutMs?: number } = {}): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 30_000)
  const headers = new Headers(init.headers)
  if (init.key) headers.set('Authorization', `Bearer ${init.key}`)
  try {
    const res = await fetch(joinUrl(apiUrl, path), { ...init, headers, signal: ctrl.signal })
    if (!res.ok) {
      let msg = res.statusText
      try {
        msg = ((await res.json()) as { error?: string }).error ?? msg
      } catch {
        /* ignore */
      }
      throw new SyncHttpError(res.status, msg)
    }
    const type = res.headers.get('content-type') ?? ''
    return (type.includes('application/json') ? await res.json() : await res.blob()) as T
  } finally {
    clearTimeout(timer)
  }
}

/** 用当前同步配置请求 API（未配置返回 null）。 */
export async function syncApi<T>(path: string, timeoutMs = 15_000): Promise<T | null> {
  const cfg = config
  if (!cfg) return null
  return request<T>(cfg.apiUrl, path, { key: cfg.key, timeoutMs })
}

export async function createHousehold(apiUrl: string, name: string, setupSecret?: string): Promise<{ householdId: string; key: string }> {
  return request(apiUrl, '/v1/households', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(setupSecret ? { 'X-Setup-Secret': setupSecret } : {}) },
    body: JSON.stringify({ name }),
  })
}

export async function checkKey(apiUrl: string, key: string): Promise<{ householdId: string; name: string }> {
  if (!parseSyncKey(key)) throw new SyncHttpError(400, 'invalid key format')
  return request(apiUrl, '/v1/household', { key })
}

export interface SyncReport {
  pushed: number
  pulled: number
  conflicts: number
  uploaded: number
}

let running: Promise<SyncReport> | null = null

/** 同步一次。并发调用会复用进行中的那次。 */
export function syncNow(store: AppStore): Promise<SyncReport> {
  if (!config) return Promise.reject(new Error('sync not configured'))
  running ??= doSync(store, config).finally(() => {
    running = null
  })
  return running
}

export function isSyncing(): boolean {
  return running !== null
}

const PUSH_CHUNK = 100

async function doSync(store: AppStore, cfg: SyncConfig): Promise<SyncReport> {
  const report: SyncReport = { pushed: 0, pulled: 0, conflicts: 0, uploaded: 0 }
  try {
    report.uploaded = await uploadFiles(store, cfg)

    // 推送
    const dirty = store.dirtyRecords()
    for (let i = 0; i < dirty.length; i += PUSH_CHUNK) {
      const chunk = dirty.slice(i, i + PUSH_CHUNK)
      const res = await request<PushResult>(cfg.apiUrl, '/v1/sync/push', {
        method: 'POST',
        key: cfg.key,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: chunk.map((d) => toPush(d.kind, d.record)) }),
      })
      const sent = new Map(chunk.map((d) => [`${d.kind}:${d.record.id}`, d.record]))
      const writes: Array<{ kind: SyncKind; record: BaseRecord }> = []
      for (const a of res.applied) {
        const cur = store.getRecord(a.kind as SyncKind, a.id)
        const pushed = sent.get(`${a.kind}:${a.id}`)
        if (!cur || !pushed) continue
        const unchanged = cur.rev === pushed.rev && cur.updatedAt === pushed.updatedAt
        const next: BaseRecord = { ...cur, _srv: a.ver }
        if (unchanged) delete next._dirty
        writes.push({ kind: a.kind as SyncKind, record: next })
      }
      const conflicts = takeServer(store, res.conflicts, writes)
      await store.applySync(writes, conflicts)
      report.pushed += res.applied.length
      report.conflicts += conflicts.length
    }

    // 拉取
    let cursor = cfg.cursor
    for (let guard = 0; guard < 1000; guard++) {
      const res = await request<PullResult>(cfg.apiUrl, `/v1/sync/pull?since=${cursor}`, { key: cfg.key })
      const writes: Array<{ kind: SyncKind; record: BaseRecord }> = []
      const conflictRecords: WireRecord[] = []
      const removedFiles: string[] = []
      for (const r of res.records) {
        const local = store.getRecord(r.kind as SyncKind, r.id)
        const d = decideRemote(local, r)
        if (d === 'skip') continue
        if (d === 'conflict') {
          conflictRecords.push(r)
          continue
        }
        writes.push({ kind: r.kind as SyncKind, record: { ...r.data, _srv: r.ver } })
        if (r.kind === 'attachments' && r.deleted) removedFiles.push(r.id)
      }
      const conflicts = takeServer(store, conflictRecords, writes)
      await store.applySync(writes, conflicts)
      for (const id of removedFiles) await store.deleteFile(id)
      report.pulled += writes.length
      report.conflicts += conflicts.length
      cursor = res.cursor
      patchConfig({ cursor })
      if (!res.more) break
    }
    patchConfig({ lastSyncAt: Date.now(), lastError: null })
    return report
  } catch (err) {
    patchConfig({ lastError: err instanceof Error ? err.message : String(err) })
    throw err
  }
}

/** 冲突：采用云端版本，本机版本存入冲突列表供用户复核/恢复。 */
function takeServer(store: AppStore, records: WireRecord[], writes: Array<{ kind: SyncKind; record: BaseRecord }>): ConflictEntry[] {
  const out: ConflictEntry[] = []
  for (const r of records) {
    const local = store.getRecord(r.kind as SyncKind, r.id)
    if (local) out.push({ kind: r.kind as SyncKind, id: r.id, local, at: Date.now() })
    writes.push({ kind: r.kind as SyncKind, record: { ...r.data, _srv: r.ver } })
  }
  return out
}

/** 冲突复核：用本机版本覆盖云端（基于当前云端版本重新推送）。 */
export async function keepLocalVersion(store: AppStore, index: number): Promise<void> {
  const c = store.getState().conflicts[index]
  if (!c) return
  const cur = store.getRecord(c.kind, c.id)
  const record: BaseRecord = {
    ...c.local,
    _srv: cur?._srv ?? 0,
    rev: (cur?.rev ?? c.local.rev) + 1,
    updatedAt: Date.now(),
    _dirty: 1,
  }
  await store.applySync([{ kind: c.kind, record }])
  await store.dismissConflict(index)
}

async function uploadFiles(store: AppStore, cfg: SyncConfig): Promise<number> {
  let n = 0
  const atts = Object.values(store.getState().snap.attachments).filter((a) => !a.deletedAt && a.provider === 'local' && !a.remote)
  for (const a of atts) {
    const f = await store.getFile(a.id)
    if (!f) continue
    await request(cfg.apiUrl, `/v1/files/${a.id}`, {
      method: 'PUT',
      key: cfg.key,
      headers: { 'Content-Type': f.mime || 'application/octet-stream', ...(a.checksum ? { 'X-Checksum-Sha256': a.checksum } : {}) },
      body: f.blob,
      timeoutMs: 120_000,
    })
    const cur = store.getRecord('attachments', a.id) as Attachment | undefined
    if (cur && !cur.deletedAt) {
      await store.applySync([{ kind: 'attachments', record: { ...cur, remote: true, rev: cur.rev + 1, updatedAt: Date.now(), _dirty: 1 } as Attachment }])
    }
    n++
  }
  return n
}

/** 取附件字节：本机优先；本机没有且云端有 → 下载并缓存。 */
export async function ensureLocalFile(store: AppStore, attachmentId: string): Promise<StoredFile | undefined> {
  const f = await store.getFile(attachmentId)
  if (f) return f
  const a = store.getRecord('attachments', attachmentId) as Attachment | undefined
  const cfg = config
  if (!a || a.deletedAt || !a.remote || !cfg) return undefined
  const blob = await request<Blob>(cfg.apiUrl, `/v1/files/${attachmentId}`, { key: cfg.key, timeoutMs: 120_000 })
  await store.saveFile(attachmentId, blob)
  return store.getFile(attachmentId)
}
