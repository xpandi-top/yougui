import { describe, expect, it } from 'vitest'
import {
  DomainError,
  Tx,
  addAttachment,
  addBarcode,
  applyCount,
  attachmentsOf,
  bindLabel,
  buildCount,
  checkMove,
  classifyScan,
  commitBatch,
  createEntity,
  createLabels,
  createWithBarcode,
  daysUntil,
  displayProductCode,
  expiringItems,
  expiryStatus,
  localDate,
  setProductDetails,
  updateEntity,
  deleteAttachment,
  deleteEntity,
  diffCount,
  gtinCheckValid,
  linkAttachment,
  moveEntity,
  parseProductCode,
  pathText,
  putIn,
  randomString,
  resolveScan,
  search,
  setContainer,
  setCover,
  setQuantity,
  similarNames,
  stocksOfType,
  undoOperation,
  unlinkAttachment,
  unlinkedAttachments,
  validateExternalUrl,
  withdraw,
  type Operation,
  type Snapshot,
} from '../core/index.ts'
import { emptySnapshot, makeCtx, run } from './helpers.ts'

function seed() {
  const ctx = makeCtx()
  const { snap, out } = run(emptySnapshot(), ctx, (tx) => {
    const study = createEntity(tx, { kind: 'location', name: '书房' })
    const cabinet = createEntity(tx, { kind: 'location', name: '储物柜', parentId: study.id })
    const box = createEntity(tx, { kind: 'item', name: '配件盒 A', parentId: cabinet.id, canContain: true })
    const hdmi = createEntity(tx, { kind: 'item', name: 'HDMI 线', parentId: box.id })
    const garage = createEntity(tx, { kind: 'location', name: '车库' })
    const kitchen = createEntity(tx, { kind: 'location', name: '厨房' })
    const aa = createEntity(tx, { kind: 'item', name: 'AA 电池', parentId: kitchen.id, quantity: 12 })
    return { study, cabinet, box, hdmi, garage, kitchen, aa }
  })
  return { ctx, snap, ...out }
}

function expectCode(fn: () => unknown, code: string) {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError)
    expect((e as DomainError).code).toBe(code)
    return
  }
  throw new Error(`expected DomainError ${code}`)
}

function asOp(tx: Tx, id = 'op1'): Operation {
  return { id, type: 'move', summary: {}, changes: tx.changes(), createdAt: 0, updatedAt: 0, rev: 1 }
}

describe('创建与路径 (A01/A02)', () => {
  it('只输入名称即可保存：未分配、数量 null', () => {
    const ctx = makeCtx()
    const { out } = run(emptySnapshot(), ctx, (tx) => createEntity(tx, { kind: 'item', name: '  剪刀 ' }))
    expect(out.name).toBe('剪刀')
    expect(out.parentId).toBeNull()
    expect(out.quantity).toBeNull()
    expect(out.state).toBe('in')
  })

  it('名称必填', () => {
    expectCode(() => run(emptySnapshot(), makeCtx(), (tx) => createEntity(tx, { kind: 'item', name: '   ' })), 'name.required')
  })

  it('搜索显示完整路径；整盒移动后路径立即更新', () => {
    const s = seed()
    const hit = search(s.snap, 'hdmi')[0]
    expect(hit.entity.id).toBe(s.hdmi.id)
    expect(hit.path).toEqual(['书房', '储物柜', '配件盒 A'])
    const { snap } = run(s.snap, s.ctx, (tx) => moveEntity(tx, s.box.id, s.garage.id))
    expect(pathText(snap.entities, s.hdmi.id)).toBe('车库 › 配件盒 A')
    expect(search(snap, '车库 hdmi')[0].entity.id).toBe(s.hdmi.id)
  })

  it('位置不能放进物品容器', () => {
    const s = seed()
    expectCode(() => run(s.snap, s.ctx, (tx) => createEntity(tx, { kind: 'location', name: '层', parentId: s.box.id })), 'move.locationIntoItem')
  })

  it('相似名称只提示', () => {
    const s = seed()
    expect(similarNames(s.snap, 'hdmi线', 'item').map((e) => e.id)).toContain(s.hdmi.id)
  })
})

