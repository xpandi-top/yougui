// 盘点：建立范围快照 → 录入实际值 / 已见 / 缺失 → 差异复核 → 保存调整。未扫描绝不自动归零。
import { Tx } from './tx.ts'
import { childrenOf, descendants, pathNames } from './tree.ts'
import { DomainError, type Entity, type Snapshot } from './types.ts'

export interface CountLine {
  entityId: string
  rev: number
  name: string
  path: string[]
  /** null = 不追踪数量，只能确认已见/缺失 */
  expected: number | null
}

export interface CountEntry {
  actual?: number
  seen?: boolean
  missing?: boolean
}

export type DiffKind = 'unchecked' | 'ok' | 'seen' | 'qty' | 'missing'

export interface DiffRow {
  line: CountLine
  kind: DiffKind
  actual?: number
}

export function buildCount(snap: Snapshot, scopeId: string | null, includeChildren: boolean): CountLine[] {
  const items: Entity[] = scopeId === null
    ? Object.values(snap.entities).filter((e) => !e.deletedAt)
    : includeChildren
      ? descendants(snap, scopeId)
      : childrenOf(snap, scopeId)
  return items
    .filter((e) => e.kind === 'item' && e.state === 'in')
    .map((e) => ({ entityId: e.id, rev: e.rev, name: e.name, path: pathNames(snap.entities, e.id), expected: e.quantity }))
}

export function diffCount(lines: CountLine[], entries: Record<string, CountEntry>): DiffRow[] {
  return lines.map((line) => {
    const en = entries[line.entityId]
    if (!en) return { line, kind: 'unchecked' }
    if (en.missing) return { line, kind: 'missing' }
    if (line.expected !== null && en.actual !== undefined) {
      return en.actual === line.expected ? { line, kind: 'ok', actual: en.actual } : { line, kind: 'qty', actual: en.actual }
    }
    if (en.seen || en.actual !== undefined) return { line, kind: line.expected === null ? 'seen' : 'ok', actual: en.actual }
    return { line, kind: 'unchecked' }
  })
}

/**
 * 应用盘点调整：数量差异写入实际值；明确标记缺失的不追踪物品记为已取出，追踪的归零。
 * 若某条目在盘点期间被修改（rev 变化），整批拒绝，要求重新复核。
 */
export function applyCount(tx: Tx, rows: DiffRow[]): number {
  let changed = 0
  for (const r of rows) {
    if (r.kind !== 'qty' && r.kind !== 'missing') continue
    const e = tx.snap.entities[r.line.entityId]
    if (!e || e.deletedAt || e.rev !== r.line.rev) throw new DomainError('stocktake.changed', { name: r.line.name })
  }
  for (const r of rows) {
    const e = tx.snap.entities[r.line.entityId]
    if (r.kind === 'qty') {
      if (!Number.isInteger(r.actual) || r.actual! < 0) throw new DomainError('qty.invalid')
      tx.put('entities', { ...e, quantity: r.actual! })
      changed++
    } else if (r.kind === 'missing') {
      tx.put('entities', e.quantity !== null ? { ...e, quantity: 0 } : { ...e, state: 'out' })
      changed++
    }
  }
  return changed
}
