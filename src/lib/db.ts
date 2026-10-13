// IndexedDB 适配层：本机数据的持久化。表结构与 key 契约见 docs/STORAGE.md。
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Attachment, AttachmentLink, Entity, Household, ItemType, Label, Operation, TableName } from '../core/index.ts'

export interface StoredFile {
  id: string
  blob: Blob
  mime: string
  size: number
}

interface YouguiDB extends DBSchema {
  entities: { key: string; value: Entity }
  types: { key: string; value: ItemType }
  attachments: { key: string; value: Attachment }
  links: { key: string; value: AttachmentLink }
  labels: { key: string; value: Label }
  ops: { key: string; value: Operation; indexes: { byCreated: number } }
  files: { key: string; value: StoredFile }
  meta: { key: string; value: unknown }
}

export const DB_NAME = 'yougui'
export const DB_VERSION = 1

export type AppDB = IDBPDatabase<YouguiDB>
export type StoreName = TableName | 'ops' | 'files' | 'meta'

export const META_HOUSEHOLD = 'household'
export const META_CONFLICTS = 'syncConflicts'

export function openAppDb(name = DB_NAME): Promise<AppDB> {
  return openDB<YouguiDB>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        for (const t of ['entities', 'types', 'attachments', 'links', 'labels'] as const) db.createObjectStore(t, { keyPath: 'id' })
        const ops = db.createObjectStore('ops', { keyPath: 'id' })
        ops.createIndex('byCreated', 'createdAt')
        db.createObjectStore('files', { keyPath: 'id' })
        db.createObjectStore('meta')
      }
    },
  })
}

export type { Household }
