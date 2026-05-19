# HermesDeck 重构文档

> 目标：把 HermesDeck 从「可用的 Hermes Chat WebUI」重构为「可信、可观测、可操作的 Hermes 控制台」。本轮不关注 UI 视觉风格，重点优化功能体验、信息架构、数据可信度与 Hermes 原生能力呈现。

## 1. 重构原则

- **真实优先**：页面指标必须标明数据口径，不能用样本冒充全量。
- **Hermes 原生优先**：优先接 Hermes API / state / profile / run / tool 能力，避免回到 ClawDeck/OpenClaw 假设。
- **Chat 不是全部**：明确区分 Project、Profile、Session、Run、Trace、Artifact。
- **安全可解释**：删除、终端、外部写入、发布等高风险动作必须有清晰文案、确认与审计线索。
- **新手可上手，重度用户可深入**：默认流程要简单，Inspector / Raw / Trace 提供进阶信息。

## 2. 目标对象模型

### Project / Workspace
项目级上下文。用于承载：

- 默认 instructions
- 文件库
- 默认 profile
- 工具权限
- 预算 / timeout / approval 策略

### Profile / Agent
Hermes 执行画像。不是简单模型选择器，而是策略包：

- model / provider
- system / developer instructions
- tool policy
- memory policy
- approval policy
- file scope
- budget / timeout

### Session / Thread
用户连续任务上下文。用于组织聊天历史、当前 profile、关联文件与本地 Deck 元数据。

### Run
一次具体执行。用于追踪：

- status：queued / running / success / failed / cancelled
- profile / session / model
- started / ended / duration
- tool calls
- token / cost / latency
- error summary

### Trace
Run 的事件细节：

- model generation
- tool call
- handoff / subagent
- approval / guardrail
- file read/write
- error / retry

### Artifact / File
输入和输出对象：

- Reference files：项目级资料
- Session attachments：本次聊天附件
- Artifacts：agent 生成的报告、代码、配置、图片等产物

## 3. 信息架构调整

推荐一级导航：

- **Chat**：主工作入口。
- **Sessions**：会话管理、搜索、归档、标签。
- **Profiles**：执行画像、模型、工具策略、使用情况。
- **Runs**：执行历史、状态、失败排查。
- **Tools**：toolsets、skills、MCP、认证状态、启用范围。
- **Files / Artifacts**：输入文件、输出产物、版本与 lineage。
- **Terminal / Ops**：安全 allowlist 运维动作。
- **Settings**：连接、主题、本地缓存、PWA 状态。
- **Security / Approvals**：高风险动作审批与审计日志。

短期可以保留现有导航，但 `/runs` 不能继续作为纯占位页裸露。

## 4. 必修问题

### P0-1：首页指标口径不可信

现状：`getSessions()` 只返回最近 200 条，但首页把它用于 sessions、messages、source breakdown、heatmap 等统计。

改造：

- 首页所有统计标注 scope，例如：`Default profile · recent 200 sessions`。
- 新增聚合 API，返回真实总量：
  - total sessions
  - total messages
  - active sessions 24h
  - profile breakdown
  - source breakdown
  - model/token usage
- 列表分页和统计聚合分离。

验收：

- `/api/deck/profiles` 的 sessionCount 与首页统计口径不再冲突。
- 首页用户能明确知道看到的是全量还是样本。

### P0-2：删除动作语义危险

现状：菜单写 `Delete locally`，实际删除 Hermes `state.db` 中的 sessions/messages。

改造：

- 文案改为 `Delete from Hermes history` / `从 Hermes 历史中删除`。
- 确认弹窗显示 profile、session id、消息数量、不可恢复说明。
- 如需本地删除，新增独立动作：`Remove Deck metadata only`。

验收：

- 用户不会把删除 Hermes 历史误解成清本地缓存。
- 本地 metadata 删除与 Hermes 历史删除是两个明确动作。

## 5. 核心功能重构

### 5.1 Runs：从占位页变成一等对象

最低可用版本：

- `/runs` 展示最近 runs。
- 支持 status / profile / session / tool filter。
- 每个 run 显示：状态、耗时、profile、session、tool calls、错误摘要。
- `/runs/[id]` 展示三层：
  - Summary：本次执行做了什么，结果是什么。
  - Timeline：模型调用、工具调用、状态事件。
  - Raw：原始 payload、错误、trace ids。
- Chat 右侧 timeline 可跳转到 run detail。

验收：

- `/api/deck/runs` 不再返回空数组。
- 用户能从失败 run 定位到错误工具、错误参数或模型输出。

### 5.2 Tools：升级为 capability registry

改造：

- 分类展示：toolsets、skills、MCP servers/tools/prompts/resources、platform integrations。
- 每项显示：
  - available / enabled / disabled
  - needs auth / auth failed
  - source：builtin / local / config / MCP / plugin
  - scope：global / profile / session
- 修复 CLI table parser，把 skills summary footer 排除。
- 增加任务导向筛选：Research、Coding、Browser、Files、Messaging、DevOps、Media。

验收：

- Tools 页不再出现 footer summary 被识别为 skill。
- 用户能判断某能力是否可用、是否当前 session 启用、失败是否因认证或策略导致。

### 5.3 Profiles：拆分配置能力与使用情况

