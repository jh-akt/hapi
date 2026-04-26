# Codex Native / App-Server 实现原理

本文记录当前 HAPI 对齐 Codex 原生 app-server 的实现方式，以及它和 HAPI native/tmux 会话路线的边界。

当前基线：Codex CLI `0.122.0`，协议类型由本机 `codex app-server generate-ts --experimental` 生成。

## 目标

HAPI 现在有两条互补路线：

1. **Codex app-server 路线**：使用 Codex CLI 原生 app-server 协议访问 thread、turn、review、plugin、MCP、memory 等能力。
2. **HAPI native/tmux 路线**：作为兼容层和兜底层，支持本机 CLI、tmux attach/resume/open、手机远控和非 Codex agent。

对 Codex 来说，主链路应该优先走 app-server。native/tmux 不应该被包装成新的产品概念；它更多是 HAPI 保留本机控制、历史导入、非 Codex agent 和异常恢复能力的底座。

## 总体数据流

```text
Web / PWA
  |
  | REST + typed API client
  v
Hub
  |
  | Socket.IO RPC
  v
HAPI CLI
  |
  | stdio JSON-RPC-like transport
  v
codex app-server
```

补充数据源：

```text
~/.codex/sessions/**/*.jsonl
  |
  | transcript catalog / transcript sync
  v
Hub session list + HAPI message store
```

Web 不直接连 `codex app-server`。它只访问 Hub；Hub 再通过已经在线的 HAPI CLI 发 RPC；CLI 本地启动或复用 `codex app-server` 子进程。

## 协议类型

Codex app-server 生成类型已经迁到 shared package：

- `shared/src/generated/app-server/`
- `shared/src/codex-app-server.ts`

`shared/src/codex-app-server.ts` 做三件事：

1. 重新导出 generated protocol：
   - `ClientRequest`
   - `ServerNotification`
   - `ServerRequest`
   - `v2`
2. 提供 typed method map：
   - `CodexAppServerMethod`
   - `CodexAppServerParams<TMethod>`
   - `CodexAppServerResult<TMethod>`
3. 提供 capability registry：
   - `method`
   - `featureGroup`
   - `experimental`
   - `minimumCodexCliVersion`
   - `webVisible`
   - `failureCopy`

CLI、Hub、Web 统一从 `@hapi/protocol/codex-app-server` 引用类型，不再各自手写 Codex protocol DTO。

## 类型再生成

相关脚本：

- `shared/scripts/generate-codex-app-server-types.ts`
- `shared/scripts/check-codex-app-server-types.ts`

命令：

```bash
bun run generate:codex-app-server-types
bun run check:codex-app-server-types
bun run typecheck
```

`bun run typecheck` 会先跑 drift check。如果本机 Codex CLI 生成结果和 `shared/src/generated/app-server/` 不一致，typecheck 会失败，提醒同步协议。

## CLI app-server 客户端

核心文件：

- `cli/src/codex/codexAppServerClient.ts`
- `cli/src/codex/codexRemoteLauncher.ts`
- `cli/src/codex/appServerTypes.ts`

`CodexAppServerClient` 仍然使用 stdio transport：

```text
spawn("codex", ["app-server"])
stdin  -> JSON line request / response / notification
stdout -> JSON line response / notification / server request
stderr -> debug log
```

请求以 method + params 发送，返回 result 或 error。长 turn 使用长 timeout；普通 list/read/archive 等操作使用短 timeout。

CLI gateway 现在不再靠小型手写 allowlist。它使用 shared capability registry 识别 method，并把可用 method 转发给 app-server。

首批开放的能力组：

- `thread/*`
- `turn/*`
- `review/start`
- `skills/list`
- `plugin/list`
- `plugin/read`
- `plugin/install`
- `plugin/uninstall`
- `app/list`
- `mcpServerStatus/list`
- `mcpServer/resource/read`
- `mcpServer/tool/call`
- `thread/memoryMode/set`
- `memory/reset`

