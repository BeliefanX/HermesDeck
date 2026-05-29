# 架构

> HermesDeck 是一个 **BFF + 单页 Web 应用**：前端使用 Next.js App Router，
> 服务端 Route Handlers 把 Hermes API Server / Hermes CLI / Hermes 状态库
> 包装为 `/api/deck/*` 这一份对前端契约。本文记录每一层的职责、关键模块与
> 跨层数据流。

---

## 1. 进程拓扑

```
┌──────────────────────────────────────────────────────┐
│  Browser                                            │
│  • Next App Router pages (Client Components)        │
│  • PWA: /manifest.webmanifest, /sw.js, /offline     │
│  • Service Worker LRU caches (shell + runtime + img)│
└──────────────┬──────────────┬────────────────────────┘
               │ HTTPS        │ SSE
               ▼              ▼
┌──────────────────────────────────────────────────────┐
│  HermesDeck Server (Next.js, Node runtime)          │
│  • Route Handlers under /api/deck/*  (BFF)          │
│  • proxy.ts — auth + 401 redirect + cookie refresh  │
│  • Stream Hub — in-memory SSE replay buffer         │
│  • runPython — sqlite reads via embedded scripts    │
│  • terminal-pty — tmux + node-pty (opt-in)          │
│  • auth.ts — scrypt + signed-cookie session         │
└──┬────────────────────┬──────────────┬───────────────┘
   │ HTTP               │ execFile     │ fs / sqlite
   ▼                    ▼              ▼
┌──────────┐      ┌────────────┐  ┌───────────────────┐
│ Hermes   │      │ hermes CLI │  │ ~/.hermes/        │
│ API      │      │  • profile │  │  state.db         │
│ Server   │      │  • tools   │  │  profiles/<id>/   │
│ /v1/...  │      │  • skills  │  │  config.yaml      │
└──────────┘      │  • auth    │  │  skills/          │
                  └────────────┘  │  cache/           │
                                  └───────────────────┘
```

主要约束：

- **前端零 Hermes 知识**：所有模型 / Provider / 工具 / Profile 都通过
  `/api/deck/*` 暴露给前端；不在客户端硬编码任何 Hermes 数据。
- **服务端零网状态**：全部聚合都来自 Hermes 自己（API Server / state.db /
  CLI），HermesDeck 只持有少量 BFF-only 缓存（5–10s TTL）。
- **本地 metadata 与 Hermes 历史分离**：pin / folder / archive / tag /
  rename 全部存浏览器 `localStorage`，绝不写回 Hermes。

---

## 2. 顶层目录