改造：

- Profile 页分三层：
  - Active routing：当前默认模型、delegation、auxiliary、aliases。
  - Configured capability：已配置 provider/model/auth/tool policy。
  - Usage overlay：sessions、tokens、last used、models used。
- 不隐藏“已配置但未使用”的 provider/model。
- 每个 profile 提供动作：
  - Use in new chat
  - Inspect config
  - Compare
  - Set default（如安全允许）

验收：

- 用户能区分「Hermes 可用能力」和「历史使用过的能力」。
- profile 不再只是模型使用报表，而是执行画像入口。

### 5.4 Chat：降低认知负担，强化上下文解释

改造：

- Timeline 空状态区分：
  - 纯文本回复，无 tool calls。
  - 当前无结构化 run events。
  - run event 加载失败。
- 状态文案更明确：
  - `linked` → `Hermes API linked`
  - `ready` → `Ready to send`
- 右侧 Inspector 展示：
  - profile
  - enabled tools
  - file scope
  - memory / budget / timeout
  - latest run
  - pending approvals
- 明确标注 local-only 元数据：pin、folder、tag、rename、archive。

验收：

- 用户完成一次纯文本对话后，不会误以为 timeline 坏了。
- 用户能在 chat 内看懂当前运行上下文。

### 5.5 Command Palette / Search

改造：

- 实现 `⌘K` / `Ctrl+K`。
- 支持搜索：sessions、profiles、tools、runs、settings。
- 支持动作：New chat、Use profile、Open terminal action、Filter failed runs。
- 如果短期不做，移除顶栏假搜索样式或标注 coming soon。

验收：

- 顶栏搜索不再是 false affordance。
- 重度用户可以通过键盘快速操作 HermesDeck。

## 6. 文件与产物体验

新增 Files / Artifacts 面板：

- Reference files：项目级长期资料。
- Session attachments：会话临时附件。
- Artifacts：agent 输出产物。

每个 artifact 记录 lineage：

- 由哪个 run 生成。
- 使用了哪些输入文件。
- 使用哪个 profile / model / tool。
- 版本历史。

验收：

- 用户能从一个产物追溯到生成它的 run。
- 长任务不需要反复上传同一批资料。

## 7. 安全与审批

高风险动作必须使用审批卡片：

- shell / terminal action
- 文件写入 / 删除
- 外部 API 写入
- 消息发送
- 发布 / 部署
- 删除历史

审批卡片显示：

- 工具名
- 目标资源
- 参数摘要
- 预期副作用
- 风险等级
- 授权范围：仅本次 / 本 session / 本 project
- approve / deny / edit params

验收：

- 用户能在执行前理解风险。
- 所有高风险动作可在 Security / Approvals 中追溯。

## 8. 阶段计划

### Phase 1：可信度修复（0-1 周）

- 修首页统计口径。
- 修 `Delete locally` 文案与行为边界。
- 修 Tools footer parser。
- `/runs` 至少显示 Beta/Coming soon，或接入最小 run list。
- 顶栏假搜索降级或实现最小 command palette。

### Phase 2：Hermes 核心体验补齐（1-3 周）

- Runs MVP：list、filter、detail、timeline、raw。
- Tools capability registry：补 MCP、认证状态、启用范围。
- Profiles：Configured vs Used 分层。
- Chat：Inspector、timeline 空状态、local-only 标注。

### Phase 3：Control Plane 化（3-6 周）

- Projects / Workspaces。
- Files / Artifacts / lineage。
- Security / Approvals。
- Command palette 完整化。
- Run replay / failure retry / step rerun。

## 9. 验证清单

每轮重构后执行：

```bash
cd ~/HermesDeck
npm run typecheck -- --pretty false
npm run build
PORT=6117 npm start
```

API 验证：

```bash
curl -fsS http://127.0.0.1:6117/api/deck/health
curl -fsS http://127.0.0.1:6117/api/deck/profiles
curl -fsS http://127.0.0.1:6117/api/deck/tools
curl -fsS http://127.0.0.1:6117/api/deck/runs
```

浏览器验证：

- 打开 `/chat`，发送：`Reply exactly UI_OK`，确认返回 `UI_OK`。
- 打开 `/profiles`，确认配置能力与使用情况分层清楚。
- 打开 `/tools`，确认没有 footer 污染，MCP/skill/toolset 状态清楚。
- 打开 `/runs`，确认不是空壳。
- 打开 `/terminal`，执行安全 allowlist action。
- 检查 browser console 无 JS error。

## 10. 非目标

本次重构不优先处理：

- 纯视觉风格重做。
- 任意浏览器 shell。
- 重新引入 ClawDeck/OpenClaw 路由假设。
- 为了展示效果伪造 Hermes 数据。
- 无审计的高风险自动执行。

## 11. 成功标准

重构完成后，HermesDeck 应满足：

- 用户能清楚知道 Hermes 当前是否可用。
- 用户能选择正确 profile 开始任务。
- 用户能理解本 session 启用了哪些工具和上下文。
- 用户能查看一次 run 做了什么、为什么失败、如何继续。
- 用户能区分配置能力和历史使用情况。
- 用户能安全地审批或拒绝高风险动作。
- Dashboard 指标可信，所有数据口径明确。
