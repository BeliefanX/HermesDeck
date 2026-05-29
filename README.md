# HermesDeck

> Hermes-native WebUI · 多会话聊天 · Profile / Run / Tool 一等公民 · 安全运维终端 · PWA。

HermesDeck 是 [Hermes Agent](https://hermes-agent.nousresearch.com/docs) 的原生控制台。它把 Hermes
的 API Server、状态库（`~/.hermes/state.db`）、Profile 体系与 CLI 工具整合
成一个浏览器即可访问的工作台：可以多会话聊天、流式查看每一次 Run、按
Profile 切换执行上下文、浏览能力清单（toolsets / skills / MCP）、在受
限白名单内运行 Hermes 维护命令、嵌入 tmux 实时终端，并支持 PWA 安装。

> ClawDeck 与 open-webui 仅作为产品参考；运行时代码完全为 Hermes 重写。

---

## 技术栈

| 层 | 选择 |
| --- | --- |
| Runtime / Framework | Next.js 16 (App Router) · React 19 · TypeScript（strict） |
| 客户端状态 | React Hooks · Zustand · localStorage（按 Profile 命名空间） |
| 流式协议 | Server-Sent Events（in-memory 重放 Hub） |
| 后端封装 | Next Route Handlers（BFF）+ 内嵌 Python 脚本读取 sqlite |
| 终端 | tmux + node-pty（可选）+ Hermes 安全 Action 白名单 |
| PWA | `next/manifest` · `public/sw.js` · `/offline` 降级页 |
| 文档处理 | `pdf-parse` · `mammoth`（DOCX）· `remark-gfm` · `mermaid` · `katex` |

---

## 快速开始

要求：Node.js 22+（与 CI 保持一致）。实时终端为可选功能，启用前请确保系统已安装 `tmux`，且 `node-pty` 的原生依赖可编译/加载（macOS 通常需要 Xcode Command Line Tools；Linux CI/部署通常需要 `python3 make g++`）。默认 `HERMESDECK_LIVE_TERMINAL=0`，需要实时 PTY 时显式设为 `1`。

```bash
git clone <repo> ~/HermesDeck
cd ~/HermesDeck
npm install
cp .env.example .env.local        # 按需填入 Hermes API_BASE / KEY
npm run dev                        # http://localhost:6118
# 或正式启动
npm run build && npm start
```

启动时如未发现 `~/.hermesdeck/auth.json`，会一次性在终端打印出 `admin` 的
随机密码。登录后请在 **Settings → 账号** 中修改用户名 / 密码。

> 端口约定：进程绑定在 `6118`；`6117` 被一个轻量 301 重定向占位（旧 PWA
> 安装锁定在该端口，参见 [scripts/redirect-6117.mjs](scripts/redirect-6117.mjs)）。

---

## 主要功能

- **多会话聊天**：左栏会话索引（pin / 文件夹 / 归档 / 标签 / 搜索 / 来源
  过滤 / 子代理折叠），中栏流式时间线，右栏 Run 时间线 / Inspector。
  支持图片 + DOCX/PDF/纯文本附件，斜杠命令（`/new`、`/regen`、`/stop`、
  `/clear` 与若干提示模板）。
- **刷新可恢复的流**：所有聊天 SSE 走服务端 in-memory Hub；浏览器刷新
  后用 `?since=<seq>` 重新订阅，丢失的事件由缓冲区回放或回退到落库消息。
- **Profile 切换**：顶部 ProfileChip 全局切换，每个 Profile 自带独立的
  `state.db`、模型默认值、`agent.reasoning_effort` 等。
- **Run 时间线**：从 `messages` 表反推每一次「用户问 → 助手答 + 工具调用」
  为一条 Run，列表 + 详情（Summary / Timeline / Raw）。
- **Tools 注册表**：合并 `hermes tools list`（toolsets / MCP）与
  `hermes skills list`，按任务分类、状态、来源筛选；技能支持在线编辑
  `SKILL.md`（realpath + 原子写 + mtime 乐观锁）。
- **安全终端**：白名单化的 `runTerminalAction`（`hermes --version`、
  `tools list`、`skills list`、Deck 健康检查等）+ 可选的 tmux + node-pty
  实时 PTY（`HERMESDECK_LIVE_TERMINAL=1` 启用）。
- **PWA & 移动端**：Manifest、Service Worker、离线降级页、底部导航、
  iOS 键盘 inset 适配。
- **i18n**：界面中英双语切换；浏览器存储优先，回退 `navigator.language`。

---

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | 架构、模块、数据流、Hub/SSE、Python 子进程协议 |
| [docs/api.md](docs/api.md) | 每条 `/api/deck/*` 路由的契约、错误码、限速 |
| [docs/configuration.md](docs/configuration.md) | 环境变量、Hermes 连接、认证存储、PWA 资源 |
| [docs/development.md](docs/development.md) | 本地开发、脚本、调试、PWA 验证、Lint/Typecheck |
| [docs/deployment.md](docs/deployment.md) | 反向代理、HTTPS、Cookie Secure、PWA 安装 |
| [docs/glossary.md](docs/glossary.md) | Profile / Session / Run / Trace / Toolset 等概念 |

---

## 常用脚本

```bash
npm run dev         # next dev + 6117 重定向辅助进程
npm run build       # next build --webpack
npm start           # next start + 6117 重定向辅助进程（默认 HERMESDECK_LIVE_TERMINAL=0）
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm run verify:pwa  # 检查 manifest / sw.js / icons / CSS 关键 token
npm run smoke       # build 后启动 next start 并检查 /login /offline /manifest.webmanifest /sw.js
```

详细脚本见 [docs/development.md](docs/development.md#scripts)。

---

## 反馈

- 问题 / 改进建议：在仓库内开 issue 或在 PR 里附改动说明。
- 安全反馈：直接联系仓库 owner，不要在 issue 公开 PoC。
