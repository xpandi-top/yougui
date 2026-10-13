// 应用数据仓库：内存快照 + IndexedDB 持久化 + 订阅。本机数据是唯一真相，云端只是同步通道。
import {
  Tx,
  TABLES,
  TOKEN_ALPHABET,
  emptySnapshot,
  randomString,
  undoOperation,
  type AnyRecord,
  type BaseRecord,
  type Ctx,
  type Household,
  type OpSummary,
  type OpType,
  type Operation,
  type Snapshot,
  type TableName,
} from '../core/index.ts'
import { META_CONFLICTS, META_HOUSEHOLD, openAppDb, type AppDB, type StoredFile } from './db.ts'

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n))
}

export function newId(): string {
  return randomString(TOKEN_ALPHABET, 16, randomBytes)
}

/** 家庭记录是单例，固定 id，便于多设备同步合并。 */
export const HOUSEHOLD_ID = 'home'

export type SyncKind = TableName | 'ops' | 'household'

export interface ConflictEntry {
  kind: SyncKind
  id: string
  /** 被云端版本替换掉的本机版本 */
  local: BaseRecord
  at: number
}

export interface StoreState {
  snap: Snapshot
  /** 新到旧 */
  ops: Operation[]
  household: Household | null
  conflicts: ConflictEntry[]
  version: number
}

export interface CommitResult<T> {
  out: T
  op: Operation | null
}

export class AppStore {
  private readonly db: AppDB
  private state: StoreState
  private readonly listeners = new Set<() => void>()
  private queue: Promise<unknown> = Promise.resolve()

  private constructor(db: AppDB, state: StoreState) {
    this.db = db
    this.state = state
  }

  static async open(dbName?: string): Promise<AppStore> {
    const db = await openAppDb(dbName)
    const snap = emptySnapshot()
    for (const t of TABLES) {
      const rows = (await db.getAll(t)) as AnyRecord[]
      const map = snap[t] as Record<string, AnyRecord>
      for (const r of rows) map[r.id] = r
    }
    const ops = (await db.getAll('ops')).sort((a, b) => b.createdAt - a.createdAt)
    const household = ((await db.get('meta', META_HOUSEHOLD)) as Household | undefined) ?? null
    const conflicts = ((await db.get('meta', META_CONFLICTS)) as ConflictEntry[] | undefined) ?? []
    return new AppStore(db, { snap, ops, household, conflicts, version: 0 })
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getState = (): StoreState => this.state

  private set(patch: Partial<StoreState>): void {
    this.state = { ...this.state, ...patch, version: this.state.version + 1 }
    for (const fn of this.listeners) fn()
  }

  ctx(): Ctx {
    return { now: Date.now(), newId }
  }

  /** 串行化写盘，保证顺序。 */
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const p = this.queue.then(job, job)
    this.queue = p.catch(() => undefined)
    return p
  }

  private async persist(records: Array<{ store: TableName | 'ops'; value: AnyRecord | Operation }>): Promise<void> {
    if (!records.length) return
    const stores = [...new Set(records.map((r) => r.store))]
    const tx = this.db.transaction(stores, 'readwrite')
    await Promise.all([...records.map((r) => tx.objectStore(r.store).put(r.value as never)), tx.done])
  }

  /**
   * 执行一次业务操作：在 Tx 中运行 fn，成功后更新内存并写日志与 IndexedDB。
   * fn 抛错时不产生任何修改。写盘失败则回滚内存并抛出。
   */
  async commit<T>(
    type: OpType,
    summary: OpSummary | ((out: NoInfer<T>, tx: Tx) => OpSummary),
    fn: (tx: Tx) => T,
    opts: { batchId?: string; undoOf?: string; extra?: (op: Operation) => Operation[] } = {},
  ): Promise<CommitResult<T>> {
    const prev = this.state
    const ctx = this.ctx()
    const tx = new Tx(prev.snap, ctx)
    const out = fn(tx)
    const changes = tx.changes()
    if (!changes.length) return { out, op: null }
    const op: Operation = {
      id: newId(),
      type,
      summary: typeof summary === 'function' ? summary(out, tx) : summary,
      changes,
      batchId: opts.batchId,
      undoOf: opts.undoOf,
      createdAt: ctx.now,
      updatedAt: ctx.now,
      rev: 1,
      _dirty: 1,
    }
    const extraOps = opts.extra?.(op) ?? []
    let ops = [op, ...prev.ops]
    for (const e of extraOps) ops = ops.map((o) => (o.id === e.id ? e : o))
    this.set({ snap: tx.snap, ops })
    try {
      await this.enqueue(() =>
        this.persist([
          ...changes.map((c) => ({ store: c.table, value: c.after })),
          { store: 'ops' as const, value: op },
          ...extraOps.map((e) => ({ store: 'ops' as const, value: e })),
        ]),
      )
    } catch (err) {
      this.set({ snap: prev.snap, ops: prev.ops })
      throw err
    }
    return { out, op }
  }

  async undo(opId: string): Promise<Operation> {
    const target = this.state.ops.find((o) => o.id === opId)
    if (!target) throw new Error('op not found')
    const { op } = await this.commit('undo', { ...target.summary, text: target.type }, (tx) => undoOperation(tx, target), {
      undoOf: target.id,
      extra: (undoOp) => [{ ...target, undoneBy: undoOp.id, updatedAt: undoOp.createdAt, rev: target.rev + 1, _dirty: 1 }],
    })
    if (!op) throw new Error('nothing to undo')
    return op
  }

