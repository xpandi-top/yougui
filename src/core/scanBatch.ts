// 连续扫码批次：识别 ≠ 提交。识别结果先进入待提交清单，确认后整批原子提交。
import { Tx } from './tx.ts'
import type { ProductCode, ScanResult } from './codes.ts'
import { createEntity, createWithBarcode, findTypeByBarcode, labelByCode, labelByToken, liveEntity, moveEntity, putIn, stocksOfType, withdraw } from './ops.ts'
import { DomainError, type Entity, type Label, type ProductDetails, type Snapshot } from './types.ts'

export type BatchOp = 'putIn' | 'withdraw' | 'move'

export const BATCH_MAX = 100

export interface BatchLine {
  key: string
  name: string
  /** 现有实体 */
  entityId?: string
  /** 入库时在目标处新建库存：已知型号（typeId）或新商品码（product + 用户填写的名称） */
  create?: { typeId?: string; product?: ProductCode; details?: ProductDetails | null }
  /** null = 整件（独立实物 / 不追踪数量） */
  qty: number | null
}

export type Resolution =
  | { kind: 'lines'; lines: BatchLine[]; line: BatchLine; merged: boolean }
  | { kind: 'info'; code: InfoCode; name?: string }
  | { kind: 'holder'; entity: Entity }
  | { kind: 'chooseSource'; candidates: Entity[]; typeId: string }
  | { kind: 'unknownProduct'; product: ProductCode }
  | { kind: 'blankLabel'; label: Label }

export type InfoCode =
  | 'alreadyThere'
  | 'alreadyAdded'
  | 'alreadyOut'
  | 'notInStock'
  | 'unknownLabel'
  | 'labelDisabled'
  | 'invalidProduct'
  | 'unknownCode'
  | 'needTarget'
  | 'batchFull'
  | 'untrackedThere'

/** 并入清单：同 key 且都计数量 → 累加；整件重复 → 视为已加入。 */
export function addLine(lines: BatchLine[], line: BatchLine): Resolution {
  const i = lines.findIndex((l) => l.key === line.key)
  if (i >= 0) {
    const cur = lines[i]
    if (cur.qty === null || line.qty === null) return { kind: 'info', code: 'alreadyAdded', name: cur.name }
    const next = [...lines]
    next[i] = { ...cur, qty: cur.qty + line.qty }
    return { kind: 'lines', lines: next, line: next[i], merged: true }
  }
  if (lines.length >= BATCH_MAX) return { kind: 'info', code: 'batchFull' }
  const next = [...lines, line]
  return { kind: 'lines', lines: next, line, merged: false }
}

export function lineForEntity(e: Entity, op: BatchOp): BatchLine {
  // 追踪数量的库存：取出/移动默认 1；独立实物整件
  const qty = e.quantity !== null && op !== 'putIn' && !e.canContain ? 1 : null
  return { key: `e:${e.id}`, name: e.name, entityId: e.id, qty }
}

function resolveLabel(snap: Snapshot, op: BatchOp, targetId: string | null | undefined, lines: BatchLine[], label: Label | undefined, asItem: boolean): Resolution {
  if (!label) return { kind: 'info', code: 'unknownLabel' }
  if (label.status === 'blank') return { kind: 'blankLabel', label }
  const e = label.entityId ? snap.entities[label.entityId] : undefined
  if (label.status === 'disabled' || !e || e.deletedAt) return { kind: 'info', code: 'labelDisabled' }
  if ((e.kind === 'location' || e.canContain) && !asItem) return { kind: 'holder', entity: e }
  if (op !== 'withdraw' && targetId === undefined) return { kind: 'info', code: 'needTarget' }
  if (op === 'withdraw') {
    if (e.state === 'out') return { kind: 'info', code: 'alreadyOut', name: e.name }
    if (e.quantity === 0) return { kind: 'info', code: 'notInStock', name: e.name }
  } else if (e.state === 'in' && e.parentId === targetId) {
    return { kind: 'info', code: 'alreadyThere', name: e.name }
  }
  const line = lineForEntity(e, op)
  if (lines.some((l) => l.key === line.key)) return { kind: 'info', code: 'alreadyAdded', name: e.name }
  return addLine(lines, line)
}

/**
 * 解析一次识别结果在当前批次中的含义（纯函数，不修改数据）。
 * asItem：用户已选择把扫到的容器当作待处理物品而非更换目标。
 */
