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
    proxy_read_timeout 1800s;
  }
}
```

`proxy_buffering off` 与长 `proxy_read_timeout` 对聊天 SSE 必要；服务端还会发送 keep-alive 注释。

## Production security

- 必设 `HERMESDECK_PUBLIC_ORIGIN=https://...`，否则写路由可能因 same-origin 检查失败。
- TLS 后设置 `HERMESDECK_FORCE_SECURE_COOKIE=1`。
- 只有可信反代才启用 `HERMESDECK_TRUST_PROXY=1`。
- 不要把 Deck 裸奔到公网；Deck 管理 Hermes profile/config、可选终端，并持有用户 session。
- Live Terminal 默认关。启用后仅 active admin/super_admin 可用，但本质上仍是宿主用户 shell。
- admin/super_admin 依赖 API-backed catalog；API outage 时 fail-closed，不本地枚举 profiles/models。

## Hermes API Server requirements

- Default profile：`HERMES_API_BASE` 或 default `.env` 的 API base/port 可达。
- Named profiles：各 profile `.env` 配置独立 API base/port/key；缺少 base 时 Deck 拒绝把请求发到 default profile。
- Profiles catalog endpoint：`/v1/profiles` 或 `/api/profiles` 至少一个可用。
- Models：`/v1/models` 可用且返回 selectable models。
- Cron：`/api/jobs?include_disabled=true&profile=<id>` 必须返回 profile proof。

## PWA and HTTPS

PWA 安装要求安全上下文：HTTPS 或 `localhost`。LAN HTTP (`http://10.x.x.x:6117`) 通常不能安装，但可作为普通网页访问。

Service Worker 策略：

- shell cache 只存公开离线页和 icons。
- 受保护 navigation HTML 不缓存；离线只返回 `/offline`。
- API 不缓存；网络失败才合成 offline JSON。
- static assets 使用最多 40 条 runtime LRU。

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
npm run smoke
```

排查：

- 6117 不通：检查 `scripts/redirect-6117.mjs` 是否启动，或端口是否被其他进程占用。
- 6118 不通：检查 Next child 是否退出。
- SSE 断流：检查反代 buffering/timeout，确认响应中有 `X-Accel-Buffering: no` 与 keep-alive 注释。
- profile/model/cron 空：先查 Hermes API Server endpoints 与 profile `.env`，不要添加本地补齐路径。
