# Codex App-Server 功能缺口清单

本文记录 HAPI 对齐 Codex 原生 app-server 后，剩余要补的功能。每项都带中文功能名，方便排期、沟通和 UI 文案复用。

状态说明：

- **API 已通**：shared protocol、CLI gateway、Hub proxy、Web client 至少一层已具备调用能力。
- **UI 未完成**：缺前端入口、状态展示、toast、刷新链路或最终交互。
- **底层未完成**：server request、数据同步或运行时处理还没真正闭环。

## P0：Codex 主路径

| 中文功能名 | Codex API / 能力 | 当前状态 | 下一步 |
| --- | --- | --- | --- |
| 原生历史读取 | `thread/read` | API 已通；聊天页仍主要渲染 HAPI message store，transcript sync 负责补历史 | 聊天主路径改为优先读 app-server thread，transcript scanning 降为 fallback |
| 原生线程恢复 | `thread/resume` | API 已通；inactive session 可 resume | 确认 history placeholder、attached session、archived thread 的打开路径都走同一套刷新逻辑 |
| 原生线程派生 | `thread/fork` | API 已通；部分 UI 仍走 HAPI session fork | Web action 改成 Codex thread fork，并刷新 sessions/codexSessions/nativeSessions/当前 thread |
| 原生线程归档 | `thread/archive` | API 已通；列表归档已有入口 | 补齐失败 toast、archived list 细节和状态一致性检查 |
| 原生线程恢复归档 | `thread/unarchive` | API 已通；列表恢复归档已有入口 | 与归档共用刷新链路，避免恢复后仍显示灰态 |
| 原生线程回滚 | `thread/rollback` | API 和 client 已通；UI 基本缺失 | 增加回滚入口、确认弹窗、turn 数选择和结果刷新 |
| 原生线程重命名 | `thread/name/set` | API 已通；现有 rename 多数仍是 HAPI session rename | Codex session 改用 app-server rename，并同步 HAPI metadata display name |
| 原生线程元数据 | `thread/metadata/update` | API 已通；UI 缺失 | 用于标签、置顶、分组或未来 thread metadata 编辑 |
| 原生线程压缩 | `thread/compact/start` | API 已通；UI 缺失 | 增加 compact action、运行中状态、完成/失败提示 |
| 原生 turn 列表 | `thread/turns/list` | API 已通；UI 缺失 | 支撑 timeline、rollback 选择和 summary pane |
| 主动追加指令 | `turn/steer` | API 已通；现有输入链路可调用 | 对 active turn 给明确“追加指令”状态和失败反馈 |
| 中断当前 turn | `turn/interrupt` | API 已通；Codex 专用 UI 缺失 | 停止按钮对 Codex active turn 优先调用 app-server interrupt |
| 原生 Review 启动 | `review/start` | `/review` 能启动；结果展示不完整 | 增加 review output、PR comments、review thread 关联展示 |

## P1：工作区体验

| 中文功能名 | 依赖能力 | 当前状态 | 下一步 |
| --- | --- | --- | --- |
| 多终端标签 | HAPI terminal / native session | 未完成 | 同一 session 下展示多个 terminal tabs，保留手机端可读性 |
| 线程摘要面板 | `thread/read`, `thread/turns/list` | 未完成 | 展示 thread preview、模型、effort、turn 数、最新状态 |
| Review 结果面板 | `review/start`, thread events | 未完成 | 展示 review findings、PR comments、关联文件和跳转 |
| 富文件预览 | HAPI files / Codex outputs | 未完成 | 补齐 markdown、image、diff、二进制占位等更好的预览 |

## P2：Codex 管理面板

| 中文功能名 | Codex API / 能力 | 当前状态 | 下一步 |
| --- | --- | --- | --- |
| 技能列表 | `skills/list` | API 已通；UI 缺失 | 增加 Skills panel，展示技能来源和说明 |
| 插件列表 | `plugin/list` | API 已通；UI 缺失 | 增加 Plugins panel，展示已安装/可用插件 |
| 插件详情 | `plugin/read` | API 已通；UI 缺失 | 展示 plugin metadata、说明、权限和入口 |
| 插件安装 | `plugin/install` | API 已通；UI 缺失 | 增加安装动作、进度、错误提示 |
| 插件卸载 | `plugin/uninstall` | API 已通；UI 缺失 | 增加卸载确认和刷新 |
| App 列表 | `app/list` | API 已通；UI 缺失 | 增加 Apps panel，展示 Codex app 能力入口 |
| MCP 状态 | `mcpServerStatus/list` | API 已通；UI 缺失 | 展示每个 MCP server 的连接状态和错误 |
| MCP 资源读取 | `mcpServer/resource/read` | API 已通；UI 缺失 | 在 MCP panel 中查看 resource 内容 |
| MCP 工具调用 | `mcpServer/tool/call` | API 已通；UI 缺失 | 提供受控调用入口，避免误触危险工具 |
| 线程记忆模式 | `thread/memoryMode/set` | API 已通；UI 缺失 | 在 thread 设置中切换 memory mode |
| 重置记忆 | `memory/reset` | API 已通；UI 缺失 | 增加危险操作确认和完成提示 |
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

1. **先补原生历史读取**：`thread/read` 成为聊天主路径，transcript 只兜底。
2. **补全线程动作**：fork、rollback、rename、compact、interrupt。
3. **补 Review 展示**：review output、PR comments、关联 thread。
4. **补管理面板**：Skills、Plugins、Apps、MCP、Memory。
5. **最后处理 P3**：Browser use、Computer use、SSH devbox。
