import type { FileStore } from './types.ts'

/** 私有 R2 文件存储：不开放公共读取，所有读取经 Worker 鉴权后流式返回。 */
export class R2FileStore implements FileStore {
  constructor(private readonly bucket: R2Bucket) {}

  async put(key: string, body: ArrayBuffer, meta: { contentType: string; checksum: string }): Promise<void> {
    await this.bucket.put(key, body, { httpMetadata: { contentType: meta.contentType }, customMetadata: { sha256: meta.checksum } })
  }

  async get(key: string) {
    const o = await this.bucket.get(key)
    if (!o) return null
    return { body: o.body, contentType: o.httpMetadata?.contentType ?? 'application/octet-stream', size: o.size }
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key)
  }
}
