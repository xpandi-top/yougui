# 有归 Homebase · 家庭收纳登记

记下家里每件东西放在哪里：搜索看完整路径，扫码打开位置或物品，整盒搬家时路径自动跟着变。

- **本地优先**：数据保存在本机浏览器（IndexedDB），断网也能完整使用，不需要注册。
- **可以联网**：部署到 GitHub Pages 后，任何设备打开网址即可用，也能安装到 iPhone 主屏幕（PWA）。
- **可选云同步**：把 `worker/` 部署到你自己的 Cloudflare（D1 存记录、R2 存附件），多台设备共用一份数据。

> 设计来源：`有归_完整交付包_含房间图标库/`（PRD v1.2、页面设计、新中式物品图标与房间图标库；`有归_完整交付包_v1.2/` 为上一版）。本实现对 PRD 做了哪些取舍，见 [docs/PRD-ADJUSTMENTS.md](docs/PRD-ADJUSTMENTS.md)。

## 快速开始

```bash
npm install
npm run dev          # http://localhost:5180
```

需要 Node 22+（开发时用的是 Node 26）。

| 命令 | 作用 |
|---|---|
| `npm run dev` / `npm run dev:host` | 开发服务器（`:host` 允许局域网设备访问） |
| `npm run build` && `npm run preview` | 生产构建与本地预览（含 PWA 离线） |
| `npm test` | 单元 + 组件测试（Vitest） |
| `npm run verify` | 完整门禁：i18n、core 边界、测试、构建、体积预算、worker 测试 |
| `npm run worker:dev` | 本地运行同步服务（需先 `npm --prefix worker install`） |

## 功能（v0.2）

| 模块 | 能力 |
|---|---|
| 位置 | 房间 → 柜 → 层 → 盒，自由层级；任何物品可开启「容器」；整盒移动；房间用 24 枚房间图标或照片作封面 |
| 物品 | 只填名称即可保存；连续添加；图标；数量追踪（可选）；分类、备注、商品码 |
| 搜索 | 名称/路径/备注/商品码；多关键词；限定位置范围；结果显示完整路径 |
| 操作 | 取出、放回、入库、移动（含部分数量移动）、调整数量；全部写日志，可撤销 |
| 扫码 | 普通模式直接打开；连续模式（入库/取出/移动）先进清单再整批提交；手动输入兜底 |
| 标签 | 批量生成空白二维码 → 按毫米实际尺寸打印 → 扫码绑定；改绑、停用、补打 |
| 盘点 | 选范围建快照 → 录实际数/已见/缺失 → 差异复核 → 调整；未核对不归零 |
| 附件 | 照片（自动优化 1600px）、收据/说明书 PDF（保留原件）、外链；一份附件关联多处；未关联列表 |
| 数据 | ZIP 完整备份与恢复（含附件文件）；可选云同步，冲突不静默覆盖 |
| 体验 | 新中式主题、深色模式、中英文、iPhone 安全区与 44px 触控 |

## 文档

- [CLAUDE.md](CLAUDE.md) — 开发入口：命令、结构、约定
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 架构、数据模型、同步协议
- [docs/PRD-ADJUSTMENTS.md](docs/PRD-ADJUSTMENTS.md) — 对 PRD 的实现范围与调整
- [docs/STORAGE.md](docs/STORAGE.md) — 所有存储 key / 表的契约
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — 开发环境、iPhone 真机调试
- [docs/DEPLOY.md](docs/DEPLOY.md) — GitHub Pages 与 Cloudflare Worker 部署
- [docs/TESTING.md](docs/TESTING.md) — 自动测试与 PRD 验收对照、手动清单
- [docs/ISSUES.md](docs/ISSUES.md) — 已知问题与后续需求
- [docs/CHANGELOG.md](docs/CHANGELOG.md)
