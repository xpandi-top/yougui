// 业务操作：全部在 Tx 上执行，校验失败抛 DomainError，整批不写入。
import { Tx } from './tx.ts'
import { canHold, checkMove, childrenOf, liveChildCount } from './tree.ts'
import type { ProductCode } from './codes.ts'
import {
  DomainError,
  type Attachment,
  type AttachmentLink,
  type AttachmentProvider,
  type AttachmentTypeKey,
  type Entity,
  type EntityKind,
  type ItemType,
  type Label,
  type LinkTargetKind,
  type Operation,
  type Snapshot,
} from './types.ts'

export const NAME_MAX = 80
export const NOTE_MAX = 1000
export const QTY_MAX = 1_000_000
export const LABEL_BATCH_MAX = 200

export function cleanName(name: string, max = NAME_MAX): string {
  const s = name.trim().replace(/\s+/g, ' ')
  if (!s) throw new DomainError('name.required')
  if (s.length > max) throw new DomainError('name.tooLong', { max })
  return s
}

function cleanText(s: string | undefined, max = NOTE_MAX): string | undefined {
  if (s === undefined) return undefined
  const v = s.trim()
  if (v.length > max) throw new DomainError('note.tooLong', { max })
  return v || undefined
}

export function cleanQty(q: number | null | undefined): number | null {
  if (q === null || q === undefined) return null
  if (!Number.isInteger(q) || q < 0 || q > QTY_MAX) throw new DomainError('qty.invalid')
  return q
}

function cleanPositive(q: number | undefined, fallback = 1): number {
  const n = q ?? fallback
  if (!Number.isInteger(n) || n < 1 || n > QTY_MAX) throw new DomainError('qty.invalid')
  return n
}

export function liveEntity(tx: Tx | { snap: Snapshot }, id: string): Entity {
  const e = tx.snap.entities[id]
  if (!e || e.deletedAt) throw new DomainError('entity.missing')
  return e
}

// ───────────────────────── 实体 ─────────────────────────

export interface CreateInput {
  kind: EntityKind
  name: string
  parentId?: string | null
  canContain?: boolean
  quantity?: number | null
  unit?: string
  iconKey?: string | null
  note?: string
  category?: string
  typeId?: string | null
}

export function createEntity(tx: Tx, input: CreateInput): Entity {
  const parentId = input.parentId ?? null
  if (parentId) {
    const p = tx.snap.entities[parentId]
    if (!canHold(p)) throw new DomainError('parent.invalid')
    if (input.kind === 'location' && p.kind !== 'location') throw new DomainError('move.locationIntoItem')
  }
  const isLoc = input.kind === 'location'
  const quantity = isLoc ? null : cleanQty(input.quantity)
  const canContain = isLoc ? true : !!input.canContain
  if (canContain && !isLoc && quantity !== null && quantity > 1) throw new DomainError('container.hasQuantity')
  if (input.typeId && !tx.snap.types[input.typeId]) throw new DomainError('type.missing')
  return tx.put('entities', {
    id: tx.ctx.newId(),
    kind: input.kind,
    name: cleanName(input.name),
    parentId,
    canContain,
    quantity,
    unit: cleanText(input.unit, 12),
    state: 'in',
    iconKey: input.iconKey ?? null,
    coverId: null,
    typeId: input.typeId ?? null,
    category: cleanText(input.category, 40),
    note: cleanText(input.note),
  })
}

export interface EntityPatch {
  name?: string
  iconKey?: string | null
  note?: string
  category?: string
  unit?: string
}

export function updateEntity(tx: Tx, id: string, patch: EntityPatch): Entity {
  const e = liveEntity(tx, id)
  const next: Entity = { ...e }
  if (patch.name !== undefined) next.name = cleanName(patch.name)
  if (patch.iconKey !== undefined) next.iconKey = patch.iconKey
  if (patch.note !== undefined) next.note = cleanText(patch.note)
  if (patch.category !== undefined) next.category = cleanText(patch.category, 40)
  if (patch.unit !== undefined) next.unit = cleanText(patch.unit, 12)
  return tx.put('entities', next)
}

