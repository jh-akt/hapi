# HAPI Codex app-server 当前实现交接

生成日期：2026-04-30

用途：给下一个 session 快速接手当前 HAPI Codex app-server 实现。本文描述的是当前工作树里的真实实现，不是早期路线图。

## 1. 当前产品边界

HAPI 当前公开支持范围只保留 Codex app-server。

- 支持：Codex remote session、Codex app-server thread 历史、thread lifecycle actions、review、workspace 摘要、Skills / Plugins / Apps / MCP / Memory 管理入口、模型和 reasoning effort 选择。
- 不支持：Claude / Gemini / OpenCode 作为公开支持面。
- 不支持：native / tmux create、attach、resume、open。旧 native/tmux 代码若仍在仓库里出现，视为历史兼容或退役实现。
- 旧 native/tmux API 当前返回 `410 Gone`，旧 native session 被隔离到 `retired-native-tmux` namespace 或直接不可打开。

README 已写明“只支持 Codex app-server”，后续不要重新把 tmux 作为产品主路径接回来。

## 2. 关键文件地图

### Shared 协议与 capability registry

- `shared/src/codex-app-server.ts`
  - Codex app-server shared 类型和 method map。
  - `CODEX_APP_SERVER_CAPABILITIES` 是 web 可见能力的唯一登记点。
  - 目前 baseline：Codex CLI `0.122.0`。

- `shared/src/generated/app-server/**`
  - 由 `codex app-server generate-ts --experimental` 生成的协议类型。
  - 不要手写 generated 类型。

### CLI / runner

- `cli/src/codex/codexRemoteLauncher.ts`
  - remote Codex session 的 `codex-app-server` RPC handler。
  - 负责把 HAPI RPC 转成 Codex app-server request。
  - 已支持 `thread/turns/list`、`thread/name/set`、`thread/compact/start`、`model/list` 等。

- `cli/src/runner/run.ts`
  - runner 级 machine Codex app-server client。
  - 当前 machine fallback method：`thread/list`、`thread/read`、`thread/turns/list`、`model/list`。
  - 作用：旧 runner-spawned session 子进程未注册新 RPC 时，hub 可以通过在线 runner 的 machine app-server 读取 thread/模型。

- `cli/src/api/apiMachine.ts`
  - machine RPC wire。

### Hub

- `hub/src/web/routes/sessions.ts`
  - generic proxy：`POST /api/sessions/:id/codex/app-server`
  - body：`{ method, params }`
  - method 必须经过 shared capability registry 且 `webVisible: true`。
  - 对 `thread/read`、`thread/turns/list`、`model/list` 优先尝试 machine fallback。

- `hub/src/sync/rpcGateway.ts`
  - session RPC 和 machine RPC gateway。
  - `codexAppServerFromMachine(...)` 是 runner 级 fallback 入口。

- `hub/src/sync/syncEngine.ts`
  - 对上暴露 `codexAppServer(...)`、`readCodexThreadFromMachine(...)`、`codexAppServerFromMachine(...)`。
  - native/tmux 操作当前直接返回 retired error。

- `hub/src/web/routes/codexSessions.ts`
  - Codex history 列表和 open 策略。
  - transcript-only fallback 已退役；没有在线 app-server 来源时，不再用 native/tmux resume 兜底。

- `hub/src/web/routes/nativeSessions.ts`
  - native/tmux endpoints 当前统一 `410 Gone`。

### Web

- `web/src/api/client.ts`
  - typed wrappers：`codexAppServer(...)`、`readCodexThread(...)`、`listCodexThreadTurns(...)`、`listCodexModels(...)` 等。
  - UI 层不应散落 raw method string。

- `web/src/hooks/queries/useCodexThreadMessages.ts`
  - 聊天页 Codex 历史主路径。
  - 当前不再用整条 `thread/read` 做首屏历史。
  - 当前用 `thread/turns/list` 分页读取：
    - 首屏最近 `2` turns。
    - “加载更早”每次增加 `4` turns。
  - query key：`queryKeys.codexThreadMessages(sessionId, threadId)`，避免和 workspace summary 的 `codexThread` cache 混用。

- `web/src/router.tsx`
  - SessionPage 决定消息数据源。
  - remote Codex 且非 `native-attached` 时，优先 `useCodexThreadMessages`。
  - app-server read 失败才回退 HAPI message store。

- `web/src/components/CodexWorkspacePanel.tsx`
  - Workspace summary / review / manage 面板。
  - summary 的 `thread/read` 当前使用 `includeTurns: false`，避免抢整条历史。
  - turn 数和 rollback 预览通过 `thread/turns/list`。

