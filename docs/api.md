# BFF API 参考

> 所有路由都挂在 `/api/deck/*`。除特别注明外：
> - **Auth**：`hermesdeck_session` cookie（HMAC-签名）。
> - **CSRF / 写**：`POST` / `PUT` / `PATCH` / `DELETE` 走 `guardMutating`，
>   即 `requireAuth` + `isSameOrigin`（`Origin` / `Referer` 必须命中
>   `HERMESDECK_PUBLIC_ORIGIN` 或 dev 模式下的 RFC1918 IPv4）。
> - **响应体**：失败时形如 `{ "error": "<machine_code>", "detail": "<≤200 chars>" }`，
>   附合适的 HTTP 状态。

| 状态 | 含义（约定） |
| --- | --- |
| 400 | 请求体或参数非法 |
| 401 | 未登录或 cookie 失效 |
| 403 | 同源校验失败、路径越权（cache-image、skills） |
| 404 | 资源不存在 / Hub 流已经被驱逐 |
| 409 | 乐观锁冲突（保存 SKILL.md 时 mtime 不一致） |
| 413 | 请求体超过路由上限 |
| 415 | Content-Type 不是预期的 application/json 或 multipart |
| 429 | 登录限速 |
| 502 | 上游 Hermes（API Server / state.db / CLI）失败 |
| 503 | HermesDeck 自身降级，或 Service Worker 合成的离线响应 |

---

## 健康与统计

### `GET /api/deck/health`

返回 BFF 自身 + Hermes API Server + Hermes Dashboard 的连接状态。

```ts
type DeckHealth = {
  ok: boolean;
  status: 'connected' | 'degraded' | 'unreachable';
  version: string;
  apiServer: { baseUrl: string; healthy: boolean; detail?: string };
  dashboard: { baseUrl?: string; healthy: boolean; detail?: string };
  uptimeSeconds?: number;
};
```

- `Cache-Control: private, max-age=3, stale-while-revalidate=10`，BFF 内部
  缓存 3 秒。
- `apiServer.detail` 截断到 240 字符，`dashboard.detail` 通常是 `HTTP <status>`。
- `version` 来自 `hermes --version`，CLI 不可用时形如 `Hermes (<error msg>)`。

### `GET /api/deck/stats?profile=<id?>`

> 仪表盘统计的真实总量（不再用 200 条样本估算）。

```ts
type DeckStats = {
  scope: 'all' | string;
  totalSessions: number;
  totalMessages: number;
  activeSessions24h: number;
  activeMessages24h: number;
  perProfile: Array<{ profileId: string; sessions: number; messages: number; lastActiveAt?: string }>;
  perSource:  Array<{ source: string; sessions: number }>;
  lastActiveAt?: string;
};
```

- `profile` 若提供，只算该 profile 的 `state.db`；省略时合并所有 profile。
- 不合法的 profile id（不匹配 `^[\w.-]{1,64}$`）→ 400 `invalid_profile`。

### `GET /api/deck/tokens?days=<N>`

返回 token 与成本时序，默认 14 天，clamp 到 [1, 180]。

```ts
type TokenStats = {
  totals: { input; output; cacheRead; cacheWrite; reasoning; total; sessions; apiCalls; cost };
  last24h: { input; output; total; sessions; cost };
  daily:   Array<{ date; input; output; total; cost; sessions }>;
  hourly:  number[];   // 24
  weekday: number[];   // 7 (Mon..Sun)
  topModels:  Array<{ model;  tokens; sessions; cost }>;
  topSources: Array<{ source; tokens; sessions }>;
  windowDays: number;
};
```

`days` 非有限正数 → 400 `invalid_days`；BFF 缓存 10s/SWR 60s。

---

## Profiles & Models

### `GET /api/deck/profiles`

```ts
type DeckProfile = {
  id: string;
  name: string;
  alias?: string;
  active: boolean;
  model?: string;
  gateway?: string;
  toolsets: string[];
  hermesHome?: string;
  sessionCount?: number;       // 该 profile state.db 的全量 session 数
  lastActiveAt?: string;       // ISO
};
type Resp = { profiles: DeckProfile[] };
```

实现并发执行 `hermes profile show` + `hermes profile list`，再用一段嵌入
Python 聚合 `state.db` 的 sessions 总数与最近活跃时间。

