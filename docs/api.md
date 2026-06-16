# BFF API Reference

所有 Deck 前端请求都走同源 `/api/deck/*`。BFF 负责 Deck auth/RBAC/CSRF、profile scope、输入限制、错误归一化与 Hermes Agent API Server 适配。除登录/注册/公开 PWA 资源外，路由默认要求 `hermesdeck_session` cookie。

## 通用约定

- 写请求：`POST`/`PUT`/`PATCH`/`DELETE` 使用 `guardMutating`，即登录校验 + `Origin`/`Referer` 同源校验。
- Same-origin 来源：`HERMESDECK_PUBLIC_ORIGIN`，以及开发场景的 loopback/RFC1918 host 规则。
- 失败响应：通常为 `{ ok:false, error:string, detail?:string }` 或 `{ error:string, detail?:string }`。
- 上游错误中可能含 secret；BFF 返回前通过 redaction 裁剪。
- 运行时数据失败不走 local DB/CLI/catalog 补齐；按 fail-closed 返回 4xx/5xx。

常见状态：

- 400：参数、profile id、请求体或 Content-Type 不合法。
- 401：未登录或 cookie 无效。
- 403：inactive、权限不足、profile 未分配、CSRF/same-origin 失败、named-profile proof 不足。
- 404：资源不存在或 stream hub 已驱逐。
- 409：mtime 乐观锁冲突。
- 413：请求体超过路由限制。
- 415：Content-Type 不支持。
- 429：登录限速。
- 502：Hermes Agent API Server 或 profile routing proof 失败。
- 503：Deck/SW 离线降级响应。

## Auth and admin

- `GET /api/deck/auth/session`：返回当前用户、role、capabilities、assigned profiles。
- `POST /api/deck/auth/login`：登录；支持限速；可在 `HERMESDECK_TRUST_PROXY=1` 时信任代理来源 IP。
- `POST /api/deck/auth/logout`：清除 session。
- `POST /api/deck/auth/register`：创建待审批普通用户。
- `PUT /api/deck/auth/credentials`：当前用户更新 username/password。
- `GET /api/deck/admin/users`、`POST /api/deck/admin/users`：admin/super_admin 管理用户。
- `GET/PATCH/DELETE /api/deck/admin/users/[id]`：用户状态、角色、删除等；`super_admin` 不可修改/删除，只有 `super_admin` 能授予/改变角色。
- `GET/PUT /api/deck/admin/users/[id]/profiles`：管理用户 profile assignment。

RBAC：`admin` 和 `super_admin` 可访问全部 API-backed profiles；普通 `user` 只能访问 assignment 中的 profiles。catalog outage 时不通过本地枚举补齐可见列表。

## Health and catalog

- `GET /api/deck/health`：Deck 与 Hermes API Server 健康状态、版本/uptime 等。
- `GET /api/deck/profiles`：从 Hermes API Server profiles endpoints 获取 catalog，选择最完整的 API-backed 列表，并按当前用户过滤。失败时返回错误，不扫描本地 profiles 目录。
- `GET /api/deck/models?profile=<id>`：按 profile 调 Hermes API Server `/v1/models`。无 selectable model 或 API 不可达时返回错误/空 UI 状态；不从本地文件合成模型清单。
- `GET /api/deck/model-preferences?profileId=<id>`、`PUT /api/deck/model-preferences`：Deck 用户级模型偏好；只影响 Deck 下次发起的 chat request override。

## Chat streaming

### `POST /api/deck/chat/stream`

请求体核心字段：

```ts
type ChatStreamRequest = {
  message: string;
  profileId?: string;
  sessionId?: string;
  previousResponseId?: string;
  model?: string;
  reasoningEffort?: string;
  attachments?: unknown[];
  timeoutMs?: number;
};
```

行为：