- `web/src/hooks/queries/useCodexModels.ts`
  - 模型列表从 Codex app-server `model/list` 动态获取。

- `web/src/components/SessionModelDialog.tsx`
  - session 模型和 reasoning effort UI。
  - reasoning effort 会按 selected model 的 `supportedReasoningEfforts` 过滤。

- `web/src/components/AssistantChat/modelOptions.ts`
  - `getCodexModelOptionsFromModels(...)` 把 Codex `model/list` 返回转换成 UI options。

## 3. 当前 web-visible Codex app-server API

以 `shared/src/codex-app-server.ts` 为准。

### Thread / turn

- `thread/resume`
- `thread/fork`
- `thread/archive`
- `thread/unarchive`
- `thread/rollback`
- `thread/list`
- `thread/read`
- `thread/name/set`
- `thread/metadata/update`
- `thread/compact/start`
- `thread/turns/list`
- `turn/steer`
- `turn/interrupt`

### Review

- `review/start`

### Models

- `model/list`

模型选项现在不是写死主路径。UI 优先从 Codex app-server `model/list` 获取；静态 Codex model presets 只作为 fallback。

### Skills / Plugins / Apps

- `skills/list`
- `plugin/list`
- `plugin/read`
- `plugin/install`
- `plugin/uninstall`
- `app/list`

Plugin / app 当前标为 experimental。

### MCP

- `mcpServerStatus/list`
- `mcpServer/resource/read`
- `mcpServer/tool/call`

### Memory

- `thread/memoryMode/set`
- `memory/reset`

## 4. Session 历史打开策略

Codex session 列表现在是 app-server first。

- attached remote Codex session：直接导航到已有 HAPI session。
- unattached app-server thread：通过 `/api/codex-sessions/open` 创建或恢复 app-server-backed HAPI session。
- transcript-only history：不再包装成可打开 HAPI session；tmux fallback 已退役。

关键字段：

- `codexOrigin`
- `openStrategy`
- `codexSessionId`
- `attachedSessionId`

相关文件：

- `hub/src/web/routes/codexSessions.ts`
- `web/src/lib/sessionSelection.ts`
- `web/src/components/SessionList.tsx`

## 5. 刚修过的重要问题：大 thread 历史首屏卡住

线上曾出现 Codex session 打开后历史为空或等待很久的问题。

实际后端状态：

- HAPI session 有 `metadata.codexSessionId`。
- `thread/read` 能返回完整历史，但不适合首屏直接拉完整 turns。
- 完整历史包较大，线上 Cloudflare 路径会很慢。

根因有两个：

1. 聊天页和 Workspace 面板曾共用 `queryKeys.codexThread(sessionId, threadId)`，但缓存数据结构不同：
   - 聊天 hook 期望 `{ response, loadedAt }`
   - Workspace summary 期望 `{ thread }`
   - 互相污染后，聊天 hook 可能得到空消息。

2. Workspace summary 和聊天历史曾首屏拉整条 `thread/read(includeTurns: true)`，大 thread 会导致浏览器等待或渲染卡住。

当前修复：

- 聊天历史使用独立 `queryKeys.codexThreadMessages(sessionId, threadId)`。
- 聊天首屏改用 `thread/turns/list({ limit: 2, sortDirection: 'desc' })`。
- 加载更早时增加到更多 turns。
- hook 的可见 turn limit 和 `threadId` 绑定，切换 thread 时会重置到首屏大小。
- Workspace summary 的 `thread/read` 改为 `includeTurns: false`。
- Workspace review tab 也改为 `thread/turns/list` 读取最近 turns，不再拉整条 review thread。
- machine fallback 增加 `thread/turns/list`，旧 spawned session 也可通过 runner 读取 turns。

最近一次验证记录：

- public / debug `/health` 正常。
- 对大 thread 走线上 `thread/turns/list limit=2`：
  - HTTP `200`
  - `count=2`
  - `hasMore=true`
  - `totalItems=119`
  - 约 `3.36s`

如果用户仍然看不到历史，优先检查：

1. 是否还在旧 PWA service worker / 旧 bundle。让用户彻底关闭 PWA 再打开，或浏览器强刷。
2. 当前 HTML 引用的 bundle 是否是最新 hash。
3. Network 里是否还在请求 `thread/read` 而不是 `thread/turns/list`。
4. `POST /api/sessions/:id/codex/app-server` 是否返回 `thread/turns/list` 数据。

## 6. 模型选择当前实现

模型选择在两个位置接入：

- header 里的 session model dialog。
- composer settings / shortcut 里的模型切换。

关键文件：

