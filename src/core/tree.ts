import type { Entity, Snapshot } from './types.ts'

/** 由实体表派生的父子索引（只含未删除实体）。按实体表对象做 memo，表不变则复用。 */
export interface TreeIndex {
  children: Map<string | null, string[]>
}

const cache = new WeakMap<Record<string, Entity>, TreeIndex>()

const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })

export function compareEntities(a: Entity, b: Entity): number {
  const rank = (e: Entity) => (e.kind === 'location' ? 0 : e.canContain ? 1 : 2)
  return rank(a) - rank(b) || collator.compare(a.name, b.name)
}

/** Tx 在工作副本上原地写入后调用，丢弃过期索引。 */
export function invalidateTree(entities: Record<string, Entity>): void {
  cache.delete(entities)
}

export function treeIndex(entities: Record<string, Entity>): TreeIndex {
  const hit = cache.get(entities)
  if (hit) return hit
  const children = new Map<string | null, string[]>()
  const list = Object.values(entities)
    .filter((e) => !e.deletedAt)
    .sort(compareEntities)
  for (const e of list) {
    // 父节点不存在或已删除时视为根（防御脏数据，不丢失实体）
    const parent = e.parentId && entities[e.parentId] && !entities[e.parentId].deletedAt ? e.parentId : null
    let arr = children.get(parent)
    if (!arr) children.set(parent, (arr = []))
    arr.push(e.id)
  }
  const idx = { children }
  cache.set(entities, idx)
  return idx
}

export function childrenOf(snap: Snapshot, parentId: string | null): Entity[] {
  const ids = treeIndex(snap.entities).children.get(parentId) ?? []
  return ids.map((id) => snap.entities[id])
}

export function rooms(snap: Snapshot): Entity[] {
  return childrenOf(snap, null).filter((e) => e.kind === 'location')
}

export function unassigned(snap: Snapshot): Entity[] {
  return childrenOf(snap, null).filter((e) => e.kind === 'item')
}

/** 从根到父节点的祖先链（不含自身）。遇到环或缺失父节点时截断。 */
export function ancestors(entities: Record<string, Entity>, id: string): Entity[] {
  const out: Entity[] = []
  const seen = new Set<string>([id])
  let cur = entities[id]?.parentId ?? null
  while (cur) {
    const e = entities[cur]
    if (!e || e.deletedAt || seen.has(cur)) break
    seen.add(cur)
    out.unshift(e)
    cur = e.parentId
  }
  return out
}

export function pathNames(entities: Record<string, Entity>, id: string, includeSelf = false): string[] {
  const names = ancestors(entities, id).map((e) => e.name)
  if (includeSelf && entities[id]) names.push(entities[id].name)
  return names
}

export const PATH_SEP = ' › '

export function pathText(entities: Record<string, Entity>, id: string, includeSelf = false): string {
  return pathNames(entities, id, includeSelf).join(PATH_SEP)
}

/** id 是否为 ancestorId 本身或其后代。 */
export function isSelfOrDescendant(entities: Record<string, Entity>, ancestorId: string, id: string): boolean {
  if (ancestorId === id) return true
  return ancestors(entities, id).some((a) => a.id === ancestorId)
}

export function descendants(snap: Snapshot, id: string): Entity[] {
  const idx = treeIndex(snap.entities)
  const out: Entity[] = []
  const stack = [...(idx.children.get(id) ?? [])].reverse()
  const seen = new Set<string>()
  while (stack.length) {
    const cur = stack.pop()!
    if (seen.has(cur)) continue
    seen.add(cur)
    out.push(snap.entities[cur])
    const kids = idx.children.get(cur)
    if (kids) for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i])
  }
  return out
}

export function liveChildCount(snap: Snapshot, id: string): number {
  return treeIndex(snap.entities).children.get(id)?.length ?? 0
}

/** 自身或任一祖先已取出 → 实际不在家中。 */
export function isEffectivelyOut(entities: Record<string, Entity>, id: string): boolean {
  const e = entities[id]
  if (!e) return false
  if (e.state === 'out') return true
  return ancestors(entities, id).some((a) => a.state === 'out')
}

/** 能否作为放置目标（位置，或开启容器的在库物品）。 */
export function canHold(e: Entity | undefined): e is Entity {
  return !!e && !e.deletedAt && (e.kind === 'location' || e.canContain)
}

export type MoveCheck =
  | { ok: true }
  | { ok: false; code: 'move.same' | 'move.cycle' | 'move.notContainer' | 'move.locationIntoItem' | 'move.missing' }

export function checkMove(snap: Snapshot, entityId: string, targetId: string | null): MoveCheck {
  const e = snap.entities[entityId]
  if (!e || e.deletedAt) return { ok: false, code: 'move.missing' }
  if (targetId === null) {
    return e.parentId === null && e.state === 'in' ? { ok: false, code: 'move.same' } : { ok: true }
  }
  const t = snap.entities[targetId]
  if (!t || t.deletedAt) return { ok: false, code: 'move.missing' }
  if (isSelfOrDescendant(snap.entities, entityId, targetId)) return { ok: false, code: 'move.cycle' }
  if (!canHold(t)) return { ok: false, code: 'move.notContainer' }
  if (e.kind === 'location' && t.kind !== 'location') return { ok: false, code: 'move.locationIntoItem' }
  if (e.parentId === targetId && e.state === 'in') return { ok: false, code: 'move.same' }
  return { ok: true }
}

/** 位置及其下所有物品数量摘要（用于房间卡片）。 */
export function countItems(snap: Snapshot, id: string): number {
  return descendants(snap, id).filter((e) => e.kind === 'item').length
}