/** 确保物品有型号记录（批量库存拆分、绑定商品码时需要）。 */
export function ensureType(tx: Tx, id: string): Entity {
  const e = liveEntity(tx, id)
  if (e.kind !== 'item') throw new DomainError('type.locationNoType')
  if (e.typeId && tx.snap.types[e.typeId] && !tx.snap.types[e.typeId].deletedAt) return e
  const t = tx.put('types', { id: tx.ctx.newId(), name: e.name, barcodes: [] })
  return tx.put('entities', { ...e, typeId: t.id })
}

/**
 * 移动。数量追踪且 qty < 当前数量 → 部分移动：来源减少、目标同型号库存增加（无则新建），同一事务内完成。
 * 独立实物与容器只能整体移动。返回目标处的实体 id。
 */
export function moveEntity(tx: Tx, id: string, targetId: string | null, qty?: number): string {
  let e = liveEntity(tx, id)
  const check = checkMove(tx.snap, id, targetId)
  if (!check.ok) throw new DomainError(check.code)
  if (qty !== undefined && e.quantity !== null) {
    const n = cleanPositive(qty)
    if (n > e.quantity) throw new DomainError('qty.exceeds', { max: e.quantity })
    if (n < e.quantity) {
      if (e.state === 'out') throw new DomainError('move.partialOut')
      e = ensureType(tx, id)
      const existing = childrenOf(tx.snap, targetId).find(
        (x) => x.id !== e.id && x.kind === 'item' && x.typeId === e.typeId && x.quantity !== null && x.state === 'in' && !x.canContain,
      )
      tx.put('entities', { ...e, quantity: e.quantity! - n })
      if (existing) {
        tx.put('entities', { ...existing, quantity: existing.quantity! + n })
        return existing.id
      }
      const copy = tx.put('entities', {
        id: tx.ctx.newId(),
        kind: 'item',
        name: e.name,
        parentId: targetId,
        canContain: false,
        quantity: n,
        unit: e.unit,
        state: 'in',
        iconKey: e.iconKey ?? null,
        coverId: null,
        typeId: e.typeId,
        category: e.category,
      })
      return copy.id
    }
  }
  tx.put('entities', { ...e, parentId: targetId, state: 'in' })
  return e.id
}

/** 取出：追踪数量 → 减少（不能超过库存）；不追踪 → 整件标记已取出，保留原位置。 */
export function withdraw(tx: Tx, id: string, qty?: number): Entity {
  const e = liveEntity(tx, id)
  if (e.kind === 'location') throw new DomainError('withdraw.location')
  if (e.state === 'out') throw new DomainError('withdraw.alreadyOut')
  if (e.quantity !== null) {
    const n = cleanPositive(qty)
    if (n > e.quantity) throw new DomainError('qty.exceeds', { max: e.quantity })
    return tx.put('entities', { ...e, quantity: e.quantity - n })
  }
  return tx.put('entities', { ...e, state: 'out' })
}

/** 入库：放回 / 放入目标，追踪数量时增加 qty。 */
export function putIn(tx: Tx, id: string, opts: { targetId?: string | null; qty?: number } = {}): Entity {
  const e = liveEntity(tx, id)
  if (e.kind === 'location') throw new DomainError('putIn.location')
  const next: Entity = { ...e, state: 'in' }
  if (opts.targetId !== undefined && opts.targetId !== e.parentId) {
    const check = checkMove(tx.snap, id, opts.targetId)
    if (!check.ok) throw new DomainError(check.code)
    next.parentId = opts.targetId
  }
  if (e.quantity !== null && opts.qty !== undefined) {
    next.quantity = e.quantity + cleanPositive(opts.qty)
    if (next.quantity > QTY_MAX) throw new DomainError('qty.invalid')
  } else if (e.state === 'in' && next.parentId === e.parentId) {
    throw new DomainError('putIn.already')
  }
  return tx.put('entities', next)
}

/** 调整数量；null = 关闭数量追踪。 */
export function setQuantity(tx: Tx, id: string, qty: number | null): Entity {
  const e = liveEntity(tx, id)
  if (e.kind === 'location') throw new DomainError('qty.location')
  const q = cleanQty(qty)
  if (e.canContain && q !== null && q > 1) throw new DomainError('container.hasQuantity')
  return tx.put('entities', { ...e, quantity: q })
}

