# 部署指南

> HermesDeck 是一个 **运行在 Hermes 主机本地的单进程 Node 服务**：默认
> 监听 `0.0.0.0:6118`，访问 Hermes API Server 与 `~/.hermes` 目录都通过
> 本地 IO。本文记录两种典型部署形态及关键安全配置。

---

## 1. 部署形态

### A. 单机自用（推荐）

- HermesDeck 与 Hermes 跑在同一台机器（同一用户）。
- `HERMES_API_BASE` 默认 `http://127.0.0.1:8642`。
- 反代通过 Caddy / Nginx 终止 TLS，再到 `127.0.0.1:6118`。

```
┌──────────┐    HTTPS      ┌─────────┐   loopback HTTP   ┌────────────┐
│ Browser  │ ───────────► │ Caddy    │ ─────────────────►│ HermesDeck │
└──────────┘              └─────────┘                    │ + Hermes   │
                                                         └────────────┘
```

### B. 局域网共用

- HermesDeck 跑在 LAN 主机上（`10.10.10.253:6118`）。
- 不上 HTTPS 的话 PWA 安装能力受限（参见 §4）。
- 写路由会校验 `Origin/Referer`：手机 / 平板访问要把它们加进
  `HERMESDECK_PUBLIC_ORIGIN`，或者使用 dev mode（自动放行 RFC1918）。

### 不推荐

- **直接把 6118 暴露到公网**。HermesDeck 是单用户工具：登录限速虽然在
  位，但缺少多用户审计；`Live Terminal` 一旦显式启用就会给登陆用户极大权限。

---

## 2. 反向代理样例

### 2.1 Caddy

```caddyfile
hermesdeck.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:6118 {
    flush_interval -1            # 立即下发 SSE 字节
    transport http {
      keepalive 30s
    }
  }
  # 如果你想强制 HSTS，把它放在外层 server block：
  # header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
}
```

### 2.2 Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name hermesdeck.example.com;

    location / {
        proxy_pass http://127.0.0.1:6118;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE：禁用 buffering、提升超时到聊天最大时长之上。
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1800s;          # > HARD_TIMEOUT_MS / 1000
        proxy_send_timeout 1800s;

        # Next 16 server 已经下发 X-Accel-Buffering: no，但加一份显式更稳。
        proxy_set_header X-Accel-Buffering no;
    }
}
```

> 关键点：`proxy_buffering off`（或 Caddy 的 `flush_interval -1`）必须开。
> 否则 SSE 帧会被代理在内存里聚合，UI 永远看不到 `delta`/`run-event`。

---

## 3. 必需的环境变量

`/etc/systemd/system/hermesdeck.service.d/override.conf`（systemd 例）：

```ini
[Service]
Environment=NODE_ENV=production
Environment=HERMES_API_BASE=http://127.0.0.1:8642
Environment=HERMES_API_KEY=...
Environment=HERMES_DASHBOARD_BASE=http://127.0.0.1:9120

# ★ 必填：写路由的同源校验需要它
Environment=HERMESDECK_PUBLIC_ORIGIN=https://hermesdeck.example.com

# 反代终止 TLS、上游为 HTTP 时必填
Environment=HERMESDECK_FORCE_SECURE_COOKIE=1

# 仅在反代真的会重写/剥离 X-Forwarded-For 时设置
Environment=HERMESDECK_TRUST_PROXY=1

# 如果不需要 PTY，建议关掉
Environment=HERMESDECK_LIVE_TERMINAL=0
```

剩余可选项见 [docs/configuration.md](configuration.md)。

---

## 4. PWA 与 HTTPS

浏览器只有在 **secure context** 下才允许：

- 注册 Service Worker（HermesDeck `<PWARegister>` 仅在 `NODE_ENV=production`
  且 `'serviceWorker' in navigator` 时尝试注册）。
- 「添加到主屏幕」/ Install Prompt。
- 部分敏感 API（剪贴板等）。

支持的 secure context：

- ✅ `https://...`
- ✅ `http://localhost`
- ❌ 普通 LAN HTTP（`http://10.x.x.x:6118`）

落地方式：

