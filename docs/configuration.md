# Configuration

HermesDeck 配置分三层：Deck 进程环境、Deck-owned auth/data store、Hermes Agent API Server 连接。Deck 不使用 Hermes 本地数据库、CLI 或本地 catalog 作为生产运行时数据源。Deck 用户/账号不同于 Hermes Agent profile；Deck 分配的是 Agent runtime id。

## 端口与入口

默认脚本：

- `CANONICAL_PORT=6118`：Next.js 内部监听端口。
- `LEGACY_PORT=6117`：浏览器/PWA/反向代理可见入口；`scripts/redirect-6117.mjs` 当前是透明 reverse proxy。
- `NEXT_HOST=0.0.0.0`：Next bind host。
- `CANONICAL_HOST=127.0.0.1`：6117 proxy 连接 6118 的目标 host。

推荐访问与部署入口：`http://127.0.0.1:6117` 或反代到 `127.0.0.1:6117`。只有在显式自定义进程管理时才直接碰 6118。

## Deck 环境变量

- `HERMESDECK_PUBLIC_ORIGIN`：写请求 same-origin allowlist。生产 HTTPS 必设，例如 `https://deck.example.com`；多个 origin 可按代码解析支持的分隔方式填写。
- `HERMESDECK_AUTH_DIR`：Deck auth store 目录，默认 `~/.hermesdeck`。
- `HERMESDECK_DATA_DIR`：Deck data/projection 目录；默认 `HERMESDECK_AUTH_DIR` 或 `~/.hermesdeck`。
- `HERMESDECK_FORCE_SECURE_COOKIE=1`：强制 session cookie `Secure`，适合 TLS 反代后部署。
- `HERMESDECK_TRUST_PROXY=1`：登录限速信任 proxy forwarded 地址；仅在可信反代后启用。
- `HERMESDECK_LIVE_TERMINAL=1`：启用 Live Terminal。默认关闭。
- `HERMESDECK_TMUX_BIN`：tmux 可执行文件路径，默认 `tmux`。
- `HERMESDECK_TMUX_CONF`：tmux config，默认 `/dev/null`。
- `HERMESDECK_DEBUG_HEALTH=1`：生产中 health response 显示未脱敏 URL；仅排查时使用。
- `HERMESDECK_VAPID_PUBLIC_KEY` / `HERMESDECK_VAPID_PRIVATE_KEY`：启用 Web Push chat notifications 的 VAPID key pair。缺任一项时 `/api/deck/notifications/config` 返回 `available:false`，Settings 中不能订阅 push。
- `HERMESDECK_VAPID_SUBJECT`：VAPID subject，例如 `mailto:ops@example.com` 或 `https://deck.example.com`。可省略；默认取 `HERMESDECK_PUBLIC_ORIGIN` 的第一个 origin。生产建议显式设置。
- `HERMES_HOME`：Hermes root。若指向 `.../profiles/<id>`，Deck 会归一到 root。用于 config editor/Agent env discovery；不是 runtime DB source。
- `HERMES_PROFILE`：初始 active Agent hint（legacy env name），仅当 API-backed catalog 中存在该 Agent runtime id 时生效。

## Hermes API Server 连接

Default Agent（Hermes default profile）连接优先级：

1. 进程环境 `HERMES_API_BASE`。
2. `~/.hermes/.env` 中的 `HERMES_API_BASE` 或 `HERMES_API_SERVER_BASE`。
3. `~/.hermes/.env` 中 `API_SERVER_HOST`/`HERMES_API_SERVER_HOST` + `API_SERVER_PORT`/`HERMES_API_SERVER_PORT`。
4. 默认 `http://127.0.0.1:6117`。

API key: default Agent reads process env `HERMES_API_KEY`/`API_SERVER_KEY`, then default `.env`; named Agents read only their backing Hermes Agent profile `.env`. When a key exists, Deck sends `Authorization: Bearer ***`.

Named Agent 连接：backing `~/.hermes/profiles/<id>/.env` 必须提供 API base/port，且 `API_SERVER_ENABLED` 不能显式为 false/0/no。缺少 base 时，Deck 返回 Agent routing error，不把请求路由到 default API。

## Deck-owned stores

默认目录：`~/.hermesdeck`。