### `GET /api/deck/models?profile=<id>`

合并三处信息：`config.yaml` 默认模型 / `hermes auth list` 凭证清单 /
`state.db` 的实际使用统计。

```ts
type DeckModelsResponse = {
  default?: { provider; model; baseUrl? };
  providers: Array<{
    id; name; credentialCount?; isDefault?; baseUrl?; authFailed?;
    models: Array<{
      id; isDefault?; sessions?; tokens?; inputTokens?; outputTokens?;
      lastUsed?; available?; used?;
    }>;
  }>;
  orphanModels: ModelInfo[];   // 当前实现固定为 []
  reasoningEffort?: string;    // agent.reasoning_effort
};
```

`profile` 默认 `default`；BFF 缓存 10 秒（按 profile 隔离）。

---

## Sessions

> 所有 session 路由都接受 `?profile=<id>` 参数，缺省 `default`。

### `GET /api/deck/sessions?profile=<id>`

返回最近 200 条 session（按 `updated_at`/`started_at` 倒序），过滤掉无消
息的 ghost session。响应里给出 `parentSessionId` / `childCount`，前端可以
做子代理折叠。

### `GET /api/deck/sessions/[id]/messages?profile=<id>&limit=<N?>&before=<ISO?>`

```ts
type DeckMessage = {
  id; role; content;
  createdAt?;
  metadata?;
  attachments?: DeckAttachment[];
  toolName?;
  toolCallId?;
  toolCalls?: Array<{ id?; name?; arguments? }>;
};
```

- `limit` clamp 到 [1, 1000]，默认 1000。
- `before` 严格小于 `created_at` 用于分页向前翻。
- 多模态 `content`（OpenAI Responses parts）会被拆为 `{ content: <joined text>,
  attachments: [{kind:'image'|'file', url|dataUrl, mime, …}] }`。

### `DELETE /api/deck/sessions/[id]?profile=<id>`

> ⚠️ **从 Hermes state.db 永久删除**该 session 与对应的 messages。
> UI 文案应明确标注「从 Hermes 历史中删除」。

`200`：`{ ok: true, removed: <number_of_session_rows> }`。

---

## Runs

Run 不是 Hermes 的一等概念，是 HermesDeck 把 messages 表按「user 消息为
分界线」切片得到的派生模型。

### `GET /api/deck/runs?profile=<id?>`

返回最近 80 条 run，跨所有 profile（若不传 `profile`）。

```ts
type DeckRun = {
  id: string;          // run::<profile>::<sessionId>::<idx>
  sessionId; sessionTitle?; profileId;
  status: 'success' | 'failed' | 'running' | 'cancelled';
  model?; source?;
  startedAt?; endedAt?; durationMs?;
  toolCallCount: number;
  toolNames: string[];
  promptPreview?; replyPreview?;
  errorSummary?;
};
```

### `GET /api/deck/runs/[id]`

进一步返回该 run 完整事件序列（按时间排序的 user / assistant / tool 行
+ 工具调用归一化）。

返回 `null` 等价于 404；极端情况下 `id` 用旧格式 `run_<profile>_<sid>_<idx>`
也兼容。

---

## Tools / Skills

### `GET /api/deck/tools`

合并 `hermes tools list`（toolsets / MCP servers）+ `hermes skills list`：

```ts
type ToolSummary = {
  name: string;
  kind: 'toolset' | 'skill' | 'mcp' | 'unknown';
  enabled?: boolean;
  description?: string;
  category?: string;
  source?: 'builtin' | 'local' | 'hub' | 'config' | 'mcp' | 'plugin' | 'unknown';
  trust?: string;
  taskGroup?: 'research' | 'coding' | 'browser' | 'files' | 'messaging'
            | 'devops' | 'media' | 'agents' | 'memory' | 'planning' | 'unknown';
  authFailed?: boolean;
  relPath?: string;             // skill 才会带
};
type Resp = { tools: ToolSummary[] };
```

- 强制 `COLUMNS=400`、`NO_COLOR=1` 调用 CLI，避免 Rich 表格被截断。
- 显式过滤掉 skills footer (`0 hub-installed, 89 builtin, …`)，否则会被
  当成名为 `0` 的 skill。