```
HermesDeck/
├─ next.config.js               # LAN dev origins, security headers, externals
├─ src/
│  ├─ app/                      # Next App Router (routes + pages)
│  │  ├─ layout.tsx             # Root layout · Theme · ProfileProvider · PWA
│  │  ├─ manifest.ts            # /manifest.webmanifest
│  │  ├─ page.tsx               # Dashboard
│  │  ├─ chat/                  # 多会话聊天页（hooks + components）
│  │  ├─ profiles/  runs/[id]/  tools/  terminal/  settings/  login/  offline/
│  │  └─ api/deck/              # BFF 路由（详见 docs/api.md）
│  ├─ proxy.ts                  # Next 16 proxy（中间件） — auth / 401 / refresh
│  ├─ instrumentation.ts        # Next instrumentation hook
│  ├─ instrumentation-node.ts   # 全局 unhandledRejection / uncaughtException 兜底
│  ├─ components/               # 跨页组件（AppShell / Brand / SkillEditor …）
│  └─ lib/
│     ├─ api.ts                 # 浏览器侧 fetch 封装 + ApiError / OfflineError
│     ├─ types.ts               # 公共数据契约
│     ├─ client-sse.ts          # 浏览器 SSE 解析 + 5 分钟 stall watchdog
│     ├─ profile-context.tsx    # 全局 active-profile，跨标签同步
│     ├─ i18n.tsx               # zh / en 字典 + useT
│     ├─ session-meta.ts        # localStorage 上的会话元数据（pin / folder …）
│     ├─ timeline.ts            # 把 SSE 原始事件聚合成 UI 时间线
│     ├─ format.ts              # source 标签、相对时间、tone 映射
│     ├─ attachments.ts         # 客户端附件（图片压缩、PDF/DOCX 解析）
│     ├─ prompts.ts             # 斜杠命令目录
│     └─ server/                # Node-only：所有 BFF 实现都集中在这里
│        ├─ auth.ts             # scrypt + signed cookie + login rate-limit
│        ├─ csrf.ts             # Origin/Referer same-origin guard
│        ├─ run-python.ts       # 统一 python3 -c <script> 调用
│        ├─ terminal-pty.ts     # tmux + node-pty 实时终端
│        └─ hermes/             # Hermes 集成的全部模块
│           ├─ index.ts         # 重导出：稳定的内部 API 门面
│           ├─ core.ts          # env 读取、cache 装饰器、SSE 工具
│           ├─ health.ts        # /v1/health + dashboard probe
│           ├─ profiles.ts      # `hermes profile show/list` + activity 聚合
│           ├─ sessions.ts      # state.db 读取（含 ghost session 过滤）
│           ├─ messages.ts      # 多模态 content 拆分 + 工具调用归一化
│           ├─ runs.ts          # 由 messages 聚合出 Runs / RunDetail
│           ├─ tools.ts         # `hermes tools list` + `skills list` 解析
│           ├─ skills.ts        # SKILL.md 读写 + path/realpath 校验
│           ├─ models.ts        # provider 目录 × 配置默认 × 历史使用
│           ├─ stats.ts         # 全 profile sessions / messages / 24h aggr
│           ├─ tokens.ts        # 14 天 token / cost 直方图、热力图
│           ├─ terminal.ts      # 安全 Action 白名单
│           ├─ chat-stream.ts   # /v1/responses 流式 + CLI fallback
│           ├─ stream-hub.ts    # in-memory 事件总线（重放 + 心跳）
│           └─ attachments.ts   # 提取 SSE/历史里的图片/文件 artifact
├─ public/
│  ├─ sw.js                     # Service Worker（shell + image LRU + offline）
│  ├─ icons/*.png               # PWA 图标 / Apple touch / maskable
│  └─ apple-touch-icon.png …
├─ scripts/
│  ├─ dev-with-redirect.mjs     # 同时拉起 next + 6117 重定向
│  ├─ redirect-6117.mjs         # 6117 → 6118 的 301 helper
│  ├─ free-port.mjs             # 启动前释放 6118
│  ├─ fix-pty-helper.mjs        # node-pty spawn-helper 可执行权限修复
│  ├─ verify-pwa.mjs            # 验证 PWA 关键文件 / CSS 关键 token
│  └─ smoke.mjs                 # build 后启动并检查关键公开路由
└─ docs/                        # 当前文档集
```

---

## 3. 请求生命周期

### 3.1 普通页面

1. 浏览器请求 `/chat`。
2. `src/proxy.ts` 校验 `hermesdeck_session` cookie（`SESSION_COOKIE`）：
   - 公开路径（`/login`、`/api/deck/auth/*`、`/sw.js`、`/manifest.webmanifest`、
     `/offline`、`/_next/*`、`/icons/*`）直接放行。
   - 通过校验且距 `iat` 已超过 TTL 的一半，下发新 cookie（滑动续期）。
   - 校验失败：API 路由返回 401 JSON；页面路由 302 → `/login?next=…`。
