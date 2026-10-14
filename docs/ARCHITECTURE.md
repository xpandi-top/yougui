# 架构

## 1. 总览

```
┌──────────────────────── 浏览器 / iPhone 主屏幕 PWA（静态文件，GitHub Pages） ────────────────────────┐
│ React 19 + TS + Vite 8 + MUI 9（新中式主题）                                                          │
│ components → hooks → core（纯逻辑）        lib（IndexedDB、localStorage、摄像头、二维码、ZIP、同步）     │
│ 内容：assets/icons/manifest.json、assets/locales/*.json（构建期打包）                                   │
│ 本机数据：IndexedDB（唯一真相）   设置：localStorage   离线：Service Worker 预缓存 app shell             │
└───────────────────────────────────────────┬─────────────────────────────────────────────────────────┘
                                            │ HTTPS，Bearer 同步密钥（可选，不配置则完全本地）
                          ┌─────────────────▼──────────────────┐
                          │ Cloudflare Worker（Hono）            │
                          │ /v1/sync/push|pull  /v1/files/:id    │
                          │ D1：households、records、files 账本  │
                          │ R2：私有附件文件  Cron：孤儿清理       │
                          └──────────────────────────────────────┘
```

两种运行方式用同一份代码：

| 场景 | 怎么跑 | 数据在哪 |
|---|---|---|
| 本地 | `npm run dev` / `npm run preview`，或部署后断网使用 | 本机 IndexedDB |
| 联网 | GitHub Pages 网址，安装到主屏幕 | 本机 IndexedDB；开启云同步后另存一份到你的 D1/R2 |

## 2. 分层

| 层 | 规则 |
|---|---|
| `core/` | 纯函数，参数接收 `Snapshot` 与 `Ctx{now,newId}`，不读存储。`Tx` 在快照上写时复制并记录 before/after。业务失败抛 `DomainError(code, params)`。 |
| `lib/store.ts` | `AppStore`：启动时把 IndexedDB 全量读入内存快照（1 万条级别没问题），`commit()` 在 Tx 中执行 core 操作 → 更新内存 → 单个 IDB 事务写盘（失败回滚内存）→ 通知订阅者。 |
| `hooks/useCommit` | UI 唯一的写入口：成功 toast（带撤销）、失败把 `DomainError` 翻译成 `err.<code>` 文案。 |
| `components/` | 只读 `useAppState()` / `useSnap()`，写入走 `useCommit`。 |

## 3. 数据模型

| 表 | 说明 |
|---|---|
| `entities` | 位置与物品统一为 Entity。`kind`、`parentId`（单父）、`canContain`、`quantity`（null=不追踪）、`state`（in/out）、`iconKey`、`coverId`、`typeId`、`category`、`note` |
| `types` | 型号：`barcodes[]`（规范化）。同型号在多处 = 多条 Entity 共享 typeId |
| `attachments` | 附件元数据：`typeKey`（photo/receipt/manual/warranty/invoice/maintenance/document/link）、`provider`（local/external_url）、mime、size、checksum、`optimized`、`remote` |
| `links` | 附件 ↔ 实体/型号 多对多；id = `附件~kind~目标`，解除 = 软删除 |
| `labels` | 标签：id = 随机 token（16 位），`code` 6 位短编号，`status` blank/bound/disabled |
| `ops` | 操作日志：type、summary、changes[{table,id,before,after}]、undoneBy/undoOf、batchId |
| `files` | 附件字节（Blob），只在本机；云端在 R2 |
| `meta` | `household`（单例 id=home）、`syncConflicts` |

所有记录有 `id/createdAt/updatedAt/rev/deletedAt`，以及同步元数据 `_srv`（最后一次与云端一致的服务端版本）、`_dirty`（有未上传修改）。

### 关键规则（在 `core/ops.ts`）

- 层级不能成环；位置不能放进物品容器；目标必须是位置或开启容器的物品。
- 有子项不能删除、不能关闭容器；数量 >1 的物品不能直接变容器。
- 整盒移动只改盒子的 `parentId`，后代路径动态计算。
- 部分数量移动：来源减少、目标同型号库存增加（没有就新建同 typeId 的库存），同一事务。
- 取出：追踪数量 → 扣减（不能超过库存）；不追踪 → `state=out`，保留原位置。
- 删除记录 ≠ 取出：删除时解除附件关联（附件保留）、停用绑定的标签。
- 标签已绑定到别处时必须显式确认才能改绑。
- 撤销：校验每条变更记录的当前 rev 等于操作后的 rev，否则拒绝（`undo.stale`）。
- 盘点：快照记录 rev；提交时任一条 rev 变了整批拒绝（`stocktake.changed`）；未核对不调整。
- 连续扫码：识别结果进清单（纯函数 `resolveScan`），确认后 `commitBatch` 一次事务，任一行失败抛 `LineError` 整批不写。

## 4. 同步协议（可选）

单位是「记录」，kind ∈ entities/types/attachments/links/labels/ops/household。

