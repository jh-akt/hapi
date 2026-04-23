# Codex Desktop 拉齐计划

日期: 2026-04-24

## 对比基线

- HAPI 当前分支
  - 参考: `README.md`, `cli/README.md`, `hub/README.md`, `web/README.md`
  - 重点代码: `cli/src/codex/*`, `hub/src/native/*`, `hub/src/web/routes/*`, `web/src/routes/*`, `web/src/components/*`
- OpenAI Codex 开源基线
  - 仓库: `https://github.com/openai/codex`
  - 本次对比 commit: `c2423f42d148f83aff8e119a218885673a1c0e4f`
  - 重点: `codex-rs/app-server`, `codex-rs/app-server-protocol`, `codex-rs/app-server-client`, `codex-rs/cli`
- OpenAI Codex Desktop 产品面
  - 官方文章: `Codex for (almost) everything`
  - 发布时间: 2026-04-16

说明:

- `openai/codex` 开源仓库可作为 protocol/runtime 基线。
- Desktop 完整 UI 并不都在开源仓库里。
- 桌面产品能力对比, 以官方文章为准; protocol/runtime 对比, 以开源仓库为准。

## 一句话判断

当前 HAPI 更像:

- `native tmux + codex` 远程控制器
- `web/PWA` 远程审批 + 聊天 + 文件/终端观察层

而不是:

- typed 的 Codex Desktop 工作台

最核心差距:

1. protocol 只接了很小一段, 还是手写类型 + 手动 event 转换
2. thread lifecycle 没跟上官方 app-server
3. desktop workspace 能力不够全
4. plugins/apps/memory/review/automation 等长期能力基本没接

HAPI 的独特优势:

- `tmux native attach/create/open/resume`
- local-first/self-hosted
- 手机/PWA 远程控制

结论:

- 不该把 HAPI 改造成另一个独立桌面壳子
- 应该做成 `typed Codex app-server parity + HAPI native attach moat`

## 当前状态核对

按当前代码核对, `1/2/3` 不是“全部实现”, 更准确是:

| 项 | 状态 | 代码观察 |
| --- | --- | --- |
| 1. Typed protocol 基础层 | 部分完成 | `cli/src/codex/appServerTypes.ts` 已扩到 `thread/list/read/fork/archive/unarchive/rollback`、`turn/steer`、`review/start`; 但仍是手写类型, 还没引入 generated protocol types |
| 2. Thread/session lifecycle 拉齐 | 部分完成 | 已接 session-scoped `codex-app-server` RPC、hub/web 的 `thread/list/read/fork/archive/unarchive/rollback` 路由和 client; remote launcher 已支持 active turn 自动 `turn/steer`; `/api/codex-sessions` 已改成 active remote Codex session 优先走 `thread/list`, transcript 扫描降为 fallback, 并补了 attached managed session fallback; SessionList 已开始消费 thread archive/unarchive, 但完整 thread/read 驱动和 fork/rollback/steer 的前端主路径还没做完 |
| 3. Event/approval/review 拉齐 | 部分完成 | approvals handler 已接 command/file-change/request-user-input; `review/start` 已接通 hub/web 和 `/review` slash command; `AppServerEventConverter` 已补 review/thread archive 事件, 但整体仍是手工映射, 未切到 typed notification surface |
| 4. Workspace UI 拉齐 | 部分完成 | 已有项目分组、归档过滤、codex history/open; 但还没有多 terminal tabs、summary pane、rich file preview |

本次核对的关键信号:

- `cli/src/codex/appServerTypes.ts` 仍是手写接口, 不是 generated schema
- `cli/src/codex/codexAppServerClient.ts` 已扩到 thread/review/steer 主方法, 但底层仍未 vendor generated protocol
- `hub/src/web/routes/sessions.ts` / `hub/src/sync/syncEngine.ts` 新增的是 HAPI `session` 级 `fork/archive`
- `hub/src/web/routes/codexSessions.ts` 已变成 app-server first 聚合: active remote Codex session 走 `thread/list`, attached managed session 无 transcript 也能展示, `hub/src/native/codexSessionCatalog.ts` 退成 fallback
- codex history 列表暂时过滤 unattached app-server-only thread; 在 thread-open UI 落地前, 不把不可直接打开的 remote thread 暴露给用户
- `turn/steer` / `review/start` / `thread/fork` / `thread/list` / `thread/read` 已在 HAPI 侧有 RPC + route + client 主链, codex history 列表已开始吃 `thread/list`, SessionList 已接 thread archive/unarchive, 但还没做 `thread/read` 驱动和 fork/rollback/steer 的 thread actions UI
- Web 仍是单 terminal route, 不是多 terminal tabs / summary pane

