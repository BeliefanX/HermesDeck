# Deployment

HermesDeck 部署为一个本地 Node/Next 服务，加一个 6117 同源 reverse proxy。它依赖 Hermes Agent API Server 提供运行时数据；Deck 自身不通过本地 DB/CLI/catalog 在生产中补齐 runtime 结果。

## Recommended topology

```text
Browser / PWA
  -> https://deck.example.com
  -> Caddy/Nginx/Tailscale Funnel/etc.
  -> 127.0.0.1:6117  (Deck visible entrypoint)
  -> 127.0.0.1:6118  (Next internal target)
  -> Hermes Agent API Server(s)
```

Local-only/LAN 开发也使用 `http://<host>:6117`。6118 仅是 Next 目标端口，除自定义进程管理外不要作为用户文档入口。

## launchd example (macOS)

使用 `npm start` 让项目脚本同时管理 Next 与 6117 proxy：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>local.hermesdeck</string>
  <key>WorkingDirectory</key><string>/Users/fanxuxin/Hermes_Sync/HermesDeck</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>npm</string>
    <string>start</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>HERMESDECK_PUBLIC_ORIGIN</key><string>https://deck.example.com</string>
    <key>HERMESDECK_FORCE_SECURE_COOKIE</key><string>1</string>
    <key>HERMESDECK_VAPID_PUBLIC_KEY</key><string>...</string>
    <key>HERMESDECK_VAPID_PRIVATE_KEY</key><string>...</string>
    <key>HERMESDECK_VAPID_SUBJECT</key><string>mailto:ops@example.com</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/hermesdeck.out.log</string>
  <key>StandardErrorPath</key><string>/tmp/hermesdeck.err.log</string>
</dict>
</plist>
```

如果改用自定义 supervisor 直接调用 `next start -p 6118`，必须另行启动 6117 reverse proxy 或把反向代理入口明确切到你的新可见端口，并同步文档。

## Reverse proxy

### Caddy

```caddyfile
deck.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:6117 {
    flush_interval -1
  }
  header {
    X-Content-Type-Options nosniff
    Referrer-Policy same-origin
  }
}
```

### Nginx

```nginx
server {
  listen 443 ssl http2;
  server_name deck.example.com;

  location / {
    proxy_pass http://127.0.0.1:6117;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 2200s;
  }
}
```

`proxy_buffering off` 与长 `proxy_read_timeout` 对聊天 SSE 必要；服务端还会发送 keep-alive 注释。Deck chat stream 的默认/硬上限是 2,100,000ms（2100s/35 分钟），所以生产反代 read timeout 必须至少 2100s，建议 2200s 或更高。

## Production security

- 必设 `HERMESDECK_PUBLIC_ORIGIN=https://...`，否则写路由可能因 same-origin 检查失败。
- TLS 后设置 `HERMESDECK_FORCE_SECURE_COOKIE=1`。
- 如启用 Web Push chat notifications，设置 VAPID public/private key 与 subject；不要把 private key 放进客户端或仓库。
- 只有可信反代才启用 `HERMESDECK_TRUST_PROXY=1`。
- 不要把 Deck 裸奔到公网；Deck 管理 Agent 背后的 Hermes profile/config、可选终端，并持有用户 session。
- Live Terminal 默认关。启用后仅 active admin/super_admin 可用，但本质上仍是宿主用户 shell。
- admin/super_admin 先依赖 API-backed Agent catalog；只有 strict `/v1/profiles` 与 `/api/profiles` 都返回 404 时，才可使用 bounded immediate local profile-dir catalog fallback，且每个 candidate 必须 `/health` 证明。普通用户没有本地枚举 fallback，也不把 catalog/health proof 缺失解释成用户无权限。

## Hermes API Server requirements

- Default Agent（Hermes default profile）：`HERMES_API_BASE` 或 default `.env` 的 API base/port 可达。
- Named Agents：各 backing profile `.env` 配置独立 API base/port/key；缺少 base 时 Deck 拒绝把请求发到 default Agent。
- Agent catalog endpoint：`/v1/profiles` 或 `/api/profiles` 至少一个可用。
- Models：`/v1/models` 可用且返回 selectable models。
- Cron：`/api/jobs?include_disabled=true&profile=<id>` 必须返回 Agent routing proof；无 proof 时这类敏感 upstream data fail closed。
- Sessions/stats：named-Agent session/stat lists 必须先成功取得 routing-proven API rows，再合并 Deck projection；routing error 时返回 `profile_routing_unavailable`/502。

## Notifications / Web Push

- 配置 `HERMESDECK_VAPID_PUBLIC_KEY`、`HERMESDECK_VAPID_PRIVATE_KEY`、`HERMESDECK_VAPID_SUBJECT`（或可用 `HERMESDECK_PUBLIC_ORIGIN` 作为 subject fallback）。
- Store 为 `notifications.v1.json` under Deck data/auth dir，按 Deck user 保存 preferences/subscriptions。
- Service Worker 不缓存 `/api/*`；push notification click 只打开同源非 API URL。
- Web Push 只覆盖 chat completed/failed；Kanban/Cron completion 是 page-open browser notifications。

## PWA and HTTPS

PWA 安装要求安全上下文：HTTPS 或 `localhost`。LAN HTTP (`http://10.x.x.x:6117`) 通常不能安装，但可作为普通网页访问。

Web Push 同样要求安全上下文和浏览器支持。Cloudflare Tunnel、Caddy、Nginx/TLS、Tailscale Funnel 等 HTTPS 入口适合 HermesDeck notifications；确保 `HERMESDECK_PUBLIC_ORIGIN` 与用户实际访问 origin 一致。iOS/iPadOS Safari 仅对安装到主屏幕的 PWA 提供 Web Push，普通 Safari tab 不能作为后台通知目标。

Service Worker 策略：

- shell cache 只存公开离线页和 icons。
- 受保护 navigation HTML 不缓存；离线只返回 `/offline`。
- API 不缓存；网络失败才合成 offline JSON。
- static assets 使用最多 40 条 runtime LRU。
- push notification clicks are constrained to same-origin non-API app URLs.

Notification support matrix:

- Chat complete / failed：Web Push，页面关闭后仍可送达已订阅设备。
- Kanban task complete：只有 Kanban 页面打开且浏览器通知权限为 granted 时提示。
- Cron job complete：只有 Cron 页面打开且该页 polling 观察到完成状态变化时提示。
- Kanban/Cron closed-page background notifications：未实现；需要未来安全 watcher/event API。

发布新版本后，`public/sw.js` 的 cache version 变化会清理旧 cache；不要依赖旧版本 cache 行为。

## Operations

Build/start：

```bash
npm install
npm run build
npm start
curl -fsS http://127.0.0.1:6117/api/deck/health
```

验证：

```bash
npm run typecheck
npm run lint
npm run verify:pwa
node --experimental-strip-types --test tests/notification-events.test.mjs
npm run smoke
```

排查：

- 6117 不通：检查 `scripts/redirect-6117.mjs` 是否启动，或端口是否被其他进程占用。
- 6118 不通：检查 Next child 是否退出。
- SSE 断流：检查反代 buffering/timeout，确认响应中有 `X-Accel-Buffering: no` 与 keep-alive 注释；read timeout 应 >= 2100s（建议 2200s+）。
- profile/model/cron 空：先查 Hermes API Server endpoints 与 profile `.env`，不要添加本地补齐路径。