export function setContainer(tx: Tx, id: string, on: boolean): Entity {
  const e = liveEntity(tx, id)
  if (e.kind === 'location') throw new DomainError('container.location')
  if (on && e.quantity !== null && e.quantity > 1) throw new DomainError('container.hasQuantity')
  if (!on && liveChildCount(tx.snap, id) > 0) throw new DomainError('container.notEmpty', { count: liveChildCount(tx.snap, id) })
  return tx.put('entities', { ...e, canContain: on })
}

/** 删除记录（不是取出）：有子项必须先移走；附件只解除关联，标签停用。 */
export function deleteEntity(tx: Tx, id: string): void {
  const e = liveEntity(tx, id)
  const kids = liveChildCount(tx.snap, id)
  if (kids > 0) throw new DomainError('delete.notEmpty', { count: kids })
  for (const l of Object.values(tx.snap.links)) {
    if (!l.deletedAt && l.targetKind === 'entity' && l.targetId === id) tx.remove('links', l.id)
  }
  for (const lb of Object.values(tx.snap.labels)) {
    if (!lb.deletedAt && lb.entityId === id && lb.status === 'bound') tx.put('labels', { ...lb, status: 'disabled' })
  }
  tx.remove('entities', e.id)
}

// ───────────────────────── 型号与商品码 ─────────────────────────

export function findTypeByBarcode(snap: Snapshot, normalized: string): ItemType | undefined {
  return Object.values(snap.types).find((t) => !t.deletedAt && t.barcodes.includes(normalized))
}

/** 同型号在各处的库存（未删除的物品）。 */
export function stocksOfType(snap: Snapshot, typeId: string): Entity[] {
  return Object.values(snap.entities).filter((e) => !e.deletedAt && e.kind === 'item' && e.typeId === typeId)
}

export function addBarcode(tx: Tx, entityId: string, code: ProductCode): Entity {
  const owner = findTypeByBarcode(tx.snap, code.normalized)
  const cur = liveEntity(tx, entityId)
  if (owner && owner.id !== cur.typeId) throw new DomainError('barcode.taken', { name: owner.name })
  const e = ensureType(tx, entityId)
  if (owner) return e
  const t = tx.snap.types[e.typeId!]
  tx.put('types', { ...t, barcodes: [...t.barcodes, code.normalized] })
  return e
}

export function removeBarcode(tx: Tx, typeId: string, normalized: string): void {
  const t = tx.snap.types[typeId]
  if (!t || t.deletedAt) throw new DomainError('type.missing')
  tx.put('types', { ...t, barcodes: t.barcodes.filter((b) => b !== normalized) })
}

/** 用商品码新建物品：码已知 → 归入该型号；未知 → 新建型号并记住关联。 */
export function createWithBarcode(tx: Tx, input: CreateInput, code: ProductCode): Entity {
  const owner = findTypeByBarcode(tx.snap, code.normalized)
  const e = createEntity(tx, { ...input, typeId: owner?.id ?? null })
  return owner ? e : addBarcode(tx, e.id, code)
}

// ───────────────────────── 标签 ─────────────────────────

export function labelByToken(snap: Snapshot, token: string): Label | undefined {
  const l = snap.labels[token]
  return l && !l.deletedAt ? l : undefined
}

export function labelByCode(snap: Snapshot, code: string): Label | undefined {
  return Object.values(snap.labels).find((l) => !l.deletedAt && l.code === code)
}

export function labelsOf(snap: Snapshot, entityId: string): Label[] {
  return Object.values(snap.labels).filter((l) => !l.deletedAt && l.status === 'bound' && l.entityId === entityId)
}

export function createLabels(
  tx: Tx,
  count: number,
  gen: () => { token: string; code: string },
  batchId: string,
): Label[] {
  if (!Number.isInteger(count) || count < 1 || count > LABEL_BATCH_MAX) throw new DomainError('label.count', { max: LABEL_BATCH_MAX })
  const used = new Set(Object.values(tx.snap.labels).map((l) => l.code))
  const out: Label[] = []
  for (let i = 0; i < count; i++) {
    let g = gen()
    let guard = 0
    while (used.has(g.code) || tx.snap.labels[g.token]) {
      if (++guard > 50) throw new DomainError('label.exhausted')
      g = gen()
    }
    used.add(g.code)
    out.push(tx.put('labels', { id: g.token, token: g.token, code: g.code, status: 'blank', entityId: null, batchId }))
  }
  return out
}