## Server Request 处理

核心文件：

- `cli/src/codex/utils/appServerPermissionAdapter.ts`
- `cli/src/codex/utils/appServerEventConverter.ts`

app-server 不只发 notification，也会向客户端发 server request。HAPI 当前明确处理：

- `item/commandExecution/requestApproval`
- `item/fileChange/requestApproval`
- `item/tool/requestUserInput`

这些请求会转到 HAPI 原有 permission / user input 流程，继续支持手机审批。

当前明确 unsupported fallback：

- `mcpServer/elicitation/request`
- `item/permissions/requestApproval`
- `item/tool/call`
- `account/chatgptAuthTokens/refresh`
- `applyPatchApproval`
- `execCommandApproval`

这些不会静默失败；会返回“暂不支持”的错误，方便前端给出明确失败信息。

事件转换层已经改为接受 generated `ServerNotification` union。旧的 `(method, params)` 调用形态仍保留，方便现有代码渐进迁移。

## Hub 代理

核心文件：

- `hub/src/sync/rpcGateway.ts`
- `hub/src/sync/syncEngine.ts`
- `hub/src/web/routes/sessions.ts`

Hub 新增统一 typed proxy：

```http
POST /api/sessions/:id/codex/app-server
Content-Type: application/json

{
  "method": "thread/read",
  "params": {}
}
```

实际 body 中的 `params` 随 method 类型变化。Web API client 会提供 typed helper，UI 层不应该直接散落 raw method string。

Hub 代理的保护逻辑：

1. 必须是当前 namespace 可访问的远端 Codex session。
2. method 必须在 shared capability registry。
3. method 必须 `webVisible: true`。
4. RPC 失败返回 `409`，优先使用 app-server 原始错误；没有错误时使用 capability 的 `failureCopy`。

旧 explicit endpoints 仍保留，例如：

- `/api/sessions/:id/codex/threads/list`
- `/api/sessions/:id/codex/threads/read`
- `/api/sessions/:id/codex/threads/fork`
- `/api/sessions/:id/codex/threads/archive`

这些 endpoint 后续可以继续作为兼容 wrapper，内部逐步汇总到同一 gateway。

## Web API 与 UI 选择

核心文件：

- `web/src/api/client.ts`
- `web/src/types/api.ts`
- `web/src/lib/sessionSelection.ts`
- `web/src/components/SessionList.tsx`
- `web/src/components/CodexWorkspacePanel.tsx`

Web API client 暴露：

```ts
api.codexAppServer(sessionId, method, params)
```

类型来自 shared generated protocol。UI 层应该调用更具体的 wrapper 或 mutation，而不是手写 method string 到处散落。

当前 Web 已有的 typed wrapper 覆盖：

- thread：`read/fork/archive/unarchive/rollback/name/set/compact/turns/list`
- turn：`steer`
- review：`review/start`
- management：`skills/list`、`plugin/list/read/install/uninstall`、`app/list`
- MCP：`mcpServerStatus/list`、`mcpServer/resource/read`、`mcpServer/tool/call`
- memory：`thread/memoryMode/set`、`memory/reset`

聊天页会挂载 `CodexWorkspacePanel`，提供三组入口：

1. **线程摘要**：基于 `thread/read` 和 `thread/turns/list` 显示 name、status、model、effort、turn count、cwd、CLI、Git。
2. **Review 展示**：`/review` 成功后保存 `reviewThreadId`，再读取 review thread 的输出、文件变更、命令和 MCP/tool 行。
3. **管理面板**：展示 Skills、Plugins、Apps、MCP server 状态，并提供 plugin install/uninstall、memory mode、memory reset 的基础操作。

session 点击逻辑：

1. 已 attached 的 HAPI session：进入该 session 页面。
2. inactive 且未 archived 的 HAPI session：触发 resume。
3. `codex:` 开头的 Codex history placeholder：调用 `/api/codex-sessions/open`，再进入新建/attach 后的 HAPI session。

