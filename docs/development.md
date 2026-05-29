# 开发指南

> 适用于贡献者和需要在本机调试 HermesDeck 的运维人员。所有命令默认在仓
> 库根目录执行（`cd ~/HermesDeck`）。

---

## 1. 环境要求

| 工具 | 推荐版本 | 备注 |
| --- | --- | --- |
| Node.js | ≥ 22 LTS | Next.js 16 + React 19 要求 ESM、`fetch`、`AbortSignal.any`（≤22.x 已自带） |
| npm | 与 Node 同梱 | `package-lock.json` 严格锁版本 |
| Python | ≥ 3.10 | `runPython` 嵌入脚本里只用标准库（`sqlite3` / `json` / `pathlib` / `datetime`） |
| Hermes CLI | latest | `hermes profile` / `tools` / `skills` / `auth` 必须可用 |
| tmux | ≥ 3.2（仅 Live Terminal） | 仅在 `HERMESDECK_LIVE_TERMINAL=1` 时需要 |

可选：

- **iOS Simulator / Android Emulator** —— 验证移动端布局；生产 PWA 安装
  需要 HTTPS（`/offline` 与 SW 在 `localhost` 也能装）。
- **Chrome DevTools Application 面板** —— 检查 SW、Manifest、Cache。

---

## 2. 安装与首启

```bash
git clone <repo> ~/HermesDeck
cd ~/HermesDeck

npm install                 # postinstall 会自动修 node-pty 的 spawn-helper
cp .env.example .env.local  # 至少填 HERMES_API_BASE / HERMES_API_KEY

npm run dev                  # http://localhost:6118
# 同时 6117 → 6118 的 301 redirect 也会被起来（兼容旧 PWA 安装）
```

第一次启动会在 stdout 打印一段 banner：

```
═══════════════════════════════════════════════════════
 HermesDeck first-run bootstrap
 Username: admin
 Password: <random 24-char base64url>

 Sign in once and change the password from Settings.
 This banner will not be shown again.
═══════════════════════════════════════════════════════
```

输入这对凭据登录，到 **Settings → Account** 改成自己的用户名 / 密码（旧
cookie 会因 `passwordVersion` 自增立刻失效）。

---

## 3. 常用命令

<a id="scripts"></a>

### 3.1 npm 脚本

| 命令 | 行为 |
| --- | --- |
| `npm run dev` | `free-port 6118` → `next dev -H 0.0.0.0 -p 6118` + 6117 重定向 helper。`HERMESDECK_LIVE_TERMINAL` 默认 `0`。 |
| `npm run build` | `next build --webpack`（生成 `.next/`）。 |
| `npm start` | 同 `dev` 流程，但用 `next start --start`，跑生产构建。 |
| `npm run typecheck` | `tsc --noEmit`。CI / 提交前必跑。 |
| `npm run lint` | `eslint .`，规则见 `eslint.config.mjs`。 |
| `npm run verify:pwa` | 静态检查 `manifest.ts` / `sw.js` / icons / `globals.css` 关键 token。 |

### 3.2 直接调用 Next

调试某个端口或单独以 production 跑：

```bash
PORT=6200 npx next dev -H 0.0.0.0 -p 6200
```

注意：自定义端口走不到 `redirect-6117.mjs`，旧 PWA 安装将无法回流。

### 3.3 释放端口

```bash
node scripts/free-port.mjs 6118     # 不会杀别人 uid 的进程
```

---

## 4. 目录速查