/** 绑定标签。已绑定其他对象时必须显式 force（界面先展示旧目标并确认），绝不静默抢绑。 */
export function bindLabel(tx: Tx, labelId: string, entityId: string, force = false): Label {
  const l = tx.snap.labels[labelId]
  if (!l || l.deletedAt) throw new DomainError('label.missing')
  liveEntity(tx, entityId)
  if (l.status === 'bound' && l.entityId === entityId) throw new DomainError('label.sameTarget')
  if (l.status === 'bound' && l.entityId && !force) {
    const old = tx.snap.entities[l.entityId]
    throw new DomainError('label.alreadyBound', { name: old?.name ?? '?' })
  }
  if (l.status === 'disabled' && !force) throw new DomainError('label.disabled')
  return tx.put('labels', { ...l, status: 'bound', entityId })
}

export function disableLabel(tx: Tx, labelId: string): Label {
  const l = tx.snap.labels[labelId]
  if (!l || l.deletedAt) throw new DomainError('label.missing')
  return tx.put('labels', { ...l, status: 'disabled' })
}

// ───────────────────────── 附件 ─────────────────────────

export interface AttachmentInput {
  name: string
  typeKey: AttachmentTypeKey
  provider: AttachmentProvider
  url?: string
  mime?: string
  size?: number
  originalName?: string
  checksum?: string
  width?: number
  height?: number
  optimized?: boolean
  note?: string
}

