// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createEntity, moveEntity, type Entity } from '../core/index.ts'
import { exportBackup, readBackup, restoreMerge, restoreReplace } from '../lib/backup.ts'
import { AppStore } from '../lib/store.ts'

let n = 0
const fresh = () => AppStore.open(`test-${Date.now()}-${++n}`)

describe('AppStore（IndexedDB 持久化）', () => {
  it('提交写盘，重新打开后数据仍在；撤销以新操作记录', async () => {
    const name = `persist-${Date.now()}`
    const s1 = await AppStore.open(name)
    await s1.setHousehold('我的家')
    const { out: room } = await s1.commit('create', {}, (tx) => createEntity(tx, { kind: 'location', name: '书房' }))
    const { out: item, op } = await s1.commit('create', {}, (tx) => createEntity(tx, { kind: 'item', name: '剪刀', parentId: room.id }))
    expect(op).not.toBeNull()
    s1.close()

    const s2 = await AppStore.open(name)
    expect(s2.getState().household?.name).toBe('我的家')
    expect(s2.getState().snap.entities[item.id].parentId).toBe(room.id)
    expect(s2.getState().ops).toHaveLength(2)
    await s2.undo(s2.getState().ops[0].id)
    expect(s2.getState().snap.entities[item.id].deletedAt).toBeTruthy()
    expect(s2.getState().ops[1].undoneBy).toBe(s2.getState().ops[0].id)
    s2.close()
  })

  it('业务校验失败时不写入任何东西', async () => {
    const s = await fresh()
    const { out: a } = await s.commit('create', {}, (tx) => createEntity(tx, { kind: 'location', name: 'A' }))
    const before = s.getState().version
    await expect(s.commit('move', {}, (tx) => moveEntity(tx, a.id, a.id))).rejects.toThrow()
    expect(s.getState().version).toBe(before)
    s.close()
  })

  it('脏记录列表包含新建与修改，供同步推送', async () => {
    const s = await fresh()
    await s.setHousehold('家')
    await s.commit('create', {}, (tx) => createEntity(tx, { kind: 'item', name: 'x' }))
    const kinds = s.dirtyRecords().map((d) => d.kind).sort()
    expect(kinds).toEqual(['entities', 'household', 'ops'])
    s.close()
  })
})

describe('备份 ZIP 往返 (B04/B13)', () => {
  it('导出 → 读取 → 替换导入：记录完整，文件字节与校验和一致', async () => {
    const src = await fresh()
    await src.setHousehold('源')
    const { out: e } = await src.commit('create', {}, (tx) => createEntity(tx, { kind: 'item', name: '保修卡夹' }))
    const bytes = new TextEncoder().encode('%PDF-1.4 original bytes')
    await src.saveFile('att1', new Blob([bytes], { type: 'application/pdf' }))
    await src.commit('attach', {}, (tx) => {
      tx.put('attachments', { id: 'att1', name: '保修', typeKey: 'warranty', provider: 'local', mime: 'application/pdf', size: bytes.length, optimized: false })
      tx.put('links', { id: `att1~entity~${e.id}`, attachmentId: 'att1', targetKind: 'entity', targetId: e.id })
    })
    const { blob, manifest } = await exportBackup(src, 'test')
    expect(manifest.files).toHaveLength(1)

    const parsed = await readBackup(blob)
    expect(parsed.corrupt).toEqual([])
    const dst = await fresh()
    await restoreReplace(dst, parsed)
    expect((dst.getState().snap.entities[e.id] as Entity).name).toBe('保修卡夹')
    const f = await dst.getFile('att1')
    expect(new Uint8Array(await f!.blob.arrayBuffer())).toEqual(bytes)
    expect(dst.getState().household?.name).toBe('源')

    // 合并：本机独有记录保留
    const other = await fresh()
    const { out: mine } = await other.commit('create', {}, (tx) => createEntity(tx, { kind: 'item', name: '本机独有' }))
    await restoreMerge(other, parsed)
    expect(other.getState().snap.entities[mine.id]).toBeTruthy()
    expect(other.getState().snap.entities[e.id]).toBeTruthy()
    for (const s of [src, dst, other]) s.close()
  })

  it('非备份文件被拒绝', async () => {
    await expect(readBackup(new Blob(['not a zip']))).rejects.toThrow()
  })
})