3. `src/app/layout.tsx` 注入：
   - `theme-bootstrap` 内联脚本（消除主题闪烁）。
   - `ProfileProvider` —— 加载 `/api/deck/profiles` 并暴露 active profile。
   - `<AppShell>` 提供桌面 sidebar、移动 app-bar、命令面板和底部 nav。
   - `<PWARegister>` 仅在生产环境下注册 `/sw.js`，dev 反而会主动卸载残留的
     SW（避免缓存劫持 `/api/*`）。

### 3.2 BFF GET（read-only）

```
Browser  ──fetch──► /api/deck/sessions?profile=… ──► getSessions(profile)
                                                          │
                                                          ▼
                                                runPython(<embedded sqlite script>)
                                                          │
                                                          ▼
                                                   ~/.hermes/state.db
                                                  / ~/.hermes/profiles/<id>/state.db
```

- 大多数 GET 路由都包了 `Cache-Control: private, max-age=N, stale-while-revalidate=M`，
  N/M 视成本而定（health 3/10、profiles 5/30、tokens 10/60 等）。
- BFF 内部使用 `makeCache` / `makeKeyedCache` 做单进程内缓存，TTL 与
  HTTP 响应头互相印证（cf. [src/lib/server/hermes/core.ts](../src/lib/server/hermes/core.ts)）。
- Sqlite 访问全部走 `runPython`，理由：跨平台一致、零依赖、字段差异（旧
  schema 用 `created_at`、新 schema 用 `timestamp`）由 Python 侧统一吸收。

### 3.3 BFF 写操作（含 SSE）

写入路由（`POST` / `PUT` / `DELETE`）一律走 `guardMutating`：

1. `requireAuth` —— 验签 cookie，401 短路。
2. `isSameOrigin` —— 检查 `Origin`/`Referer`：白名单包含
   - `localhost` / `127.0.0.1` / `::1`
   - 环境变量 `HERMESDECK_PUBLIC_ORIGIN`（多个用逗号分隔）
   - 开发环境额外放行 RFC1918 / 链路本地 IPv4。

   两者都缺时（不会发生在浏览器）默认拒绝，避免 fetch 提权。

聊天 `POST /api/deck/chat/stream` 同时承担 **Stream Hub** 的入口：

```
POST /api/deck/chat/stream                    GET /api/deck/chat/resume
            │                                            │
            ▼                                            ▼
  createChatStream(body)                        resumeChatStream(sessionId, since)
            │                                            │
            ▼                                            │
  createActiveStream(sessionId) ─────────────────────────┘
            │
            ▼
   pumpUpstream():
     ⤷ POST {HERMES_API_BASE}/v1/responses (stream=true)
        ⤷ emitToHub(stream, 'delta'  | 'run-event' | 'attachment' | 'status')
        ⤷ markStreamDone(stream) on completion
   buildSubscriberStream(stream, {since}):
     ⤷ enqueue 'hub' envelope (sessionId, latestSeq, gap)
     ⤷ replay buffer events seq > since
     ⤷ live subscribe; emit `: ka` heartbeats every 15s
```

要点：

- **超时 / 取消层级**
  - 单个请求最长 30 分钟（`chat-stream.ts: HARD_TIMEOUT_MS`）。
  - 客户端断开 (`reader.cancel`) 不会中止 upstream —— Hub 继续 pump，刷新
    后通过 `?since=` 拿回所有未消费事件。
  - 同一 `sessionId` 上又来一条新请求时，旧的 ActiveStream 收到 abort
    `'superseded'` 并下发一帧 `error` 给所有订阅者。
- **CLI fallback**：当 `/v1/responses` 整个失败（非 `payload_too_large`）
  且本次没有图片，`pumpUpstream` 切换到 `hermes chat -Q --source hermesdeck`
  子进程，把 stdout 转成 `delta` 事件继续流。
- **请求体 1 MB 上限**：来自 Hermes API Server；超过即给 `error`
  `payload_too_large` 而不是真的发请求。
