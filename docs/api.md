# BFF API Reference

所有 Deck 前端请求都走同源 `/api/deck/*`。BFF 负责 Deck auth/RBAC/CSRF、Agent scope、输入限制、错误归一化与 Hermes Agent API Server 适配。除登录/注册/公开 PWA 资源外，路由默认要求 `hermesdeck_session` cookie。

## 通用约定

- 写请求：`POST`/`PUT`/`PATCH`/`DELETE` 使用 `guardMutating`，即登录校验 + `Origin`/`Referer` 同源校验。
- Same-origin 来源：`HERMESDECK_PUBLIC_ORIGIN`，以及开发场景的 loopback/RFC1918 host 规则。
- 失败响应：通常为 `{ ok:false, error:string, detail?:string }` 或 `{ error:string, detail?:string }`。
- 上游错误中可能含 secret；BFF 返回前通过 redaction 裁剪。
- 运行时数据失败不走 local DB/CLI/catalog 补齐；按 fail-closed 返回 4xx/5xx。
- API 兼容字段和查询参数 `profile`/`profileId` 表示 Agent runtime id（由 Hermes Agent profile 支撑），不是 Deck user profile。

常见状态：

- 400：参数、profile id、请求体或 Content-Type 不合法。
- 401：未登录或 cookie 无效。
- 403：inactive、权限不足、Agent 未分配、CSRF/same-origin 失败、named-Agent continuation proof 不足。
- 404：资源不存在或 stream hub 已驱逐。
- 409：mtime 乐观锁冲突。
- 413：请求体超过路由限制。
- 415：Content-Type 不支持。
- 429：登录限速。
- 502：Hermes Agent API Server 或敏感 upstream Agent routing proof 失败。
- 503：Deck/SW 离线降级响应。

## Auth and admin

- `GET /api/deck/auth/session`：返回当前 Deck 用户、role、capabilities、assigned Agents（wire 字段仍为 `assignedProfileIds`/profile ids 以兼容旧客户端）。
- `POST /api/deck/auth/login`：登录；支持限速；可在 `HERMESDECK_TRUST_PROXY=1` 时信任代理来源 IP。
- `GET /api/deck/auth/mfa`：返回当前用户可用 MFA factors。
- `POST /api/deck/auth/mfa`：MFA enrollment 与登录二阶段。Actions：`totp-enroll-start`（返回 `secret`、`otpauth`、server-generated `qrDataUrl`）、`totp-enroll-confirm`、`totp-disable`、`passkey-register-options`、`passkey-register-verify`、`login-totp`、`passkey-login-options`、`passkey-login-verify`。该 path 在 proxy 层 intentionally public；route 对 login actions 校验 purpose-bound password-MFA `mfaToken`，对 enrollment/settings actions 仍要求受保护 session。Mutating requests 走 same-origin/body-size guard；passkey registration 要 current password/受保护 session，但不要求 TOTP；login 二阶段不接受 WebAuthn challenge id 代替 `mfaToken`。
- `POST /api/deck/auth/logout`：清除 session。
- `POST /api/deck/auth/register`：创建待审批普通用户。
- `PUT /api/deck/auth/credentials`：当前用户更新 username/password。
- `GET /api/deck/admin/users`、`POST /api/deck/admin/users`：admin/super_admin 管理用户。
- `GET/PATCH/DELETE /api/deck/admin/users/[id]`：用户状态、角色、删除等；PATCH 可传 `mfaReset:true` 清空可管理用户的 TOTP/passkeys。`super_admin` 不可修改/删除，只有 `super_admin` 能授予/改变角色。
- `GET/PUT /api/deck/admin/users/[id]/profiles`：管理用户 Agent assignment；路径名保留 `profiles` 仅为 API 兼容。

RBAC：`super_admin` 可访问全部 API-backed Agents，并拥有 `super_admin/local-owner` 本机管理面（config/skills/LCM/Live Terminal）；`admin` 和普通 `user` 只能访问分配给自己的 Agents（`admin` 另外拥有普通用户管理权限）。每条 Agent-scoped route 都必须在服务端授权；普通用户不得访问未分配 Agent/default，也没有本地 runtime data fallback。admin/super_admin catalog fallback 仅在两个 strict API catalog endpoints 都返回 404 时枚举 bounded immediate local profile dirs，并且每个 candidate 必须 `/health` 证明。

