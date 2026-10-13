import { invalidateTree } from './tree.ts'
import type { AnyRecord, Change, Ctx, Entity, Snapshot, TableName } from './types.ts'

type TableRecord<T extends TableName> = Snapshot[T][string]

/**
 * 写事务：在基础快照上做写时复制，记录每条记录首次被触碰前的值。
 * 任何一步抛错，调用方丢弃 Tx 即可——基础快照从未被修改（整批不写入）。
 */
export class Tx {
  readonly ctx: Ctx
  private readonly base: Snapshot
  private readonly work: Snapshot
  private readonly copied = new Set<TableName>()
  private readonly touched = new Map<string, { table: TableName; id: string; before: AnyRecord | null }>()

  constructor(base: Snapshot, ctx: Ctx) {
    this.base = base
    this.work = { ...base }
    this.ctx = ctx
  }

  get snap(): Snapshot {
    return this.work
  }

  get<T extends TableName>(table: T, id: string): TableRecord<T> | undefined {
    return this.work[table][id] as TableRecord<T> | undefined
  }

  /** 写入一条记录：自动维护 rev / updatedAt / createdAt，并标记同步脏位。 */
  put<T extends TableName>(table: T, next: Omit<TableRecord<T>, 'rev' | 'createdAt' | 'updatedAt'> & Partial<TableRecord<T>>): TableRecord<T> {
    const prev = this.work[table][next.id] as TableRecord<T> | undefined
    const key = `${table}:${next.id}`
    if (!this.touched.has(key)) {
      this.touched.set(key, { table, id: next.id, before: (this.base[table][next.id] as AnyRecord | undefined) ?? null })
    }
    const rec = {
      ...next,
      createdAt: prev?.createdAt ?? next.createdAt ?? this.ctx.now,
      updatedAt: this.ctx.now,
      rev: (prev?.rev ?? 0) + 1,
      _srv: prev?._srv ?? next._srv,
      _dirty: 1,
    } as TableRecord<T>
    if (!this.copied.has(table)) {
      ;(this.work as unknown as Record<TableName, Record<string, AnyRecord>>)[table] = { ...this.work[table] }
      this.copied.add(table)
    }
    ;(this.work[table] as Record<string, AnyRecord>)[next.id] = rec as AnyRecord
    if (table === 'entities') invalidateTree(this.work.entities as Record<string, Entity>)
    return rec
  }

  /** 软删除（墓碑）。 */
  remove<T extends TableName>(table: T, id: string): void {
    const prev = this.work[table][id]
    if (!prev || prev.deletedAt) return
    this.put(table, { ...(prev as TableRecord<T>), deletedAt: this.ctx.now })
  }

  changes(): Change[] {
    const out: Change[] = []
    for (const t of this.touched.values()) {
      out.push({ table: t.table, id: t.id, before: t.before, after: this.work[t.table][t.id] as AnyRecord })
    }
    return out
  }

  result(): { snapshot: Snapshot; changes: Change[] } {
    return { snapshot: this.work, changes: this.changes() }
  }
}
