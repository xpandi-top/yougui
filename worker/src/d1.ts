import type { CachedProduct } from './lookup.ts'
import type { FileEntry, Household, PullResult, PushRecord, PushResult, SyncStore, WireRecord } from './types.ts'

interface RecordRow {
  kind: string
  id: string
  data: string
  updated_at: number
  deleted: number
  ver: number
}

function toWire(r: RecordRow): WireRecord {
  return { kind: r.kind, id: r.id, data: JSON.parse(r.data), updatedAt: r.updated_at, deleted: !!r.deleted, ver: r.ver }
}

/**
 * D1 记录存储。push 在一个 batch（事务）内为每条记录先递增家庭计数器再条件 upsert，
 * 保证 ver 按提交顺序单调递增（拉取游标不漏），且 baseVer 不匹配的写入不生效（冲突）。
 */
export class D1Store implements SyncStore {
  constructor(private readonly db: D1Database) {}

  async createHousehold(h: Household): Promise<void> {
    await this.db.batch([
      this.db.prepare('INSERT INTO households (id, name, token_hash, created_at) VALUES (?, ?, ?, ?)').bind(h.id, h.name, h.tokenHash, h.createdAt),
      this.db.prepare('INSERT INTO counters (household_id, ver) VALUES (?, 0)').bind(h.id),
    ])
  }

  async getHousehold(id: string): Promise<Household | null> {
    const r = await this.db.prepare('SELECT id, name, token_hash, created_at FROM households WHERE id = ?').bind(id).first<{ id: string; name: string; token_hash: string; created_at: number }>()
    return r ? { id: r.id, name: r.name, tokenHash: r.token_hash, createdAt: r.created_at } : null
  }

  async push(hid: string, records: PushRecord[]): Promise<PushResult> {
    if (!records.length) return { applied: [], conflicts: [] }
    const stmts: D1PreparedStatement[] = []
    for (const r of records) {
      stmts.push(this.db.prepare('UPDATE counters SET ver = ver + 1 WHERE household_id = ? RETURNING ver').bind(hid))
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO records (household_id, kind, id, data, updated_at, deleted, ver)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, (SELECT ver FROM counters WHERE household_id = ?1))
             ON CONFLICT (household_id, kind, id) DO UPDATE SET
               data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted, ver = excluded.ver
             WHERE records.ver = ?7`,
          )
          .bind(hid, r.kind, r.id, JSON.stringify(r.data), r.updatedAt, r.deleted ? 1 : 0, r.baseVer),
      )
    }
    const res = await this.db.batch(stmts)
    const applied: PushResult['applied'] = []
    const conflictKeys: PushRecord[] = []
    records.forEach((r, i) => {
      const ver = (res[i * 2].results[0] as { ver: number } | undefined)?.ver ?? 0
      if ((res[i * 2 + 1].meta.changes ?? 0) > 0) applied.push({ kind: r.kind, id: r.id, ver })
      else conflictKeys.push(r)
    })
    const conflicts: WireRecord[] = []
    for (const r of conflictKeys) {
      const row = await this.db
        .prepare('SELECT kind, id, data, updated_at, deleted, ver FROM records WHERE household_id = ? AND kind = ? AND id = ?')
        .bind(hid, r.kind, r.id)
        .first<RecordRow>()
      if (row) conflicts.push(toWire(row))
    }
    return { applied, conflicts }
  }

  async pull(hid: string, since: number, limit: number): Promise<PullResult> {
    const { results } = await this.db
      .prepare('SELECT kind, id, data, updated_at, deleted, ver FROM records WHERE household_id = ? AND ver > ? ORDER BY ver LIMIT ?')
      .bind(hid, since, limit)
      .all<RecordRow>()
    const records = results.map(toWire)
    return { records, cursor: records.length ? records[records.length - 1].ver : since, more: records.length === limit }
  }

  async getFile(hid: string, aid: string): Promise<FileEntry | null> {
    const r = await this.db
      .prepare('SELECT attachment_id, size, mime, checksum, created_at FROM files WHERE household_id = ? AND attachment_id = ?')
      .bind(hid, aid)
      .first<{ attachment_id: string; size: number; mime: string; checksum: string; created_at: number }>()
    return r ? { attachmentId: r.attachment_id, size: r.size, mime: r.mime, checksum: r.checksum, createdAt: r.created_at } : null
  }

  async putFile(hid: string, f: FileEntry): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO files (household_id, attachment_id, size, mime, checksum, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (household_id, attachment_id) DO UPDATE SET size = excluded.size, mime = excluded.mime, checksum = excluded.checksum`,
      )
      .bind(hid, f.attachmentId, f.size, f.mime, f.checksum, f.createdAt)
      .run()
  }

  async deleteFile(hid: string, aid: string): Promise<void> {
    await this.db.prepare('DELETE FROM files WHERE household_id = ? AND attachment_id = ?').bind(hid, aid).run()
  }

  async usedBytes(hid: string): Promise<number> {
    const r = await this.db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM files WHERE household_id = ?').bind(hid).first<{ n: number }>()
    return r?.n ?? 0
  }

  async attachmentLive(hid: string, aid: string): Promise<boolean> {
    const r = await this.db
      .prepare("SELECT deleted FROM records WHERE household_id = ? AND kind = 'attachments' AND id = ?")
      .bind(hid, aid)
      .first<{ deleted: number }>()
    return !!r && !r.deleted
  }

  async orphanFiles(olderThan: number, limit: number): Promise<Array<{ householdId: string; attachmentId: string }>> {
    const { results } = await this.db
      .prepare(
        `SELECT f.household_id AS householdId, f.attachment_id AS attachmentId FROM files f
         LEFT JOIN records r ON r.household_id = f.household_id AND r.kind = 'attachments' AND r.id = f.attachment_id
         WHERE (r.id IS NULL AND f.created_at < ?) OR r.deleted = 1
         LIMIT ?`,
      )
      .bind(olderThan, limit)
      .all<{ householdId: string; attachmentId: string }>()
    return results
  }

  async getProduct(code: string): Promise<CachedProduct | null> {
    const r = await this.db.prepare('SELECT status, data, fetched_at FROM product_cache WHERE code = ?').bind(code).first<{ status: string; data: string | null; fetched_at: number }>()
    if (!r) return null
    return { status: r.status === 'found' ? 'found' : 'notFound', info: r.data ? JSON.parse(r.data) : undefined, fetchedAt: r.fetched_at }
  }

  async putProduct(code: string, entry: CachedProduct): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO product_cache (code, status, data, fetched_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (code) DO UPDATE SET status = excluded.status, data = excluded.data, fetched_at = excluded.fetched_at`,
      )
      .bind(code, entry.status, entry.info ? JSON.stringify(entry.info) : null, entry.fetchedAt)
      .run()
  }
}