结论:

- 当前更适合把 `1/2/3` 标成 `全部部分完成`
- 后续计划应从“是否已做”改成“剩余缺口”

## 差距矩阵

| 维度 | HAPI 当前 | Codex Desktop / app-server 基线 | 结论 |
| --- | --- | --- | --- |
| Protocol 类型 | `cli/src/codex/appServerTypes.ts` 手写子集 | `app-server-protocol` 全量 typed schema, 可生成 TS/JSON Schema | 第一优先级补齐 |
| Client transport | 本地 spawn `codex app-server`, JSONL request/response | 官方已有 typed in-process client, 也有 stdio/websocket transport | HAPI 继续走 stdio; 不追 websocket 首发 |
| Thread lifecycle | 仅 `initialize`, `thread/start`, `thread/resume`, `turn/start`, `turn/interrupt` | 还支持 `thread/list/read/fork/archive/unarchive/rollback`, `turn/steer`, `thread/compact`, `review/start` 等 | 当前覆盖面明显偏小 |
| Event 处理 | `AppServerEventConverter` 手动 unwrap/mapping, 兼容 raw/wrapped event | 官方协议已有 typed notifications / server requests | 当前实现脆, 易跟不上上游变更 |
| Session discovery | `hub/src/native/codexSessionCatalog.ts` 直接扫 `~/.codex/sessions/*.jsonl` | 官方有 `thread/list`, `thread/read`, `thread/resume` | JSONL 扫描应降级为 fallback |
| Native attach | 能 attach/create/open/resume `tmux + codex` | 官方 desktop 产品未看到现成 `tmux attach` 路线 | HAPI 必须保留, 这是 moat |
| Workspace UI | chat + file browser + 单 terminal route | 官方产品有 multiple terminal tabs, rich file previews, summary pane, browser | UI 明显没对齐 |
| Review 能力 | 主要是人工 chat / diff 观察 | 官方有 `review/start`, 也支持处理 GitHub review comments | 需要补协议和 UI |
| Skills / Apps / Plugins | 本地 skills/slash-commands 有, 但不是官方 app-server surface | 官方有 `skills/list`, `app/list`, `plugin/list/read/install`, `externalAgentConfig/*` | 当前是旁路实现, 不是 parity |
| MCP | HAPI 主要做 MCP bridge | 官方有 `mcpServerStatus/list`, `resource/read`, `tool/call`, OAuth login | 需要接官方 inventory/auth surface |
| Memory / automation | 几乎没有 | 官方已有 `thread/memoryMode/set`, `memory/reset`; 产品面还有 memory / automations | 中后期能力 |
| Browser / computer use / SSH devbox | 没有 | 官方产品面已有 in-app browser, computer use, SSH devbox(alpha) | 单独长线 track |

## 关键设计原则

1. typed first

- 停止继续手写 app-server schema 子集
- 以后跟上游对齐, 先对齐 schema, 再对齐 feature

2. preserve HAPI moat

- `tmux native attach/create/open/resume` 不删
- 这一层继续作为 HAPI 差异化

3. app-server happy path, transcript fallback

- 主路径: official thread APIs
- 兜底: 本地 sqlite / transcript / tmux snapshot

4. no big bang rewrite

- 先 protocol
- 再 lifecycle
- 再 workspace
- 最后长线能力

5. experimental features behind flags

- upstream 明确 experimental / under development 的 method, 不直接默认开启
- HAPI 侧需要 capability gating + version gating

6. stdio first, not websocket first

- 官方 app-server README 明确 websocket transport 仍属 experimental / unsupported
- HAPI 初期不应该把核心架构押到 websocket app-server transport 上

## 建议分期

### Phase 0: Typed protocol 基础层

优先级: P0
成本: M
状态: 部分完成

目标:

- 把“非类型 codex desktop”先拉成 typed app-server integration

工作:

- 引入上游 `app-server-protocol` 生成物
  - 方案 A: 在 CI/脚本里调用 `codex app-server generate-ts`
  - 方案 B: vendor 上游 schema/typescript 生成结果
- 替换 `cli/src/codex/appServerTypes.ts`
- 重构 `cli/src/codex/codexAppServerClient.ts`
  - 从“只支持 5 个方法”变成通用 typed RPC client
  - 支持 typed request / typed notification / typed server request