describe('容器 (A03)', () => {
  it('非空容器拒绝关闭', () => {
    const s = seed()
    expectCode(() => run(s.snap, s.ctx, (tx) => setContainer(tx, s.box.id, false)), 'container.notEmpty')
    const { snap } = run(s.snap, s.ctx, (tx) => moveEntity(tx, s.hdmi.id, s.study.id))
    const r = run(snap, s.ctx, (tx) => setContainer(tx, s.box.id, false))
    expect(r.out.canContain).toBe(false)
  })

  it('数量 >1 的物品不能直接变成容器', () => {
    const s = seed()
    expectCode(() => run(s.snap, s.ctx, (tx) => setContainer(tx, s.aa.id, true)), 'container.hasQuantity')
  })

  it('删除有内容的位置被拒绝', () => {
    const s = seed()
    expectCode(() => run(s.snap, s.ctx, (tx) => deleteEntity(tx, s.cabinet.id)), 'delete.notEmpty')
  })
})

describe('移动 (A05/A08)', () => {
  it('禁止移动到自身或后代', () => {
    const s = seed()
    expect(checkMove(s.snap, s.study.id, s.box.id)).toEqual({ ok: false, code: 'move.cycle' })
    expectCode(() => run(s.snap, s.ctx, (tx) => moveEntity(tx, s.study.id, s.cabinet.id)), 'move.cycle')
  })

  it('来源与目标相同提示无需操作', () => {
    const s = seed()
    expectCode(() => run(s.snap, s.ctx, (tx) => moveEntity(tx, s.hdmi.id, s.box.id)), 'move.same')
  })

  it('部分移动：来源减少、目标新建同型号库存，合计守恒', () => {
    const s = seed()
    const { snap, out } = run(s.snap, s.ctx, (tx) => moveEntity(tx, s.aa.id, s.garage.id, 5))
    expect(snap.entities[s.aa.id].quantity).toBe(7)
    expect(snap.entities[out].quantity).toBe(5)
    expect(snap.entities[out].parentId).toBe(s.garage.id)
    expect(snap.entities[out].typeId).toBe(snap.entities[s.aa.id].typeId)
    // 再移 2 个：并入目标已有库存
    const r2 = run(snap, s.ctx, (tx) => moveEntity(tx, s.aa.id, s.garage.id, 2))
    expect(r2.out).toBe(out)
    expect(r2.snap.entities[out].quantity).toBe(7)
    expect(r2.snap.entities[s.aa.id].quantity).toBe(5)
  })

  it('移动数量超过库存被拒绝，数据不变', () => {
    const s = seed()
    expectCode(() => run(s.snap, s.ctx, (tx) => moveEntity(tx, s.aa.id, s.garage.id, 13)), 'qty.exceeds')
    expect(s.snap.entities[s.aa.id].quantity).toBe(12)
  })
})

describe('取出与入库', () => {
  it('取出超过库存被拒绝', () => {
    const s = seed()
    expectCode(() => run(s.snap, s.ctx, (tx) => withdraw(tx, s.aa.id, 20)), 'qty.exceeds')
  })

  it('追踪数量：取出减少；不追踪：整件已取出且保留原位置', () => {
    const s = seed()
    let r = run(s.snap, s.ctx, (tx) => withdraw(tx, s.aa.id, 2))
    expect(r.out.quantity).toBe(10)
    r = run(s.snap, s.ctx, (tx) => withdraw(tx, s.hdmi.id))
    expect(r.out.state).toBe('out')
    expect(r.out.parentId).toBe(s.box.id)
    const back = run(r.snap, s.ctx, (tx) => putIn(tx, s.hdmi.id, { targetId: s.garage.id }))
    expect(back.out.state).toBe('in')
    expect(back.out.parentId).toBe(s.garage.id)
  })

  it('非整数数量被拒绝', () => {
    const s = seed()
    expectCode(() => run(s.snap, s.ctx, (tx) => setQuantity(tx, s.aa.id, 1.5)), 'qty.invalid')
    expectCode(() => run(s.snap, s.ctx, (tx) => setQuantity(tx, s.aa.id, -1)), 'qty.invalid')
  })
})

