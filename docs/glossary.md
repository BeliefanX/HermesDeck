# 术语表

> HermesDeck 同时面向 Hermes 用户、运维与前端贡献者；下面把跨场景的关
> 键概念集中说明，避免文档间口径漂移。

---

## A. Hermes 概念

### Profile / 配置档案

> Hermes 的执行上下文单元。

- 默认 profile 把状态库放在 `~/.hermes/`；命名 profile 在
  `~/.hermes/profiles/<id>/`。
- 每个 profile 拥有独立的 `state.db`、`config.yaml`（model.default、
  base_url、agent.reasoning_effort 等）以及可选的 `skills/` 目录。
- HermesDeck 通过 `hermes profile show` / `profile list` 拉列表，再读
  各 profile 的 `state.db` 聚合 sessionCount / lastActiveAt。
- 前端用全局的 `ProfileContext` 持有当前激活 id，并写入
  `localStorage['hermesdeck.active-profile.v1']`。

### Provider / Model

- Provider：例如 `openai-codex`、`anthropic`、`gemini`、`ollama-cloud`、
  `openrouter`、`bedrock`、`azure`。 `hermes auth list` 决定哪些 provider
  有可用凭据。
- Model：在指定 provider 下的具体模型 id；HermesDeck 会合并
  - `provider_model_ids(provider)` —— provider 内可调用模型；
  - `state.db` 里历史使用过的模型；
  - `config.yaml` 的默认模型。
  返回 `available` / `used` 标记，UI 只展示 used + 默认两类。

### Session / 会话

- Hermes 的会话行（`sessions` 表）。每个 session 隶属唯一 profile。
- HermesDeck 把无消息的 ghost session 过滤掉、对没有 title 的会话用首条
  user message 反推 fallback title。
- 通过 `parent_session_id` 与 `child_count` 表示子代理关系（subagent）。

### Run / 运行

- **HermesDeck 派生概念**，不是 Hermes 一等对象。
- 把同一 session 的消息序列按「user 行」切分：每条 user 消息开启一个 run，
  到下一条 user 消息或 session 结束为止。
- run id：`run::<profile>::<sessionId>::<idx>`，老格式 `run_<profile>_<sid>_<idx>`
  仍兼容。
- 状态由 reply / tool 行推断：assistant 收到文本即 success，tool 行内容
  以 `error` 开头则 failed，user 后面没出现 reply 则 running。

### Source / 来源

- session 行上的 `source` 字段，标识这条会话是从哪个渠道发起的。
- HermesDeck Web 发起的会话写为 `hermesdeck`（参见
  `tagSessionSource`）。其它常见值：`api_server`、`telegram`、
  `whatsapp`、`imessage`、`slack`、`cron`、`webui`、`hermes`。
- UI 在 [src/lib/format.ts](../src/lib/format.ts) 提供统一 tone 映射。

### Toolset / Skill / MCP

- **Toolset**：Hermes 内建的工具组（`web`、`browser`、`terminal`、
  `code_execution`、`file`、`vision`、`memory`、`messaging` 等），通过
  `hermes tools list` 暴露。
- **Skill**：基于 Markdown 的「技能描述」，存在 `~/.hermes/skills/<category>/<name>/SKILL.md`。
  HermesDeck Tools 页允许就地编辑。
- **MCP server**：由配置文件加载的外部 MCP 进程；`tools list` 在
  `MCP servers:` / `Plugin:` 段下列出。

### Trace / 事件

- Hermes API Server `/v1/responses` 流式返回的事件（OpenAI Responses
  shape）。HermesDeck 透传到 SSE `run-event` 帧。
- 在前端经 `lib/timeline.ts:interpret()` 折叠为 status / tool / message /
  done / error 五类时间线 item。

### Reasoning effort

- `agent.reasoning_effort` 可选 `auto` / `low` / `medium` / `high`，对应
  `/v1/responses` 请求的 `reasoning.effort`。
- HermesDeck 聊天 composer 暴露此字段，缺省读 profile 默认。

---

## B. HermesDeck 概念

### BFF（Backend-for-Frontend）

- HermesDeck 的服务端层：Next App Router 的 `src/app/api/deck/*` 路由 +
  `src/lib/server/*` 实现。
- 前端只面对 `/api/deck/*` 的契约；任何 Hermes 字段差异、CLI 抖动、
  state.db schema 变化都被 BFF 吸收。

### Stream Hub

- 服务端进程内的 SSE 重放总线（`src/lib/server/hermes/stream-hub.ts`）。
- 把上游 fetch 的事件按 `nextSeq` 写入 ring buffer（≤4000）；订阅者用
  `?since=<seq>` 重连 / 续播。
