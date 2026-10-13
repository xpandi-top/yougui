// 唯一的内置内容入口：图标清单（构建期打包）。
// - assets/icons/manifest.json：ui-*（页面）与 items-*（物品），来自交付包 icons/
// - assets/icons/rooms.json：rooms-*（房间与功能区域），来自交付包 room-icons/
import manifest from '../assets/icons/manifest.json'
import roomManifest from '../assets/icons/rooms.json'

export type IconKind = 'ui' | 'items' | 'rooms'

export interface IconDef {
  id: string
  key: string
  name: string
  group: string
  kind: IconKind
  body: string
}

const ICONS: IconDef[] = [
  ...(manifest as IconDef[]),
  ...(roomManifest as Omit<IconDef, 'kind'>[]).map((r) => ({ ...r, kind: 'rooms' as const })),
]
const BY_ID = new Map(ICONS.map((i) => [i.id, i]))

export const DEFAULT_ITEM_ICON = 'items-box'
/** 位置没有（或有无法识别的）图标时的通用回退 */
export const LOCATION_ICON = 'ui-room'

export function iconById(id: string | null | undefined): IconDef | undefined {
  return id ? BY_ID.get(id) : undefined
}

export function uiIcon(key: string): IconDef | undefined {
  return BY_ID.get(`ui-${key}`)
}

export const ITEM_ICONS: IconDef[] = ICONS.filter((i) => i.kind === 'items')
export const ROOM_ICONS: IconDef[] = ICONS.filter((i) => i.kind === 'rooms')

export const ITEM_ICON_GROUPS: string[] = [...new Set(ITEM_ICONS.map((i) => i.group))]
export const ROOM_ICON_GROUPS: string[] = [...new Set(ROOM_ICONS.map((i) => i.group))]

/** 图标组名的英文（manifest 只有中文）。 */
export const GROUP_EN: Record<string, string> = {
  收纳: 'Storage',
  数码: 'Digital',
  工具: 'Tools',
  衣物: 'Clothing',
  厨卫: 'Kitchen & bath',
  文具: 'Stationery',
  出行: 'Travel',
  家居: 'Home',
  健康: 'Health',
  生活: 'Living',
  日常起居: 'Living',
  厨卫家务: 'Kitchen, bath & chores',
  睡眠休憩: 'Sleep & rest',
  阅读工作: 'Study & work',
  收纳储藏: 'Storage',
  通行过渡: 'Passageways',
  户外延伸: 'Outdoor',
  休闲兴趣: 'Hobbies',
}

/**
 * 图标显示名。房间图标的英文名走 i18n（room.<key>），由调用方传入 roomName；
 * 物品图标的英文名用 key 首字母大写。
 */
export function iconLabel(icon: IconDef, lang: 'zh' | 'en', roomName?: (key: string) => string): string {
  if (lang === 'zh') return icon.name
  if (icon.kind === 'rooms' && roomName) return roomName(icon.key)
  return icon.key.charAt(0).toUpperCase() + icon.key.slice(1)
}

// 按名称给新位置推荐图标：只在新建位置时作为默认值（界面上可见、随时可改），
// 不用于推断已有数据，也不代表房间分类。顺序有意义：更具体的词在前；
// 柜子、抽屉、盒子这类子位置用物品图标库里的收纳图标。
const PLACE_HINTS: Array<[RegExp, string]> = [
  [/食品|储粮|粮仓|pantry|larder/i, 'rooms-pantry'],
  [/儿童|孩子|宝宝|婴儿|kid|child|nursery|baby/i, 'rooms-child'],
  [/衣帽|衣物间|更衣|closet|dressing/i, 'rooms-closet'],
  [/洗衣|laundry|utility/i, 'rooms-laundry'],
  [/客房|客卧|guest/i, 'rooms-guest'],
  [/浴室|淋浴|bath(room)?|shower/i, 'rooms-bathroom'],
  [/卫生间|洗手间|厕所|卫浴|主卫|客卫|toilet|restroom|powder|\bwc\b/i, 'rooms-powder'],
  [/卧|睡房|bed(room)?/i, 'rooms-bedroom'],
  [/客厅|起居|大厅|living|lounge/i, 'rooms-living'],
  [/餐厅|饭厅|餐室|dining/i, 'rooms-dining'],
  [/厨房|kitchen/i, 'rooms-kitchen'],
  [/书房|阅读|study|library/i, 'rooms-study'],
  [/工作室|办公|office|studio/i, 'rooms-office'],
  [/玄关|门厅|入户|entry|foyer/i, 'rooms-entry'],
  [/走廊|过道|hall(way)?|corridor/i, 'rooms-hallway'],
  [/阳台|balcony/i, 'rooms-balcony'],
  [/露台|天台|terrace|patio|deck/i, 'rooms-terrace'],
  [/花园|庭院|院子|garden|yard/i, 'rooms-garden'],
  [/车库|garage/i, 'rooms-garage'],
  [/地下室|basement|cellar/i, 'rooms-basement'],
  [/阁楼|attic|loft/i, 'rooms-attic'],
  [/健身|gym|fitness/i, 'rooms-gym'],
  [/工具|工坊|workshop|tool/i, 'rooms-workshop'],
  [/抽屉|drawer/i, 'items-drawer'],
  [/柜|橱|cabinet|cupboard|wardrobe/i, 'items-cabinet'],
  [/篮|筐|basket/i, 'items-basket'],
  [/箱|盒|box|bin|crate/i, 'items-box'],
  [/储藏|储物|杂物|仓库|storage|store ?room/i, 'rooms-storage'],
]

export function suggestRoomIcon(name: string): string | null {
  const s = name.trim()
  if (!s) return null
  for (const [re, id] of PLACE_HINTS) if (re.test(s)) return id
  return null
}
