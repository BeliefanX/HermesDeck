# Deck Chat Projection

Deck chat projection 是 HermesDeck 自有的 UX/proof store。它记录 Deck 通过 API Server 发起或观察到的聊天 turn，用于刷新后的会话列表、stream 状态、named-profile session/response proof、错误状态展示。

它不是 Hermes runtime 数据源：不替代 Hermes Agent API Server，不从 Hermes 本地数据库重建 runtime，不作为跨 profile 权限绕过。

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

- `id/title/profileId/source/createdAt/updatedAt`
- `ownerUserId/ownerRole`
- `status`: `running | completed | failed`
- `responseId/previousResponseId/aliases/lastError`
- normalized messages，含 draft assistant message、attachments、projection metadata 等。

## Chat hooks

`POST /api/deck/chat/stream` 构造 `ChatStreamProjectionHooks`：

- `onStart`：在 upstream pump 前写入 user message 与 draft assistant message。
- `onCanonicalSessionId`：当 Hermes API Server 返回 `X-Hermes-Session-Id` 时 reconcile old/new session id。
- `onDone`：写入 assistant final content、response id、attachments，并标记 completed。
- `onError`：标记 failed 并保存 last error。

## Named-profile proof

Projection 是 named-profile continuation 的 proof source：

- `hasProjectedSession(sessionId, profileId)` 证明 session 属于 profile。
- `projectedResponseIdMatches(sessionId, profileId, previousResponseId)` 证明 response chain 属于该 profile session。
- 若 proof 不存在，Deck 拒绝 continuation 或生成新的 Deck-owned `deck_<uuid>` session id。

这能防止用户把一个 profile 的 session/response id 带到另一个 profile 继续运行，也能让新 named-profile turn 与 upstream session id 对齐，避免额外 `api` 话题。

## RBAC boundary

Projection 带 `ownerUserId/ownerRole`。Stream Hub 和 routes 仍以 Deck session cookie/RBAC 为准；普通用户不能通过知道 projection id 访问未分配 profile。Admin/super_admin 能查看/管理更广 profile，但 catalog 仍必须来自 API Server。

## Operational notes

- 删除 projection 文件只会丢失 Deck UX/proof 状态；不会删除 Hermes runtime history。
- 如果 named-profile continuation 开始 403，先确认 projection 是否存在对应 session/response proof，再确认 API Server 是否返回 canonical session id。
- 不要用 projection 内容向用户承诺 Hermes Agent 已持久化某条消息；最终 runtime 状态仍以 Hermes API Server 为准。