MFA：TOTP 与 passkey 是并列 second factors。`POST /api/deck/auth/login` 对已启用 TOTP/passkey 的用户返回 `mfaRequired:true` 与短期 `mfaToken`，不会设置 `hermesdeck_session`。完成 `login-totp` 或 `passkey-login-verify` 后才签发正式 session cookie。Passkey 是 MFA-only，不提供 username-only/passwordless 认证。

## Health and Agent catalog

- `GET /api/deck/health`：Deck 与 Hermes API Server 健康状态、版本/uptime 等。
- `GET /api/deck/gateway/status?profile=<id>`、`GET /api/deck/health/detailed?profile=<id>`：转发 Agent `/health/detailed`，普通用户只看低敏状态，admin/super_admin 额外看到 platforms/pid/exitReason。
- `GET /api/deck/capabilities?profile=<id>`：转发 Agent `/v1/capabilities`，返回归一化 `features/endpoints/summary`；需要 Agent access。
- `GET /api/deck/profiles`：从 Hermes API Server profile endpoints 获取 API-backed Agent catalog，并按当前用户过滤；admin/super_admin 仅在 strict catalog 双 404 时使用 bounded `/health`-proven local catalog fallback。普通用户不扫描本地 profiles 目录。
- `GET /api/deck/models?profile=<id>`：按 Agent runtime id 调 Hermes API Server `/v1/models`。无 selectable model 或 API 不可达时返回错误/空 UI 状态；不从本地文件合成模型清单。
- `GET /api/deck/model-preferences?profileId=<id>`、`PUT /api/deck/model-preferences`：Deck 用户级 Agent 模型偏好；只影响 Deck 下次发起的 chat request override。

## Chat streaming

### `POST /api/deck/chat/stream`

请求体核心字段：

```ts
type ChatStreamRequest = {
  message: string;
  profileId?: string; // legacy/compat name for Agent runtime id
  sessionId?: string;
  previousResponseId?: string;
  model?: string;
  reasoningEffort?: string;
  attachments?: unknown[];
  timeoutMs?: number;
};
```

行为：

- Deck route body hard cap：8 MiB；发送给 Hermes `/v1/runs` 的 upstream JSON body hard cap：10,000,000 bytes。
- 图片附件沿用 `buildPromptWithAttachments()` 生成的 text prompt 发送给 `/v1/runs`；当前 Deck 不向 `/v1/runs` 发送 `/v1/responses` 风格的 `input_image` content parts。
- Agent runtime id 必须合法且当前用户可访问。
- named Agent continuation 必须通过 Deck projection 证明 session/response 属于该 Agent，且普通用户必须是该 projection 的 `ownerUserId`；否则 403。admin/super_admin 只有在 route 已通过 Agent 授权后才可跨 owner 使用 proof。
- 未被证明的 named-Agent session 会替换为 server-generated `deck_<uuid>`，并作为可信 session 传 upstream，避免产生额外 `api` 话题。
- 若显式 `model` 缺省，Deck 会读取该用户/Agent 的 model preference。
- `timeoutMs` 可选；前端默认发送 `2100000`（35 分钟），服务端 clamp 到 `[1000, 2100000]`。这个上限等于 Hermes active subagent 30 分钟 timeout + 5 分钟收尾余量。
- 响应为 SSE，包含 `hub`、`status`、`delta`、`run-event`、`attachment`、`done`、`error`。keep-alive 是 SSE comment，不触发 event listener。
- Raw run-events 仍会转发给浏览器；`tool.started`/`tool.completed` 使用通用 `payload.tool` 名称渲染（例如 `lcm_grep`、`hindsight_recall`），并在扳手按钮打开时显示在聊天窗口主体的工具卡片里，不再显示右侧运行事件小窗。同时 `onRunEvent` 会把 projectable tool/function call/result 语义边界物化进 Deck projection；其它带 `run_id` 的非 delta Agent API events 也会持久化为隐藏 `role='tool'` / `projectionKind='run-event'` rows，打开工具详情时按“具体事件名 → Run event”展示。tool/function `arguments.delta` 不逐条持久化；持久参数来自 `arguments.done`/done item。
- 仅文本 delta 进入 assistant bubble；tool/function argument delta 不混入普通助手正文，projectable 工具调用显示为 `tool-call` 行，结果显示为 `tool-result`/`tool` 行。聊天窗口内的工具卡片优先显示具体工具名，再显示 `Tool call` / `Tool result` 等通用标签；raw run-event rows 使用 `run.created Run event`、`reasoning.available Run event` 这类同样的标题格式，便于一眼区分插件工具调用与 Agent API 生命周期事件。`delegate_task` 的 immediate tool output 若只是 `{status:'dispatched', mode:'background'}` 会标为 `Subagent dispatched`；后续 Hermes history 中的 `[ASYNC DELEGATION ... COMPLETE — deleg_<8hex>]` 完成消息会在消息 hydration/可见消息选择时归一化为 assistant-side `delegate_task` subagent result，不作为普通 user row 展示。

