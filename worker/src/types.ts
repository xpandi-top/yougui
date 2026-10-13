// 与前端共用的同步线上协议（单一来源：src/core/sync.ts）
export type { PullResult, PushRecord, PushResult, WireRecord } from '../../src/core/sync.ts'
export { parseSyncKey } from '../../src/core/sync.ts'
import type { ProductCache } from './lookup.ts'

export interface Household {
  id: string
  name: string
  tokenHash: string
  createdAt: number
}

export interface FileEntry {
  attachmentId: string
  size: number
  mime: string
  checksum: string
  createdAt: number
}

/** 记录存储：D1 实现见 d1.ts，测试用内存实现见 memory.ts。 */
export interface SyncStore extends ProductCache {
  createHousehold(h: Household): Promise<void>
  getHousehold(id: string): Promise<Household | null>
  push(householdId: string, records: import('../../src/core/sync.ts').PushRecord[]): Promise<import('../../src/core/sync.ts').PushResult>
  pull(householdId: string, since: number, limit: number): Promise<import('../../src/core/sync.ts').PullResult>
  getFile(householdId: string, attachmentId: string): Promise<FileEntry | null>
  putFile(householdId: string, f: FileEntry): Promise<void>
  deleteFile(householdId: string, attachmentId: string): Promise<void>
  usedBytes(householdId: string): Promise<number>
  /** 是否存在未删除的附件记录 */
  attachmentLive(householdId: string, attachmentId: string): Promise<boolean>
  /** 清理候选：超过 olderThan 仍无附件记录，或附件已删除 */
  orphanFiles(olderThan: number, limit: number): Promise<Array<{ householdId: string; attachmentId: string }>>
}

/** 文件字节存储：R2 实现见 r2.ts。 */
export interface FileStore {
  put(key: string, body: ArrayBuffer, meta: { contentType: string; checksum: string }): Promise<void>
  get(key: string): Promise<{ body: ReadableStream | ArrayBuffer; contentType: string; size: number } | null>
  delete(key: string): Promise<void>
}

export function fileKey(householdId: string, attachmentId: string): string {
  return `h/${householdId}/${attachmentId}`
}
