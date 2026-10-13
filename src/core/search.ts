import { ancestors, isSelfOrDescendant, pathNames } from './tree.ts'
import type { Entity, Snapshot } from './types.ts'

/** 规范化：全半角统一、小写、去空白与常见标点。 */
export function normalize(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\-_·•.,，。、/\\|()（）[\]【】'"“”‘’!！?？:：;；]+/g, '')
}

export interface SearchOptions {
  /** 限定在某位置（含子层级）内搜索 */
  scopeId?: string | null
  kinds?: Array<Entity['kind']>
  includeOut?: boolean
  limit?: number
}

export interface SearchHit {
  entity: Entity
  score: number
  path: string[]
}

/**
 * 名称/路径/备注/分类/商品码搜索。多个关键词（空格分隔）须全部命中名称或路径。
 * 1 万条以内线性扫描足够快（PRD 目标 P95 ≤ 1 秒）。
 */
export function search(snap: Snapshot, query: string, opts: SearchOptions = {}): SearchHit[] {
  const terms = query
    .split(/\s+/)
    .map(normalize)
    .filter(Boolean)
  if (!terms.length) return []
  const limit = opts.limit ?? 200
  const hits: SearchHit[] = []
  for (const e of Object.values(snap.entities)) {
    if (e.deletedAt) continue
    if (opts.kinds && !opts.kinds.includes(e.kind)) continue
    if (opts.includeOut === false && e.state === 'out') continue
    if (opts.scopeId && (e.id === opts.scopeId || !isSelfOrDescendant(snap.entities, opts.scopeId, e.id))) continue
    const name = normalize(e.name)
    const path = pathNames(snap.entities, e.id)
    const pathN = normalize(path.join(''))
    const extra = normalize([e.note ?? '', e.category ?? ''].join(' '))
    const codes = e.typeId ? (snap.types[e.typeId]?.barcodes ?? []) : []
    let score = 0
    let ok = true
    for (const t of terms) {
      let s = 0
      if (name === t) s = 100
      else if (name.startsWith(t)) s = 80
      else if (name.includes(t)) s = 60
      else if (codes.some((c) => c === t || c.endsWith(t))) s = 70
      else if (pathN.includes(t)) s = 30
      else if (extra.includes(t)) s = 20
      if (!s) {
        ok = false
        break
      }
      score += s
    }
    if (!ok) continue
    if (e.state === 'out') score -= 5
    hits.push({ entity: e, score, path })
  }
  hits.sort((a, b) => b.score - a.score || a.entity.name.length - b.entity.name.length || a.entity.name.localeCompare(b.entity.name, 'zh-Hans-CN'))
  return hits.slice(0, limit)
}

/** 相似名称提示：规范化后相同或互相包含的同类实体。只提示，不强制合并。 */
export function similarNames(snap: Snapshot, name: string, kind: Entity['kind']): Entity[] {
  const n = normalize(name)
  if (n.length < 2) return []
  return Object.values(snap.entities)
    .filter((e) => {
      if (e.deletedAt || e.kind !== kind) return false
      const m = normalize(e.name)
      return m === n || (n.length >= 3 && (m.includes(n) || n.includes(m)) && m.length >= 2)
    })
    .slice(0, 5)
}

/** 位置选择器用：位置与容器（可作为放置目标）按完整路径搜索。 */
export function searchHolders(snap: Snapshot, query: string): Entity[] {
  const q = normalize(query)
  return Object.values(snap.entities)
    .filter((e) => !e.deletedAt && (e.kind === 'location' || e.canContain))
    .filter((e) => !q || normalize([...ancestors(snap.entities, e.id).map((a) => a.name), e.name].join('')).includes(q))
    .slice(0, 100)
}