现在 inactive session 不再因为离线而灰掉。视觉 dim 只代表 archived：

```ts
isSessionVisuallyDimmed(session) === session.archived
```

这样 Codex app-server 历史 session 可以被正常点击打开，不会看起来像不可用。

## Codex Session Catalog

核心文件：

- `hub/src/web/routes/codexSessions.ts`
- `hub/src/native/codexSessionCatalog.ts`
- `hub/src/native/sessionManager.ts`

`GET /api/codex-sessions` 会合并三类来源：

1. **已 attached 的 HAPI session**
   - `session.metadata.flavor === "codex"`
   - 有 `metadata.codexSessionId`
2. **app-server thread/list**
   - 从在线 Codex app-server session 调 `thread/list`
   - 同时查 archived 和 non-archived
   - unattached thread 也会生成 `codex:<threadId>` placeholder
3. **本机 Codex transcript catalog**
   - 扫描 `~/.codex/sessions/**/*.jsonl`
   - 支持 `source=cli`
   - 支持 `source=vscode`
   - 支持 `originator=codex-tui`
   - 支持 `originator=happy-codex`
   - 支持 `originator=Codex Desktop`

合并优先级会偏向更可操作、更实时的数据：

```text
attached HAPI session
  + app-server thread/list
  + local transcript catalog
  -> one Codex session list
```

相同 `codexSessionId` 的条目会合并，避免同一个 Codex thread 在列表里出现多次。

## 历史记录显示

核心文件：

- `web/src/hooks/queries/useCodexThreadMessages.ts`
- `web/src/lib/codex-thread-messages.ts`
- `hub/src/native/codexTranscript.ts`
- `hub/src/sync/messageService.ts`

remote Codex 且非 `native-attached` 的聊天页现在优先走 app-server：

```text
thread/read({ threadId, includeTurns: true })
  -> thread.turns/items
  -> codexThreadToMessages(...)
  -> HappyThread render
```

生成的 message id 稳定使用 `codex:${threadId}:${turnId}:${itemId || index}`。这些 message 不写回 HAPI message store，避免 transcript sync 和 app-server read 产生重复历史。

以下场景才回落到 HAPI messages + transcript sync：

- app-server read 失败
- session 是 `native-attached`
- session offline / inactive
- metadata 没有 `codexSessionId`

对于 native/desktop Codex session，HAPI 会同步本地 transcript：

```text
~/.codex/sessions/**/*.jsonl
  -> discover matching transcript
  -> read delta by line cursor
  -> convert event_msg / response_item
  -> write into HAPI messages
  -> Web chat render
```

匹配条件：

- cwd 归一化后相同
- hinted `codexSessionId` 命中时加权
- 近期 transcript 加权
- attach 时 snapshot prompt 能命中时加权

这解决了 Codex Desktop / VS Code 来源 transcript 打开后空白的问题。`source=vscode` 和 `originator=Codex Desktop` 现在属于支持范围。

## HAPI 本地会话的作用

HAPI session 不是 Codex thread 的重复副本。它是 HAPI 的远控外壳：

- namespace 权限隔离
- Web/PWA URL 和 session id
- SSE 更新
- 消息持久化
- pending permission
- 手机输入、停止、恢复
- machine/runner 归属
- native transcript 同步状态
- 和非 Codex agent 共享的统一 UI 模型

对 Codex 来说，`metadata.codexSessionId` 是桥。HAPI session 通过它绑定到 Codex 原生 thread。

## native/tmux 的保留价值

在 Codex app-server 能覆盖 thread lifecycle 之后，“真实本地会话现场”本身不再是 Codex 主链路的核心卖点。它保留的价值更具体：