```
src/
├─ app/                  # Next App Router 路由 + 页面 + API 路由
│  ├─ chat/              # 聊天页（_components / _hooks / _lib 拆分）
│  ├─ api/deck/          # BFF：详见 docs/api.md
│  ├─ login/  offline/   # 鉴权与 PWA 降级
│  └─ ...                # profiles/ runs/ tools/ terminal/ settings/
├─ components/           # 跨页组件（AppShell、Brand、SkillEditor、…）
├─ lib/
│  ├─ api.ts             # 浏览器 fetch 封装
│  ├─ types.ts           # 公共契约
│  ├─ client-sse.ts      # SSE 解析 + stall watchdog
│  ├─ profile-context.tsx
│  ├─ i18n.tsx
│  ├─ session-meta.ts
│  ├─ timeline.ts
│  ├─ format.ts
│  ├─ attachments.ts
│  ├─ prompts.ts
│  └─ server/            # Node-only 实现
│     ├─ auth.ts  csrf.ts  run-python.ts  terminal-pty.ts
│     └─ hermes/         # Hermes 集成（index.ts 是稳定门面）
├─ proxy.ts              # Next 16 proxy（auth gate）
└─ instrumentation*.ts   # 进程级 unhandled error 兜底
```

详见 [docs/architecture.md](architecture.md)。

---

## 5. 调试技巧

### 5.1 浏览器侧

- **打开命令面板**：`⌘K` / `Ctrl+K`（顶栏搜索框是面板入口）。
- **切 profile**：顶栏 ProfileChip。所有页面会重新加载该 profile 数据；
  ChatPage 会按 profile 命名空间从 `localStorage` 重水化。
- **切语言**：顶栏 EN/中按钮，存 `localStorage['hermesdeck-lang']`。
- **关闭 SW**：DevTools → Application → Service Workers → Unregister。dev
  模式 `<PWARegister>` 已经会自动 unregister，但本地访问过 prod 后值得手
  动确认。

### 5.2 服务端侧

- **看 SSE 帧**：`curl -N`：

  ```bash
  curl -N -H 'Cookie: hermesdeck_session=…' \
       -H 'Origin: http://localhost:6118' \
       -H 'Content-Type: application/json' \
       http://localhost:6118/api/deck/chat/stream \
       -d '{"message":"hi","profileId":"default"}'
  ```

- **resume 测试**：把上面的 `sessionId` 抓出来，然后：

  ```bash
  curl -N "http://localhost:6118/api/deck/chat/resume?sessionId=<id>&since=0"
  ```

  返回 404 表示 hub 已驱逐（done 后保留 10 分钟）。

- **查看缓存命中**：`makeCache` 没有专门的 metrics；改 TTL 时把
  `console.warn('[cache] miss', ...)` 临时加进 fetcher 即可。

- **Python 失败排查**：所有路由错误都带 `detail`，直接 curl 看返回；典型
  原因：`python_not_found`（PATH 缺）/ `python_timeout`（state.db 大）/
  `python_parse_failed`（脚本里 `print` 了非 JSON）。

- **CLI fallback 验证**：临时停掉 Hermes API Server，发一条不带图片的
  消息 —— 应该看到 `event: status, phase: fallback-cli`，再看 `delta` 是
  否仍能流出。

### 5.3 终端 / PTY

- 启用：`HERMESDECK_LIVE_TERMINAL=1 npm run dev`。
- 检查 tmux：`tmux -L hermesdeck list-sessions`。
- 单 session 限制：8 个；订阅者每 session 8 个。可以同时打开多个标签页
  验证重放 + 实时数据。
- 输入 ≥ 256 字节会写一行审计日志：`[pty-audit] session=<id> bytes=…
  head=<32 bytes safe>`。

### 5.4 节点错误兜底

`src/instrumentation-node.ts` 把 SSE 后台路径的 `EPIPE` /
`ERR_STREAM_PREMATURE_CLOSE` / `AbortError` / `TimeoutError` 视为 benign，
只 `console.warn`。需要还原为 Node 默认行为时把 `installOnce` 注释掉。

---

## 6. 测试与验证

仓库目前没有单测套件；推荐的「最小验证流程」：

```bash
npm run typecheck -- --pretty false
npm run lint
npm run build
npm run verify:pwa

# 起服务并做端到端冒烟
npm start &

# 健康面
curl -fsS http://127.0.0.1:6118/api/deck/health
curl -fsS http://127.0.0.1:6118/api/deck/profiles
curl -fsS http://127.0.0.1:6118/api/deck/tools
curl -fsS http://127.0.0.1:6118/api/deck/runs
```