- **SSE 心跳**：每 15s 一帧 `: keep-alive ${ts}` 注释，纯字节流，避免
  nginx/Cloudflare 的 idle 关闭，也是浏览器侧 5 分钟 stall watchdog 的活
  跃凭据（注意：心跳本身**不**重置 watchdog 计时，只有真正的事件才重置，
  以防 upstream 卡住但代理仍 keep-alive 的情况，详见
  [src/lib/client-sse.ts](../src/lib/client-sse.ts)）。

---

## 4. Stream Hub（核心）

`src/lib/server/hermes/stream-hub.ts` 是「刷新可恢复」的核心：

| 字段 | 作用 |
| --- | --- |
| `sessionId` | 用户首次 POST 时给的 id（也是 hub key），后续 `?sessionId=` 都用它 |
| `buffer: HubEvent[]` | 环形缓冲，最多 4000 条 |
| `nextSeq` | 单调递增，从 1 开始；客户端用它做 `?since=` |
| `subscribers` | 当前订阅的 SSE controller 集合 |
| `done` | upstream 是否结束 |
| `evictTimer` | done 后 10 分钟回收 stream |
| `abort` | upstream fetch / CLI 子进程的 abort signal |

行为：

- 如果 `buffer[0].seq > since + 1`，`hasGap` 返回 true 并在 `hub` 信封中
  标 `gap: true`，提醒客户端这次 resume 漏掉了部分事件，应再去落库拉
  最终消息。
- 同一 `sessionId` 重复 POST 时，旧 stream 立即 `abort('superseded')` 并
  通知所有订阅者收一条 `error: 'superseded'`，避免双流叠加。
- 进程级单例：`globalThis.__hermesdeck_stream_hub__`，HMR 重载后仍然继承。

---

## 5. 鉴权与会话

`src/lib/server/auth.ts`：

- 凭据存放：`~/.hermesdeck/auth.json`（mode 600）。
- 哈希：`scryptSync(password, salt, 64, { N: 1<<15 })`。
- 第一次启动时若文件不存在，会以 `firstBootInProgress` 互斥锁的形式生成：
  - 18 字节 base64url 一次性密码。
  - 32 字节随机 `sessionSecret`（HMAC key）。
  - 通过 `console.log` 打印 banner 到服务器输出，**不**写回任何日志文件。
- 登录限速：以 `IP|username` 为 key，15 分钟窗口、6 次失败、锁 15 分钟，
  bucket 上限 1024（LRU evict）。
- Cookie：`hermesdeck_session`，HMAC-SHA256(`{u, pv, iat, exp}`)。
  - `secure` 跟随请求 protocol；通过 `HERMESDECK_FORCE_SECURE_COOKIE=1`
    强制（HTTPS 反代后端为 HTTP 时使用）。
  - 半生 TTL 时滑动续期。
- 改密会自增 `passwordVersion`，旧 token 因 `payload.pv !== rec.passwordVersion`
  立即失效（强制下线其他设备）。

`src/lib/server/csrf.ts`：

- 写路由必经 `guardMutating`。
- `Origin` / `Referer` 必须命中允许列表；浏览器现代版本对所有跨域写都会
  附带 `Origin`，二者皆缺则拒绝。

---

## 6. 状态库读取（runPython）

`src/lib/server/run-python.ts` 是所有 sqlite 读取的入口：

- 默认 `python3 -c <inline script>`，timeout 12s，stdout maxBuffer 10MB。
- 失败枚举：`python_timeout` / `python_not_found` / `python_output_too_large`
  / `python_parse_failed` / 其余原始消息（截断 240 字符）。
- 子进程环境合并：`{ ...process.env, ...opts.env }`，避免覆盖 `PATH`/`HOME`。

主要场景：

