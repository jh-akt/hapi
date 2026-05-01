# Codex App-Server 功能缺口清单

本文记录 HAPI 对齐 Codex 原生 app-server 后，剩余要补的功能。每项都带中文功能名，方便排期、沟通和 UI 文案复用。

状态说明：

- **API 已通**：shared protocol、CLI gateway、Hub proxy、Web client 至少一层已具备调用能力。
- **UI 已接入**：前端已有主入口、toast 或刷新链路。
- **基础已接入**：可用但还缺结构化展示、深层交互或更细状态。
- **UI 未完成**：缺前端入口、状态展示、toast、刷新链路或最终交互。
- **底层未完成**：server request、数据同步或运行时处理还没真正闭环。

## P0：Codex 主路径

| 中文功能名 | Codex API / 能力 | 当前状态 | 下一步 |
| --- | --- | --- | --- |
| 原生历史读取 | `thread/read` | UI 已接入；remote Codex 聊天页优先读 app-server thread，HAPI messages 只做 fallback | 继续补更细的 item 渲染和空态提示 |
| 原生线程恢复 | `thread/resume` | UI 已接入；inactive session 和 history placeholder 可按策略打开 | 继续覆盖 archived/thread 失效时的错误文案 |
| 原生线程派生 | `thread/fork` | UI 已接入；Codex session action 走 app-server fork 并打开新 HAPI session | 补 fork 参数高级设置 |
| 原生线程归档 | `thread/archive` | UI 已接入；action 成功后刷新 session/codex/thread queries | 补 archived list 边界状态 |
| 原生线程恢复归档 | `thread/unarchive` | UI 已接入；恢复后刷新列表和当前 thread | 补恢复后跳转策略 |
| 原生线程回滚 | `thread/rollback` | UI 已接入；确认弹窗从 `thread/turns/list` 选择 turn 数 | 补更细的 turn preview |
| 原生线程重命名 | `thread/name/set` | UI 已接入；成功后同步 HAPI metadata name 并刷新查询 | 补 metadata/tag 类扩展 |
| 原生线程元数据 | `thread/metadata/update` | API 已通；UI 缺失 | 用于标签、置顶、分组或未来 thread metadata 编辑 |
| 原生线程压缩 | `thread/compact/start` | UI 已接入；action menu 可启动 compact 并显示 toast | 补 compact 完成事件和结果展示 |
| 原生 turn 列表 | `thread/turns/list` | UI 已接入；支撑 rollback 和 thread summary pane | 补 timeline 视图 |
| 主动追加指令 | `turn/steer` | API 已通；输入链路可调用 | 对 active turn 增加更明确的“追加指令”状态 |
| 中断当前 turn | `turn/interrupt` | API 已通；停止按钮仍复用 HAPI abort，由 CLI 优先桥到 Codex interrupt | 增加 Codex 专用 interrupt 失败文案 |
| 原生 Review 启动 | `review/start` | 基础已接入；`/review` 会保存 review thread id，Review 面板读取输出 | 结构化 findings / PR comments 仍需解析和文件跳转 |

## P1：工作区体验

| 中文功能名 | 依赖能力 | 当前状态 | 下一步 |
| --- | --- | --- | --- |
| 多终端标签 | HAPI terminal | 基础已接入；同一 session 可创建多个 terminal id tab | 补 inactive tab 输出缓存/回放和 tab 命名 |
| 线程摘要面板 | `thread/read`, `thread/turns/list` | UI 已接入；展示名称、状态、模型、effort、turn 数、cwd、CLI、Git | 补 token usage 和 timeline |
| Review 结果面板 | `review/start`, thread events | 基础已接入；展示 review thread 输出、文件变更、命令和 MCP/tool 行 | 结构化 PR comments、findings、文件跳转仍需补 |
| 富文件预览 | HAPI files / Codex outputs | 基础已接入；已有 diff/file，Markdown 增加 Preview | 图片、二进制 metadata、超大文件分页仍需补 |

## P2：Codex 管理面板

