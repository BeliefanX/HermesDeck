# Development

本地开发目标：只改 HermesDeck，不改 Hermes Agent；所有运行时事实以当前代码和 Hermes Agent API Server 为准。

## Prerequisites

- Node.js 22+。
- npm dependencies：`npm install`。
- Hermes Agent API Server：default Agent 默认 `http://127.0.0.1:8642`，或用 backing profile `.env` 指定。Deck UI/BFF 可见入口仍是 `6117`。
- Python：仅用于少量 Deck-side helpers（如 config YAML validation）；不是 runtime data source。
- tmux/node-pty：仅在 `HERMESDECK_LIVE_TERMINAL=1` 时需要。

## Start

```bash
npm run dev
# open http://127.0.0.1:6117
```

`npm run dev` 会：

1. `node scripts/free-port.mjs 6118`
2. `node scripts/free-port.mjs 6117`
3. 启动 Next dev on 6118
4. 启动 6117 reverse proxy 到 6118

如果你绕过脚本直接跑 Next，请记住 6118 只是内部 target；需要自己提供 6117 可见入口或同步更新部署说明。

## Scripts

- `npm run dev`：Next dev + 6117 reverse proxy；Live Terminal 默认关。
- `npm run build`：`next build --webpack`。
- `npm start`：Next start + 6117 reverse proxy。
- `npm run typecheck`：TypeScript noEmit。
- `npm run lint`：ESLint。
- `npm run verify:pwa`：manifest/SW/icons/CSS smoke 验证。
- `npm run smoke`：构建后启动并检查核心公开页面/assets。
- `npm run smoke:wrapper`：通过 wrapper 运行 smoke。
- `npm run test:rbac`：RBAC/auth 测试。
- `npm run test:csrf`：CSRF/auth 测试。

## Code map

- `src/app/api/deck/**/route.ts`：BFF endpoints。
- `src/lib/server/hermes/core.ts`：Hermes API base/key/Agent env 解析、fetch helper、redaction、cache helper。
- `src/lib/server/hermes/profiles.ts`：API-backed Agent catalog；ordinary users 无本地枚举补齐。
- `src/lib/server/hermes/models.ts`：per-Agent `/v1/models` adapter，无本地模型清单补齐。
- `src/lib/server/hermes/tools.ts`：API-first `/v1/skills` + `/v1/toolsets` discovery；local skill index 只服务 `super_admin/local-owner` 编辑器。
- `src/lib/server/hermes/chat-stream.ts`：`/v1/runs` start + `/v1/runs/{run_id}/events` upstream SSE pump/keep-alive/text delta filtering；图片附件先归一为 attachment-annotated text prompt；chat timeout clamp 是 `[1000, 2100000]` ms。
- `src/lib/chat-timeouts.ts`：35 分钟 chat stream default/hard cap（Hermes active subagent 30 分钟 + 5 分钟余量），前端与服务端共享。
- `src/lib/server/hermes/cron.ts`：cron Agent routing proof。
- `src/lib/server/auth.ts`、`mfa.ts`、`rbac.ts`：Deck users/roles/capabilities/MFA/Agent scope（代码中 `profile`/`profileId` 是 legacy Agent runtime id）。
- `src/lib/server/deck-chat-projection.ts`：projection store lock/atomic write/prune。
- `src/lib/server/notifications.ts`、`src/lib/notification-events.ts`：Web Push chat dispatch、notification preferences/subscriptions store、page-open Cron notification helpers。
- `public/sw.js`：PWA cache policy。

## Debugging

### Auth/RBAC

- `GET /api/deck/auth/session` 查看当前用户与 capabilities。
- `POST /api/deck/auth/mfa` 承载 TOTP/passkey enrollment 与登录二阶段；proxy 必须允许它在无 session cookie 时进入 route。Route 内 login actions 校验 purpose-bound `mfaToken`，enrollment/settings actions 仍要求受保护 session；正式 `hermesdeck_session` 只能在第二因子完成后签发。
- 普通用户访问 Agent 前必须有 assignment，且不得访问未分配 Agent/default。
- catalog outage 应显示上游不可用，而不是给普通用户从本地目录补齐；不要把 catalog/health proof 缺失描述成用户无权限。`super_admin/local-owner` 本机管理面可用的 config/skills/LCM/Live Terminal 不等于 runtime fallback。

### Chat SSE

```bash
curl -N \
  -H 'Cookie: hermesdeck_session=…' \
  -H 'Origin: http://127.0.0.1:6117' \
  -H 'Content-Type: application/json' \
  http://127.0.0.1:6117/api/deck/chat/stream \
  -d '{"message":"hi","profileId":"default"}'
```

预期：先收到 `event: hub/status`，长工具调用期间每 15 秒有 `: keep-alive ...` 注释，结束时 `event: done` 或 `event: error`。当前路径是 Hermes API Server only。前端默认发送 2,100,000ms timeout；服务端最多允许 35 分钟，反代 read timeout 应大于这个值。

### Live Terminal SSE

