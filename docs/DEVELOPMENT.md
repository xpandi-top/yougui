# 开发

## 环境

- Node 22+（开发用 Node 26、npm 11）。
- `npm install`；同步服务另需 `npm --prefix worker install`。
- 复制 `.env.local.example` 为 `.env.local`（可选）：

| 变量 | 作用 |
|---|---|
| `VITE_BASE` | 部署子路径，GitHub Pages 项目页为 `/<仓库名>/` |
| `VITE_API_URL` | 默认云同步地址；`off` 隐藏云同步；留空由用户在页面填写 |
| `VITE_PUBLIC_URL` | 标签二维码中的正式网址（留空 = 当前地址） |

所有 `VITE_*` 都会打进前端 bundle，不要放密钥。

## 常用命令

```bash
npm run dev              # :5180
npm test                 # Vitest
npm run verify           # 提交前完整检查
npm run build && npm run preview   # :4180，含 Service Worker（离线测试用这个）
```

## 本地跑同步服务（不需要 Cloudflare 账号）

```bash
cd worker
CI=1 npx wrangler d1 migrations apply yougui --local   # 首次：建本地 D1 表
npm run dev                                            # http://localhost:8787（监听 0.0.0.0）
```

然后在应用「更多 → 云同步」填 `http://localhost:8787` → 创建并同步。数据在 `worker/.wrangler/state`（已 gitignore）。

模拟第二台设备：`npm run build && npm run preview`，用 `http://localhost:4180` 打开（不同端口 = 不同存储），在「云同步 → 加入已有家庭」输入第一台设备显示的同步密钥。

## iPhone 真机调试

摄像头只在安全上下文（HTTPS 或 localhost）可用，局域网 `http://192.168.x.x:5180` 打开时**扫码不可用**（会提示改用手输），其余功能正常。要在手机上测相机，任选其一：

1. 部署到 GitHub Pages（HTTPS），手机直接访问。
2. 本机 HTTPS 隧道，例如 `cloudflared tunnel --url http://localhost:5180`，用它给的 https 地址打开。
3. `vite --host` + 自签证书（mkcert，并在 iPhone 信任根证书）。

局域网访问同步服务时，把手机访问的前端来源加入 `worker/wrangler.jsonc` 的 `ALLOWED_ORIGINS`。

## 代码约定

见 `CLAUDE.md`。要点：写入只走 `useCommit().commit` → `core/ops.ts`；文案只用 `t()`；`core/` 不得引用框架与浏览器 API。

## 图标

`assets/icons/manifest.json` 来自交付包 `icons/manifest.json`（ui-* / items-*，80 枚）；`assets/icons/rooms.json` 来自 `room-icons/manifest.json`（rooms-*，24 枚）。更新图标时替换对应文件；不要复用旧 id 表示不同东西。新增房间图标时同步在 `assets/locales/*.json` 加 `room.<key>` 名称（`catalog.test.ts` 会检查）。App 图标（favicon、iPhone 主屏幕、PWA 普通与遮罩图标）用 `app-icons/` 定稿文件，复制到 `public/`：`favicon.ico/.svg(小尺寸版)/-16/-32.png`、`ios-icon-152/167/180.png`（iPhone/iPad 主屏幕）、`icon-192/512.png`、`icon-maskable-192/512.png`、`app-icon.svg`（启动画面）；清单文件为 `app.webmanifest`。应用内品牌标记是 `src/components/ui/BrandMark.tsx`（同一菱形「归」矢量轮廓，≤32px 自动用光学调整版）。

**更换图标时必须改文件名**（例如 `ios-icon-180-v2.png`）并同步 `index.html` 与 `vite.config.ts`：iOS 只在「添加到主屏幕」时抓取图标，且会缓存失败或旧的结果，沿用旧文件名会继续显示旧图标或文字图标。