### `GET /api/deck/chat/resume?sessionId=<id>&since=<seq>`

重新订阅进程内 Stream Hub。若 ring buffer 存在 gap，首个 `hub` event 会带 `gap:true`，前端应回拉 messages/projection。

## Sessions, messages, stats

- `GET /api/deck/sessions?profile=<id>`：先成功取得 Agent-scoped API sessions，再融合 Deck projection 中的 in-flight/proof 状态。普通用户只能看到 owner 为自己 Deck user id 的 projected rows；admin/super_admin 可跨 owner 查看，但仍受 Agent auth/catalog 约束。API response metadata、explicit identity、distinct API base 或 distinct API key 可证明 scope；shared/default base+key 且 `/health` 无 identity 或 explicit mismatch fail closed as `profile_routing_unavailable`/502 or `session_profile_mismatch`/403。
- `GET /api/deck/sessions/[id]/messages?profile=<id>`：返回 session messages；projection 可返回刷新后仍存在的 draft assistant、tool-call、tool-result rows。若 projected draft 的 upstream hydrate 因 alias / canonical session proof 暂不可证而返回 `session_profile_mismatch`，BFF 保留 viewer-scoped projection 响应，不把 live/in-flight thread 打成 403；无 projection 或读取他人 projection 仍 fail closed。
- `DELETE /api/deck/sessions/[id]?profile=<id>`：通过 Hermes Agent `DELETE /api/sessions/{id}` 删除 upstream session；执行前必须通过 RBAC 与 profile/routing proof，不直接改本地 Hermes DB。
- `PATCH /api/deck/sessions/[id]?profile=<id>`：只允许 `title`、`end_reason`，CSRF + session/profile proof 后转发 Agent `PATCH /api/sessions/{id}`；不处理 Deck pin/tags/folder。
- `POST /api/deck/sessions/[id]/fork?profile=<id>`：CSRF + session/profile proof 后转发 Agent `POST /api/sessions/{id}/fork`。
- `GET /api/deck/stats?profile=<id>`：dashboard stats；成功取得 API sessions 后合并 viewer-scoped projection；sessions 的 dedicated-base/profile-metadata proof 规则相同，routing errors fail closed。
- `GET /api/deck/tokens?days=<n>&profile=<id>`：token/cost 聚合，timeout 较长。

## Notifications

Notification BFF routes are Deck-owned and user-scoped. They do not call Hermes Agent except when chat completion/failure is observed by the chat stream route.

- `GET /api/deck/notifications/config`：requires active Deck session; returns `{ ok:true, config, preferences, subscriptionCount, subscriptions }`. `subscriptions` contains non-reversible public ids only (no endpoint/key material). `config.available` is true only when `HERMESDECK_VAPID_PUBLIC_KEY`, `HERMESDECK_VAPID_PRIVATE_KEY`, and a subject (`HERMESDECK_VAPID_SUBJECT` or `HERMESDECK_PUBLIC_ORIGIN`) are present.
- `GET /api/deck/notifications/preferences`：returns the current user's notification preference booleans.
- `PUT/PATCH /api/deck/notifications/preferences`：mutating/CSRF-guarded; accepts booleans for `chatCompleted`, `chatFailed`, `cronJobCompleted`; ignores unknown or non-boolean values.
- `GET /api/deck/notifications/subscription`：returns only the current user's subscription count, never endpoint/key material.
- `POST /api/deck/notifications/subscription`：mutating/CSRF-guarded; stores the browser Push API subscription for the current Deck user. Endpoint must use a supported browser push provider; key sizes are capped; each user is capped at 16 subscriptions.
- `DELETE /api/deck/notifications/subscription`：mutating/CSRF-guarded; removes the current user's subscription by endpoint.
- `POST /api/deck/notifications/test`：mutating/CSRF-guarded; requires active user, available VAPID config, and access to the requested Agent runtime id before sending a low-sensitivity test chat-complete push.

