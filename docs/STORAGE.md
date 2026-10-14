# 存储契约

改动任何 key、表或形状时：升版本号、写迁移、更新本表。

## 1. IndexedDB（本机，数据权威）

数据库 `yougui`，版本 `1`（`src/lib/db.ts`）。

| Store | keyPath | 形状 | 导出到备份 | 云同步 kind | 说明 |
|---|---|---|---|---|---|
| `entities` | id | `Entity` | ✅ | `entities` | 位置与物品；软删除 |
| `types` | id | `ItemType` | ✅ | `types` | 型号与商品码 |
| `attachments` | id | `Attachment` | ✅ | `attachments` | 元数据；`remote=true` 表示文件已在 R2 |
| `links` | id（`附件~kind~目标`） | `AttachmentLink` | ✅ | `links` | |
| `labels` | id（= token） | `Label` | ✅ | `labels` | |
| `ops` | id，索引 `byCreated` | `Operation` | ✅ | `ops` | 操作日志（含 before/after 快照） |
| `files` | id（= 附件 id） | `{id, blob, mime, size}` | ✅ 文件本体 | 经 `/v1/files` | 只在本机；云端在 R2 |
| `meta` | 显式 key | — | | | |
| ↳ `household` | | `Household`（id 固定 `home`） | ✅ | `household` | 单例，便于多设备合并 |
| ↳ `syncConflicts` | | `ConflictEntry[]`（≤200） | ❌ | ❌ | 被云端版本替换掉的本机版本 |

`Entity.iconKey`：图标稳定 id，物品为 `items-*`，位置为 `rooms-*`（房间图标库）或 `items-*`（柜子、抽屉等收纳图标）；未知 id 回退默认图标。`Entity.coverId`：封面照片附件 id（物品与位置都可用）。`Entity.expiresAt`：有效期（本地日期 `YYYY-MM-DD`，仅物品）。`ItemType.product`：联网查到并保存的产品信息 `{name, brand, model, category, source, at}`。

公共字段：`id, createdAt, updatedAt, rev, deletedAt?`；同步元数据 `_srv?`（服务端版本）、`_dirty?`（待上传），导出备份时会去掉。

迁移方式：`openAppDb` 的 `upgrade(oldVersion)` 中按版本递增处理；读取时容忍未知字段（展开复制保留）。

## 2. localStorage（本机偏好，可丢失）

| Key | 模块 | 形状 | 导出 | 说明 |
|---|---|---|---|---|
| `yg-settings-v1` | `lib/settings.ts` | `{lang, theme, labelBaseUrl, labelSize, labelShowName, labelShowPath, scanSound, productLookup}` | ❌ | 跨标签页通过 `storage` 事件同步 |
| `yg-sync-v1` | `lib/sync.ts` | `{apiUrl, key, householdName, cursor, lastSyncAt, lastError, auto}` | ❌ **含密钥，绝不导出** | 断开同步时删除 |
| `yg-lookup-v1` | `lib/lookup.ts` | `{[商品码]: {at, status, info?}}`（≤300 条） | ❌ | 商品名查询结果缓存；未查到的 1 天后过期，未开云同步时不缓存未查到 |
| `yg-scan-draft-v1` | `ScanPage` | `{op, targetId, lines[]}` | ❌ | 连续扫码未提交清单（切后台/刷新后恢复） |
| `yg-count-draft-v1` | `StocktakePage` | `{scopeId, deep, lines, entries, startedAt}` | ❌ | 进行中的盘点 |

sessionStorage：`yg-chunk-reload`（`lazyWithRetry` 防止无限刷新）。

## 3. 云端（可选，Cloudflare）

### D1（`worker/migrations/0001_init.sql`）

| 表 | 主键 | 说明 |
|---|---|---|
| `households` | id | `name`、`token_hash`（SHA-256，不存明文密钥）、`created_at` |
| `counters` | household_id | `ver` 家庭内单调递增版本 |
| `records` | (household_id, kind, id) | `data`（客户端记录 JSON）、`updated_at`、`deleted`、`ver`；索引 (household_id, ver) |
| `files` | (household_id, attachment_id) | R2 对象账本：size、mime、checksum、created_at（配额与孤儿清理） |
| `product_cache` | code | 商品名查询缓存（`0002_product_cache.sql`）：status found/notFound、data（ProductInfo JSON）、fetched_at；公开商品信息，跨家庭共享 |

### R2

私有 bucket `yougui-files`，key = `h/<householdId>/<attachmentId>`，`httpMetadata.contentType`、`customMetadata.sha256`。不开放公共读取，只能经 Worker 鉴权下载。

## 4. 备份 ZIP（`lib/backup.ts`）

```
manifest.json   {app, schemaVersion:1, appVersion, exportedAt, counts, files[{id,path,size,mime,checksum}], external[], missing[]}
data.json       {schemaVersion, household, tables{entities,types,attachments,links,labels}, ops}
files/<附件id>.<ext>
```

外链只记录引用（`content_included:false`）；本机没有文件的附件列入 `missing`。同步密钥、设置不导出。导入先校验 schema 与每个文件的 SHA-256。