- 加 capability registry
  - 记录当前 codex 版本支持哪些 method/feature
- 建 protocol compat tests
  - 固定一个或多个 codex 版本 fixture
  - 覆盖 initialize, core thread/turn methods, approvals, notifications

建议改动面:

- `cli/src/codex/appServerTypes.ts`
- `cli/src/codex/codexAppServerClient.ts`
- `cli/src/codex/utils/appServerConfig.ts`
- `cli/src/codex/utils/appServerPermissionAdapter.ts`
- `cli/src/codex/utils/appServerEventConverter.ts`
- 新增 `cli/src/codex/generated/*` 或 `shared/src/codex-protocol/*`
- 新增 schema sync script

退出标准:

- HAPI 不再手写 app-server 核心 request/response 类型
- 能基于 generated types 编译
- 对上游 schema 变更有测试报警

### Phase 1: Thread/session lifecycle 拉齐

优先级: P0
成本: M
状态: 部分完成

目标:

- 不再把 session/history 主要建立在 JSONL 扫描和猜测上

工作:

- 已完成:
  - HAPI `session` 级 `fork/archive`
  - `codexSessions/projects` 路由
  - Web 归档过滤 / 项目分组 / codex history open
  - session-scoped `codex-app-server` RPC
  - hub/web `thread/list/read/fork/archive/unarchive/rollback` API surface
  - remote launcher active turn 自动 `turn/steer`
  - `/api/codex-sessions` active remote Codex session 优先走 `thread/list`, transcript 扫描作为 fallback
  - attached managed Codex session 即使没有 transcript 也会进 catalog
  - SessionList 对 attached remote Codex thread 接上 archive/unarchive
- 接入:
  - `thread/list`
  - `thread/read`
  - `thread/resume`
  - `thread/fork`
  - `thread/archive`
  - `thread/unarchive`
  - `thread/rollback`
  - `turn/steer`
- 改造 session list / codex history list
  - 主路径从 app-server thread APIs 取数
  - `hub/src/native/codexSessionCatalog.ts` 降级成 fallback
- Web 增加:
  - fork session
  - archive/unarchive
  - rollback last turns
  - steer active turn
- shared types 加 thread status / fork lineage / archived metadata

建议改动面:

- `hub/src/native/codexSessionCatalog.ts`
- `hub/src/web/routes/codexSessions.ts`
- `hub/src/sync/syncEngine.ts`
- `shared/src/types.ts`
- `shared/src/schemas.ts`
- `web/src/components/SessionList.tsx`
- `web/src/components/SessionChat.tsx`
- `web/src/api/client.ts`

退出标准:

- 正常 codex history 展示默认走 app-server thread APIs; transcript 扫描仅作为 native attach / 旧版本 / app-server 失败 fallback
- Web 可 fork / archive / unarchive / rollback / steer
- `thread/read` 已进入前端主路径, 不再只是 route/client 预留

### Phase 2: Event/approval/review 拉齐

优先级: P1
成本: M
状态: 部分完成

目标:

- 把事件流从 heuristic mapping 拉到 typed notifications

工作:

- 已完成:
  - approval handlers: command execution / file change / request user input
  - `review/start` CLI/hub/web 主链
  - Web `/review` slash command 触发 structured review
  - review lifecycle / thread archive event 基础映射
- 重写 `AppServerEventConverter`
  - typed decode
  - lossless / best-effort 分类跟官方语义对齐
- 补齐 server requests / approvals
  - command execution
  - file change
  - MCP / network / other approval families
  - `tool/requestUserInput`
- 接入 `review/start`
  - UI 有 review 发起入口
  - 渲染 review lifecycle 和最终 review output
- 对齐 auto-review / review-related notifications

建议改动面:

- `cli/src/codex/utils/appServerEventConverter.ts`
- `cli/src/codex/utils/appServerPermissionAdapter.ts`
- `hub/src/sync/*`
- `web/src/components/ToolCard/*`
- `web/src/components/SessionChat.tsx`

退出标准:

- 常用通知不再靠字符串猜测和 wrapped/raw 双重分支维持
- review/start 可从 HAPI 发起并完整展示
- approval surface 与官方 app-server 主路径一致

### Phase 3: Workspace UI 拉齐

优先级: P1
成本: L
状态: 部分完成

目标:

- 从“远程看 session”升级成“远程工作台”

工作:

- 已完成:
  - 项目分组
  - 归档视图
  - codex history 列表与 reopen