  async setHousehold(name: string): Promise<Household> {
    const now = Date.now()
    const prev = this.state.household
    const h: Household = prev
      ? { ...prev, name, updatedAt: now, rev: prev.rev + 1, _dirty: 1 }
      : { id: HOUSEHOLD_ID, name, createdAt: now, updatedAt: now, rev: 1, _dirty: 1 }
    await this.enqueue(() => this.db.put('meta', h, META_HOUSEHOLD))
    this.set({ household: h })
    return h
  }

  // ───────────── 文件（附件字节） ─────────────

  async saveFile(id: string, blob: Blob): Promise<void> {
    const f: StoredFile = { id, blob, mime: blob.type, size: blob.size }
    await this.enqueue(() => this.db.put('files', f))
  }

  async getFile(id: string): Promise<StoredFile | undefined> {
    return this.db.get('files', id)
  }

  async hasFile(id: string): Promise<boolean> {
    return (await this.db.getKey('files', id)) !== undefined
  }

  async deleteFile(id: string): Promise<void> {
    await this.enqueue(() => this.db.delete('files', id))
  }

  async allFileIds(): Promise<string[]> {
    return (await this.db.getAllKeys('files')) as string[]
  }

  // ───────────── 同步支持 ─────────────

  /** 所有有未上传修改的记录。 */
  dirtyRecords(): Array<{ kind: SyncKind; record: BaseRecord }> {
    const out: Array<{ kind: SyncKind; record: BaseRecord }> = []
    const s = this.state
    if (s.household?._dirty) out.push({ kind: 'household', record: s.household })
    for (const t of TABLES) {
      for (const r of Object.values(s.snap[t]) as BaseRecord[]) if (r._dirty) out.push({ kind: t, record: r })
    }
    for (const o of s.ops) if (o._dirty) out.push({ kind: 'ops', record: o })
    return out
  }

  getRecord(kind: SyncKind, id: string): BaseRecord | undefined {
    if (kind === 'household') return this.state.household?.id === id ? this.state.household : undefined
    if (kind === 'ops') return this.state.ops.find((o) => o.id === id)
    return (this.state.snap[kind] as Record<string, BaseRecord>)[id]
  }

  /**
   * 写入同步结果（不产生操作日志）。
   * - records：要写入的记录（已带正确的 _srv / _dirty）。
   * - conflicts：被替换的本机版本，留给用户复核。
   */
  async applySync(records: Array<{ kind: SyncKind; record: BaseRecord }>, conflicts: ConflictEntry[] = []): Promise<void> {
    if (!records.length && !conflicts.length) return
    const snap: Snapshot = { ...this.state.snap }
    const copied = new Set<TableName>()
    let ops = this.state.ops
    let household = this.state.household
    const writes: Array<() => Promise<unknown>> = []
    let opsChanged = false
    for (const { kind, record } of records) {
      if (kind === 'household') {
        household = record as Household
        writes.push(() => this.db.put('meta', record, META_HOUSEHOLD))
      } else if (kind === 'ops') {
        const i = ops.findIndex((o) => o.id === record.id)
        if (!opsChanged) ops = [...ops]
        opsChanged = true
        if (i >= 0) ops[i] = record as Operation
        else ops.push(record as Operation)
        writes.push(() => this.db.put('ops', record as Operation))
      } else if ((TABLES as string[]).includes(kind)) {
        if (!copied.has(kind)) {
          ;(snap as unknown as Record<TableName, Record<string, AnyRecord>>)[kind] = { ...snap[kind] }
          copied.add(kind)
        }
        ;(snap[kind] as Record<string, AnyRecord>)[record.id] = record as AnyRecord
        writes.push(() => this.db.put(kind, record as never))
      }
    }
    if (opsChanged) ops.sort((a, b) => b.createdAt - a.createdAt)
    const allConflicts = conflicts.length ? [...conflicts, ...this.state.conflicts].slice(0, 200) : this.state.conflicts
    await this.enqueue(async () => {
      for (const w of writes) await w()
      if (conflicts.length) await this.db.put('meta', allConflicts, META_CONFLICTS)
    })
    this.set({ snap, ops, household, conflicts: allConflicts })
  }

  async dismissConflict(index: number): Promise<void> {
    const conflicts = this.state.conflicts.filter((_, i) => i !== index)
    await this.enqueue(() => this.db.put('meta', conflicts, META_CONFLICTS))
    this.set({ conflicts })
  }

  // ───────────── 导入 / 清空 ─────────────

  async replaceAll(data: { household: Household | null; snap: Snapshot; ops: Operation[] }, files: StoredFile[]): Promise<void> {
    await this.enqueue(async () => {
      const stores = [...TABLES, 'ops', 'files', 'meta'] as const
      const tx = this.db.transaction(stores, 'readwrite')
      for (const s of stores) await tx.objectStore(s).clear()
      for (const t of TABLES) for (const r of Object.values(data.snap[t])) await tx.objectStore(t).put(r as never)
      for (const o of data.ops) await tx.objectStore('ops').put(o)
      for (const f of files) await tx.objectStore('files').put(f)
      if (data.household) await tx.objectStore('meta').put(data.household, META_HOUSEHOLD)
      await tx.done
    })
    this.set({
      snap: data.snap,
      ops: [...data.ops].sort((a, b) => b.createdAt - a.createdAt),
      household: data.household,
      conflicts: [],
    })
  }

  async clearAll(): Promise<void> {
    await this.replaceAll({ household: null, snap: emptySnapshot(), ops: [] }, [])
  }

  close(): void {
    this.db.close()
  }
}