describe('撤销', () => {
  it('撤销移动恢复原位置', () => {
    const s = seed()
    const r = run(s.snap, s.ctx, (tx) => moveEntity(tx, s.hdmi.id, s.garage.id))
    const op = asOp(r.tx)
    const u = run(r.snap, s.ctx, (tx) => undoOperation(tx, op))
    expect(u.snap.entities[s.hdmi.id].parentId).toBe(s.box.id)
  })

  it('撤销创建 = 软删除', () => {
    const s = seed()
    const r = run(s.snap, s.ctx, (tx) => createEntity(tx, { kind: 'item', name: '新物品' }))
    const u = run(r.snap, s.ctx, (tx) => undoOperation(tx, asOp(r.tx)))
    expect(u.snap.entities[r.out.id].deletedAt).toBeTruthy()
  })

  it('期间被修改则拒绝撤销', () => {
    const s = seed()
    const r = run(s.snap, s.ctx, (tx) => moveEntity(tx, s.hdmi.id, s.garage.id))
    const op = asOp(r.tx)
    const r2 = run(r.snap, s.ctx, (tx) => moveEntity(tx, s.hdmi.id, s.kitchen.id))
    expectCode(() => run(r2.snap, s.ctx, (tx) => undoOperation(tx, op)), 'undo.stale')
  })
})

describe('条码与扫码分类', () => {
  it('GTIN 校验位', () => {
    expect(gtinCheckValid('4006381333931')).toBe(true)
    expect(gtinCheckValid('4006381333932')).toBe(false)
    expect(gtinCheckValid('96385074')).toBe(true)
  })

  it('UPC-A 规范化为前导 0 的 EAN-13，保留原始码', () => {
    const p = parseProductCode('036000291452')!
    expect(p.format).toBe('upca')
    expect(p.normalized).toBe('0036000291452')
    expect(p.raw).toBe('036000291452')
    expect(parseProductCode('0036000291452')!.normalized).toBe(p.normalized)
  })

  it('识别标签链接、短编号、商品码与外部码', () => {
    expect(classifyScan('https://x.github.io/yougui/#/l/abcdefgh23456789')).toEqual({ kind: 'label', token: 'abcdefgh23456789' })
    expect(classifyScan('k7m-2pq')).toEqual({ kind: 'code', code: 'K7M2PQ' })
    expect(classifyScan('4006381333931').kind).toBe('product')
    expect(classifyScan('4006381333932').kind).toBe('invalidProduct')
    expect(classifyScan('https://evil.example/').kind).toBe('unknown')
  })

  it('同一商品码只属于一个型号', () => {
    const s = seed()
    const code = parseProductCode('4006381333931')!
    const r = run(s.snap, s.ctx, (tx) => addBarcode(tx, s.aa.id, code))
    expectCode(() => run(r.snap, s.ctx, (tx) => addBarcode(tx, s.hdmi.id, code)), 'barcode.taken')
  })

  it('randomString 只用指定字母表', () => {
    let i = 0
    const bytes = (n: number) => Uint8Array.from({ length: n }, () => (i++ * 37) % 256)
    const s = randomString('ABC', 20, bytes)
    expect(s).toMatch(/^[ABC]{20}$/)
  })
})

describe('标签 (A04)', () => {
  function withLabels(s: ReturnType<typeof seed>) {
    let k = 0
    return run(s.snap, s.ctx, (tx) =>
      createLabels(tx, 3, () => ({ token: `tok${String(++k).padStart(8, '0')}`, code: `ABC${k}DE`.slice(0, 6) }), 'b1'),
    )
  }

  it('首次绑定成功，重复绑定到其他对象被阻止，需显式确认', () => {
    const s = seed()
    const { snap, out } = withLabels(s)
    const l = out[0]
    const r = run(snap, s.ctx, (tx) => bindLabel(tx, l.id, s.box.id))
    expect(r.out.status).toBe('bound')
    expectCode(() => run(r.snap, s.ctx, (tx) => bindLabel(tx, l.id, s.hdmi.id)), 'label.alreadyBound')
    const forced = run(r.snap, s.ctx, (tx) => bindLabel(tx, l.id, s.hdmi.id, true))
    expect(forced.out.entityId).toBe(s.hdmi.id)
  })

  it('删除实体后标签停用', () => {
    const s = seed()
    const { snap, out } = withLabels(s)
    const r = run(snap, s.ctx, (tx) => bindLabel(tx, out[0].id, s.hdmi.id))
    const d = run(r.snap, s.ctx, (tx) => deleteEntity(tx, s.hdmi.id))
    expect(d.snap.labels[out[0].id].status).toBe('disabled')
  })
})