- BFF 缓存 10 秒；上限 240 项。

### `GET /api/deck/skills?path=<relPath>`

读取 SKILL.md 内容。`relPath` 是 `~/.hermes/skills/` 下的相对路径，例如
`software-development/spike`：

```ts
type SkillContent = {
  relPath; name; category?;
  content: string;        // utf-8
  mtime: string;          // ISO，作为乐观锁 token
  size: number;
  readOnly?: boolean;     // 当 file mode 不带 0o200 时 true
};
```

校验：路径不允许 `..`、绝对、Windows 盘符；逐段必须匹配
`/^[A-Za-z0-9_.\- ]+$/`，深度 ≤ 6。读完会再用 `realpath` 检查是否仍在
base 内（防符号链接逃逸）。最大 512KB。

错误码：

- 400 `invalid_path` / `path_escapes_base`
- 404 `ENOENT`
- 500 其它

### `PUT /api/deck/skills`

```jsonc
// body
{ "relPath": "creative/poster",
  "content": "<entire SKILL.md>",
  "mtime":  "<ISO from prior GET>"     // 可选；不传则跳过乐观锁
}
```

- 415 不是 `application/json`；413 `Content-Length` 超 1MB；
  409 `mtime_mismatch`；其余 fs 错误同上。
- 写入策略：临时文件 + `rename`（原子），mode 0o644。
- 成功 → `{ ok: true, mtime: <new ISO>, size: <bytes> }`。

---

## Chat 流

### `POST /api/deck/chat/stream`

请求体（`application/json`，最大 8MB）：

```ts
type ChatStreamBody = {
  message: string;                    // 用户消息
  profileId?: string;                 // 默认 'default'
  model?: string;
  reasoningEffort?: string;           // 跳过即不发；'auto' 表示由后端决定
  previousResponseId?: string;
  sessionId?: string;                 // 续话或重连用 hubKey
  attachments?: Array<{
    kind: 'text' | 'image';
    name: string; mime: string; size: number;
    text?: string;                    // text 类必填
    dataUrl?: string;                 // image 类必填，data:image/...;base64,...
  }>;
  timeoutMs?: number;                 // [1s, 30min]，默认 10min
};
```

响应：

- `Content-Type: text/event-stream; charset=utf-8`
- `Cache-Control: no-cache, no-transform`
- `X-Accel-Buffering: no`（绕过 nginx / Cloudflare 的 SSE buffer）
- 帧顺序：

  ```
  event: hub
  data: { sessionId, startedAt, latestSeq, gap }

  event: status        // phase = connecting | streaming | fallback-cli
  event: delta         // { delta: "<text chunk>" }
  event: run-event     // { type, payload, ts }   // 透传 OpenAI Responses 事件
  event: attachment    // 见 EmittedAttachment
  event: error         // { error, … }
  event: done          // { ok, content, responseId?, sessionId?, attachments? }
  ```

  心跳（不重置客户端 stall watchdog）：

  ```
  : keep-alive 1715049600000\n\n
  ```

- Hermes API Server 返回非 2xx 时，**自动**回退到 `hermes chat ...` CLI
  子进程（前提：本次请求不含图片，且不是 1MB body limit 这一类不可恢复
  错误）。回退时会先发一帧 `status.phase = fallback-cli`。

错误（不是 SSE 帧而是 HTTP 状态）：

- 400 `invalid_json` / `invalid_body`
- 413 `payload_too_large`（client → BFF 8MB；BFF → Hermes 1MB 由 SSE
  `error` 帧告知，不会用 HTTP 413）。
- 415 `expected application/json`

### `GET /api/deck/chat/resume?sessionId=<hubKey>&since=<seq>`

幂等读，不需要 CSRF。订阅 in-memory hub 上仍存活的 stream，从 `since`
之后回放。

- 404 `not_found` —— hub 已驱逐（done 后 10 分钟回收）或从未存在；
  调用方应改为 `GET /api/deck/sessions/[id]/messages` 拉持久化消息。
- 200 → 与 POST 同样的 SSE 帧，第一帧 `hub` 中的 `gap: true` 表示缓冲
  窗口已经覆盖不到 `since+1`，客户端应在流结束后再去 messages 端点抓
  最终结果。