1. 用 [Caddy 内置 ACME](https://caddyserver.com/docs/automatic-https) 一行
   配置自动签发 Let's Encrypt。
2. 内网受信 CA + DNS 通配 + Caddy `tls internal`（仅供内网）。
3. 用 mkcert + Nginx 自签证书 → 手动信任，内网手机访问可装 PWA。

manifest（[src/app/manifest.ts](../src/app/manifest.ts)）默认 `start_url`
为 `/chat?source=pwa`，启动后会带这个 source 标记新建会话；可在 Service
Worker 缓存 `APP_SHELL` 里看到所有预缓存的路由。

---

## 5. 启动 / systemd

最简 systemd 单元：

```ini
# /etc/systemd/system/hermesdeck.service
[Unit]
Description=HermesDeck
Wants=network-online.target
After=network-online.target

[Service]
User=hermes
Group=hermes
WorkingDirectory=/home/hermes/HermesDeck
ExecStart=/usr/bin/env npm start
Restart=on-failure
RestartSec=2
KillSignal=SIGTERM
TimeoutStopSec=15
EnvironmentFile=/home/hermes/HermesDeck/.env.local

[Install]
WantedBy=multi-user.target
```

注意：

- `npm start` 内部会 `node scripts/free-port.mjs 6118` 强制释放端口，再
  起 Next + 6117 重定向 helper。如果你用进程管理器（pm2 / supervisord）
  接管，请保证它发 `SIGTERM` 而不是 `SIGKILL`，否则 `redirect-6117.mjs`
  与 PTY 子进程可能不会被善后。
- `--start` 会让 `dev-with-redirect.mjs` 调 `next start`；想替换为自定义
  端口请绕过该脚本直接调 `npx next start -H 0.0.0.0 -p <port>` 并自己实现
  6117 兼容。

---

## 6. 首次访问 / 凭据轮转

1. 第一次启动后到日志里抓 `Username/Password` banner（或在 stdout 看）。
2. 浏览器登录 → Settings → Account：
   - 改用户名（可选）。
   - 改密码（强制至少 8 位）。
3. 改密会自增 `passwordVersion`：所有现存的旧 cookie 立刻失效，等价于强
   制下线其他设备。这之后 banner 不再打印。

---

## 7. 升级

```bash
cd ~/HermesDeck
git fetch && git pull
npm install
npm run typecheck -- --pretty false
npm run build       # next build --webpack
systemctl restart hermesdeck
```

注意：

- Service Worker 的 cache 名字带版本号（当前 `hermesdeck-pwa-v8`）。前端
  起来后 `<PWARegister>` 会监测到新 SW，弹一行 *New version ready*；用户
  点了才 reload，避免打断流式输出。
- 浏览器 localStorage 的版本是 `hermesdeck.chat.v1` / `…panels.v1` /
  `…sourcefilter.v1` 等；改 schema 时建议同步抬版本，以免老数据反序列化失败。

---

## 8. 备份

唯一**必须**备份的运行期文件：

| 路径 | 内容 |
| --- | --- |
| `~/.hermesdeck/auth.json` | 凭据 + sessionSecret。丢失会重新进入首启流程并印新密码。 |

`~/.hermes/` 是 Hermes 的状态目录，HermesDeck 只读它（删除 session 时会
写）。常规 Hermes 备份策略已足够。

---

## 9. 监控建议

- **健康面**：`GET /api/deck/health`（无需认证？—— 仍走 cookie 校验，
  建议在反代旁边新建只在 LAN 暴露的探活端点；或者在监控里挂带 cookie 的
  探针）。
- **日志关键字**：
  - `[hermesdeck] benign unhandledRejection swallowed:` —— SSE 客户端断
    开常见，正常。
  - `[hermesdeck] unhandledRejection:` —— 真异常，需要查。
  - `[free-port] failed to free :6118` —— 启动前清端口失败。
  - `[redirect-6117] :6117 already in use` —— 旧 PWA 兼容 helper 没起。
- **资源**：实时终端单 session 256KB ring buffer + 子进程；不开 PTY 时
  HermesDeck 自身常驻内存通常 < 200MB。

---

## 10. 卸载

```bash
systemctl stop hermesdeck
systemctl disable hermesdeck

rm -rf ~/HermesDeck
rm -rf ~/.hermesdeck       # 凭据
# 如果想顺便清浏览器侧：在 Settings 页点「清除 HermesDeck 缓存」即可
```

`~/.hermes/` 是 Hermes 自己的，删 HermesDeck 不要动它。
