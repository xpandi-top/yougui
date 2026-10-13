// 云同步的纯规则：记录级乐观并发（baseVer），冲突不静默覆盖。
import type { BaseRecord } from './types.ts'

/** 同步线上传输的记录。kind 为表名（含 ops / household）。 */
export interface WireRecord {
  kind: string
  id: string
  data: BaseRecord
  updatedAt: number
  deleted: boolean
  ver: number
}

export interface PushRecord {
  kind: string
  id: string
  data: BaseRecord
  updatedAt: number
  deleted: boolean
  /** 本地修改基于的服务端版本；0 = 认为云端没有这条 */
  baseVer: number
}

export interface PushResult {
  applied: Array<{ kind: string; id: string; ver: number }>
  conflicts: WireRecord[]
}

export interface PullResult {
  records: WireRecord[]
  cursor: number
  more: boolean
}

export function stripSync<T extends BaseRecord>(r: T): T {
  const { _srv: _a, _dirty: _b, ...rest } = r
  return rest as T
}

function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(',')}}`
}

/** 忽略同步元数据与 rev/updatedAt 的内容比较。 */
export function sameContent(a: BaseRecord, b: BaseRecord): boolean {
  const strip = (r: BaseRecord) => {
    const { rev: _r, updatedAt: _u, ...rest } = stripSync(r)
    return rest
  }
  return stable(strip(a)) === stable(strip(b))
}

export type MergeDecision = 'take' | 'skip' | 'conflict'

/** 拉取到云端记录时如何处理本地同 id 记录。 */
export function decideRemote(local: BaseRecord | undefined, remote: WireRecord): MergeDecision {
  if (!local) return 'take'
  if ((local._srv ?? 0) >= remote.ver) return 'skip'
  if (!local._dirty) return 'take'
  if (sameContent(local, remote.data)) return 'take'
  return 'conflict'
}

export function toPush(kind: string, r: BaseRecord): PushRecord {
  return { kind, id: r.id, data: stripSync(r), updatedAt: r.updatedAt, deleted: !!r.deletedAt, baseVer: r._srv ?? 0 }
}

/** 同步密钥格式：<householdId>.<secret> */
export function parseSyncKey(key: string): { householdId: string; secret: string } | null {
  const m = key.trim().match(/^([a-z0-9]{8,40})\.([A-Za-z0-9_-]{20,128})$/)
  return m ? { householdId: m[1], secret: m[2] } : null
}
