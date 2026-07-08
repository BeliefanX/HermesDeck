# Deck Chat Projection

Deck chat projection 是 HermesDeck 自有的 UX/proof store。它记录 Deck 通过 API Server 发起或观察到的聊天 turn，用于刷新后的会话列表、stream 状态、server-projected draft assistant/tool rows、named-Agent session/response proof、错误状态展示。

它不是 Hermes runtime 数据源：不替代 Hermes Agent API Server，不从 Hermes 本地数据库重建 runtime，不作为跨 Agent 权限绕过。

## Files

默认目录：`HERMESDECK_DATA_DIR`，否则 `HERMESDECK_AUTH_DIR`，否则 `~/.hermesdeck`。

- `chat-projection.v1.json`
- `chat-projection.v1.json.lock`

## Store invariants

- 写入时获取 lock file；stale lock 超过 5 分钟可被清理。
- lock acquisition 最长等待 5 秒，每 25ms 重试。
- 写入采用 temp file + rename 的 atomic write。
- 读取时会 normalize/repair 可接受旧 shape，但不会把 projection 当作 Hermes runtime 真相。
- projection failure 不能中断 live chat；hook errors 被隔离。

## Prune policy

当前代码常量：

- `MAX_IMPORTED_SESSIONS = 500`
- `MAX_MESSAGES_PER_SESSION = 1000`
- `MAX_STORED_SESSIONS = 750`
- `MAX_ACTIVE_OR_ERRORED_SESSIONS = 200`
- `COMPLETED_SESSION_TTL_MS = 14 days`
- `FAILED_OR_RUNNING_SESSION_TTL_MS = 3 days`

Prune 保留最近/活跃/失败状态，限制总 session 数与每 session message 数，避免长期 PWA/Deck 使用无限增长。

## What is stored

Projection session 包含：

- `id/title/profileId/source/createdAt/updatedAt`（`profileId` 是 legacy/compat Agent runtime id）
- `ownerUserId/ownerRole`
- `status`: `running | completed | failed`
- `responseId/previousResponseId/aliases/lastError`
- normalized messages，含 draft/final assistant message、tool-call rows、tool-result/tool rows、attachments、projection metadata 等。

## Chat hooks

`POST /api/deck/chat/stream` 构造 `ChatStreamProjectionHooks`：

- `onStart`：在 upstream pump 前写入 user message 与 draft assistant message。
- `onCanonicalSessionId`：当 Hermes API Server 返回 `X-Hermes-Session-Id` 时 reconcile old/new session id。
- `onRunEvent`：raw run-events 仍转发给浏览器，并由右侧观测面板通用渲染 `tool.started`/`tool.completed` 的 `payload.tool` 名称；projection 只在语义边界（tool/function call added、arguments done、output item done、tool result/output）物化为 messages。`arguments.delta` 不做 durable projection write，刷新后的持久参数以 `arguments.done`/done item 为准。它会关联 Responses `itemId`（如 `fc_*`）和稳定 `callId`（如 `call_*`），将工具输出数组中的 text parts 归一化为文本。
- `onDone`：写入 assistant final content、response id、attachments，并标记 completed。
- `onError`：标记 failed 并保存 last error。

## Named-Agent proof

Projection 是 named-Agent continuation 的 proof source：

- `hasProjectedSession(sessionId, profileId, viewer)` 证明 session 属于 Agent，且普通用户的 viewer 必须匹配 `ownerUserId`。
- `projectedResponseIdMatches(sessionId, profileId, previousResponseId, viewer)` 证明 response chain 属于该 Agent session，且普通用户的 viewer 必须匹配 `ownerUserId`。
- 若 proof 不存在，Deck 拒绝 continuation 或生成新的 Deck-owned `deck_<uuid>` session id。

这能防止用户把一个 Agent 的 session/response id 带到另一个 Agent 继续运行，也能让新 named-Agent turn 与 upstream session id 对齐，避免额外 `api` 话题。

## RBAC boundary

Projection 带 `ownerUserId/ownerRole`。Stream Hub 和 routes 仍以 Deck session cookie/RBAC 为准；普通用户只能读取、proof、continue、写入 `ownerUserId` 等于自己 Deck user id 的 projected sessions/messages/stats，且仍必须有对应 Agent assignment。Admin/super_admin 可显式绕过 projection owner filter/proof/write check，但仍受 route-level Agent auth/catalog 约束；catalog 仍必须来自 API Server。Shared/default API base 上的 unlabeled upstream session rows 仍 fail closed；专用 named-Agent API base 可作为 Deck server-side routing proof。

## Operational notes

- 删除 projection 文件只会丢失 Deck UX/proof 状态；不会删除 Hermes runtime history，也会丢失刷新后可见的 in-flight draft/tool rows。
- 如果 named-Agent continuation 开始 403，先确认 projection 是否存在对应 session/response proof，再确认 API Server 是否返回 canonical session id。
- 不要用 projection 内容向用户承诺 Hermes Agent 已持久化某条消息；最终 runtime 状态仍以 Hermes API Server 为准。
