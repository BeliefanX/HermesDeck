# 配置参考

> 配置入口：`.env.local` 优先于 `~/.hermes/.env`，再回退到内置默认值。
> 本页列出全部可用的环境变量、外部依赖、运行期文件以及它们的默认行为。

---

## 1. 环境变量

> 完整模板见 [.env.example](../.env.example)。

### 1.1 Hermes 连接

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `HERMES_API_BASE` | `http://127.0.0.1:8642`（可被 `~/.hermes/.env` 的 `API_SERVER_PORT` / `HERMES_API_SERVER_PORT` / `HERMES_API_BASE` 覆盖） | Hermes API Server 根 URL，所有聊天流都发到 `${HERMES_API_BASE}/v1/responses`。 |
| `HERMES_API_KEY` / `API_SERVER_KEY` | 同左 | Bearer token；当存在时所有 API Server 请求加 `Authorization: Bearer …`。 |
| `HERMES_DASHBOARD_BASE` | `http://127.0.0.1:9120` | Dashboard 根 URL，仅作 `/api/deck/health` 探活用。 |

`~/.hermes/.env` 也会被 `core.ts` 读入，以便操作员只在 Hermes 端维护一份
连接参数（`.env.local` 仍然优先）。

### 1.2 HermesDeck 服务器

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `HERMESDECK_PUBLIC_ORIGIN` | _（未设置）_ | 生产环境必须设置。逗号分隔的允许 origin 列表，写路由的同源校验靠它。例：`https://deck.example.com,https://deck-internal.example.com`。 |
| `HERMESDECK_TRUST_PROXY` | `0` | 设为 `1` 时登录路由按 `X-Forwarded-For` / `X-Real-IP` 取客户端 IP（仅限确实有反代剥离这些头的场景）。 |
| `DECK_DEV_ORIGINS` | `localhost,127.0.0.1,0.0.0.0` | `next dev` 允许的跨源访问列表。`next.config.js` 还会自动加入所有非 loopback 的 IPv4，便于手机直连。 |
| `HERMESDECK_FORCE_SECURE_COOKIE` | _（未设置）_ | 当反代终止 TLS、上游为 HTTP 时设 `1`，强制把会话 cookie 写为 `Secure`。 |
| `HERMESDECK_SESSION_SECRET` | _自动生成_ | HMAC 签名密钥；首次启动若 `~/.hermesdeck/auth.json` 不存在会随机生成 32 字节。一般无需手动设置。 |
| `LANG` | `en_US.UTF-8` | 仅当 Live Terminal 用到，避免 zsh 默认 C locale 丢失多字节输入。 |

### 1.3 实时终端

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `HERMESDECK_LIVE_TERMINAL` | `0`（`npm run dev` / `npm start` 通过 `package.json` 默认关闭） | 设为 `1` 才启用 PTY 路由 + tmux 会话。安全敏感部署建议保持关闭。 |
| `HERMESDECK_TMUX_BIN` | `tmux` | tmux 可执行文件路径，自定义编译时使用。 |
| `HERMESDECK_TERMINAL_ENV_PASSTHROUGH` | _（未设置）_ | `terminal-pty.ts` 默认从子进程环境剥掉一组敏感变量；该项预留给将来主动添加白名单变量。 |

### 1.4 PWA 与端口

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `LEGACY_PORT` | `6117` | `scripts/redirect-6117.mjs` 监听端口；EADDRINUSE 时直接退出 0。 |
| `CANONICAL_PORT` | `6118` | 重定向目标端口。 |

> 端口 6118 由 `package.json` 的 `dev`/`start` 脚本通过 `node
> scripts/free-port.mjs 6118` 强制释放后启动。`free-port.mjs` 不会杀掉
> 不属于当前 uid 的进程。

---

## 2. 外部依赖

### 2.1 系统命令

| 命令 | 用途 | 必需性 |
| --- | --- | --- |
| `python3` | `runPython` 调度全部 sqlite 与 Hermes 内部模块查询 | 必需 |
| `hermes` | 通过 `execFile` 调用 `--version` / `profile` / `tools` / `skills` / `auth list` | 必需 |
| `tmux` | 实时终端会话管理 | 仅在 `HERMESDECK_LIVE_TERMINAL=1` 时必需 |
| `lsof` / `ps` | `scripts/free-port.mjs` 释放占用端口 | 启动脚本必需 |

### 2.2 Node 包

`postinstall` 钩子运行 [scripts/fix-pty-helper.mjs](../scripts/fix-pty-helper.mjs)，
为 `node-pty` 的预编译 `spawn-helper` 二进制补 `chmod 0755`，并在 macOS
上去掉 `com.apple.quarantine` xattr —— 没有这一步，App Store 安装的 Node
会让 `pty.fork()` 静默失败。

`pdf-parse`、`mammoth`、`node-pty` 三个包带 native / 文件系统依赖，
`next.config.js` 把前两个加进 `serverExternalPackages`（让 Next 在 server
runtime 直接 `require` 它们的 CJS 入口而不是打包进 NFT）。

---

## 3. 运行期文件

### 3.1 `~/.hermesdeck/`（本应用）

| 文件 | 描述 |
| --- | --- |
| `auth.json` | 单用户凭据 + `sessionSecret`，scrypt 哈希。mode 600。 |

