// 内存实现：测试与本地演示用，语义与 D1Store / R2FileStore 一致。
import type { CachedProduct } from './lookup.ts'
import type { FileEntry, FileStore, Household, PullResult, PushRecord, PushResult, SyncStore, WireRecord } from './types.ts'

export class MemoryStore implements SyncStore {
  households = new Map<string, Household>()
  counters = new Map<string, number>()
  records = new Map<string, WireRecord & { household: string }>()
  files = new Map<string, FileEntry & { household: string }>()
  products = new Map<string, CachedProduct>()

  async getProduct(code: string) {
    return this.products.get(code) ?? null
  }

  async putProduct(code: string, entry: CachedProduct) {
    this.products.set(code, entry)
  }

  async createHousehold(h: Household) {
    if (this.households.has(h.id)) throw new Error('exists')
    this.households.set(h.id, h)
    this.counters.set(h.id, 0)
  }

  async getHousehold(id: string) {
    return this.households.get(id) ?? null
  }

  async push(hid: string, records: PushRecord[]): Promise<PushResult> {
    const applied: PushResult['applied'] = []
    const conflicts: WireRecord[] = []
    for (const r of records) {
      const ver = (this.counters.get(hid) ?? 0) + 1
      this.counters.set(hid, ver)
      const key = `${hid}|${r.kind}|${r.id}`
      const cur = this.records.get(key)
      if (cur && cur.ver !== r.baseVer) {
        const { household: _h, ...wire } = cur
        conflicts.push(wire)
        continue
      }
      this.records.set(key, { household: hid, kind: r.kind, id: r.id, data: r.data, updatedAt: r.updatedAt, deleted: r.deleted, ver })
      applied.push({ kind: r.kind, id: r.id, ver })
    }
    return { applied, conflicts }
  }

  async pull(hid: string, since: number, limit: number): Promise<PullResult> {
    const records = [...this.records.values()]
      .filter((r) => r.household === hid && r.ver > since)
      .sort((a, b) => a.ver - b.ver)
      .slice(0, limit)
      .map(({ household: _h, ...r }) => r)
    return { records, cursor: records.length ? records[records.length - 1].ver : since, more: records.length === limit }
  }

  async getFile(hid: string, aid: string) {
    const f = this.files.get(`${hid}|${aid}`)
    if (!f) return null
    const { household: _h, ...entry } = f
    return entry
  }

  async putFile(hid: string, f: FileEntry) {
    this.files.set(`${hid}|${f.attachmentId}`, { ...f, household: hid })
  }

  async deleteFile(hid: string, aid: string) {
    this.files.delete(`${hid}|${aid}`)
  }

  async usedBytes(hid: string) {
    return [...this.files.values()].filter((f) => f.household === hid).reduce((n, f) => n + f.size, 0)
  }

  async attachmentLive(hid: string, aid: string) {
    const r = this.records.get(`${hid}|attachments|${aid}`)
    return !!r && !r.deleted
  }

  async orphanFiles(olderThan: number, limit: number) {
    const out: Array<{ householdId: string; attachmentId: string }> = []
    for (const f of this.files.values()) {
      const r = this.records.get(`${f.household}|attachments|${f.attachmentId}`)
      if ((!r && f.createdAt < olderThan) || r?.deleted) out.push({ householdId: f.household, attachmentId: f.attachmentId })
    }
    return out.slice(0, limit)
  }
}

export class MemoryFiles implements FileStore {
  objects = new Map<string, { body: ArrayBuffer; contentType: string }>()
  async put(key: string, body: ArrayBuffer, meta: { contentType: string }) {
    this.objects.set(key, { body, contentType: meta.contentType })
  }
  async get(key: string) {
    const o = this.objects.get(key)
    return o ? { body: o.body, contentType: o.contentType, size: o.body.byteLength } : null
  }
  async delete(key: string) {
    this.objects.delete(key)
  }
}
