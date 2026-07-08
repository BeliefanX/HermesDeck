# HermesDeck

HermesDeck 是 Hermes Agent 的浏览器控制台：多会话聊天、Agents、配置编辑、能力面板、受控终端与可安装 PWA。Deck 的运行时 source of truth 是 Hermes Agent API Server；Deck 不把 Hermes 的本地数据库、CLI 或本地 catalog 当作生产回退路径。

## 当前架构要点

- **API-first runtime**：聊天、Agents、models、cron proof、stats/messages、tools/skills 等运行时数据通过 Hermes Agent API Server 暴露给 Deck BFF；BFF 再以 `/api/deck/*` 给前端提供稳定契约。`super_admin/local-owner` 管理面保留本机 config/SOUL/USER/MEMORY、raw skill 文件、LCM SQLite dashboard 与 Live Terminal；这些不是普通 runtime fallback。
- **Deck 用户 ≠ Hermes Agent profile**：Deck 登录账号（user/account）由 Deck auth/RBAC 管理；Deck 分配给用户的是 Agent（技术上由 Hermes Agent profile 支撑的 runtime id）。API 兼容字段 `profile`/`profileId` 表示 Agent runtime id，不是 Deck user profile。
- **RBAC fail-closed**：Deck 有自己的登录 cookie、用户/角色和 Agent assignment。Hermes Agent 本身不是 Deck 多用户/RBAC 系统；多用户边界属于 Deck BFF。每条 Agent-scoped route 都必须先由 Deck server-side RBAC 授权；普通用户不得访问未分配 Agent/default。敏感 upstream 数据缺少 routing proof 时失败关闭；profileless session rows 只有在 Deck server-side 已证明 explicit identity、非 default 专用 Agent API base 或专用 API key 时才可按该 Agent stamped。共享/default base+key 且 `/health` 无 identity 时失败关闭。
- **MFA**：Deck auth 支持 TOTP 2FA 与 passkey/WebAuthn 作为密码后的第二因子；不提供 passwordless 登录。TOTP 用本地 `auth.json` 中的 per-user secret，passkey 依赖浏览器安全上下文与 WebAuthn RP origin/id。
- **Canonical visible entrypoint：`http://<host>:6117`**。项目脚本启动 Next 服务在 `6118`，同时启动 `6117 -> 6118` 的同源反向代理；用户、PWA、反向代理/launchd 对外应以 `6117` 为入口，`6118` 是内部目标。
- **Agent API port**：Deck 可见入口仍是 `6117`；Hermes Agent API fallback default 是 `http://127.0.0.1:8642`。不要把 Deck UI port 当成 Agent API port。
- **聊天流**：Deck BFF 先 POST Hermes API Server `/v1/runs`，再读取 `/v1/runs/{run_id}/events` SSE，向浏览器转发文本、raw run-event、attachment、done/error，并发送 keep-alive 注释保持长连接活性。前端发送 35 分钟 timeout（2,100,000ms），服务端夹在 `[1000, 2100000]`，匹配 Hermes active subagent 30 分钟上限 + 5 分钟收尾余量。
- **Agent API BFF**：Deck exposes profile-scoped `/api/deck/capabilities`, `/gateway/status`, `/health/detailed`, chat run status/stop, cron detail/actions, session fork/update, `/toolsets`, and `/skill-catalog` as same-origin wrappers over Hermes Agent API. Writes are CSRF-guarded; run/session/cron actions require Deck projection or Agent profile proof before upstream calls.
- **Deck-owned chat projection**：`~/.hermesdeck/chat-projection.v1.json`（或 `HERMESDECK_DATA_DIR`）只保存 Deck UX/proof 状态，用 lock、atomic write、TTL/cap prune 维护；它不是 Hermes runtime 数据源。Projection 会持久化 draft/final assistant、tool-call、tool-result 行和 response/session aliases（不逐 delta 持久化 tool/function arguments），刷新后仍可显示 in-flight 状态。Projection proof/write 对普通用户按 `ownerUserId` 收紧，admin/super_admin 仍需先通过 Agent 授权；shared/default API base 上的 unlabeled upstream session rows 仍 fail closed。
- **Notifications**：Web Push 支持聊天完成/失败的后台通知；Cron job 完成只在 Cron 页面打开时用浏览器 `Notification` API 提示。Cron 关闭页面后的后台通知尚未实现，因为当前没有安全的 always-on watcher/event API。
- **安全 PWA cache / push worker**：Service Worker 只预缓存公开离线 shell 和图标；认证页面、API 响应、聊天 HTML 不被持久缓存。Push payload 只包含低敏标题、短正文和同源非 API 点击 URL。

## 快速开始