第一次启动时如果不存在，会自动创建并把一次性 admin 密码打到 stdout。
不会把这个密码写回任何文件 / log。

### 3.2 `~/.hermes/`（Hermes 状态目录）

> HermesDeck **只读** state.db / config.yaml / skills；删除 session 时会
> 写 state.db。其余 Hermes 状态保持原样。

```
~/.hermes/
├─ .env                # HermesDeck 也会解析这份做 fallback
├─ config.yaml         # default profile 的配置（model.default、agent.reasoning_effort）
├─ state.db            # default profile 的 sqlite
├─ skills/             # 全局 skills 树（HermesDeck 在线编辑 SKILL.md 用）
├─ cache/              # /api/deck/cache-image 暴露的二进制目录
└─ profiles/<id>/
   ├─ config.yaml      # 该 profile 的 model/auth/etc
   ├─ state.db         # 独立 sqlite
   └─ skills/          # （目前 HermesDeck Tools 页只展示全局 skills）
```

预期的 sqlite 表（HermesDeck 兼容老 / 新 schema 字段）：

- `sessions(id|session_id, source, model, title?, prompt?, created_at?,
  updated_at?, started_at?, ended_at?, message_count?, total_messages?,
  parent_session_id?, billing_provider?, input_tokens?, output_tokens?,
  cache_read_tokens?, cache_write_tokens?, reasoning_tokens?,
  actual_cost_usd?, estimated_cost_usd?, api_call_count?)`
- `messages(id, session_id|conversation_id, role|speaker, content|message,
  tool_name?, tool_call_id?, tool_calls?, timestamp|created_at?)`

字段不存在时由 BFF 自适配（见
[src/lib/server/hermes/sessions.ts](../src/lib/server/hermes/sessions.ts) 与
[runs.ts](../src/lib/server/hermes/runs.ts) 中的 `cols`/`mcols` 探测）。

### 3.3 浏览器存储

HermesDeck 在浏览器写多份 `localStorage` key；它们都按 profile 命名
空间隔离（除明确说明外）。

| Key | 用途 |
| --- | --- |
| `hermesdeck-theme` | 主题：`dark` / `light` |
| `hermesdeck-lang` | 语言：`zh` / `en` |
| `hermesdeck-sidebar-collapsed` | 桌面 sidebar 折叠 |
| `hermesdeck.active-profile.v1` | 当前激活 profile |
| `hermesdeck.chat.v1.<profile>` | 聊天主缓存：sessions / messages / responseIds / active |
| `hermesdeck.chat.panels.v1` | 聊天页左 / 右栏可见性 |
| `hermesdeck.chat.sourcefilter.v1` | 来源过滤白名单 |
| `hermesdeck.chat.show-subagents.v1` | 是否展示子代理会话 |
| `hermesdeck.chat.show-tool-details.v1` | 是否在主线程展示工具调用 |
| `hermesdeck.session.meta.v1` | pin / folder / archive / tag / customTitle |
| `hermesdeck.chat.inflight.v1` | 刷新可恢复的流元数据（30 分钟 TTL） |

> 同时由 Service Worker 维护若干 cache：`hermesdeck-pwa-v8-{shell,
> runtime, images}`。Settings 页提供「清除 HermesDeck 缓存」按钮，会一并
> 清空上述 localStorage + 触发 SW caches 的删除。

---

## 4. Next.js 安全头

`next.config.js` 在所有路径下追加：

```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Cross-Origin-Opener-Policy: same-origin
```

`/api/deck/cache-image` 单独发 `Cache-Control: private, max-age=86400,
immutable`，并且对 SVG 强制 `Content-Disposition: attachment`。

---

## 5. 默认行为速查

- 未配置 `HERMES_API_BASE` → 用 `http://127.0.0.1:8642`，BFF 健康检查会标
  `degraded` 但 CLI fallback 仍可工作。
- 未配置 `HERMES_API_KEY` → 不发 `Authorization`。Hermes API Server 可在
  本地 0-credential 部署模式下使用。
- 未提供 Hermes CLI（`hermes` 不在 PATH） → `health.version` 显示
  `Hermes (… version unavailable)`，`profiles` / `tools` / `terminal/run`
  返回 502 + `detail`。
- 未启用实时终端 → `/api/deck/term/*` 全部 400；UI 终端页改为只展示安全
  Action 入口。

---

## 6. 安全配置 checklist（生产环境）

1. 反代到 HTTPS，把 HTTP 到 6118 仅暴露在内网。
2. 设置 `HERMESDECK_PUBLIC_ORIGIN=https://your-host`，确保写路由的
   `Origin/Referer` 校验有依据。
3. 反代后端为 HTTP 时设置 `HERMESDECK_FORCE_SECURE_COOKIE=1`。
4. `HERMESDECK_TRUST_PROXY=1` 仅在反代真的剥离/重写 `X-Forwarded-For`
   时启用，否则登录限速会被伪造 IP 绕过。
5. 启动后立刻登录、改密；改密会自增 `passwordVersion`，所有旧 cookie
   立即失效。
6. 如不需要 PTY，设 `HERMESDECK_LIVE_TERMINAL=0`，并保持 `tmux` /
   `node-pty` 无害（即使没装也不会启动）。
7. 检查 `~/.hermesdeck/auth.json` 是否仍是 `mode 600`、属主是当前用户。