/** 外链只允许 http/https；拒绝 javascript:/data:/file: 等。 */
export function validateExternalUrl(url: string): string {
  const s = url.trim()
  if (!/^https?:\/\/[^\s/?#]+\.[^\s/?#]+([/?#]\S*)?$/i.test(s) && !/^https?:\/\/localhost(:\d+)?([/?#]\S*)?$/i.test(s)) {
    throw new DomainError('url.invalid')
  }
  return s
}

export function urlHost(url: string): string {
  return url.replace(/^https?:\/\//i, '').split(/[/?#]/)[0]
}

export function addAttachment(tx: Tx, input: AttachmentInput, id?: string): Attachment {
  const isUrl = input.provider === 'external_url'
  return tx.put('attachments', {
    id: id ?? tx.ctx.newId(),
    name: cleanName(input.name, 120),
    typeKey: input.typeKey,
    provider: input.provider,
    url: isUrl ? validateExternalUrl(input.url ?? '') : undefined,
    mime: input.mime,
    size: input.size,
    originalName: input.originalName,
    checksum: input.checksum,
    width: input.width,
    height: input.height,
    optimized: !!input.optimized,
    note: cleanText(input.note),
  })
}

export function updateAttachment(
  tx: Tx,
  id: string,
  patch: { name?: string; typeKey?: AttachmentTypeKey; note?: string; url?: string },
): Attachment {
  const a = liveAttachment(tx, id)
  const next: Attachment = { ...a }
  if (patch.name !== undefined) next.name = cleanName(patch.name, 120)
  if (patch.typeKey !== undefined) {
    if (a.provider === 'external_url' && patch.typeKey === 'photo') throw new DomainError('attachment.urlNotPhoto')
    next.typeKey = patch.typeKey
  }
  if (patch.note !== undefined) next.note = cleanText(patch.note)
  if (patch.url !== undefined) {
    if (a.provider !== 'external_url') throw new DomainError('url.notLink')
    next.url = validateExternalUrl(patch.url)
  }
  const out = tx.put('attachments', next)
  // 不再是照片 → 清除引用它的封面
  if (next.typeKey !== 'photo') clearCovers(tx, id)
  return out
}

function liveAttachment(tx: Tx, id: string): Attachment {
  const a = tx.snap.attachments[id]
  if (!a || a.deletedAt) throw new DomainError('attachment.missing')
  return a
}

export function linkId(attachmentId: string, kind: LinkTargetKind, targetId: string): string {
  return `${attachmentId}~${kind}~${targetId}`
}

export function linkAttachment(tx: Tx, attachmentId: string, kind: LinkTargetKind, targetId: string): void {
  liveAttachment(tx, attachmentId)
  if (kind === 'entity') liveEntity(tx, targetId)
  else if (!tx.snap.types[targetId] || tx.snap.types[targetId].deletedAt) throw new DomainError('type.missing')
  const id = linkId(attachmentId, kind, targetId)
  const prev = tx.snap.links[id]
  if (prev && !prev.deletedAt) return
  tx.put('links', { id, attachmentId, targetKind: kind, targetId, deletedAt: null })
}

function clearCovers(tx: Tx, attachmentId: string, onlyEntity?: string): void {
  for (const e of Object.values(tx.snap.entities)) {
    if (!e.deletedAt && e.coverId === attachmentId && (!onlyEntity || e.id === onlyEntity)) {
      tx.put('entities', { ...e, coverId: null })
    }
  }
}

/** 解除一条关联：不删除文件，其他关联不受影响；若是该物品封面则回退到图标。 */
export function unlinkAttachment(tx: Tx, attachmentId: string, kind: LinkTargetKind, targetId: string): void {
  const id = linkId(attachmentId, kind, targetId)
  const l = tx.snap.links[id]
  if (!l || l.deletedAt) throw new DomainError('link.missing')
  tx.remove('links', id)
  if (kind === 'entity') clearCovers(tx, attachmentId, targetId)
}

/** 删除附件及文件：清理所有关联与封面。文件字节由调用方在提交成功后释放。 */
export function deleteAttachment(tx: Tx, attachmentId: string): void {
  liveAttachment(tx, attachmentId)
  for (const l of linksOfAttachment(tx.snap, attachmentId)) tx.remove('links', l.id)
  clearCovers(tx, attachmentId)
  tx.remove('attachments', attachmentId)
}

export function setCover(tx: Tx, entityId: string, attachmentId: string | null): Entity {
  const e = liveEntity(tx, entityId)
  if (attachmentId) {
    const a = liveAttachment(tx, attachmentId)
    if (a.typeKey !== 'photo' || a.provider !== 'local') throw new DomainError('cover.notPhoto')
    linkAttachment(tx, attachmentId, 'entity', entityId)
  }
  return tx.put('entities', { ...liveEntity(tx, e.id), coverId: attachmentId })
}

export function linksOfAttachment(snap: Snapshot, attachmentId: string): AttachmentLink[] {
  return Object.values(snap.links).filter((l) => !l.deletedAt && l.attachmentId === attachmentId)
}

export function attachmentsOf(snap: Snapshot, kind: LinkTargetKind, targetId: string): Attachment[] {
  const out: Attachment[] = []
  for (const l of Object.values(snap.links)) {
    if (l.deletedAt || l.targetKind !== kind || l.targetId !== targetId) continue
    const a = snap.attachments[l.attachmentId]
    if (a && !a.deletedAt) out.push(a)
  }
  return out.sort((a, b) => b.createdAt - a.createdAt)
}

export function unlinkedAttachments(snap: Snapshot): Attachment[] {
  const linked = new Set<string>()
  for (const l of Object.values(snap.links)) {
    if (l.deletedAt) continue
    const target = l.targetKind === 'entity' ? snap.entities[l.targetId] : snap.types[l.targetId]
    if (target && !target.deletedAt) linked.add(l.attachmentId)
  }
  return Object.values(snap.attachments)
    .filter((a) => !a.deletedAt && !linked.has(a.id))
    .sort((a, b) => b.createdAt - a.createdAt)
}

// ───────────────────────── 撤销 ─────────────────────────

function recordName(r: unknown): string {
  return (r as { name?: string; code?: string }).name ?? (r as { code?: string }).code ?? '?'
}

/** 撤销 = 反向写入一条新操作。若涉及记录在此后被修改过，拒绝并引导手工修正。 */
export function undoOperation(tx: Tx, op: Operation): void {
  if (op.undoneBy) throw new DomainError('undo.already')
  if (op.type === 'undo' || op.type === 'import') throw new DomainError('undo.notUndoable')
  for (const c of op.changes) {
    const cur = tx.get(c.table, c.id)
    if (!cur || cur.rev !== c.after.rev) throw new DomainError('undo.stale', { name: recordName(c.after) })
  }
  for (const c of op.changes) {
    if (c.before === null) tx.remove(c.table, c.id)
    else tx.put(c.table, { ...c.before, deletedAt: c.before.deletedAt ?? null } as never)
  }
}