`src/app/api/deck/term/sessions/[id]/stream/route.ts` subscribes before replay, sends `ready`/buffered `data`/`replay-end`, then `: ka` every 25s. Cleanup is idempotent: cancel, subscriber close, enqueue failure, or keepalive failure must clear the interval and call `unsubscribe()` so browser/EventSource retries do not leak subscribers or hit `Too many subscribers for this session`.

Resume：

```bash
curl -N 'http://127.0.0.1:6117/api/deck/chat/resume?sessionId=<id>&since=0' \
  -H 'Cookie: hermesdeck_session=…'
```

### Named-Agent sessions

- 未证明归属的 named-Agent continuation 应返回 `session_profile_unverified` 或 `response_profile_unverified`（legacy error name）。
- 新 named-Agent turn 如带未证明 session id，Deck 会改用 `deck_<uuid>` 并通过 `X-Hermes-Session-Id` 让 upstream/Deck projection 对齐。
- 如果看到额外 `api` 话题，先查 projection proof、`X-Hermes-Session-Id` header 与 Agent API base。
- 刷新后仍应从 projection 看到 draft assistant/tool-call/tool-result rows；普通用户只能读/证明/继续/写入自己的 owner-scoped projection，admin/super_admin 可跨 owner 但仍受 Agent auth 约束。不要逐条持久化 tool/function `arguments.delta`；只在 `arguments.done`/done item 等语义边界写 projection。
- `delegate_task` 的 background dispatch ack 与 async completion 是两种卡片：ack 标为 `Subagent dispatched`；`[ASYNC DELEGATION ... COMPLETE — deleg_<8hex>]` history marker 在 server hydration 和 visible-message selector 中归一化为 assistant-side `delegate_task` subagent result。不要改成 `role='tool'`，否则默认隐藏 tool rows 时会丢失完成结果。

### Cron

`GET /api/deck/cron?profile=<id>` 必须能确认 Agent routing。响应 profile envelope 或 row profile metadata 可证明；profileless legacy rows 只有在 Deck 证明 dedicated named-Agent API routing 时才 stamped。若返回 `profile_routing_unavailable`，升级/重启 Hermes API Server 或修正 Agent API base；不要在 Deck 里添加本地 cron 枚举。cron/jobs 属于敏感 upstream data，无 proof 仍 fail closed。

### PWA

- dev 模式 `PWARegister` 会 unregister SW；如果曾访问 production，手动在 DevTools Application 面板清理旧 SW/cache。
- 生产 SW 版本以 `public/sw.js` 的 `CACHE_VERSION` 为准，当前为 `hermesdeck-pwa-v58`。
- 验证：`npm run verify:pwa`。

### Notifications

- Web Push chat notifications require VAPID env (`HERMESDECK_VAPID_PUBLIC_KEY`, `HERMESDECK_VAPID_PRIVATE_KEY`, optional `HERMESDECK_VAPID_SUBJECT`) and HTTPS/localhost secure context.
- Settings owns permission/subscription UX. `/api/deck/notifications/*` routes require Deck auth; writes are guarded by CSRF/same-origin.
- Chat complete/failed is server-side Web Push and may fire after the chat tab closes. Cron notifications are page-open only and use `new Notification(...)`; do not add docs implying closed-page Cron support.
- Focused tests: `node --experimental-strip-types --test tests/notifications.test.mjs tests/notification-events.test.mjs`。

### MFA

- TOTP code/secret 使用 Node `crypto`；`qrcode` 仅用于 server-side QR data URLs。不要为 Base32/TOTP 引入额外依赖。
- WebAuthn/passkey server verification 使用 SimpleWebAuthn；不要手写 COSE/CBOR/signature 验证。
- 关键回归在 `npm run test:rbac`：MFA 登录不提前发 session、fresh pre-auth token 不能重置 TOTP 限速、WebAuthn challenge id 不能充当 password-MFA token。

## Documentation rules

更新文档时请同时检查：

- 不出现把本地数据库、Hermes CLI、本地 profile/model 枚举描述为运行时数据路径的内容。
- 不把 Deck user/account 与 Hermes Agent profile 混用；用户可见文案用 Agent/账号/用户，API 字段 `profile`/`profileId` 仅按 legacy/compat Agent runtime id 说明。
- 端口叙述必须是：6117 可见入口，6118 内部 Next/proxy target。
- PWA cache 必须强调不缓存受保护认证 HTML/API 响应。
- Agent catalog/models/cron proof 必须 API-backed 且 fail-closed；tools discovery 优先 `/v1/skills` + `/v1/toolsets`，local skill index/raw file 只属于 `super_admin/local-owner` 编辑器。

## Pre-merge verification

```bash
node --test tests/chat-stream-runtime-settings.test.mjs
node --test tests/tool-call-linking.test.mjs
node --test tests/chat-projection-draft-ui.test.mjs
npm run typecheck -- --pretty false
npm run lint
npm run verify:pwa
npm run test:rbac
npm run test:csrf
```

文档-only 改动至少跑 `typecheck`、`lint`、`verify:pwa`，并用搜索确认无陈旧词。