- **兜底导入历史**：当 app-server 不在线、没有 attached session，或需要打开 Codex Desktop/VS Code 写出的旧 transcript 时，仍可从 `~/.codex/sessions/**/*.jsonl` 补齐历史。
- **保留本机控制权**：用户仍可在电脑上用原生 CLI/tmux 工作，手机端只是接同一条会话线索。
- **覆盖非 Codex agent**：Claude、Gemini、OpenCode 等 agent 没有 Codex app-server，仍需要 HAPI native session 模型。
- **异常恢复**：app-server method 不支持、Codex 版本漂移、进程断开时，HAPI 还有 transcript、shell snapshot、tmux/process 等 fallback。

所以产品表达上不应强调“真实本地会话现场”这个抽象概念。更准确的边界是：

```text
Codex 正常路径：app-server thread/read/resume/actions
Codex 兜底路径：transcript catalog + native attach
非 Codex 路径：HAPI native/tmux session
```

HAPI 的差异化仍然是 self-hosted、PWA/手机远控、本机 attach/create/open/resume；但 Codex parity 的优先级应放在 app-server，而不是 terminal 现场复刻。

## 当前已实现

- generated app-server protocol 迁到 shared package。
- CLI/Hub/Web 共用 typed Codex protocol。
- capability registry 统一记录 method 元信息。
- root typecheck 可检测 app-server generated type drift。
- CLI app-server RPC 扩展到 thread、turn、review、skills、plugins、apps、MCP、memory。
- Hub 提供 generic `POST /api/sessions/:id/codex/app-server` proxy。
- Web API client 提供 typed `codexAppServer(...)` helper 和 thread/review/management wrappers。
- `GET /api/codex-sessions` 合并 attached、app-server thread/list、local transcript catalog。
- unattached app-server thread 不再被过滤，可以作为 `codex:` placeholder 打开。
- inactive session 不再灰显；只有 archived session 灰显。
- 聊天页 remote Codex 主路径优先用 `thread/read` 渲染历史；transcript/message store 只做 fallback。
- Web action 已接入 fork、archive/unarchive、rollback、rename、compact。
- Workspace 已有 thread summary pane、Review 基础展示、Codex 管理面板。
- 文件页已支持 Markdown Preview；terminal 页已支持基础多 tab。
- Codex Desktop / VS Code transcript 可被识别并同步到 HAPI messages。
- native/tmux 作为兼容/兜底路线保留。

## 当前缺口

仍需要继续推进的部分：

- Review output 仍只是基础行展示，缺结构化 findings / PR comments / 文件跳转。
- plugin detail、MCP resource read、MCP tool call、app detail 仍缺 UI。
- memory UI 还缺当前模式读取展示。
- terminal tabs 还缺输出缓存/回放和用户自定义 tab 名。
- 富文件预览还缺图片、二进制 metadata、超大文件分页。
- thread metadata/tag/置顶类 UI 仍未接入。
- steer active turn / interrupt 需要更明确状态和失败文案。
- automation 列表。
- MCP elicitation、dynamic tool call、auth refresh 等 server request 的完整 UI 流程。
- browser/computer use/SSH devbox 仍是 P3，不作为首批 parity 阻塞项。

## 调试入口

常用 API：

```bash
curl http://127.0.0.1:3006/api/codex-sessions
curl http://127.0.0.1:3006/api/sessions/:id/messages
```

检查 app-server proxy：

```bash
curl -X POST http://127.0.0.1:3006/api/sessions/:id/codex/app-server \
  -H 'Content-Type: application/json' \
  -d '{"method":"thread/list","params":{"archived":false,"sortKey":"updated_at","sortDirection":"desc","limit":20}}'
```

检查 generated type drift：

```bash
bun run check:codex-app-server-types
```

跑相关测试：

```bash
bun run test:cli -- codexRemoteLauncher.test.ts appServerEventConverter.test.ts appServerPermissionAdapter.test.ts
bun run test:hub -- codexSessions.test.ts codexTranscript.test.ts sessions.test.ts
bun run test:web -- sessionSelection.test.ts SessionList.test.ts
```