要求：Node.js 22+。Live Terminal 可选，需要 `tmux` 和可加载的 `node-pty`；默认关闭。

```bash
cd /Users/fanxuxin/Hermes_Sync/HermesDeck
npm install
npm run dev
# 浏览器打开 http://127.0.0.1:6117
```

生产式本地启动：

```bash
npm run build
npm start
# 仍以 http://127.0.0.1:6117 访问；6118 仅作为内部 Next 目标。
```

第一次启动如未发现 Deck auth store，会在终端打印一次性 `admin`/`super_admin` bootstrap 密码。登录后请在 Settings 中修改凭据并按需创建/审批用户。

MFA 在 Settings 中启用：TOTP 可用任意 authenticator app 扫描/录入 `otpauth://` secret；passkey 需要 HTTPS 或 `localhost`。公网/反代部署 passkey 时请固定 `HERMESDECK_WEBAUTHN_ORIGIN` 与 `HERMESDECK_WEBAUTHN_RP_ID`。

## 通知快速配置

聊天后台通知需要 HTTPS（或 `localhost`）安全上下文、已注册 Service Worker，以及 VAPID key：

```bash
# 生成 VAPID key（任选一种方式）
npx web-push generate-vapid-keys

export HERMESDECK_PUBLIC_ORIGIN=https://deck.example.com
export HERMESDECK_VAPID_PUBLIC_KEY=...
export HERMESDECK_VAPID_PRIVATE_KEY=...
export HERMESDECK_VAPID_SUBJECT=mailto:ops@example.com  # 可省略，默认取 PUBLIC_ORIGIN
```

部署后在 Settings → Notifications 启用通知、授权浏览器权限，并发送 test notification。Cloudflare Tunnel/Caddy/Nginx 等 HTTPS 反代适合承载 Web Push/PWA；普通 LAN HTTP 只能当网页访问，通常无法安装 PWA 或订阅 push。Deck 只接受常见浏览器 push provider endpoint，API 返回的订阅列表只含不可逆 public id，不暴露 endpoint/key。iOS/iPadOS Safari 只有安装到主屏幕的 PWA 才支持 Web Push，且权限仍需用户手动授予。

支持矩阵：

- Chat complete / failed：Web Push，可在页面关闭后送达订阅设备；由 `/api/deck/chat/stream` 完成 projection 写入后非阻塞派发。
- Cron job complete：Cron 页面打开并已授权通知时提示；依赖页面 30 秒 polling diff。
- Cron 后台通知：暂不支持；不要把当前实现描述为 always-on watcher。

## 常用脚本

```bash
npm run dev          # free 6118/6117，启动 Next dev(6118) + 6117 reverse proxy
npm run build        # next build --webpack
npm start            # free 6118/6117，启动 Next start(6118) + 6117 reverse proxy
npm run typecheck    # tsc --noEmit
npm run lint         # eslint .
npm run verify:pwa   # 检查 manifest / sw.js / icons / CSS 关键项
npm run smoke        # build 后启动并 smoke /login /offline /manifest /sw.js
npm run test:rbac    # RBAC route/auth 单测
npm run test:csrf    # CSRF/auth 单测
```

## 文档索引

- [docs/architecture.md](docs/architecture.md)：系统边界、数据流、RBAC、SSE、projection、PWA 策略。
- [docs/api.md](docs/api.md)：`/api/deck/*` BFF 契约与关键错误语义。
- [docs/configuration.md](docs/configuration.md)：环境变量、端口、auth/data store、Hermes API Server 连接。
- [docs/development.md](docs/development.md)：本地开发、验证、调试纪律。
- [docs/deployment.md](docs/deployment.md)：launchd/反代/HTTPS/PWA/安全边界。
- [docs/deck-chat-projection.md](docs/deck-chat-projection.md)：Deck-owned chat projection 的用途和不变量。
- [docs/design-handoff/README.md](docs/design-handoff/README.md)：设计交接包；以 `design.md`、`globals.css` 和当前主文档为准。
- [docs/glossary.md](docs/glossary.md)：Deck user/account、Agent、Hermes Agent profile、Session、Run、Projection、RBAC 等术语。
- [design.md](design.md)：Hallmark UI/design system 约束。

## 非目标与安全边界

- HermesDeck 只改 Deck；不要从 Deck 文档或代码中要求修改 Hermes Agent 内部行为。
- 不把本地数据库读取、Hermes CLI 或本地 profile/model 枚举描述为普通运行时数据路径；本机 config/skills/LCM/terminal 只属于 `super_admin/local-owner` 管理面。
- 不在普通用户会话中缓存受保护 HTML/API 响应。
- Live Terminal 一旦启用即等价于给登录用户一条真实 shell；只应授予可信 `super_admin`。