describe('附件 (B02/B03/B08/B09)', () => {
  function withReceipt(s: ReturnType<typeof seed>) {
    return run(s.snap, s.ctx, (tx) => {
      const a = addAttachment(tx, { name: 'Costco 收据', typeKey: 'receipt', provider: 'local', mime: 'application/pdf' })
      linkAttachment(tx, a.id, 'entity', s.aa.id)
      linkAttachment(tx, a.id, 'entity', s.hdmi.id)
      linkAttachment(tx, a.id, 'entity', s.box.id)
      return a
    })
  }

  it('一份附件关联三处，解除一处其他仍在', () => {
    const s = seed()
    const { snap, out } = withReceipt(s)
    const r = run(snap, s.ctx, (tx) => unlinkAttachment(tx, out.id, 'entity', s.hdmi.id))
    expect(attachmentsOf(r.snap, 'entity', s.aa.id).map((a) => a.id)).toEqual([out.id])
    expect(attachmentsOf(r.snap, 'entity', s.hdmi.id)).toEqual([])
    expect(r.snap.attachments[out.id].deletedAt).toBeFalsy()
  })

  it('未关联附件可在基础列表找到；删除物品只清除关联', () => {
    const s = seed()
    const r = run(s.snap, s.ctx, (tx) => {
      const a = addAttachment(tx, { name: '维修记录', typeKey: 'maintenance', provider: 'local' })
      linkAttachment(tx, a.id, 'entity', s.hdmi.id)
      return a
    })
    expect(unlinkedAttachments(r.snap)).toEqual([])
    const d = run(r.snap, s.ctx, (tx) => deleteEntity(tx, s.hdmi.id))
    expect(unlinkedAttachments(d.snap).map((a) => a.id)).toEqual([r.out.id])
  })

  it('删除附件清理所有关联与封面', () => {
    const s = seed()
    const r = run(s.snap, s.ctx, (tx) => {
      const p = addAttachment(tx, { name: '照片', typeKey: 'photo', provider: 'local', mime: 'image/jpeg', optimized: true })
      setCover(tx, s.hdmi.id, p.id)
      linkAttachment(tx, p.id, 'entity', s.box.id)
      return p
    })
    expect(r.snap.entities[s.hdmi.id].coverId).toBe(r.out.id)
    const d = run(r.snap, s.ctx, (tx) => deleteAttachment(tx, r.out.id))
    expect(d.snap.entities[s.hdmi.id].coverId).toBeNull()
    expect(Object.values(d.snap.links).every((l) => l.deletedAt)).toBe(true)
  })

  it('取消关联封面图会回退图标但保留附件', () => {
    const s = seed()
    const r = run(s.snap, s.ctx, (tx) => {
      const p = addAttachment(tx, { name: '照片', typeKey: 'photo', provider: 'local' })
      setCover(tx, s.hdmi.id, p.id)
      return p
    })
    const u = run(r.snap, s.ctx, (tx) => setCover(tx, s.hdmi.id, null))
    expect(u.snap.entities[s.hdmi.id].coverId).toBeNull()
    expect(u.snap.attachments[r.out.id].deletedAt).toBeFalsy()
  })

  it('外链只允许 http/https', () => {
    expectCode(() => validateExternalUrl('javascript:alert(1)'), 'url.invalid')
    expectCode(() => validateExternalUrl('data:text/html,hi'), 'url.invalid')
    expect(validateExternalUrl(' https://example.com/manual.pdf ')).toBe('https://example.com/manual.pdf')
  })
})

