# HermesDeck

HermesDeck 是 Hermes Agent 的浏览器控制台：多会话聊天、profile-aware 运行视图、配置编辑、能力/任务面板、受控终端与可安装 PWA。Deck 的运行时 source of truth 是 Hermes Agent API Server；Deck 不把 Hermes 的本地数据库、CLI 或本地 catalog 当作生产回退路径。

## 当前架构要点

- **API-only runtime**：聊天、profiles、models、cron proof、runs/stats/messages 等运行时数据通过 Hermes Agent API Server 暴露给 Deck BFF；BFF 再以 `/api/deck/*` 给前端提供稳定契约。
- **RBAC fail-closed**：Deck 有自己的登录 cookie、用户/角色和 profile assignment。生产多用户场景中，未能证明权限或 profile 归属时拒绝访问，而不是枚举本地 profile/model 目录补齐结果。
- **Canonical visible entrypoint：`http://<host>:6117`**。项目脚本启动 Next 服务在 `6118`，同时启动 `6117 -> 6118` 的同源反向代理；用户、PWA、反向代理/launchd 对外应以 `6117` 为入口，`6118` 是内部目标。
- **聊天流**：Deck BFF 调 Hermes API Server `/v1/responses`，用 SSE 向浏览器转发文本、run-event、attachment、done/error，并发送 keep-alive 注释保持长连接活性。
- **Deck-owned chat projection**：`~/.hermesdeck/chat-projection.v1.json`（或 `HERMESDECK_DATA_DIR`）只保存 Deck UX/proof 状态，用 lock、atomic write、TTL/cap prune 维护；它不是 Hermes runtime 数据源。
- **安全 PWA cache**：Service Worker 只预缓存公开离线 shell 和图标；认证页面、API 响应、聊天 HTML 不被持久缓存。

## 快速开始

要求：Node.js 22+。Live Terminal 可选，需要 `tmux` 和可加载的 `node-pty`；默认关闭。

```bash
cd /Users/fanxuxin/Hermes_Sync/HermesDeck
npm install
npm run dev
# 浏览器打开 http://127.0.0.1:6117
```

生产式本地启动：

```bash
npm run build
npm start
# 仍以 http://127.0.0.1:6117 访问；6118 仅作为内部 Next 目标。
```

第一次启动如未发现 Deck auth store，会在终端打印一次性 `admin`/`super_admin` bootstrap 密码。登录后请在 Settings 中修改凭据并按需创建/审批用户。

## 常用脚本

```bash
npm run dev          # free 6118/6117，启动 Next dev(6118) + 6117 reverse proxy
npm run build        # next build --webpack
npm start            # free 6118/6117，启动 Next start(6118) + 6117 reverse proxy
npm run typecheck    # tsc --noEmit
npm run lint         # eslint .
npm run verify:pwa   # 检查 manifest / sw.js / icons / CSS 关键项
npm run smoke        # build 后启动并 smoke /login /offline /manifest /sw.js
npm run test:rbac    # RBAC route/auth 单测
npm run test:csrf    # CSRF/auth 单测
```

## 文档索引

- [docs/architecture.md](docs/architecture.md)：系统边界、数据流、RBAC、SSE、projection、PWA 策略。
- [docs/api.md](docs/api.md)：`/api/deck/*` BFF 契约与关键错误语义。
- [docs/configuration.md](docs/configuration.md)：环境变量、端口、auth/data store、Hermes API Server 连接。
- [docs/development.md](docs/development.md)：本地开发、验证、调试纪律。
- [docs/deployment.md](docs/deployment.md)：launchd/反代/HTTPS/PWA/安全边界。
- [docs/deck-chat-projection.md](docs/deck-chat-projection.md)：Deck-owned chat projection 的用途和不变量。
- [docs/design-handoff/README.md](docs/design-handoff/README.md)：设计交接包；以 `design.md`、`globals.css` 和当前主文档为准。
- [docs/glossary.md](docs/glossary.md)：Profile、Session、Run、Projection、RBAC 等术语。
- [design.md](design.md)：Hallmark UI/design system 约束。

## 非目标与安全边界

- HermesDeck 只改 Deck；不要从 Deck 文档或代码中要求修改 Hermes Agent 内部行为。
- 不把本地数据库读取、Hermes CLI 或本地 profile/model 枚举描述为运行时数据路径。
- 不在普通用户会话中缓存受保护 HTML/API 响应。
- Live Terminal 一旦启用即等价于给登录用户一条真实 shell；只应授予可信 admin/super_admin。
