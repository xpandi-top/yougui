# 部署

两部分独立：**前端**（必需，静态文件）和**同步服务**（可选）。只部署前端时，应用以纯本地模式运行。

## 1. 前端 → GitHub Pages

1. 推到 GitHub 仓库（例如 `yougui`）。
2. 仓库 Settings → Pages → Source 选 **GitHub Actions**。
3. 推送 `main`，`.github/workflows/deploy-pages.yml` 会测试、构建并发布到 `https://<user>.github.io/<repo>/`。

可在仓库 Settings → Secrets and variables → **Variables** 配置：

| Variable | 用途 |
|---|---|
| `VITE_BASE` | 默认 `/<仓库名>/`；如果是 `<user>.github.io` 主页仓库或自定义域名根路径，设为 `/` |
| `VITE_API_URL` | 默认同步服务地址（你的 Worker URL），用户仍可在页面修改；设 `off` 隐藏云同步 |
| `VITE_PUBLIC_URL` | 标签二维码里的网址，例如 `https://<user>.github.io/yougui/` |

> 打印标签前确认二维码网址是正式 HTTPS 地址（设置页「标签链接地址」也可以改），否则手机系统相机扫出来打不开。应用内扫码只认 token，不受影响。

其他静态托管（Cloudflare Pages、Netlify、自己的 Nginx）同理：`npm run build`，发布 `dist/`，按需设置 `VITE_BASE`。

## 2. 同步服务 → Cloudflare Worker（可选）

免费额度（Workers 每天 10 万请求、D1 5 GB、R2 10 GB）对家庭使用足够。

```bash
cd worker
npm install
npx wrangler login
npx wrangler d1 create yougui            # 记下输出的 database_id
npx wrangler r2 bucket create yougui-files
```

编辑 `worker/wrangler.jsonc`：

- `d1_databases[0].database_id` 填上一步的 id；
- `vars.ALLOWED_ORIGINS` 加上你的前端来源，如 `https://<user>.github.io`（注意是 origin，不带路径）；
- 可调整 `MAX_FILE_BYTES`（默认 20 MiB）、`QUOTA_BYTES`（默认 5 GiB / 家庭）。

```bash
npx wrangler secret put SETUP_SECRET     # 强烈建议：创建家庭时需要这个口令
npx wrangler secret put UPCDATABASE_KEY  # 可选：upcdatabase.org 的 key，作为商品名查询的备选来源
npm run migrate:remote
npm run deploy                           # 得到 https://yougui-api.<account>.workers.dev
curl https://yougui-api.<account>.workers.dev/v1/health
```

然后在应用「更多 → 云同步」填服务地址和创建口令 → 创建并同步；其他设备用同步密钥加入。

### 自动部署（可选）

仓库 Variables 设 `DEPLOY_WORKER=true`、`VITE_API_URL=<worker 地址>`；Secrets 设 `CLOUDFLARE_API_TOKEN`（Workers + D1 + R2 编辑权限）、`CLOUDFLARE_ACCOUNT_ID`。之后 `worker/` 变更推到 main 会执行迁移、部署和健康检查。

## 3. 只在家里局域网用（不上云）

在一台常开的电脑上：

```bash
npm run build && npx vite preview --host --port 4180     # 前端
cd worker && CI=1 npx wrangler d1 migrations apply yougui --local && npm run dev   # 同步服务 :8787
```

手机访问 `http://<电脑IP>:4180`，同步地址填 `http://<电脑IP>:8787`，并把 `http://<电脑IP>:4180` 加进 `ALLOWED_ORIGINS`。局域网 HTTP 下摄像头不可用（浏览器限制），可手输编号；需要扫码请用 HTTPS（见 DEVELOPMENT.md）。

### 商品名查询的额度

UPCitemdb 免费试用按来源 IP 计约 100 次/天，部署在 Cloudflare 时出口 IP 与其他用户共享，可能出现「额度已用完」。缓解：结果在 D1 缓存（同一商品只查一次）；配置 `UPCDATABASE_KEY`（upcdatabase.org 注册后免费 100 次/天）；或在家里电脑运行 Worker（用自家 IP）。食品、日化、宠物用品走 Open Facts，不消耗这部分额度。

## 4. 安全清单

- [ ] 设置了 `SETUP_SECRET`，否则任何知道 Worker 地址的人都能创建家庭（虽然看不到你的数据，但会占用你的额度）。
- [ ] `ALLOWED_ORIGINS` 只列自己的前端。
- [ ] R2 bucket 保持私有（不要开启 public access / r2.dev）。
- [ ] 同步密钥只在自己设备间传递；泄露后：断开所有设备 → 新建家庭重新上传（v0.1 无轮换接口，见 ISSUES I-06）。
- [ ] 定期在任一设备导出 ZIP 备份。
