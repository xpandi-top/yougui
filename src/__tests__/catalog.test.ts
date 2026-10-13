import { describe, expect, it } from 'vitest'
import zh from '../../assets/locales/zh.json'
import { ITEM_ICONS, LOCATION_ICON, ROOM_ICONS, iconById, suggestRoomIcon } from '../catalog.ts'

describe('图标目录', () => {
  it('房间图标 24 枚，rooms-* 命名空间，与物品/页面图标 id 不冲突', () => {
    expect(ROOM_ICONS).toHaveLength(24)
    expect(ROOM_ICONS.every((i) => i.id === `rooms-${i.key}` && i.kind === 'rooms')).toBe(true)
    const ids = [...ROOM_ICONS, ...ITEM_ICONS].map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(iconById('rooms-kitchen')?.name).toBe('厨房')
    expect(iconById(LOCATION_ICON)).toBeTruthy()
    expect(iconById('rooms-unknown')).toBeUndefined()
  })

  it('每个房间图标都有中英文名称', () => {
    for (const i of ROOM_ICONS) expect(zh, i.key).toHaveProperty(`room.${i.key}`)
  })

  it('按名称推荐位置图标；无法识别时为 null（回退通用房间图标）', () => {
    const cases: Array<[string, string | null]> = [
      ['客厅', 'rooms-living'],
      ['主卧', 'rooms-bedroom'],
      ['次卧', 'rooms-bedroom'],
      ['客卧', 'rooms-guest'],
      ['主卫', 'rooms-powder'],
      ['淋浴间', 'rooms-bathroom'],
      ['宝宝房', 'rooms-child'],
      ['衣帽间', 'rooms-closet'],
      ['食品储藏室', 'rooms-pantry'],
      ['杂物间', 'rooms-storage'],
      ['Garage', 'rooms-garage'],
      ['储物柜', 'items-cabinet'],
      ['第二层抽屉', 'items-drawer'],
      ['配件收纳盒', 'items-box'],
      ['储藏间', 'rooms-storage'],
      ['爸爸的角落', null],
      ['', null],
    ]
    for (const [name, want] of cases) expect(suggestRoomIcon(name), name).toBe(want)
    // 每个房间的中文名都能推荐回自己的图标
    for (const i of ROOM_ICONS) expect(suggestRoomIcon(i.name), i.name).toBe(i.id)
  })
})