export function resolveScan(
  snap: Snapshot,
  op: BatchOp,
  /** undefined = 尚未选择目标（入库/移动必须先选） */
  targetId: string | null | undefined,
  lines: BatchLine[],
  scan: ScanResult,
  asItem = false,
): Resolution {
  switch (scan.kind) {
    case 'label':
      return resolveLabel(snap, op, targetId, lines, labelByToken(snap, scan.token), asItem)
    case 'code':
      return resolveLabel(snap, op, targetId, lines, labelByCode(snap, scan.code), asItem)
    case 'invalidProduct':
      return { kind: 'info', code: 'invalidProduct' }
    case 'unknown':
      return { kind: 'info', code: 'unknownCode' }
    case 'product':
      return resolveProduct(snap, op, targetId, lines, scan.product)
  }
}

function resolveProduct(snap: Snapshot, op: BatchOp, targetId: string | null | undefined, lines: BatchLine[], product: ProductCode): Resolution {
  if (op !== 'withdraw' && targetId === undefined) return { kind: 'info', code: 'needTarget' }
  const type = findTypeByBarcode(snap, product.normalized)
  if (!type) return { kind: 'unknownProduct', product }
  const stocks = stocksOfType(snap, type.id)
  const typeName = stocks[0]?.name ?? type.name
  if (op === 'putIn') {
    const here = stocks.filter((s) => s.parentId === targetId && s.state === 'in')
    const tracked = here.find((s) => s.quantity !== null && !s.canContain)
    if (tracked) return addLine(lines, { key: `e:${tracked.id}`, name: tracked.name, entityId: tracked.id, qty: 1 })
    if (here.length) return { kind: 'info', code: 'untrackedThere', name: here[0].name }
    return addLine(lines, { key: `t:${type.id}`, name: typeName, create: { typeId: type.id }, qty: 1 })
  }
  const candidates = stocks.filter(
    (s) => s.state === 'in' && (s.quantity === null || s.quantity > 0) && (op === 'withdraw' || s.parentId !== targetId),
  )
  if (!candidates.length) return { kind: 'info', code: 'notInStock', name: typeName }
  // 已在清单中的来源优先累加
  const inList = candidates.find((c) => lines.some((l) => l.key === `e:${c.id}` && l.qty !== null))
  if (inList) return addLine(lines, { key: `e:${inList.id}`, name: inList.name, entityId: inList.id, qty: 1 })
  if (candidates.length === 1) return addLine(lines, lineForEntity(candidates[0], op))
  return { kind: 'chooseSource', candidates, typeId: type.id }
}

export class LineError extends DomainError {
  readonly lineKey: string
  readonly lineName: string
  readonly inner: DomainError
  constructor(line: BatchLine, inner: DomainError) {
    super(inner.code, inner.params)
    this.lineKey = line.key
    this.lineName = line.name
    this.inner = inner
  }
}

/** 整批提交：任何一行失败 → 抛 LineError，调用方丢弃事务，库存不变。 */
export function commitBatch(tx: Tx, op: BatchOp, targetId: string | null, lines: BatchLine[]): number {
  if (lines.length > BATCH_MAX) throw new DomainError('batch.tooMany', { max: BATCH_MAX })
  for (const l of lines) {
    try {
      if (l.create) {
        if (op !== 'putIn') throw new DomainError('batch.createOnlyPutIn')
        const base = { kind: 'item' as const, name: l.name, parentId: targetId, quantity: l.qty ?? 1 }
        if (l.create.typeId) createEntity(tx, { ...base, typeId: l.create.typeId })
        else if (l.create.product) createWithBarcode(tx, base, l.create.product, l.create.details)
        continue
      }
      const e = liveEntity(tx, l.entityId!)
      if (op === 'putIn') {
        if (e.quantity !== null && l.qty !== null) {
          putIn(tx, e.id, { targetId: e.parentId === targetId ? undefined : targetId, qty: l.qty })
        } else {
          putIn(tx, e.id, { targetId })
        }
      } else if (op === 'withdraw') {
        withdraw(tx, e.id, l.qty ?? undefined)
      } else {
        moveEntity(tx, e.id, targetId, l.qty ?? undefined)
      }
    } catch (err) {
      if (err instanceof DomainError) throw new LineError(l, err)
      throw err
    }
  }
  return lines.length
}