- `web/src/hooks/queries/useCodexModels.ts`
- `web/src/components/SessionHeader.tsx`
- `web/src/components/SessionModelDialog.tsx`
- `web/src/components/AssistantChat/HappyComposer.tsx`
- `web/src/components/AssistantChat/modelOptions.ts`
- `web/src/components/AssistantChat/codexReasoningEffortOptions.ts`

流程：

1. Web 调 `api.listCodexModels(sessionId, { limit: 200, includeHidden: false })`。
2. Hub generic proxy 校验 `model/list` capability。
3. Hub 优先用 machine fallback 调 runner Codex app-server。
4. UI 用返回的 `displayName` / `model` 生成 options。
5. reasoning effort 根据当前选中模型的 `supportedReasoningEfforts` 过滤。

已知边界：

- remote Codex app-server-backed session 可改模型。
- `native-attached` / controlled-by-user session 不支持在 HAPI 改模型。
- 静态模型列表仅为 fallback。

## 7. native/tmux 退役状态

当前设计不是“tmux fallback/moat”，而是 tmux 退役。

当前行为：

- `hub/src/web/routes/nativeSessions.ts` 返回 `410 Gone`。
- `hub/src/sync/syncEngine.ts` 对 native session 的 input、approval、resume、fork 等操作返回 retired error。
- `hub/src/sync/sessionCache.ts` 隐藏 retired native tmux session。
- `web/src/components/NativeSessionAttach.tsx` 已删除。
- `web/src/router.tsx` 不再渲染 native attach UI。
- README 和 docs 已同步说明“不支持 native tmux create / attach / resume / open”。

注意：schema 里仍有 `source: 'native-attached'`、`native` metadata，是为了识别和隔离历史数据，不代表产品路径还支持。

## 8. 最近验证命令

常用验证：

```bash
bun typecheck
```

```bash
cd web
bun run test src/hooks/queries/useCodexThreadMessages.test.tsx src/lib/codex-thread-messages.test.ts src/components/AssistantChat/modelOptions.test.ts src/components/SessionModelDialog.test.tsx
```

```bash
cd hub
bun test src/web/routes/sessions.test.ts
```

最近结果：

- `bun typecheck` 通过。
- web 相关测试：17 passed。
- hub `sessions.test.ts`：21 passed。

部署脚本：

```bash
scripts/public-deploy.sh restart
scripts/debug-deploy.sh restart
```

runner 改动后还要重启对应 runner：

```bash
cd cli
HAPI_HOME=/Users/haojiang/.hapi-deploy/public/runner-home \
HAPI_API_URL=http://127.0.0.1:3006 \
bun src/index.ts runner stop

HAPI_HOME=/Users/haojiang/.hapi-deploy/public/runner-home \
HAPI_API_URL=http://127.0.0.1:3006 \
bun src/index.ts runner start
```

debug runner 同理使用：

- `HAPI_HOME=/Users/haojiang/.hapi-deploy/debug/runner-home`
- `HAPI_API_URL=http://127.0.0.1:3007`

## 9. 当前工作树注意事项

当前工作树包含大量未提交变更，包括 tmux 退役、Codex app-server parity、模型选择、历史分页等。不要随手 `git reset --hard` 或回滚不认识的文件。

已知未跟踪文件：

- `cli/src/codex/runCodex.test.ts`
- `web/src/components/SessionModelDialog.tsx`
- `web/src/components/SessionModelDialog.test.tsx`
- `web/src/hooks/queries/useCodexModels.ts`
- `web/src/hooks/queries/useSession.test.ts`
- `cloudflared-diag-*.zip`

`cloudflared-diag-*.zip` 是诊断包，提交前通常应确认是否需要删除或忽略，注意隐私。

## 10. 下一步建议

优先级从高到低：

1. 提交前做隐私检查：
   - 不提交 access token、JWT、hub env、日志、诊断 zip 内敏感内容。
   - commit message 不写具体 session URL 中的私人上下文。
2. 提交前跑：
   - `bun typecheck`
   - `cd hub && bun test src/web/routes/sessions.test.ts`
   - `cd web && bun run test src/hooks/queries/useCodexThreadMessages.test.tsx src/lib/codex-thread-messages.test.ts src/components/AssistantChat/modelOptions.test.ts src/components/SessionModelDialog.test.tsx`
   - `cd docs && bun run docs:build`
3. 如果要部署，再更新 public / debug 并确认线上 bundle 已刷新、Network 走 `thread/turns/list`。

## 11. 交接给下个 session 的一句话

HAPI 已转成 Codex app-server first，并且 native/tmux 已退役；当前最需要盯的是生产页面是否真的加载新 PWA bundle，以及 Codex 历史必须走 `thread/turns/list` 分页，不能再让聊天页和 Workspace 用同一个 query key 拉整条 `thread/read`。
