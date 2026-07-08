# Architecture

HermesDeck 是 Hermes Agent 的 Deck/BFF/UI 层。它在同一个 Next.js 进程中提供 UI 与 `/api/deck/*` BFF，并把运行时请求转发给 Hermes Agent API Server。Deck 的职责是鉴权、RBAC、Agent scope、UI 投影、SSE 转发和安全缓存；Hermes runtime 的事实来源仍是 API Server。

## 进程与端口

- `npm run dev` / `npm start` 先释放 `6118` 与 `6117`，再通过 `scripts/dev-with-redirect.mjs` 启动：
  - Next.js：`0.0.0.0:6118`，内部服务/proxy target。
  - `scripts/redirect-6117.mjs`：`0.0.0.0:6117`，透明 HTTP/WebSocket reverse proxy 到 `127.0.0.1:6118`。
- 对用户、PWA、LAN 设备、反向代理和 launchd health check，**可见 canonical entrypoint 是 6117**。
- 当前脚本是保持同源的 6117 反向代理。

## 主要模块

- `src/app/*`：Next App Router 页面与 Route Handlers。
- `src/lib/api.ts`：浏览器端 `deckApi`，只调用同源 `/api/deck/*`。
- `src/lib/server/hermes/*`：BFF 到 Hermes Agent API Server 的适配层（profiles/models/chat/cron 等）。
- `src/lib/server/auth.ts`、`src/lib/server/mfa.ts` 与 `src/lib/server/rbac.ts`：Deck auth store、cookie session、TOTP/passkey MFA、角色能力、Agent assignment 与 fail-closed 检查。代码中的 `profile`/`profileId` 字段是 legacy/compat Agent runtime id。
- `src/lib/server/deck-chat-projection.ts`：Deck-owned chat UX/proof projection。
- `src/lib/server/notifications.ts` 与 `src/lib/notification-events.ts`：Deck-owned Web Push subscription/preferences store、chat notification dispatch、page-open Cron notification parsing。
- `public/sw.js`：PWA shell/runtime cache 策略。

Deck 的可见 Web 入口是 `6117`；Hermes Agent API fallback default 是 `http://127.0.0.1:8642`。这两个端口不能混用：`6117` 服务 Deck UI/BFF，`8642` 是默认 Agent API Server。

## Runtime source of truth

Deck 运行时数据来自 Hermes Agent API Server：

- Agents：`/v1/profiles`、`/api/profiles`，选择返回内容最完整的 API-backed Agent catalog。admin/super_admin 只有在两个 strict catalog endpoints 都返回 404 时，才可使用 bounded local catalog fallback：仅枚举 `default` 和 immediate local profile dirs，且每个 candidate 必须通过对应 `/health` routing/key proof。普通用户不使用本地枚举。
- models：按 Agent 调 `/v1/models`，不从本地文件合成模型清单。
- chat：按 Agent 调 `/v1/runs` + `/v1/runs/{run_id}/events`，必要时传 `X-Hermes-Session-Id`。
- run control：`/api/deck/chat/runs/{runId}` 和 `/stop` 只在 Deck projection 已绑定 `profile/session/run` 后转发 Agent `/v1/runs/{run_id}`。
- capabilities/status：按 Agent 调 `/v1/capabilities` 与 `/health/detailed`，普通用户只得到低敏 status。
- cron：按 Agent 调 `/api/jobs?include_disabled=true&profile=<id>`，必须从响应或 job rows 得到 routing proof。
- cron detail/actions：先用 profile-scoped job list 证明 job 属于该 Agent，再转发 `/api/jobs/{job_id}` 和 pause/resume/run/update/delete；写操作 admin-only + CSRF。
- sessions：list/messages/delete/update/fork 都走 Agent `/api/sessions*`，update 只转发 `title/end_reason`；Deck pin/tags/folder 仍是 Deck metadata。
- tools/skills：优先从 Agent `/v1/skills` + `/v1/toolsets` 发现；`/api/deck/skill-catalog` 只暴露 metadata；raw local skill 文件读写只属于 `super_admin/local-owner` 编辑器。
- stats/messages/tokens/tools/lcm 等：通过 BFF 对应 adapter 暴露给 UI。LCM SQLite dashboard 是 `super_admin/local-owner` 本机管理面。

