# CLAUDE.md — 有归（家庭收纳登记 PWA）

按 SMALL-APP-ARCHITECTURE（BOTC 项目提炼的小 app 模板）搭建。PRD 与设计稿在 `有归_完整交付包_含房间图标库/`（最新，含 room-icons/）与 `有归_完整交付包_v1.2/`（上一版），都是只读参考，不要修改。

## 命令

```bash
npm run dev            # Vite 开发服务器 :5180
npm test               # Vitest（jsdom + fake-indexeddb）
npm run verify         # 提交前必跑：i18n → core 边界 → 测试 → 构建 → 体积预算 → worker
npm run core:check     # core/ 只用 ES2022 类型检查
npm run i18n:check     # zh/en key 与占位符一致
npm --prefix worker test / run typecheck / run dev
```

## 结构与依赖方向

```
components → hooks → core          worker → core（只用 core/sync.ts 协议类型）
     ↓         ↓
    lib ─────→ core
```

| 目录 | 职责 |
|---|---|
| `src/core/` | **纯逻辑**：领域类型、`Tx` 写事务、业务操作（ops）、树/路径、搜索、条码、盘点、扫码批次、同步规则。禁止 React/MUI/DOM/IndexedDB/`import.meta`（`tsconfig.core.json` + `coreBoundary.test.ts` 强制）。 |
| `src/lib/` | 适配层：`store.ts`（内存快照 + IndexedDB）、`db.ts`、`settings.ts`（localStorage）、`sync.ts`（云同步客户端）、`backup.ts`（ZIP）、`scanner.ts`（摄像头 + BarcodeDetector/ZXing）、`qr.ts`、`files.ts`。 |
| `src/hooks/` | `useRoute`（hash 路由）、`useCommit`（统一提交 + 撤销提示 + 错误翻译）、`useFileUrl`。 |
| `src/context/` | i18n、store、feedback（toast/confirm）。 |
| `src/components/` | `pages/`（每路由一个）、`dialogs/`、`ui/`。 |
| `app-icons/` | App 图标定稿源文件（宣纸底、朱砂菱形「归」）；用到的已复制到 `public/`，应用内标记见 `ui/BrandMark.tsx`。 |
| `assets/` | 构建期打包的内容：`icons/manifest.json`（ui-* 32 枚 + items-* 48 枚）、`icons/rooms.json`（rooms-* 24 枚房间图标）、`locales/{zh,en}.json`。统一经 `src/catalog.ts` 读取。 |
| `worker/` | 可选同步 API：Hono + D1 + R2，独立 package 与测试。 |
| `scripts/` | `verify.mjs`、`i18n-check.mjs`、`bundle-budget.mjs`。 |

## 核心约定

- **所有数据修改走 `store.commit(type, summary, tx => op(tx, ...))`**（组件里用 `useCommit().commit`）。业务规则写在 `core/ops.ts`，校验失败抛 `DomainError('code')`，整批不写入；文案在 `err.<code>`。
- **每次提交都产生 `Operation`**，记录每条记录的 before/after；撤销 = 新的反向操作，若期间被改过（rev 不同）则拒绝。
- **软删除**：`deletedAt` 墓碑，便于同步；读取用 `!e.deletedAt` 过滤。
- 实体：`kind = location | item`；房间 = 无父位置；`parentId = null` 的物品 = 未分配；`quantity = null` = 不追踪（不能显示为 0）；`state = out` = 已取出（保留原 parentId）。
- 同型号多处库存 = 多条 Entity 共享 `typeId`；商品码挂在 `ItemType.barcodes`（UPC-A 规范化成 EAN-13）。
- 图标：`Entity.iconKey` 存稳定 id（物品用 `items-*`，位置用 `rooms-*` 或收纳类 `items-*`）；显示优先级 封面照片 → iconKey → 默认（物品 `items-box`，位置 `ui-room`）。新建位置时 `suggestRoomIcon(name)` 给出可见、可改的默认图标，不对已有数据做名称推断。
- 文案一律 `t('key')`，新增 key 同时加 zh 与 en（`npm run i18n:check`）。
- 主题色只在 `src/theme/theme.ts`；组件用 `primary/secondary/paper.*` token。
- 存储 key 带版本号，变更时更新 `docs/STORAGE.md`。
- 路由是 hash（`#/e/:id`、`#/l/:token` 标签深链接…），见 `src/App.tsx`。

## 关键文件

- `src/core/ops.ts` — 所有业务操作与规则
- `src/core/tx.ts` — 写时复制事务，记录变更
- `src/core/scanBatch.ts` — 连续扫码清单解析与整批提交
- `src/lib/store.ts` — AppStore：加载、提交、撤销、同步写入、导入
- `src/lib/sync.ts` + `worker/src/app.ts` — 同步协议两端
- `src/lib/lookup.ts` + `worker/src/lookup.ts` + `src/core/productInfo.ts` — 商品名查询（Open Facts 直连 → Worker 代理 UPCitemdb → D1 缓存）
- `src/components/pages/EntityPage.tsx` — 位置/容器/物品详情与操作

## 文档索引

`docs/ARCHITECTURE.md`（架构与协议）· `docs/PRD-ADJUSTMENTS.md`（与 PRD 的差异）· `docs/STORAGE.md` · `docs/DEVELOPMENT.md` · `docs/DEPLOY.md` · `docs/TESTING.md` · `docs/ISSUES.md` · `docs/CHANGELOG.md`