describe('盘点 (A09)', () => {
  it('未扫描不自动清零；只有差异与明确缺失才调整', () => {
    const s = seed()
    const lines = buildCount(s.snap, null, true)
    expect(lines.map((l) => l.name).sort()).toEqual(['AA 电池', 'HDMI 线', '配件盒 A'].sort())
    const rows = diffCount(lines, { [s.aa.id]: { actual: 9 }, [s.hdmi.id]: { missing: true } })
    expect(rows.find((r) => r.line.entityId === s.box.id)!.kind).toBe('unchecked')
    const r = run(s.snap, s.ctx, (tx) => applyCount(tx, rows))
    expect(r.out).toBe(2)
    expect(r.snap.entities[s.aa.id].quantity).toBe(9)
    expect(r.snap.entities[s.hdmi.id].state).toBe('out')
    expect(r.snap.entities[s.box.id]).toEqual(s.snap.entities[s.box.id])
  })

  it('盘点期间被修改 → 整批拒绝', () => {
    const s = seed()
    const lines = buildCount(s.snap, s.kitchen.id, true)
    const changed = run(s.snap, s.ctx, (tx) => withdraw(tx, s.aa.id, 1))
    const rows = diffCount(lines, { [s.aa.id]: { actual: 3 } })
    expectCode(() => run(changed.snap, s.ctx, (tx) => applyCount(tx, rows)), 'stocktake.changed')
  })
})

describe('连续扫码批次 (A06)', () => {
  function withCodes(s: ReturnType<typeof seed>): Snapshot {
    return run(s.snap, s.ctx, (tx) => {
      addBarcode(tx, s.aa.id, parseProductCode('4006381333931')!)
      createLabels(tx, 1, () => ({ token: 'boxtoken00000001', code: 'BXA234' }), 'b')
      bindLabel(tx, 'boxtoken00000001', s.hdmi.id)
    }).snap
  }

  it('入库：商品码重复扫描累加，确认前库存不变，确认后增加', () => {
    const s = seed()
    const snap = withCodes(s)
    const scan = classifyScan('4006381333931')
    const r = resolveScan(snap, 'putIn', s.kitchen.id, [], scan)
    expect(r.kind).toBe('lines')
    if (r.kind !== 'lines') return
    const r2 = resolveScan(snap, 'putIn', s.kitchen.id, r.lines, scan)
    if (r2.kind !== 'lines') throw new Error(r2.kind)
    expect(r2.lines).toHaveLength(1)
    expect(r2.lines[0].qty).toBe(2)
    expect(snap.entities[s.aa.id].quantity).toBe(12)
    const c = run(snap, s.ctx, (tx) => commitBatch(tx, 'putIn', s.kitchen.id, r2.lines))
    expect(c.snap.entities[s.aa.id].quantity).toBe(14)
  })

  it('入库到新位置：新建同型号库存', () => {
    const s = seed()
    const snap = withCodes(s)
    const r = resolveScan(snap, 'putIn', s.garage.id, [], classifyScan('4006381333931'))
    if (r.kind !== 'lines') throw new Error(r.kind)
    const c = run(snap, s.ctx, (tx) => commitBatch(tx, 'putIn', s.garage.id, r.lines))
    const typeId = c.snap.entities[s.aa.id].typeId!
    expect(stocksOfType(c.snap, typeId).map((e) => e.quantity).sort()).toEqual([1, 12])
  })

  it('实物标签重复扫描提示已加入；已在目标提示', () => {
    const s = seed()
    const snap = withCodes(s)
    const scan = classifyScan('YG:boxtoken00000001')
    const r = resolveScan(snap, 'move', s.garage.id, [], scan)
    if (r.kind !== 'lines') throw new Error(r.kind)
    expect(resolveScan(snap, 'move', s.garage.id, r.lines, scan)).toMatchObject({ kind: 'info', code: 'alreadyAdded' })
    expect(resolveScan(snap, 'move', s.box.id, [], scan)).toMatchObject({ kind: 'info', code: 'alreadyThere' })
  })

  it('任一行失败整批不写入', () => {
    const s = seed()
    const lines = [
      { key: `e:${s.hdmi.id}`, name: 'HDMI', entityId: s.hdmi.id, qty: null },
      { key: `e:${s.aa.id}`, name: 'AA', entityId: s.aa.id, qty: 99 },
    ]
    const tx = new Tx(s.snap, s.ctx)
    expect(() => commitBatch(tx, 'withdraw', null, lines)).toThrow()
    expect(s.snap.entities[s.hdmi.id].state).toBe('in')
  })
})