| 模块 | DB 路径 | 关键策略 |
| --- | --- | --- |
| sessions | `~/.hermes/state.db` 或 `~/.hermes/profiles/<id>/state.db` | 过滤无消息的 ghost session；从首条 user message 反推 fallback title；child_count 一次性聚合 |
| messages | 同上 | 多模态 `content` 拆分（input_image / output_image / file），`tool_calls` 归一化 |
| runs | 全部 profile 的 `state.db` 合并 | 以 `user` 消息为分组锚点构造 Run；id 形如 `run::<profile>::<sid>::<idx>` |
| stats | 同上 | 全量 `count(*)`、24h 窗口、per-source / per-profile 聚合 |
| tokens | `~/.hermes/state.db` | 14 天的日 / 时 / 周直方图、模型与来源 Top-N |
| profiles | 各自 `state.db` | sessionCount + 最新活跃时间 |

> 当未来 Hermes schema 变化（例如把 `created_at` 改成 `timestamp`），改动
> 集中在 `runPython` 调用处的 SQL/字段适配，无需触碰 TS 侧契约。

---

## 7. 客户端模块

### 7.1 ProfileContext

`src/lib/profile-context.tsx`：

- 单一来源 `localStorage['hermesdeck.active-profile.v1']`。
- 自迁移旧 chat-only key（`hermesdeck.chat.v1.profile`）。
- 自定义事件 `hermesdeck:active-profile-changed` 做同标签内通知。
- `storage` 事件做跨标签同步。

### 7.2 Chat 模块（[src/app/chat](../src/app/chat)）

聊天页是整个应用的最大模块，按职责拆为：

- `_components/`：纯展示性 UI（侧栏、时间线、Inspector、Composer、Empty）。
- `_hooks/`：领域 hook —— `useChatStream`（流的生命周期）、`useChatHydration`
  （localStorage rehydrate）、`useChatModels`（可选模型 / reasoning effort）、
  `useChatScroll`（粘底）、`useDragDropPaste`、`useSlashCommand`、
  `useChatGroups`（按 source / pin / folder 分组）等。
- `_lib/`：纯函数 —— storage / i18n / subagent 折叠规则。

聊天页的**反向数据流**：

```
useChatStream
   ├─ POST /api/deck/chat/stream  (resp: SSE)
   │     ├─ 'hub'        → onHub({ sessionId, latestSeq, gap })
   │     ├─ 'status'     → push status item to timeline
   │     ├─ 'delta'      → append to messages[active][assistantId].content
   │     ├─ 'run-event'  → interpret() → timeline (tool start/progress…)
   │     ├─ 'attachment' → push DeckAttachment into the same assistant row
   │     ├─ 'done'       → finalize, persist responseId, mark idle
   │     └─ 'error'      → setError, mark idle
   └─ on refresh: GET /api/deck/chat/resume?sessionId=…&since=<lastSeq>
       ├─ 404 → 退化为重新拉 messages（消息已落库）
       └─ 200 → consume 同上，从 since+1 开始
```

刷新可恢复要点：

- 客户端把 `{hubKey, sessionId, lastSeq, profile, textAssistantId, …}` 写入
  `localStorage['hermesdeck.chat.inflight.v1']`（30 分钟 TTL）。
- `hubKey` ≠ `sessionId` 的情况发生在 Hermes 后续返回了 canonical session id；
  hub 仍以原始 hubKey 作 key。
- 工具调用槽（assistantId / name / args）随 inflight 一起持久化，否则刷新
  期间到达的 `function_call_arguments.delta` 会无家可归。

### 7.3 i18n

`src/lib/i18n.tsx` 提供 `useT({ zh, en })`，每个组件就近声明字典 —— 没有全局
key registry。`useLang` 用 `useSyncExternalStore` 订阅模块级单例，避免组件
间不一致。

### 7.4 Service Worker

`public/sw.js`：

- 三个版本化 cache：shell / runtime / images，单独的 LRU 上限。
- `/api/deck/cache-image` —— stale-while-revalidate（artifact 是不可变的）。
- 其它 `/api/*` —— 网络穿透；**仅当 `fetch` 抛出**时才返回 503 offline，
  以免把上游真实 5xx 误判为离线。