PWA 验证（任选其一即可）：

```bash
curl -I http://127.0.0.1:6118/manifest.webmanifest
curl -I http://127.0.0.1:6118/sw.js
```

DevTools Console 内：

```js
fetch('/manifest.webmanifest').then(r => r.json())
fetch('/sw.js').then(r => r.status)
isSecureContext   // localhost / HTTPS 下应为 true
'serviceWorker' in navigator
```

---

## 7. 常见排错

### 7.1 `next dev` 成功但页面空白 / 接口被拦

跨域被 Next 拒绝：把所在地址加进 `DECK_DEV_ORIGINS`，或确认
`next.config.js` 自动发现的 LAN IPv4 是不是当前网卡。

### 7.2 登录页一直回跳

最常见是反代后端走 HTTP 但浏览器是 HTTPS，`Set-Cookie` 没带 `Secure` 被
丢弃。设 `HERMESDECK_FORCE_SECURE_COOKIE=1`。

### 7.3 Live Terminal 黑屏 / 无响应

- `HERMESDECK_LIVE_TERMINAL` 必须是 `1`。
- `node_modules/node-pty/prebuilds/<platform>/spawn-helper` 是否存在且
  有 +x（`postinstall` 应自动修，仍可手动 `chmod 0755`）。
- `tmux -L hermesdeck list-sessions` 是否能列出会话；不能则进程被 OS
  杀（资源限制）或 tmux 二进制不在 PATH（设 `HERMESDECK_TMUX_BIN`）。

### 7.4 上传 PDF/DOCX 报 415

只识别 `application/pdf` / `*.pdf` / `*.docx` / Office mime。其它格式
HermesDeck 不解析；可以让前端把这些当作 `text` 类附件预先读取。

### 7.5 聊天刷新后看不到「正在输出」

- `localStorage['hermesdeck.chat.inflight.v1']` 是否还在？30 分钟 TTL；
  超过就走 messages 端点拉持久化结果。
- Hub 是否还活着？hub 在 `done` 后保留 10 分钟；超时则 `/resume` 返回
  404，前端会回退到 messages 端点。
- `ngrok` / 严格反代是否吃掉了 `text/event-stream` 的帧？
  `X-Accel-Buffering: no` 是默认下发的，但部分 CDN 仍会缓冲；用
  `curl -N` 直接打 BFF 验证。

---

## 8. 编码约定

- **TypeScript strict**：禁用 implicit any、`noUncheckedIndexedAccess`
  等隐式行为；把所有可空字段标 `?:`。
- **避免 `any`**：必要时用 `unknown` + 显式 narrow（`isObj` / 字段断言）。
- **路由 → service 单向**：Route Handler 只做 IO 校验、签名校验、错误
  包装，业务逻辑全部在 `src/lib/server/hermes/*` 里。
- **错误形态统一**：抛 `Error`，由路由层包成 `{ error, detail }` JSON +
  恰当 HTTP 状态。
- **缓存 / 分页 / 截断显式化**：所有上游调用必须有 `timeout`，所有
  `runPython` 必须给 `maxBuffer`。
- **Python 内嵌脚本**：保持纯标准库，避免任何依赖。每段脚本以 `print(json.dumps(...))`
  结尾，由 `runPython` 解析。
- **i18n**：每个组件就近声明 `useT({ zh, en })`，不要把 string 放到全局
  registry。
- **设计 token**：UI 一律使用 `src/components/Brand.tsx` 的原语（`Page`、
  `Card`、`Btn`、`Tag`、`Chip`、`MetricCard`、`SectionHead`、`Kicker`、
  `Kbd`、`BarRow`、`Sparkline`、`MetricCard`），不要在页面里直写颜色。
- **ESLint**：`react/no-unescaped-entities` 关闭、`@next/next/no-img-element`
  warning、`react-hooks/exhaustive-deps` warning。