- `auth.json`：Deck 用户、角色、password hash、session secret、registration 状态。
- `chat-projection.v1.json`：Deck chat UX/proof projection。
- `chat-projection.v1.json.lock`：projection 写锁。
- `notifications.v1.json`：Deck-owned notification preferences 与 Web Push subscriptions，按 Deck user id 分区；endpoint/keys 来自浏览器 Push API，文件由 Deck 以 0600 写入。

这些文件是 Deck 自有状态。Projection 保存 observed sessions/messages、owner、Agent runtime id、status、response aliases，支持 UX 和 named-Agent proof；不是 Hermes runtime 数据源。

## Agent config editor

`GET/PUT /api/deck/config?profile=<id>` 只处理固定文件：

- `config.yaml`
- `SOUL.md`
- `memories/USER.md`
- `memories/MEMORY.md`

安全措施：

- Agent runtime id（wire 字段 `profile`）使用 `^[\w.-]{1,64}$`。
- realpath containment：目标必须在 Hermes root/backing profile base 内。
- size cap 与 NUL byte 拒绝。
- `config.yaml` 保存前用 PyYAML（可用时）验证；验证器不可用时允许保存但返回 `validationSkipped`。
- mtime 乐观锁防止覆盖他人修改。
- 临时文件 + rename 原子写，mode 0600。

## Notifications

Phase 1/2 当前实现：

- **Chat complete / failed**：Web Push，可在页面关闭后送达。服务端在 chat projection final/error 写入后调用 `dispatchChatNotification`；push 发送失败不会让 chat stream 失败。
- **Kanban task complete**：只在 Kanban 页面打开时提示。页面从 task event/status transition 解析完成事件后调用浏览器 `new Notification(...)`。
- **Cron job complete**：只在 Cron 页面打开时提示。页面每 30 秒轮询 jobs，比对上一轮 baseline，发现 done/success 状态变化后调用浏览器 `new Notification(...)`。
- **Kanban/Cron closed-page background notifications**：暂不支持；当前没有安全 always-on watcher/event API。

运营设置：

1. 配置 `HERMESDECK_PUBLIC_ORIGIN=https://...`、VAPID public/private key、可选 subject。
2. 通过 HTTPS 或 `localhost` 访问 Deck；Cloudflare Tunnel、Caddy、Nginx、Tailscale Funnel 等 TLS/HTTPS 入口都适合。普通 LAN HTTP 通常不能安装 PWA 或订阅 push。
3. 登录后在 Settings → Notifications 请求浏览器权限并启用订阅；可发送 test notification。
4. iOS/iPadOS Safari 只有安装到主屏幕的 PWA 支持 Web Push；普通 Safari tab 不能依赖后台 push。

安全/RBAC：notification routes 默认要求 `hermesdeck_session`；subscription/preferences/test 的写请求走 `guardMutating` CSRF/same-origin 检查。Test notification 还会校验目标 Agent access。Push payload 仅包含低敏 title/body/tag 与同源非 `/api/*` URL；Service Worker click 会拒绝跨源或 API URL。

## PWA cache

当前 `public/sw.js`：`CACHE_VERSION='hermesdeck-pwa-v45'`。

- shell cache：只包含 `/offline`、manifest 和 icons。
- runtime cache：只缓存同源 static `style/script/image/font`，LRU 上限 40。
- API：网络直通；只有 fetch 抛错才合成离线 503 JSON。
- navigation：网络优先；离线返回公开 `/offline`。
- 受保护认证页面和聊天 HTML 不预缓存、不 runtime-cache。
- `/api/deck/cache-image` 每次网络请求，并清理旧 SW cache 命中，避免跨用户 artifact 泄漏。

清缓存时应删除 `hermesdeck-pwa-v45-*` 及旧版本 cache；不要恢复旧版 image cache 语义。

## 安全 checklist

1. 反代/外网访问使用 HTTPS，并设置 `HERMESDECK_PUBLIC_ORIGIN`。
2. TLS 后设置 `HERMESDECK_FORCE_SECURE_COOKIE=1`。
3. 如启用 Web Push，设置 VAPID key/subject，并通过 Settings 测试每个目标浏览器/PWA 订阅。
4. 只在可信 admin/super_admin 环境启用 `HERMESDECK_LIVE_TERMINAL=1`。
5. 确认 Hermes Agent API Server Agent catalog/models/cron endpoints 可用；Deck 不会在 outage 时本地枚举补齐。
6. 对 named Agents 配置独立 API base/port 与 API key，避免请求落到 default Agent。
