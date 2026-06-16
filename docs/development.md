# Development

本地开发目标：只改 HermesDeck，不改 Hermes Agent；所有运行时事实以当前代码和 Hermes Agent API Server 为准。

## Prerequisites

- Node.js 22+。
- npm dependencies：`npm install`。
- Hermes Agent API Server：default profile 默认 `http://127.0.0.1:6117`，或用 env/profile `.env` 指定。
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
- `src/lib/server/hermes/core.ts`：Hermes API base/key/profile env 解析、fetch helper、redaction、cache helper。
- `src/lib/server/hermes/profiles.ts`：API-backed profiles catalog，无本地枚举补齐。
- `src/lib/server/hermes/models.ts`：per-profile `/v1/models` adapter，无本地模型清单补齐。
- `src/lib/server/hermes/chat-stream.ts`：SSE hub/upstream pump/keep-alive/text delta filtering；chat timeout clamp 是 `[1000, 2100000]` ms。
- `src/lib/chat-timeouts.ts`：35 分钟 chat stream default/hard cap（Hermes active subagent 30 分钟 + 5 分钟余量），前端与服务端共享。
- `src/lib/server/hermes/cron.ts`：cron profile routing proof。
- `src/lib/server/auth.ts`、`rbac.ts`：Deck users/roles/capabilities/profile scope。
- `src/lib/server/deck-chat-projection.ts`：projection store lock/atomic write/prune。
- `public/sw.js`：PWA cache policy。

## Debugging

### Auth/RBAC

- `GET /api/deck/auth/session` 查看当前用户与 capabilities。
- 普通用户访问 profile 前必须有 assignment。
- admin/super_admin catalog outage 应显示上游不可用，而不是从本地目录补齐。

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

Resume：

```bash
curl -N 'http://127.0.0.1:6117/api/deck/chat/resume?sessionId=<id>&since=0' \
  -H 'Cookie: hermesdeck_session=…'
```

### Named-profile sessions

- 未证明归属的 named-profile continuation 应返回 `session_profile_unverified` 或 `response_profile_unverified`。
- 新 named-profile turn 如带未证明 session id，Deck 会改用 `deck_<uuid>` 并通过 `X-Hermes-Session-Id` 让 upstream/Deck projection 对齐。
- 如果看到额外 `api` 话题，先查 projection proof、`X-Hermes-Session-Id` header 与 profile API base。
- 刷新后仍应从 projection 看到 draft assistant/tool-call/tool-result rows；普通用户只能读/证明/继续/写入自己的 owner-scoped projection，admin/super_admin 可跨 owner 但仍受 profile auth 约束。不要逐条持久化 tool/function `arguments.delta`；只在 `arguments.done`/done item 等语义边界写 projection。

### Cron

`GET /api/deck/cron?profile=<id>` 必须能从 API 响应确认 profile routing。若返回 `profile_routing_unavailable`，升级/重启 Hermes API Server 或修正 profile API base；不要在 Deck 里添加本地 cron 枚举。

### PWA

- dev 模式 `PWARegister` 会 unregister SW；如果曾访问 production，手动在 DevTools Application 面板清理旧 SW/cache。
- 生产 SW 版本见 `public/sw.js`，当前为 `hermesdeck-pwa-v41`。
- 验证：`npm run verify:pwa`。

## Documentation rules

更新文档时请同时检查：

- 不出现把本地数据库、Hermes CLI、本地 profile/model 枚举描述为运行时数据路径的内容。
- 端口叙述必须是：6117 可见入口，6118 内部 Next/proxy target。
- PWA cache 必须强调不缓存受保护认证 HTML/API 响应。
- Profiles/models/cron proof 必须 API-backed 且 fail-closed。

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