- 多 terminal tabs
- summary pane
  - plans
  - sources
  - artifacts
- richer file preview
  - PDF
  - spreadsheet
  - slides
  - docs
- chat / files / terminal / summary 可联动切换
- review comments workflow 预留入口

建议改动面:

- `web/src/routes/sessions/*`
- `web/src/components/*`
- `web/src/router.tsx`
- `web/src/types/api.ts`

退出标准:

- 单 session 内可开多 terminal
- 有 summary pane
- file preview 不只停留在源码文本

### Phase 4: Skills / Apps / Plugins / MCP 正式拉齐

优先级: P2
成本: L

目标:

- 不再只暴露 HAPI 自己的 MCP bridge
- 把官方 Codex apps/plugins/mcp inventory 接进来

工作:

- 接入:
  - `skills/list`
  - `app/list`
  - `plugin/list`
  - `plugin/read`
  - `plugin/install` / `plugin/uninstall`
  - `mcpServerStatus/list`
  - `mcpServer/resource/read`
  - `mcpServer/tool/call`
  - `mcpServer/oauth/login`
- composer 支持:
  - `app://...` mentions
  - `plugin://...` mentions
- settings / integrations UI
- 评估 `externalAgentConfig/detect/import`
  - 可做导入助手

退出标准:

- HAPI 可展示官方 Codex apps/plugins/MCP inventory
- 常见 OAuth / auth 状态能在 HAPI 中操作和查看
- mentions/path 语义与官方协议一致

### Phase 5: Memory / automation / desktop-only 能力

优先级: P3
成本: XL

目标:

- 追平更长线的 Codex Desktop 产品面

工作:

- 接入:
  - `thread/memoryMode/set`
  - `memory/reset`
- 调研并评估:
  - memory UI
  - reusable threads / automations
  - scheduled wake-up
- 进一步产品面对齐:
  - in-app browser
  - SSH devbox
  - computer use

说明:

- 这一阶段很多能力不一定都能只靠开源仓库直接实现
- 可能依赖 closed backend / OS capability / ChatGPT account binding
- 应拆成单独 product decision, 不和 P0/P1 混在一起

### Phase 6: HAPI moat hardening

优先级: 持续
成本: M

目标:

- 在拉齐官方 surface 时, 不把 HAPI 的 native attach 优势做没

工作:

- native attach session 与 app-server thread 建立稳定关联
- native/live mode 与 remote/web mode 共享同一 thread identity
- detach/reattach/resume 语义统一
- fallback 顺序明确:
  - official thread APIs
  - local codex state/sqlite
  - transcript parsing
  - tmux snapshot heuristics

退出标准:

- 升级为 typed integration 后, native attach 仍是 first-class flow
- 用户可继续在真实终端和手机/PWA 间切换

## 第一阶段推荐交付

建议先做“剩余 P0 + 剩余 P1 + 剩余 P2”的最小闭环:

1. typed protocol
2. official thread APIs: `thread/list/read/fork/archive/unarchive/rollback` + `turn/steer`
3. typed notifications + `review/start`
4. `codexSessionCatalog` 从主路径降为 fallback

做到这里, HAPI 就不再只是“非类型 codex desktop 模仿层”, 而是:

- typed codex app-server client
- 保留 native attach 优势
- session lifecycle 基本跟上官方

## 暂不建议首批追的项

- browser
- computer use
- SSH devbox
- automation scheduler
- 完整 plugin marketplace UX

原因:

- 这些更偏 product shell / OS integration / cloud capability
- 对 HAPI 当前最痛的结构性问题帮助不大
- 先做会把项目拖进大而散的 UI/平台工程

## 主要风险

1. 上游 experimental API 变化快

- 需要 version gating
- 需要 compatibility tests

2. Desktop 产品能力不等于 OSS protocol 全开放

- 部分能力只能对齐体验, 不能完全对齐实现

3. native attach 是非官方路径

- 官方 thread APIs 未必覆盖 `tmux live attach`
- HAPI 仍需保留自己的 native/session manager

4. 现有代码正处于活跃改动中

- 不适合大爆炸重构
- 需要 adapter-first, incremental migration

## 成功标准

- HAPI 编译时使用 generated app-server types, 不再维护手写协议子集
- session/history 主路径基于 official thread APIs
- Web 支持 fork / steer / review / archive 等核心 lifecycle
- notification/approval 流程 typed 化
- native attach/create/open/resume 保持可用
- UI 从“远程监控”提升到“基本工作台”