Deck 的 `super_admin/local-owner` 管理面可以编辑 Agent 背后的 Hermes Agent profile 文件（`config.yaml`、`SOUL.md`、`memories/USER.md`、`memories/MEMORY.md`）、raw local skill 文件，并查看 LCM SQLite dashboard；这些编辑器不是运行时数据源。文档中不要把 Hermes 本地数据库、CLI 或本地 catalog 描述为普通生产路径，也不要把 Hermes Agent profile 描述成 Deck 用户 profile。

## Auth、RBAC 与 fail-closed

Deck auth store 默认在 `~/.hermesdeck/auth.json`（可用 `HERMESDECK_AUTH_DIR` 改）。角色：

- `super_admin`：唯一且不可降级/停用，拥有所有 admin 能力，并拥有本机 config/skills/LCM/Live Terminal 管理面。
- `admin`：可管理普通用户、按 assignment 使用 API-backed Agents；不拥有本机 raw file/LCM/Live Terminal 权限。
- `user`：只能访问被分配的 Agents。

MFA：TOTP 2FA 与 passkey/WebAuthn 都是密码后的并列第二因子；没有 passwordless 登录。已启用 MFA 的用户在密码正确后只得到短期 password-MFA token，TOTP 或 passkey 验证成功后才写正式 `hermesdeck_session`。因此 `/api/deck/auth/mfa` 在 proxy 层 intentionally public，但 route 只让 login actions 使用 purpose-bound `mfaToken`，enrollment/settings actions 仍要求受保护 session。TOTP setup 显示 QR code，并保留 manual secret/URI fallback；passkey registration 需要 current password/受保护 session，但不要求 TOTP。TOTP 尝试按 user id + client IP 限速；WebAuthn registration/login challenge 是 5 分钟进程内状态并按 purpose 隔离，不能跨 enrollment/login/MFA token 混用。

Fail-closed 规则：

- 未登录、inactive、cookie 无效：401/403。
- 非 admin 缺少 Agent assignment：403。
- Agent runtime id（legacy `profile`/`profileId`）无效：400。
- admin/super_admin 需要 catalog 时，先走 API catalog；只有 `/v1/profiles` 与 `/api/profiles` 都是 404，才使用 admin-only bounded local profile-dir fallback，并逐个 `/health` 证明。普通用户无本地 runtime data fallback。
- sessions/stats 等 sensitive upstream rows 必须由 API 响应 metadata、explicit identity、Deck server-owned 专用 Agent API base 或专用 API key 证明 scope；shared/default base+key 且 `/health` 无 identity 的 unlabeled rows 返回 `profile_routing_unavailable`。cron/jobs 仍需要 API 响应证明。

## Chat/SSE 数据流

1. 浏览器向 `POST /api/deck/chat/stream` 发送 message、Agent runtime id（wire 字段 `profileId`）、model/reasoning override、attachments、可选 session/previous response。
2. Route handler 执行 auth、CSRF、Agent access、named-Agent continuation proof。
3. `createChatStream` 建立进程内 Stream Hub，先写 Deck projection draft，再后台 pump upstream。
4. BFF 调 Hermes API Server `/v1/runs` 创建 run，再连接 `/v1/runs/{run_id}/events` 解析 upstream SSE events。
5. BFF 仍原样转发 raw `run-event`；浏览器右侧观测面板会通用显示 `tool.started`/`tool.completed` 的 `payload.tool` 名称（如 `lcm_grep`、`hindsight_recall`）。`onRunEvent` projection hook 只在 tool/function call/result 语义边界物化为 `tool-call`/`tool-result` message rows；tool output arrays 会归一化为文本。
6. 只有文本 delta 写入 assistant bubble；tool/function argument delta 不混入普通助手正文，也不触发 durable projection write，持久参数来自 `arguments.done`/done item。
7. 浏览器断线/刷新只 detach 当前 subscriber；hub 继续 pump，`GET /api/deck/chat/resume?sessionId=<id>&since=<seq>` 可回放，sessions/messages polling 也能读到 projection 中的 draft assistant/tool rows。

SSE keep-alive：服务端每 15 秒发送 `: keep-alive <ts>` 注释，响应头含 `Cache-Control: no-cache, no-transform`、`Connection: keep-alive`、`X-Accel-Buffering: no`，用于代理和客户端 watchdog 的 liveness。聊天 stream timeout 默认/硬上限是 2,100,000ms（35 分钟）：Hermes active subagent 30 分钟 + 5 分钟收尾余量；客户端发送该常量，服务端将请求值夹在 1000ms 到 2,100,000ms。