**推送** `POST /v1/sync/push {records:[{kind,id,data,updatedAt,deleted,baseVer}]}`：
D1 一个 batch（事务）内，对每条记录先 `UPDATE counters SET ver=ver+1 RETURNING ver`，再
`INSERT … ON CONFLICT DO UPDATE … WHERE records.ver = baseVer`。没写进去的就是冲突，返回云端当前版本。
因此 ver 在家庭内按提交顺序单调递增，拉取游标不会漏；响应丢失后用同一 baseVer 重试只会得到冲突，不会重复写入（PRD A07）。

**拉取** `GET /v1/sync/pull?since=<cursor>` 按 ver 分页。客户端规则（`core/sync.ts decideRemote`）：
本地没有 → 采用；本地 `_srv ≥ ver` → 跳过（自己刚推的回声）；本地无未上传修改 → 采用；内容相同 → 采用；否则 → **冲突**。

**冲突处理**：采用云端版本，把本机版本存入 `meta.syncConflicts`，在「云同步」页复核，可「用本机覆盖」（以当前云端版本为 baseVer 重新推送）。不做最后写入静默覆盖。

**附件文件**：同步时先 `PUT /v1/files/:id`（Worker 校验 MIME 白名单 + 文件头嗅探 + 大小 + 配额 + 可选 SHA-256），成功后把附件记录标 `remote:true` 再推送；其他设备查看时 `GET /v1/files/:id` 按需下载并缓存到本机。读取前校验附件记录仍有效（不凭对象 key 授权）。附件墓碑推送后删除 R2 对象；每日 Cron 清理 24 小时仍无记录的孤儿文件与已删除附件的文件。

**鉴权**：创建家庭返回同步密钥 `<householdId>.<secret>`；D1 只存 `sha256(secret)`；每个请求 Bearer 校验（常量时间比较），家庭不存在与密钥错误返回相同 401。可设 `SETUP_SECRET` 限制谁能在你的服务上建家庭。CORS 只放行 `ALLOWED_ORIGINS`（CORS 不是授权机制，授权靠密钥）。

## 5. 商品名查询（可选，设置可关）

扫到新商品码时给出名称建议，用户确认后才写入：

1. 本机缓存（`yg-lookup-v1`）。
2. 浏览器直连 Open Food / Beauty / Pet Food / Products Facts（免费、不限量、允许跨域），并行查询，取第一个有名称的结果。
3. 开启了云同步时：`GET /v1/lookup/:code`（需同步密钥）→ Worker 查 D1 `product_cache` → UPCitemdb 免费试用（浏览器因 CORS 不能直连）→ 配置了 `UPCDATABASE_KEY` 时再查 upcdatabase.org。查到缓存 90 天，确定没有缓存 7 天，额度用完/上游出错不缓存。

只发送商品码；解析逻辑在 `core/productInfo.ts`（前端与 Worker 共用）；UI 在 `LookupHint`、`ProductNameDialog` 与添加页，用户输入过名称就不覆盖。

## 6. 扫码与标签

- 标签二维码内容：`<应用地址>#/l/<token>`，系统相机扫码也能直接打开；token 随机 16 位（约 80 bit），不含物品名或地址；6 位短编号（去掉 0/O/1/I/L）用于手输。
- 摄像头：`getUserMedia`（后置、仅视频、playsinline），优先原生 `BarcodeDetector`，不支持（如 iOS Safari）时按需加载 ZXing 独立 chunk。支持 QR、EAN-13、EAN-8、UPC-A/E。
- 去抖：同一码持续在镜头内只触发一次，离开 1.5 秒后再出现才算新的一次。切后台立即停止摄像头轨道。
- 打印：CSS `@page` 按毫米输出（每张一页 / A4 排版），系统打印或存 PDF 再导入标签机 App。

## 7. 离线 / PWA

`vite-plugin-pwa`（generateSW，prompt 模式）预缓存 app shell 与所有 chunk（含 ZXing，扫码离线可用）。更新流程见 `lib/pwa.ts`：启动、切回前台、每小时及手动「检查更新」时调用 `registration.update()`；新版本安装好后显示 `UpdateBanner`，用户点「更新」才 `skipWaiting` 并刷新；设置页提供「清除缓存并重新加载」兜底；hash 路由避免 GitHub Pages 刷新 404；`base` 与 manifest `scope` 随 `VITE_BASE`。React/MUI/Emotion 同一 vendor chunk；懒加载页面用 `lazyWithRetry`（新版本部署后旧 chunk 404 时刷新一次）。启动时请求 `navigator.storage.persist()`。

## 8. 质量门禁

`npm run verify`：i18n 一致性 → core 边界类型检查 → Vitest（core 规则、store 持久化、ZIP 往返、i18n、UI 冒烟）→ `tsc -b && vite build` → gzip 体积预算 → worker typecheck + 测试。CI 在 PR 上跑 verify；main 分支自动部署 Pages，Worker 部署需显式开启。
