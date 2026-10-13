// 领域类型。core/ 只放纯数据与纯函数：不引用 React、DOM、IndexedDB、import.meta。

/** 所有可同步记录的公共字段。 */
export interface BaseRecord {
  id: string
  createdAt: number
  updatedAt: number
  /** 软删除时间（墓碑，用于同步）；null/undefined = 有效 */
  deletedAt?: number | null
  /** 本地修订号，每次修改 +1；撤销与盘点用它检测「期间是否被改过」 */
  rev: number
  /** 同步元数据：本条记录最后一次与云端一致时的服务端版本号（0/undefined = 云端没有） */
  _srv?: number
  /** 同步元数据：本地有未上传修改 */
  _dirty?: 1
}

export interface Household extends BaseRecord {
  name: string
}

export type EntityKind = 'location' | 'item'
export type EntityState = 'in' | 'out'

/**
 * 实体：位置（房间/柜/层）或物品（含可作容器的物品）。
 * - 房间 = parentId 为 null 的位置。
 * - 物品 parentId 为 null = 未分配位置。
 * - quantity 为 null 表示「不追踪数量」，绝不能显示为 0。
 */
export interface Entity extends BaseRecord {
  kind: EntityKind
  name: string
  parentId: string | null
  /** 位置恒为 true；物品开启后可放其他物品 */
  canContain: boolean
  quantity: number | null
  unit?: string
  /** 物品状态：in = 在库，out = 已取出（保留 parentId 作为原位置历史） */
  state: EntityState
  iconKey?: string | null
  coverId?: string | null
  typeId?: string | null
  category?: string
  note?: string
}

/** 物品型号：同一型号可分布在多个位置（每处一条 Entity，typeId 相同）。 */
export interface ItemType extends BaseRecord {
  name: string
  /** 规范化后的商品码（UPC-A 统一为 EAN-13） */
  barcodes: string[]
}

export type AttachmentTypeKey =
  | 'photo'
  | 'receipt'
  | 'manual'
  | 'warranty'
  | 'invoice'
  | 'maintenance'
  | 'document'
  | 'link'

export const ATTACHMENT_TYPES: AttachmentTypeKey[] = [
  'photo',
  'receipt',
  'manual',
  'warranty',
  'invoice',
  'maintenance',
  'document',
  'link',
]

/** local = 文件字节在本机 IndexedDB；external_url = 只存引用 */
export type AttachmentProvider = 'local' | 'external_url'

export interface Attachment extends BaseRecord {
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
  /** 是否经过压缩优化（照片类型）；凭证类保留原件 = false */
  optimized: boolean
  note?: string
  /** 文件已上传到云端（R2），其他设备可下载 */
  remote?: boolean
}

export type LinkTargetKind = 'entity' | 'type'

export interface AttachmentLink extends BaseRecord {
  attachmentId: string
  targetKind: LinkTargetKind
  targetId: string
}

export type LabelStatus = 'blank' | 'bound' | 'disabled'

export interface Label extends BaseRecord {
  /** 短编号：打印与手输用，不作为授权凭据 */
  code: string
  /** 二维码中的随机 token */
  token: string
  status: LabelStatus
  entityId: string | null
  batchId?: string
}

export type OpType =
  | 'create'
  | 'update'
  | 'move'
  | 'putIn'
  | 'withdraw'
  | 'adjust'
  | 'containerOn'
  | 'containerOff'
  | 'delete'
  | 'labelCreate'
  | 'labelBind'
  | 'labelDisable'
  | 'attach'
  | 'detach'
  | 'attachmentDelete'
  | 'stocktake'
  | 'batch'
  | 'undo'
  | 'import'

/** 一条记录的修改前后快照；before=null 表示新建，after=null 不使用（删除也是软删除）。 */
export interface Change {
  table: TableName
  id: string
  before: AnyRecord | null
  after: AnyRecord
}

/** 操作日志：记录可撤销所需的完整前后快照。 */
export interface Operation extends BaseRecord {
  type: OpType
  /** 用于日志展示的摘要参数 */
  summary: OpSummary
  changes: Change[]
  batchId?: string
  /** 被哪条 undo 操作撤销 */
  undoneBy?: string | null
  /** 本操作撤销了哪条操作 */
  undoOf?: string | null
}

export interface OpSummary {
  entityId?: string
  entityName?: string
  fromId?: string | null
  fromName?: string | null
  toId?: string | null
  toName?: string | null
  qty?: number | null
  qtyBefore?: number | null
  qtyAfter?: number | null
  count?: number
  text?: string
}

export type TableName = 'entities' | 'types' | 'attachments' | 'links' | 'labels'

export type AnyRecord = Entity | ItemType | Attachment | AttachmentLink | Label

/** 内存中的数据快照。所有 core 函数以参数接收，不自己读存储。 */
export interface Snapshot {
  entities: Record<string, Entity>
  types: Record<string, ItemType>
  attachments: Record<string, Attachment>
  links: Record<string, AttachmentLink>
  labels: Record<string, Label>
}

export const TABLES: TableName[] = ['entities', 'types', 'attachments', 'links', 'labels']

export function emptySnapshot(): Snapshot {
  return { entities: {}, types: {}, attachments: {}, links: {}, labels: {} }
}

/** core 需要的外部能力（时间与 id），由调用方注入，便于测试。 */
export interface Ctx {
  now: number
  newId: () => string
}

export class DomainError extends Error {
  readonly code: string
  readonly params: Record<string, string | number>
  constructor(code: string, params: Record<string, string | number> = {}) {
    super(code)
    this.code = code
    this.params = params
  }
}

export function isLive<T extends BaseRecord>(r: T | undefined | null): r is T {
  return !!r && !r.deletedAt
}
