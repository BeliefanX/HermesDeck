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
- `src/lib/server/hermes/*`：BFF 到 Hermes Agent API Server 的适配层（profiles/models/chat/cron/runs 等）。
- `src/lib/server/auth.ts` 与 `src/lib/server/rbac.ts`：Deck auth store、cookie session、角色能力、Agent assignment 与 fail-closed 检查。代码中的 `profile`/`profileId` 字段是 legacy/compat Agent runtime id。
- `src/lib/server/deck-chat-projection.ts`：Deck-owned chat UX/proof projection。
- `public/sw.js`：PWA shell/runtime cache 策略。

## Runtime source of truth

Deck 运行时数据来自 Hermes Agent API Server：

- Agents：`/v1/profiles`、`/api/profiles`，选择返回内容最完整的 API-backed Agent catalog。
- models：按 Agent 调 `/v1/models`，不从本地文件合成模型清单。
- chat：按 Agent 调 `/v1/responses`，必要时传 `X-Hermes-Session-Id`。
- cron：按 Agent 调 `/api/jobs?include_disabled=true&profile=<id>`，必须从响应或 job rows 得到 routing proof。
- runs/stats/messages/tokens/tools/lcm/kanban 等：通过 BFF 对应 adapter 暴露给 UI。

Deck 可以编辑 Agent 背后的 Hermes Agent profile 文件（`config.yaml`、`SOUL.md`、`memories/USER.md`、`memories/MEMORY.md`），但这些编辑器不是运行时数据源。文档中不要把 Hermes 本地数据库、CLI 或本地 catalog 描述为生产路径，也不要把 Hermes Agent profile 描述成 Deck 用户 profile。

## Auth、RBAC 与 fail-closed

Deck auth store 默认在 `~/.hermesdeck/auth.json`（可用 `HERMESDECK_AUTH_DIR` 改）。角色：

- `super_admin`：唯一且不可降级/停用，拥有所有 admin 能力。
- `admin`：可管理普通用户、使用 terminal、查看全部 API-backed Agents。
- `user`：只能访问被分配的 Agents。

Fail-closed 规则：

- 未登录、inactive、cookie 无效：401/403。
- 非 admin 缺少 Agent assignment：403。
- Agent runtime id（legacy `profile`/`profileId`）无效：400。
- admin/super_admin 需要 catalog 时，如果 Hermes API Server catalog outage，返回错误/空降级提示，不枚举本地 profile 目录补齐；catalog/health proof 缺失不是用户无权限证明。
- cron/jobs 等敏感 upstream data 的 Agent routing 未被 API 响应证明时返回 `profile_routing_unavailable`，不展示可能属于其他 Agent 的 jobs。

## Chat/SSE 数据流

1. 浏览器向 `POST /api/deck/chat/stream` 发送 message、Agent runtime id（wire 字段 `profileId`）、model/reasoning override、attachments、可选 session/previous response。
2. Route handler 执行 auth、CSRF、Agent access、named-Agent continuation proof。
3. `createChatStream` 建立进程内 Stream Hub，先写 Deck projection draft，再后台 pump upstream。
4. BFF 调 Hermes API Server `/v1/responses`，以 SSE 解析 upstream events。
5. BFF 仍原样转发 raw `run-event`，但 `onRunEvent` projection hook 只在 tool/function call/result 语义边界物化为 `tool-call`/`tool-result` message rows；tool output arrays 会归一化为文本。
6. 只有文本 delta 写入 assistant bubble；tool/function argument delta 不混入普通助手正文，也不触发 durable projection write，持久参数来自 `arguments.done`/done item。
7. 浏览器断线/刷新只 detach 当前 subscriber；hub 继续 pump，`GET /api/deck/chat/resume?sessionId=<id>&since=<seq>` 可回放，sessions/messages polling 也能读到 projection 中的 draft assistant/tool rows。

SSE keep-alive：服务端每 15 秒发送 `: keep-alive <ts>` 注释，响应头含 `Cache-Control: no-cache, no-transform`、`Connection: keep-alive`、`X-Accel-Buffering: no`，用于代理和客户端 watchdog 的 liveness。聊天 stream timeout 默认/硬上限是 2,100,000ms（35 分钟）：Hermes active subagent 30 分钟 + 5 分钟收尾余量；客户端发送该常量，服务端将请求值夹在 1000ms 到 2,100,000ms。

## Trusted session id 与 named-Agent protection

- 对 default Agent，已有 session id 可继续使用，但普通用户仍不得访问未分配 default。
- 对 named Agent，Deck 只有在 projection 中证明 session/response 属于该 Agent 且普通用户匹配 projection owner 时，才允许 continuation；admin/super_admin 必须先通过 route-level Agent 授权。
- 若 named Agent 请求携带未被证明的 session id，Deck 生成 `deck_<uuid>`，并把它作为可信 Deck-generated session id 传给 upstream，避免 Hermes 创建额外的 `api` 话题或跨 Agent 续写。
- 只有可信 session id 才会作为 `X-Hermes-Session-Id` 发送给 Hermes API Server。

## Deck-owned chat projection

Projection 是 UX/proof 状态，不是 Hermes runtime 数据源。它保存 Deck 观察到的 sessions/messages、owner/Agent runtime id/status、response id aliases，用于刷新后会话列表、server-projected draft assistant 行、tool-call/tool-result 行、named-Agent proof、错误/完成状态展示。普通用户只可读取/证明/继续/写入 ownerUserId 等于自己的 projected sessions/messages/stats；admin/super_admin 绕过 owner filter/check，但仍需通过 Agent RBAC/catalog 授权。Deck 不返回可能串台的 unlabeled upstream session rows。

完整不变量见 [deck-chat-projection.md](deck-chat-projection.md)。

## PWA/cache strategy

`public/sw.js` 当前 cache version 为 `hermesdeck-pwa-v41`：

- shell cache 只预缓存 `/offline`、manifest、icons。
- `/api/*` 网络直通；只有网络异常时合成 `{ ok:false, offline:true, error:'offline' }` 的 503。
- `/api/deck/cache-image` 不使用 SW cache，并清理旧命中，避免 admin artifact 泄露给普通用户。
- navigation route 网络优先，离线返回 `/offline`；不缓存认证 HTML。
- static style/script/image/font 使用 runtime cache，最多 40 条 LRU。

## Config editing and terminal boundaries

- Config editor 只允许 profile base 内的已知文件；`config.yaml` 保存前用 PyYAML（可用时）校验；保存用临时文件 + rename，mode 0600，mtime 乐观锁。
- Terminal Action 是白名单命令入口并做 secret redaction。
- Live Terminal 需要 `HERMESDECK_LIVE_TERMINAL=1`，由 tmux + node-pty 提供真实 shell；仅 active admin/super_admin 应使用。