## Trusted session id 与 named-Agent protection

- 对 default Agent，已有 session id 可继续使用，但普通用户仍不得访问未分配 default。
- 对 named Agent，Deck 只有在 projection 中证明 session/response 属于该 Agent 且普通用户匹配 projection owner 时，才允许 continuation；admin/super_admin 必须先通过 route-level Agent 授权。
- 若 named Agent 请求携带未被证明的 session id，Deck 生成 `deck_<uuid>`，并把它作为可信 Deck-generated session id 传给 upstream，避免 Hermes 创建额外的 `api` 话题或跨 Agent 续写。
- 只有可信 session id 才会作为 `X-Hermes-Session-Id` 发送给 Hermes API Server。

## Deck-owned chat projection

Projection 是 UX/proof 状态，不是 Hermes runtime 数据源。它保存 Deck 观察到的 sessions/messages、owner/Agent runtime id/status、response id aliases，用于刷新后会话列表、server-projected draft assistant 行、tool-call/tool-result 行、named-Agent proof、错误/完成状态展示。普通用户只可读取/证明/继续/写入 ownerUserId 等于自己的 projected sessions/messages/stats；admin/super_admin 绕过 owner filter/check，但仍需通过 Agent RBAC/catalog 授权。Deck 只在 server-side 已证明 explicit identity、专用 named-Agent API base 或专用 API key 时 stamp profileless upstream session rows；shared/default base+key 且 `/health` 无 identity 仍 fail closed。

完整不变量见 [deck-chat-projection.md](deck-chat-projection.md)。

## Notifications Phase 1/2

Notifications are Deck-owned and scoped to the logged-in Deck user, not to Hermes Agent runtime persistence:

- **Phase 1 chat Web Push**：Settings writes the user's Push API subscription into `notifications.v1.json` and preferences under the same Deck data dir as projection. `/api/deck/chat/stream` dispatches chat-complete/chat-failed push after projection final/error writes. Dispatch is non-blocking and sends only low-sensitivity payloads: title, short body, tag, and a same-origin non-API click URL.
- **Cron page-open notifications**：Cron compares the current 30-second polling response with the prior baseline while the Cron page is open. It uses the browser `Notification` API directly and honors the user's stored preferences.
- **Not implemented**：closed-page/background Cron notifications. Do not document an always-on watcher until there is a safe server-side event/watcher API with Agent/RBAC proof.

VAPID config comes from environment only: `HERMESDECK_VAPID_PUBLIC_KEY`, `HERMESDECK_VAPID_PRIVATE_KEY`, and subject from `HERMESDECK_VAPID_SUBJECT` or `HERMESDECK_PUBLIC_ORIGIN`. Notification routes require Deck auth; subscription/preferences/test writes are CSRF/same-origin guarded, and test sends also require target Agent access.

## PWA/cache strategy

`public/sw.js` 是 cache version 的来源；当前为 `hermesdeck-pwa-v54`：

- shell cache 只预缓存 `/offline`、manifest、icons。
- `/api/*` 网络直通；只有网络异常时合成 `{ ok:false, offline:true, error:'offline' }` 的 503。
- `/api/deck/cache-image` 不使用 SW cache，并清理旧命中，避免 admin artifact 泄露给普通用户。
- navigation route 网络优先，离线返回 `/offline`；不缓存认证 HTML。
- static style/script/image/font 使用 runtime cache，最多 40 条 LRU。
- push/click handlers validate payload click URLs as same-origin and non-`/api/*`; they do not cache notification payloads.

## Config editing and terminal boundaries

- Config editor 是 `super_admin/local-owner` 管理面，只允许 profile base 内的已知文件；`config.yaml` 保存前用 PyYAML（可用时）校验；保存用临时文件 + rename，mode 0600，mtime 乐观锁。
- Terminal Action 是白名单命令入口并做 secret redaction。
- Live Terminal 需要 `HERMESDECK_LIVE_TERMINAL=1`，由 tmux + node-pty 提供真实 shell；仅 active `super_admin` 应使用。Stream subscriptions replay buffered output, send `: ka` keepalives, and must unregister on cancel/close/enqueue failure so EventSource retries do not exhaust the per-session subscriber cap.