Delivery semantics:

- Chat complete/failed notifications are background-capable Web Push. `/api/deck/chat/stream` dispatches non-blocking `chat_completed` / `chat_failed` notifications after final/error projection writes. Push errors and expired endpoints do not fail the chat stream; 404/410 subscriptions are pruned.
- Cron completion notifications are page-open browser notifications only. They use Settings preferences fetched through the config route, but delivery happens in the active page via `new Notification(...)`; there is no server watcher for closed-page Cron delivery.
- Push payloads contain title/body/tag and a same-origin app URL such as `/chat?...`; the Service Worker rejects cross-origin and `/api/*` click targets.

## Cron proof

- `GET /api/deck/cron?profile=<id>`：按一个或多个用户可访问 Agents 调 Hermes API Server `/api/jobs?include_disabled=true&profile=<id>`。
- `GET /api/deck/cron/[jobId]?profile=<id>`：先用 profile-scoped job list 证明 job 属于该 Agent，再读取 Agent `/api/jobs/{job_id}`。
- `POST /api/deck/cron`、`PATCH/DELETE /api/deck/cron/[jobId]`、`POST /api/deck/cron/[jobId]/pause|resume|run`：admin/super_admin only，CSRF，先做 Agent access/job proof，再转发 Agent jobs API；不读取本地 cron 文件。
- routing proof 接受：响应顶层 `profile_id/profileId/routed_profile_id/profile/routing.*` 等 legacy/compat 字段确认，或所有 job row 自带相同 Agent runtime id。profileless legacy rows 只有在 Deck server-owned dedicated named-Agent routing（非 default/shared API base 或专用 key）已证明时才按请求 Agent stamped。
- 未确认时返回 `profile_routing_unavailable`（502），explicit upstream mismatch 返回 403，不展示可能混 Agent 的 cron jobs；这类敏感 profile-scoped upstream data 无 proof 仍 fail closed。
- job shape 归一化为 `id/name/status/state/enabled/schedule/nextRunAt/lastRunAt/lastStatus/promptPreview/deliver/skills/toolsets/model/provider/workdir/profile/script/noAgent/repeat/lastError/lastDeliveryError/createdAt`。

## Tools, config, terminal and assets

- `GET /api/deck/tools`：API-first discovery；BFF 优先读取 Agent `/v1/skills` + `/v1/toolsets` 并归一化给 Tools UI。
- `GET /api/deck/toolsets?profile=<id>`：Agent `/v1/toolsets` 的只读归一化列表。
- `GET /api/deck/skill-catalog?profile=<id>`：Agent `/v1/skills` 的 metadata-only catalog；不返回 skill 文件正文。
- `GET /api/deck/skills`、`PUT /api/deck/skills`：`super_admin/local-owner` raw local skill 文件读写；保存使用 realpath containment、mtime optimistic lock、atomic write。
- `GET/PUT /api/deck/config?profile=<id>`：`super_admin/local-owner` 读写 Agent 对应 Hermes Agent profile 的 `config.yaml`、`SOUL.md`、`memories/USER.md`、`memories/MEMORY.md`；不是 runtime 数据源。
- `GET /api/deck/terminal/actions`、`POST /api/deck/terminal/run`：白名单 terminal actions。
- `/api/deck/term/sessions*`：Live Terminal CRUD/input/resize/stream/tmux；需要启用 Live Terminal 且 `super_admin` 权限。Stream route uses SSE replay plus `: ka` keepalive and idempotently unsubscribes on client cancel, enqueue failure, keepalive failure, or subscriber close so retries do not leak tmux subscribers.
- `POST /api/deck/uploads/parse`：解析 text/PDF/DOCX 等附件。
- `GET /api/deck/cache-image`：admin-only image proxy/cache endpoint；Service Worker 不缓存此路由。

- `/api/deck/lcm`：`super_admin/local-owner` LCM SQLite dashboard BFF。