---

## Auth

### `GET /api/deck/auth/session`

```jsonc
{
  "authenticated": true,
  "username": "admin",
  "expiresAt": 1735689600000,         // ms epoch
  "bootstrap": false                   // true = 仍在使用首启随机密码
}
```

未登录返回 `{ authenticated: false }`（HTTP 200，方便 `/login` 探测）。

### `POST /api/deck/auth/login`

```jsonc
{ "username": "admin", "password": "..." }
```

- 必须同源（Origin/Referer 校验）。
- 限速 key = `<ip>|<username.lower>`，6 次失败锁 15 分钟（429 + `Retry-After`）。
- 成功后 `Set-Cookie: hermesdeck_session=<HMAC token>; HttpOnly; SameSite=Lax;
  Secure?` —— `Secure` 跟随请求 protocol，或被 `HERMESDECK_FORCE_SECURE_COOKIE=1`
  覆盖。

### `POST /api/deck/auth/logout`

- 同源校验通过后清空 cookie。
- `Content-Type: application/x-www-form-urlencoded` → 303 重定向到 `/login`，
  方便 `<form>` 退出；JSON 调用方拿 `{ ok: true }`。

### `PATCH /api/deck/auth/credentials`

```jsonc
{
  "currentPassword": "...",            // 必填
  "newUsername":     "...",            // 可选；规则 ^[A-Za-z0-9_.\-@]{1,64}$
  "newPassword":     "..."             // 可选；长度 ≥ 8
}
```

任一改动都会自增 `passwordVersion` → 老 cookie 立即失效。响应同时下发新
cookie，避免本设备被踢。

---

## 上传与缓存

### `POST /api/deck/uploads/parse`

`multipart/form-data`，字段名 `file`。

| 检测条件 | 行为 |
| --- | --- |
| `application/pdf` 或 `*.pdf` | `pdf-parse` → 文本 |
| `*.docx` 或 `officedocument.wordprocessingml` | `mammoth.extractRawText` → 文本 |
| 其它 | 415 `unsupported file type` |

- `MAX_ATTACHMENT_BYTES = 22MB`（与客户端 `MAX_FILE_SIZE = 20MB` 留差额）。
- 超过 `MAX_TEXT_CHARS = 200_000` 的文本会被截断并标 `truncated: true`。

返回：

```ts
type Resp = {
  kind: 'text';
  name: string;
  mime: string;
  size: number;
  text: string;
  truncated: boolean;
};
```

### `GET /api/deck/cache-image?path=<absPath>`

把 Hermes 缓存目录里的二进制 artifact 暴露给浏览器渲染。

- 仅允许 `path` 落在 `~/.hermes/cache` 之下；其它一律 403。
- `lstat` 拒绝 symlink；`realpath` 二次校验仍在 base 之内。
- 体积上限 32MB；超过 4MB 流式回包，否则 `readFile`。
- SVG 强制 `Content-Disposition: attachment` 防内联脚本。
- 服务 worker 对该路径走 SWR 缓存（IMAGE_CACHE，LRU 60）。

---

## 安全终端 Action

### `GET /api/deck/terminal/actions`

```ts
type TerminalAction = {
  id: string;             // hermes.version | hermes.profile.list | …
  label: string;
  description: string;
  commandPreview: string;
  category: 'hermes' | 'system' | 'diagnostic';
  profileAware?: boolean;
  maxTimeoutMs: number;
};
```

当前白名单（[src/lib/server/hermes/terminal.ts](../src/lib/server/hermes/terminal.ts)）：
`hermes --version` · `hermes profile list/show` · `hermes tools list` ·
`hermes skills list` · 进程快照 · Deck 健康检查。

### `POST /api/deck/terminal/run`

```jsonc
{ "actionId": "hermes.tools.list",
  "profileId": "default",
  "timeoutMs": 12000 }
```

返回：

```ts
type TerminalRunResult = {
  ok: boolean;
  actionId; label; commandPreview;
  startedAt: number; durationMs: number;
  exitCode: number | null;       // 超时时为 null（被 SIGTERM）
  stdout; stderr;
  truncated: boolean;
  error?: string;
};
```

