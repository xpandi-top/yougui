// 完整备份：ZIP = manifest.json + data.json + files/<附件id>.<ext>。
// 外链只备份引用（content_included=false）；同步密钥等凭据不导出。
import {
  TABLES,
  emptySnapshot,
  stripSync,
  type AnyRecord,
  type BaseRecord,
  type Household,
  type Operation,
  type Snapshot,
} from '../core/index.ts'
import type { StoredFile } from './db.ts'
import { extFor, sha256 } from './files.ts'
import type { AppStore, SyncKind } from './store.ts'

export const BACKUP_SCHEMA = 1

export interface BackupManifest {
  app: 'yougui'
  schemaVersion: number
  appVersion: string
  exportedAt: string
  counts: Record<string, number>
  files: Array<{ id: string; path: string; size: number; mime: string; checksum: string }>
  external: Array<{ id: string; name: string; url: string; content_included: false; reason: string }>
  missing: Array<{ id: string; name: string; reason: string }>
}

interface BackupData {
  schemaVersion: number
  household: Household | null
  tables: Record<string, AnyRecord[]>
  ops: Operation[]
}

export async function exportBackup(store: AppStore, appVersion: string): Promise<{ blob: Blob; manifest: BackupManifest }> {
  const { zipSync, strToU8 } = await import('fflate')
  const s = store.getState()
  const tables: Record<string, AnyRecord[]> = {}
  for (const t of TABLES) tables[t] = (Object.values(s.snap[t]) as AnyRecord[]).map((r) => stripSync(r))
  const data: BackupData = {
    schemaVersion: BACKUP_SCHEMA,
    household: s.household ? stripSync(s.household) : null,
    tables,
    ops: s.ops.map((o) => stripSync(o)),
  }
  const manifest: BackupManifest = {
    app: 'yougui',
    schemaVersion: BACKUP_SCHEMA,
    appVersion,
    exportedAt: new Date().toISOString(),
    counts: Object.fromEntries([...TABLES.map((t) => [t, tables[t].length]), ['ops', data.ops.length]]),
    files: [],
    external: [],
    missing: [],
  }
  const entries: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {}
  for (const a of Object.values(s.snap.attachments)) {
    if (a.deletedAt) continue
    if (a.provider === 'external_url') {
      manifest.external.push({ id: a.id, name: a.name, url: a.url ?? '', content_included: false, reason: 'external_url' })
      continue
    }
    const f = await store.getFile(a.id)
    if (!f) {
      manifest.missing.push({ id: a.id, name: a.name, reason: a.remote ? 'cloud_only' : 'not_on_device' })
      continue
    }
    const path = `files/${a.id}.${extFor(f.mime)}`
    entries[path] = [new Uint8Array(await f.blob.arrayBuffer()), { level: 0 }]
    manifest.files.push({ id: a.id, path, size: f.size, mime: f.mime, checksum: a.checksum ?? (await sha256(f.blob)) })
  }
  entries['data.json'] = strToU8(JSON.stringify(data))
  entries['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))
  const zipped = zipSync(entries, { level: 6 })
  return { blob: new Blob([zipped as BlobPart], { type: 'application/zip' }), manifest }
}

export interface ParsedBackup {
  manifest: BackupManifest
  household: Household | null
  snap: Snapshot
  ops: Operation[]
  files: StoredFile[]
  /** 校验和不一致的文件 */
  corrupt: string[]
}

export class BackupError extends Error {}

export async function readBackup(file: Blob): Promise<ParsedBackup> {
  const { unzipSync, strFromU8 } = await import('fflate')
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
  } catch {
    throw new BackupError('notZip')
  }
  if (!entries['manifest.json'] || !entries['data.json']) throw new BackupError('missingParts')
  const manifest = JSON.parse(strFromU8(entries['manifest.json'])) as BackupManifest
  if (manifest.app !== 'yougui') throw new BackupError('notYougui')
  if (manifest.schemaVersion > BACKUP_SCHEMA) throw new BackupError('newerSchema')
  const data = JSON.parse(strFromU8(entries['data.json'])) as BackupData
  const snap = emptySnapshot()
  for (const t of TABLES) {
    const map = snap[t] as Record<string, AnyRecord>
    for (const r of data.tables[t] ?? []) if (r && typeof r.id === 'string') map[r.id] = r
  }
  const files: StoredFile[] = []
  const corrupt: string[] = []
  for (const f of manifest.files) {
    const bytes = entries[f.path]
    if (!bytes) {
      corrupt.push(f.id)
      continue
    }
    const blob = new Blob([bytes as BlobPart], { type: f.mime })
    if ((await sha256(blob)) !== f.checksum) corrupt.push(f.id)
    else files.push({ id: f.id, blob, mime: f.mime, size: blob.size })
  }
  return { manifest, household: data.household, snap, ops: data.ops ?? [], files, corrupt }
}

function markDirty<T extends BaseRecord>(r: T, keepSrv?: number): T {
  return { ...stripSync(r), _dirty: 1, ...(keepSrv ? { _srv: keepSrv } : {}) } as T
}

/** 替换：清空本机后导入（仅在未开启云同步时允许，避免与云端数据交错）。 */
export async function restoreReplace(store: AppStore, b: ParsedBackup): Promise<void> {
  const snap = emptySnapshot()
  for (const t of TABLES) {
    const map = snap[t] as Record<string, AnyRecord>
    for (const r of Object.values(b.snap[t]) as AnyRecord[]) map[r.id] = markDirty(r)
  }
  await store.replaceAll({ household: b.household ? markDirty(b.household) : null, snap, ops: b.ops.map((o) => markDirty(o)) }, b.files)
}

/** 合并：按 id 对齐，备份中更新的记录覆盖本机，本机独有记录保留。返回写入条数。 */
export async function restoreMerge(store: AppStore, b: ParsedBackup): Promise<number> {
  const writes: Array<{ kind: SyncKind; record: BaseRecord }> = []
  for (const t of TABLES) {
    for (const r of Object.values(b.snap[t]) as AnyRecord[]) {
      const local = store.getRecord(t, r.id)
      if (!local || r.updatedAt > local.updatedAt) {
        writes.push({ kind: t, record: markDirty({ ...r, rev: Math.max(r.rev, (local?.rev ?? 0) + 1) }, local?._srv) })
      }
    }
  }
  for (const o of b.ops) if (!store.getRecord('ops', o.id)) writes.push({ kind: 'ops', record: markDirty(o) })
  if (b.household && !store.getState().household) writes.push({ kind: 'household', record: markDirty(b.household) })
  await store.applySync(writes)
  const have = new Set(await store.allFileIds())
  for (const f of b.files) if (!have.has(f.id)) await store.saveFile(f.id, f.blob)
  return writes.length
}