describe('手输商品码纠错（真实样例：Citadels UPC-A 841333113513）', () => {
  it('11 位（漏末位校验位）给出唯一补全，不自动采用', () => {
    const r = classifyScan('84133311351')
    expect(r).toEqual({ kind: 'invalidProduct', raw: '84133311351', suggestions: ['841333113513'] })
  })

  it('UPC-A 12 位与扫码器按 EAN-13 读出的 13 位规范化为同一个 key', () => {
    expect(parseProductCode('841333113513')).toEqual({ normalized: '0841333113513', raw: '841333113513', format: 'upca' })
    expect(parseProductCode('0841333113513')!.normalized).toBe('0841333113513')
    expect(displayProductCode('0841333113513')).toBe('841333113513 · UPC-A')
    expect(displayProductCode('4006381333931')).toBe('4006381333931')
  })

  it('校验位错误的 12 位不给猜测', () => {
    expect(classifyScan('841333113514')).toMatchObject({ kind: 'invalidProduct', suggestions: [] })
  })
})

describe('有效期与产品信息', () => {
  it('有效期格式校验；位置不能设有效期', () => {
    const ctx = makeCtx()
    const r = run(emptySnapshot(), ctx, (tx) => createEntity(tx, { kind: 'item', name: '酱油', expiresAt: '2026-12-31' }))
    expect(r.out.expiresAt).toBe('2026-12-31')
    expectCode(() => run(emptySnapshot(), makeCtx(), (tx) => createEntity(tx, { kind: 'item', name: 'x', expiresAt: '2026-13-01' })), 'date.invalid')
    const loc = run(emptySnapshot(), makeCtx(), (tx) => createEntity(tx, { kind: 'location', name: '厨房' }))
    expectCode(() => run(loc.snap, makeCtx(5000), (tx) => updateEntity(tx, loc.out.id, { expiresAt: '2026-12-31' })), 'date.location')
    const cleared = run(r.snap, ctx, (tx) => updateEntity(tx, r.out.id, { expiresAt: null }))
    expect(cleared.out.expiresAt).toBeNull()
  })

  it('临期判断：过期 / 今天 / 30 天内 / 正常；用完或取出的不提醒', () => {
    const ctx = makeCtx()
    const { snap, out } = run(emptySnapshot(), ctx, (tx) => ({
      old: createEntity(tx, { kind: 'item', name: '过期牛奶', expiresAt: '2026-10-01' }),
      today: createEntity(tx, { kind: 'item', name: '今天', expiresAt: '2026-10-13' }),
      soon: createEntity(tx, { kind: 'item', name: '酱油', expiresAt: '2026-11-01' }),
      ok: createEntity(tx, { kind: 'item', name: '罐头', expiresAt: '2027-10-01' }),
      empty: createEntity(tx, { kind: 'item', name: '用完的醋', expiresAt: '2026-10-02', quantity: 0 }),
    }))
    expect(daysUntil('2026-11-01', '2026-10-13')).toBe(19)
    expect(expiryStatus(out.old, '2026-10-13')).toBe('expired')
    expect(expiryStatus(out.today, '2026-10-13')).toBe('today')
    expect(expiryStatus(out.soon, '2026-10-13')).toBe('soon')
    expect(expiryStatus(out.ok, '2026-10-13')).toBe('ok')
    expect(expiringItems(snap, '2026-10-13').map((e) => e.name)).toEqual(['过期牛奶', '今天', '酱油'])
    expect(localDate(Date.UTC(2026, 9, 13, 20, 0), -480)).toBe('2026-10-14')
  })

  it('用商品码新建时保存产品信息到型号', () => {
    const ctx = makeCtx()
    const code = parseProductCode('841333113513')!
    const r = run(emptySnapshot(), ctx, (tx) =>
      createWithBarcode(tx, { kind: 'item', name: 'Citadels' }, code, { name: 'Citadels (Revised Edition)', brand: 'Z-Man Games', model: 'ZMGZC01', category: 'Board Games', source: 'upcitemdb', at: 1 }),
    )
    expect(r.snap.types[r.out.typeId!].product).toMatchObject({ brand: 'Z-Man Games', model: 'ZMGZC01' })
    const cleared = run(r.snap, ctx, (tx) => setProductDetails(tx, r.out.typeId!, null))
    expect(cleared.snap.types[r.out.typeId!].product).toBeNull()
  })
})