- `timeoutMs` clamp 到 `min(max(1000, value), action.maxTimeoutMs, 15000)`。
- `shell:false` 直接 `execFile`，绝不拼接命令字符串。
- stdout/stderr 各自最长 64KB，超过即截断；最后再过 `redactSecrets` 脱敏。

---

## 实时终端（tmux + node-pty，可选）

> 必须在服务端设 `HERMESDECK_LIVE_TERMINAL=1`，否则所有 mutating 路由返回
> 400 "Live terminal is disabled"。

### `GET /api/deck/term/sessions`

```ts
type Resp = { enabled: boolean; sessions: LiveTerminalSession[] };
```

### `POST /api/deck/term/sessions`

```jsonc
{ "label": "shell", "cols": 100, "rows": 30 }
```

最多并存 8 个 session；name `^[A-Za-z0-9 _.\-]{1,64}$`；cols [20,400] /
rows [5,200]。

### `DELETE /api/deck/term/sessions/[id]`

终止 PTY 与对应的 tmux session。

### `GET /api/deck/term/sessions/[id]/stream`

SSE。事件：

```
event: ready        data: { cols, rows }
event: data         data: "<chunk>"        // 完整重放 buffer 后切 live
event: replay-end   data: { count }
event: meta         data: { cols, rows }   // 客户端 resize 后广播
event: exit         data: { exitCode, signal }
event: error        data: { error }
```

每 25 秒 `: ka` 心跳。订阅上限 8 / session；环形缓冲 256 KB。

### `POST /api/deck/term/sessions/[id]/input`

```jsonc
{ "data": "ls\r" }
```

- chunk 上限 64 KB。
- 长度 ≥ 256 字节会写一行审计日志（首 32 字节 hex-safe 化）。

### `POST /api/deck/term/sessions/[id]/resize`

```jsonc
{ "cols": 120, "rows": 30 }
```

### `GET /api/deck/term/sessions/[id]/windows`

```ts
type Resp = { windows: Array<{ index: number; name: string; active: boolean }> };
```

### `POST /api/deck/term/sessions/[id]/tmux`

```ts
type LiveTerminalTmuxRequest =
  | { action: 'new-window';    name?: string }
  | { action: 'kill-window';   windowIndex: number }
  | { action: 'select-window'; windowIndex: number }
  | { action: 'rename-window'; windowIndex: number; name: string }
  | { action: 'split-pane';    direction: 'h' | 'v' }
  | { action: 'select-pane';   paneTarget: 'U' | 'D' | 'L' | 'R' };
```

- `windowIndex` 必须是 [0, 99] 整数。
- `name` 必须匹配 label 白名单。
- 任何未知 action → 400 `Invalid tmux action`。

---

## 客户端调用约定

`src/lib/api.ts` 暴露的 `deckApi` 已经把所有 GET 都通过：

- 默认 timeout 20s（`tokens`/`runs` 加到 30s）。
- `AbortSignal.timeout` 与外部 `signal` 通过 `AbortSignal.any`（或自实现）
  合并。
- 503 + `{ offline: true }` 抛出 `OfflineError`，由 UI 切到「离线」横幅。
- 非 2xx 抛出 `ApiError`：`{ status, body, message }`，UI 可根据 `status`
  分支处理。

> 写路由不在 `deckApi` 上，例外见 `src/app/chat/_hooks/useChatStream.ts` 与
> Settings 页的账号修改 — 它们在调用点直接 `fetch` 并显式处理 401/429。

---

## 兼容性 / 限速

| 项 | 上限 |
| --- | --- |
| `POST /api/deck/chat/stream` 请求体 | 8MB（client → BFF）/ 1MB（BFF → Hermes）|
| `PUT /api/deck/skills` 请求体 | 1MB |
| `POST /api/deck/uploads/parse` 文件 | 22MB |
| `GET /api/deck/cache-image` 体积 | 32MB |
| 登录失败次数 | 6 / 15min；锁 15min |
| Hermes API timeout | 见 `chat-stream.ts: HARD_TIMEOUT_MS = 30 * 60_000` |
| Hub 缓冲 | 4000 events / session；done 后保留 10 分钟 |

**注意**：BFF 内部 `makeCache` TTL 与 HTTP 响应头 `max-age` 不会自动一致，
更新逻辑时建议两边同步。