- 导航请求 —— 网络优先；失败回退缓存 → `/offline`。
- 静态资产 —— 网络优先 + 失败回缓存。

PWA 注册器仅在 `process.env.NODE_ENV === 'production'` 下生效；dev 模式
主动 `unregister` 残留 SW 并清空 caches，避免开发时被旧的离线响应劫持。

---

## 8. 实时终端（可选）

`src/lib/server/terminal-pty.ts`：

- **opt-in**：`HERMESDECK_LIVE_TERMINAL=1` 才启用。
- 每个 Deck session 对应一个 `tmux new-session -A -s hd-<id>`，由 `node-pty`
  fork。`tmux` 单独跑在私有 socket（`-L hermesdeck`）+ 临时 `tmux.conf`
  （隐藏 status bar / mouse on / 256color / utf8）。
- 4 类限制：
  - 全局最多 8 个 session、每 session 最多 8 个 SSE 订阅者。
  - 256KB 环形 buffer 用于重连重放。
  - 10 分钟无人订阅自动 reap PTY + tmux session。
- 子进程环境**剥离敏感变量**（`HERMES_API_KEY`、`OPENAI_API_KEY` 等），
  防止 `env | grep` 泄漏。
- tmux 控制命令（`new-window`、`kill-window`、`select-window`、`split-pane`、
  `select-pane`、`rename-window`）走严格白名单 + 受参数校验的 `execFile`。

> 即使关闭实时终端，Settings/Terminal 页仍可使用 `runTerminalAction`
> 白名单（`hermes --version` 等只读命令），始终以 `shell:false` `execFile`
> 调用，输出经 `redactSecrets` + 64KB 截断。

---

## 9. 可观测性 / 错误处理

- `src/instrumentation-node.ts` 在 Node runtime 启动时安装兜底处理器：
  把 `EPIPE`、`ECONNRESET`、`ERR_STREAM_PREMATURE_CLOSE`、`AbortError`、
  `TimeoutError` 视为 benign，仅 `console.warn`，不再让 Node v15+ 默认行为
  把 SSE 后台错误升级为进程退出。
- `redactSecrets`（[core.ts](../src/lib/server/hermes/core.ts)）覆盖
  `Authorization: Bearer …`、`api_key=…`、`sk-/xai-/gsk_/gh[posur]_/AKIA*/eyJ…`
  几类常见 token，所有从 upstream 透出的错误正文都先过它再写日志或回包。
- 路由统一返回结构化错误：`{ ok?: false, error: "<machine_code>", detail: "<200 chars>" }`
  + 合适的 HTTP 状态（502 上游失败、503 自身降级、429 限速、…）。

---

## 10. 参考阅读顺序（新读者）

1. [src/lib/types.ts](../src/lib/types.ts) —— 公共数据契约。
2. [src/lib/api.ts](../src/lib/api.ts) —— 浏览器侧 BFF 客户端。
3. [src/lib/server/hermes/index.ts](../src/lib/server/hermes/index.ts)
   + [chat-stream.ts](../src/lib/server/hermes/chat-stream.ts)
   + [stream-hub.ts](../src/lib/server/hermes/stream-hub.ts) —— BFF 核心。
4. [src/app/api/deck/chat/stream/route.ts](../src/app/api/deck/chat/stream/route.ts)
   + [chat/resume/route.ts](../src/app/api/deck/chat/resume/route.ts) —— 流入口。
5. [src/app/chat/_hooks/useChatStream.ts](../src/app/chat/_hooks/useChatStream.ts) ——
   消费侧逻辑。
6. [proxy.ts](../src/proxy.ts) + [auth.ts](../src/lib/server/auth.ts) +
   [csrf.ts](../src/lib/server/csrf.ts) —— 安全边界。

之后的细节均在 [docs/api.md](api.md)、[docs/configuration.md](configuration.md)、
[docs/development.md](development.md) 中。