- done 后保留 10 分钟用于慢刷新；同 sessionId 上新请求会让旧 stream
  `abort('superseded')`。

### Hub key vs Session id

- **Hub key**：客户端首次 POST 时自己生成的本地 id（`pending_<rand>`）。
  Stream Hub 永远以它做主键。
- **Session id**：Hermes API Server 在 `X-Hermes-Session-Id` 头返回的
  canonical id。客户端会在收到时把 `messages[hubKey] → messages[sid]`
  迁过去，但向 BFF 发的 resume 请求仍用 hub key。

### Local-only Metadata

- 所有 pin / folder / archive / tag / 自定义标题、source filter、字段都
  写在浏览器 `localStorage`，**不会**写回 Hermes。
- 删除 session 时 UI 文案区分：
  - **Remove Deck metadata only** —— 仅删本地 metadata；
  - **Delete from Hermes history** —— 调 `DELETE /api/deck/sessions/[id]`，
    彻底清掉 Hermes state.db 中的 session + messages。

### Inflight（聊天恢复）

- `localStorage['hermesdeck.chat.inflight.v1']` 记录当前正在 stream 的
  `{hubKey, sessionId, lastSeq, profile, textAssistantId, toolCalls, …}`。
- 30 分钟 TTL；超过即丢弃，刷新后退化为重新拉 messages。

### Active Stream / Subscriber

- `ActiveStream`：Stream Hub 的内部条目，含 buffer / nextSeq / subscribers /
  abort / evictTimer。
- `Subscriber`：实现 `(ev: HubEvent) => void`，由 `buildSubscriberStream`
  创建并写入 SSE controller。

### Tone / Source tone

- UI 颜色 token 集合：`default | accent | green | yellow | red | cyan`。
- `format.ts:sourceTone` 把 source 映射成 tone，再喂 `<Tag variant>` /
  `<Chip tone>`，避免到处写颜色字面值。

### Slash command

- 聊天 composer 输入区以 `/` 起头时弹出的命令面板（[lib/prompts.ts](../src/lib/prompts.ts)）。
- 两类：
  - `prompt`：插入模板，`{cursor}` 标定光标位置。
  - `action`：触发控制面动作（new / clear / regen / stop）。

### Command palette

- 顶栏搜索框（⌘K / Ctrl+K）打开的全局命令面板，组件
  [src/components/CommandPalette.tsx](../src/components/CommandPalette.tsx)。
- 通过派发 `window.dispatchEvent(new CustomEvent('hermesdeck:open-palette'))`
  唤起，AppShell 顶栏与移动 app-bar 的搜索按钮均触发同一事件。

### Live Terminal vs Terminal Action

- **Terminal Action**（[hermes/terminal.ts](../src/lib/server/hermes/terminal.ts)）：
  白名单内的只读 / 信息类命令，输出截断到 64KB 并经 `redactSecrets`。
- **Live Terminal**（[server/terminal-pty.ts](../src/lib/server/terminal-pty.ts)）：
  tmux + node-pty，给登录用户实际 shell。可选启用，开启后即拥有该用户全
  部权限。

### CSRF / Same-Origin Guard

- `guardMutating` 是写路由的统一拦截：先 `requireAuth` 再 `isSameOrigin`。
- `isSameOrigin` 校验 `Origin` 或 `Referer` 命中 `HERMESDECK_PUBLIC_ORIGIN`
  / loopback / dev 模式下的 RFC1918。

### `redactSecrets`

- [core.ts](../src/lib/server/hermes/core.ts) 中的字符串过滤器。
- 覆盖：`Bearer …`、`api_key=…`、`sk-` / `xai-` / `gsk_` /
  `gh[posur]_` / AWS access key、JWT eyJ… 段等。所有从 upstream
  返回的 stderr / 错误正文写日志或回包前都先过它。

### `runPython`

- `src/lib/server/run-python.ts`：`python3 -c <inline script>` 的统一封装。
- 失败枚举：`python_timeout` / `python_not_found` /
  `python_output_too_large` / `python_parse_failed` / 其它。
- 每段脚本都以 `print(json.dumps(...))` 结尾、由调用方直接 `JSON.parse`。

---

## C. 前端 / UI 术语

### AppShell

- [src/components/AppShell.tsx](../src/components/AppShell.tsx)：顶层布局
  框架，提供桌面 sidebar、桌面 topbar、命令面板挂载、移动 app-bar、
  移动底部 nav 与「更多」抽屉。
- `data-route=...` 让 chat / 其它路由的 CSS 能差异化处理 full-bleed 与
  global topbar 的合并。

### ProfileChip

- AppShell 顶栏与移动 app-bar 共用的 profile 切换胶囊；点开是一个内嵌
  弹窗（`InlineDialog`）。在 `/tools` `/settings` `/terminal` 等不读
  profile 的页面隐藏。