- body hard cap：8 MiB；发送给 Hermes `/v1/responses` 的 upstream body hard cap：1 MiB。
- profile 必须合法且当前用户可访问。
- named profile continuation 必须通过 Deck projection 证明 session/response 属于该 profile，且普通用户必须是该 projection 的 `ownerUserId`；否则 403。admin/super_admin 只有在 route 已通过 profile 授权后才可跨 owner 使用 proof。
- 未被证明的 named-profile session 会替换为 server-generated `deck_<uuid>`，并作为可信 session 传 upstream，避免产生额外 `api` 话题。
- 若显式 `model` 缺省，Deck 会读取该用户/profile 的 model preference。
- `timeoutMs` 可选；前端默认发送 `2100000`（35 分钟），服务端 clamp 到 `[1000, 2100000]`。这个上限等于 Hermes active subagent 30 分钟 timeout + 5 分钟收尾余量。
- 响应为 SSE，包含 `hub`、`status`、`delta`、`run-event`、`attachment`、`done`、`error`。keep-alive 是 SSE comment，不触发 event listener。
- Raw run-events 仍会转发给浏览器；同时 `onRunEvent` 会把 projectable tool/function call/result 语义边界物化进 Deck projection。tool/function `arguments.delta` 不逐条持久化；持久参数来自 `arguments.done`/done item。
- 仅文本 delta 进入 assistant bubble；tool/function argument delta 不混入普通助手正文，projectable 工具调用显示为 `tool-call` 行，结果显示为 `tool-result`/`tool` 行。

### `GET /api/deck/chat/resume?sessionId=<id>&since=<seq>`

重新订阅进程内 Stream Hub。若 ring buffer 存在 gap，首个 `hub` event 会带 `gap:true`，前端应回拉 messages/projection。

## Sessions, messages, runs, stats

- `GET /api/deck/sessions?profile=<id>`：返回 profile scoped sessions；融合 Deck projection 中的 in-flight/proof 状态。普通用户只能看到 owner 为自己 Deck user id 的 projected rows；admin/super_admin 可跨 owner 查看，但仍受 profile auth/catalog 约束。
- `GET /api/deck/sessions/[id]/messages?profile=<id>`：返回 session messages；projection 可返回刷新后仍存在的 draft assistant、tool-call、tool-result rows。普通用户读取他人 projection 会 403。
- `DELETE /api/deck/sessions/[id]?profile=<id>`：删除/移除该 session 的 Deck 与 upstream 可删除状态；必须有 profile 权限。
- `GET /api/deck/runs?profile=<id>`、`GET /api/deck/runs/[id]`：运行列表与详情。
- `GET /api/deck/stats?profile=<id>`：dashboard stats；default profile 合并 API sessions 与 viewer-scoped projection，named profiles 使用 viewer-scoped projection stats。
- `GET /api/deck/tokens?days=<n>&profile=<id>`：token/cost 聚合，timeout 较长。

## Cron proof

- `GET /api/deck/cron?profile=<id>`：按一个或多个用户可访问 profiles 调 Hermes API Server `/api/jobs?include_disabled=true&profile=<id>`。
- profile proof 接受：响应顶层 `profile_id/profileId/routed_profile_id/profile/routing.*` 等字段确认，或所有 job row 自带相同 `profile`。
- 未确认时返回 `profile_routing_unavailable`（502），不展示可能混 profile 的 cron jobs。
- job shape 归一化为 `id/name/status/state/enabled/schedule/nextRunAt/lastRunAt/lastStatus/promptPreview/deliver/skills/toolsets/model/provider/workdir/profile/script/noAgent/repeat/lastError/lastDeliveryError/createdAt`。

## Tools, config, terminal and assets

- `GET /api/deck/tools`、`GET /api/deck/skills`、`PUT /api/deck/skills`：能力/技能视图与受限编辑；保存使用 realpath containment、mtime optimistic lock、atomic write。
- `GET/PUT /api/deck/config?profile=<id>`：读写 profile 的 `config.yaml`、`SOUL.md`、`memories/USER.md`、`memories/MEMORY.md`；不是 runtime 数据源。
- `GET /api/deck/terminal/actions`、`POST /api/deck/terminal/run`：白名单 terminal actions。
- `/api/deck/term/sessions*`：Live Terminal CRUD/input/resize/stream/tmux；需要启用 Live Terminal 且 admin 权限。
- `POST /api/deck/uploads/parse`：解析 text/PDF/DOCX 等附件。
- `GET /api/deck/cache-image`：admin-only image proxy/cache endpoint；Service Worker 不缓存此路由。
- `/api/deck/kanban*`、`/api/deck/lcm`：任务板和 LCM dashboard BFF。