| 中文功能名 | Codex API / 能力 | 当前状态 | 下一步 |
| --- | --- | --- | --- |
| 技能列表 | `skills/list` | UI 已接入；管理面板展示技能、说明和 enabled 状态 | 补技能详情和按 cwd 过滤 |
| 插件列表 | `plugin/list` | UI 已接入；管理面板展示插件、marketplace 和状态 | 补搜索、分类和详情弹窗 |
| 插件详情 | `plugin/read` | API 已通；UI 缺失 | 展示 plugin metadata、说明、权限和入口 |
| 插件安装 | `plugin/install` | 基础已接入；管理面板可安装并刷新 | 补 auth policy / appsNeedingAuth 后续 UI |
| 插件卸载 | `plugin/uninstall` | 基础已接入；管理面板可卸载并刷新 | 补卸载确认和依赖提示 |
| App 列表 | `app/list` | UI 已接入；展示 app 名称、说明、enabled/accessible | 补 app 详情和入口动作 |
| MCP 状态 | `mcpServerStatus/list` | UI 已接入；展示 server、auth、tools/resources 数量 | 补 startup error、资源浏览和工具详情 |
| MCP 资源读取 | `mcpServer/resource/read` | API 已通；UI 缺失 | 在 MCP panel 中查看 resource 内容 |
| MCP 工具调用 | `mcpServer/tool/call` | API 已通；UI 缺失 | 提供受控调用入口，避免误触危险工具 |
| 线程记忆模式 | `thread/memoryMode/set` | UI 已接入；管理面板可启用/关闭当前 thread memory | 补当前模式展示 |
| 重置记忆 | `memory/reset` | UI 已接入；危险操作有浏览器确认和完成 toast | 补更明确的账号范围说明 |
| 自动化列表 | HAPI automation / Codex app | 未完成 | 展示已有 automation，后续再接创建/编辑 |

## P2：Server Request 闭环

| 中文功能名 | Server Request | 当前状态 | 下一步 |
| --- | --- | --- | --- |
| 命令执行审批 | `item/commandExecution/requestApproval` | 已接 HAPI permission 流程 | 继续保留，补更多细节展示 |
| 文件修改审批 | `item/fileChange/requestApproval` | 已接 HAPI permission 流程 | 继续保留，补 diff/路径展示 |
| 用户输入请求 | `item/tool/requestUserInput` | 已接 HAPI user input 流程 | 补移动端表单细节和取消态 |
| MCP 交互式询问 | `mcpServer/elicitation/request` | unsupported fallback | 做成可回答的表单/选择 UI |
| Codex 权限请求 | `item/permissions/requestApproval` | unsupported fallback | 映射到 HAPI permission 模型 |
| 动态工具调用 | `item/tool/call` | unsupported fallback | 明确安全边界后再接入 |
| ChatGPT 授权刷新 | `account/chatgptAuthTokens/refresh` | unsupported fallback | 需要 auth refresh UI 或明确重新登录路径 |

## P3：暂不阻塞首批 parity

| 中文功能名 | 范围 | 当前状态 | 下一步 |
| --- | --- | --- | --- |
| 浏览器控制 | Browser use | 未实现 | 作为独立 track，不阻塞 Codex thread parity |
| 电脑控制 | Computer use | 未实现 | 作为独立 track，先不复刻 Desktop |
| SSH Devbox | Remote devbox | 未实现 | 等 app-server/thread 主路径稳定后再设计 |

## 推荐实现顺序

1. **补结构化 Review**：把 review thread 里的 findings / PR comments / 文件定位解析成可跳转列表。
2. **补管理面板深层交互**：plugin detail、MCP resource read、MCP tool call、app detail。
3. **补状态细节**：memory 当前模式、compact 完成事件、terminal tab 输出回放。
4. **补 Server Request 闭环**：MCP elicitation、Codex permissions、dynamic tool call、auth refresh。
5. **最后处理 P3**：Browser use、Computer use、SSH devbox。