### Brand primitives

- 设计系统组件：`Page` / `Card` / `Btn` / `Tag` / `Chip` / `MetricCard`
  / `BarRow` / `Sparkline` / `Kbd` / `Kicker` / `SectionHead` / `ListRow`。
- 全部用 CSS 变量驱动主题，data-theme 切换零重建。

### Lang switch (`useT`)

- [src/lib/i18n.tsx](../src/lib/i18n.tsx) 提供的小型 i18n 框架。
- 没有全局 key registry：每个组件就近声明 `useT({ zh, en })`。
- 服务端 SSR 永远返回默认语言（`zh`），客户端首次 mount 后再切到
  localStorage 偏好；该一帧的语言闪烁与主题闪烁同样的取舍。

### Chat panes

- 聊天页布局有三栏（[src/app/chat/_components/ChatLayoutView.tsx](../src/app/chat/_components/ChatLayoutView.tsx)）：
  - **Sessions sidebar**：左栏会话索引，可折叠 / 隐藏。
  - **Thread**：中央消息流。
  - **Timeline / Inspector**：右栏运行时间线与上下文 inspector，可折叠。
- 折叠状态写入 `hermesdeck.chat.panels.v1`。

### Source filter

- 聊天 sidebar 的胶囊：选中后只展示 source 命中白名单的 session。
- 持久化在 `hermesdeck.chat.sourcefilter.v1`。

### Subagent toggle

- Hermes 的子代理会话会出现在 sessions 列表里；默认折叠（`showSubagents=false`）。
- 持久化在 `hermesdeck.chat.show-subagents.v1`。

### Tool details toggle

- 主线程是否展示 `tool` / 工具调用 raw JSON 行；默认关闭。
- 持久化在 `hermesdeck.chat.show-tool-details.v1`。

---

## D. PWA 术语

### Manifest

- 由 [src/app/manifest.ts](../src/app/manifest.ts) 动态生成 `/manifest.webmanifest`。
- `display: standalone`，`start_url: /chat?source=pwa`，并暴露两个 launch
  shortcut（New chat / Safe terminal）。

### App shell

- Service Worker 在 install 阶段预缓存的关键路由集合：`/`、`/chat`、
  `/profiles`、`/runs`、`/tools`、`/terminal`、`/settings`、`/offline`、
  `/manifest.webmanifest`。

### Offline fallback

- 任何导航请求失败时，SW 先查 runtime cache，再回退到 `/offline`
  ([src/app/offline/page.tsx](../src/app/offline/page.tsx))。
- API 请求失败合成 `503 { ok:false, offline:true, error:'offline' }`，
  浏览器 `lib/api.ts` 把它映射成 `OfflineError`。

### LRU caches

- `hermesdeck-pwa-v8-shell` —— 不限量；
- `hermesdeck-pwa-v8-runtime` —— 上限 40；
- `hermesdeck-pwa-v8-images` —— 上限 60，对应
  `/api/deck/cache-image`，stale-while-revalidate。

### `<PWARegister>`

- 客户端组件 [src/components/PWARegister.tsx](../src/components/PWARegister.tsx)。
- 仅在 `NODE_ENV === 'production'` 注册 `/sw.js`；dev 模式主动 unregister
  并清空 caches。
- 检测到新 SW 安装完成后弹出更新提示，由用户主动点击才 reload，避免打断
  正在 streaming 的对话。

---

## E. 其它

### `OfflineError` / `ApiError`

- [src/lib/api.ts](../src/lib/api.ts) 暴露的两个错误类。
- `ApiError`：`{ status, body, message }`，UI 可分支处理 401 / 502 / 503。
- `OfflineError`：SW 合成的 503 + `{ offline: true }`，或 fetch 抛错。

### `relTime`

- [src/lib/format.ts](../src/lib/format.ts) 中的相对时间格式化（`刚刚` /
  `5m ago` / `2h ago` / 日期）。所有「最近活跃」「上次使用」类字段都通过
  它显示，确保格式一致。

### `state.db`

- Hermes 的 sqlite 状态库；HermesDeck 几乎所有数据都从这里聚合。
- 表结构在不同 Hermes 版本间会变（`timestamp` ↔ `created_at`、`session_id`
  ↔ `conversation_id`），BFF 在每次查询里探测可用列名。

### `~/.hermes` vs `~/.hermesdeck`

- `~/.hermes` —— Hermes 主仓状态目录。HermesDeck 只读它（删除 session
  时会写）。
- `~/.hermesdeck` —— HermesDeck 自己的小目录，目前只放 `auth.json`（mode
  600）。
