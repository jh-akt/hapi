import type {
    ClientRequest,
    CollaborationMode,
    InitializeCapabilities,
    InitializeParams,
    InitializeResponse,
    ReasoningEffort,
    ReasoningSummary,
    ResponseItem,
    ServerNotification,
    ServerRequest
} from './generated/app-server'
import type {
    AppsListParams,
    AppsListResponse,
    AskForApproval,
    ListMcpServerStatusParams,
    ListMcpServerStatusResponse,
    McpResourceReadParams,
    McpResourceReadResponse,
    McpServerToolCallParams,
    McpServerToolCallResponse,
    MemoryResetResponse,
    Model,
    ModelListParams,
    ModelListResponse,
    PluginInstallParams,
    PluginInstallResponse,
    PluginListParams,
    PluginListResponse,
    PluginReadParams,
    PluginReadResponse,
    PluginUninstallParams,
    PluginUninstallResponse,
    ReviewDelivery,
    ReviewStartParams,
    ReviewStartResponse,
    ReviewTarget,
    SandboxMode,
    SandboxPolicy,
    SkillsListParams,
    SkillsListResponse,
    SortDirection,
    Thread,
    ThreadArchiveParams,
    ThreadArchiveResponse,
    ThreadCompactStartParams,
    ThreadCompactStartResponse,
    ThreadForkParams,
    ThreadForkResponse,
    ThreadListParams,
    ThreadListResponse,
    ThreadMemoryModeSetParams,
    ThreadMemoryModeSetResponse,
    ThreadMetadataUpdateParams,
    ThreadMetadataUpdateResponse,
    ThreadReadParams,
    ThreadReadResponse,
    ThreadResumeParams,
    ThreadResumeResponse,
    ThreadRollbackParams,
    ThreadRollbackResponse,
    ThreadSetNameParams,
    ThreadSetNameResponse,
    ThreadSortKey,
    ThreadSourceKind,
    ThreadStartParams,
    ThreadStartResponse,
    ThreadStatus,
    ThreadTurnsListParams,
    ThreadTurnsListResponse,
    ThreadUnarchiveParams,
    ThreadUnarchiveResponse,
    Turn,
    TurnInterruptParams,
    TurnInterruptResponse,
    TurnStartParams,
    TurnStartResponse,
    TurnSteerParams,
    TurnSteerResponse,
    UserInput
} from './generated/app-server/v2'

export type * from './generated/app-server'
export * as v2 from './generated/app-server/v2'

export type ApprovalPolicy = AskForApproval
export type AppServerThread = Thread
export type AppServerTurn = Turn
export type NativeCodexAppServerRequest = ClientRequest
export type NativeCodexAppServerNotification = ServerNotification
export type NativeCodexAppServerServerRequest = ServerRequest
export type NativeCodexAppServerMethod = ClientRequest['method']
export type NativeCodexAppServerParams<TMethod extends NativeCodexAppServerMethod> =
    Extract<ClientRequest, { method: TMethod }>['params']

export type {
    AppsListParams,
    AppsListResponse,
    CollaborationMode,
    InitializeCapabilities,
    InitializeParams,
    InitializeResponse,
    ListMcpServerStatusParams,
    ListMcpServerStatusResponse,
    McpResourceReadParams,
    McpResourceReadResponse,
    McpServerToolCallParams,
    McpServerToolCallResponse,
    MemoryResetResponse,
    Model,
    ModelListParams,
    ModelListResponse,
    PluginInstallParams,
    PluginInstallResponse,
    PluginListParams,
    PluginListResponse,
    PluginReadParams,
    PluginReadResponse,
    PluginUninstallParams,
    PluginUninstallResponse,
    ReasoningEffort,
    ReasoningSummary,
    ResponseItem,
    ReviewDelivery,
    ReviewStartParams,
    ReviewStartResponse,
    ReviewTarget,
    SandboxMode,
    SandboxPolicy,
    SkillsListParams,
    SkillsListResponse,
    SortDirection,
    ThreadArchiveParams,
    ThreadArchiveResponse,
    ThreadCompactStartParams,
    ThreadCompactStartResponse,
    ThreadForkParams,
    ThreadForkResponse,
    ThreadListParams,
    ThreadListResponse,
    ThreadMemoryModeSetParams,
    ThreadMemoryModeSetResponse,
    ThreadMetadataUpdateParams,
    ThreadMetadataUpdateResponse,
    ThreadReadParams,
    ThreadReadResponse,
    ThreadResumeParams,
    ThreadResumeResponse,
    ThreadRollbackParams,
    ThreadRollbackResponse,
    ThreadSetNameParams,
    ThreadSetNameResponse,
    ThreadSortKey,
    ThreadSourceKind,
    ThreadStartParams,
    ThreadStartResponse,
    ThreadStatus,
    ThreadTurnsListParams,
    ThreadTurnsListResponse,
    ThreadUnarchiveParams,
    ThreadUnarchiveResponse,
    TurnInterruptParams,
    TurnInterruptResponse,
    TurnStartParams,
    TurnStartResponse,
    TurnSteerParams,
    TurnSteerResponse,
    UserInput
}

export interface CodexAppServerMethodSpec<TParams, TResult> {
    params: TParams
    result: TResult
}

export interface CodexAppServerMethodMap {
    initialize: CodexAppServerMethodSpec<NativeCodexAppServerParams<'initialize'>, InitializeResponse>
    'thread/start': CodexAppServerMethodSpec<NativeCodexAppServerParams<'thread/start'>, ThreadStartResponse>
    'thread/resume': CodexAppServerMethodSpec<NativeCodexAppServerParams<'thread/resume'>, ThreadResumeResponse>
    'thread/fork': CodexAppServerMethodSpec<NativeCodexAppServerParams<'thread/fork'>, ThreadForkResponse>
    'thread/archive': CodexAppServerMethodSpec<NativeCodexAppServerParams<'thread/archive'>, ThreadArchiveResponse>
    'thread/unarchive': CodexAppServerMethodSpec<NativeCodexAppServerParams<'thread/unarchive'>, ThreadUnarchiveResponse>
    'thread/rollback': CodexAppServerMethodSpec<NativeCodexAppServerParams<'thread/rollback'>, ThreadRollbackResponse>
    'thread/list': CodexAppServerMethodSpec<NativeCodexAppServerParams<'thread/list'>, ThreadListResponse>
    'thread/read': CodexAppServerMethodSpec<NativeCodexAppServerParams<'thread/read'>, ThreadReadResponse>
    'thread/name/set': CodexAppServerMethodSpec<NativeCodexAppServerParams<'thread/name/set'>, ThreadSetNameResponse>
    'thread/metadata/update': CodexAppServerMethodSpec<NativeCodexAppServerParams<'thread/metadata/update'>, ThreadMetadataUpdateResponse>
    'thread/memoryMode/set': CodexAppServerMethodSpec<NativeCodexAppServerParams<'thread/memoryMode/set'>, ThreadMemoryModeSetResponse>
    'thread/compact/start': CodexAppServerMethodSpec<NativeCodexAppServerParams<'thread/compact/start'>, ThreadCompactStartResponse>
    'thread/turns/list': CodexAppServerMethodSpec<NativeCodexAppServerParams<'thread/turns/list'>, ThreadTurnsListResponse>
    'turn/start': CodexAppServerMethodSpec<NativeCodexAppServerParams<'turn/start'>, TurnStartResponse>
    'turn/steer': CodexAppServerMethodSpec<NativeCodexAppServerParams<'turn/steer'>, TurnSteerResponse>
    'turn/interrupt': CodexAppServerMethodSpec<NativeCodexAppServerParams<'turn/interrupt'>, TurnInterruptResponse>
    'review/start': CodexAppServerMethodSpec<NativeCodexAppServerParams<'review/start'>, ReviewStartResponse>
    'model/list': CodexAppServerMethodSpec<NativeCodexAppServerParams<'model/list'>, ModelListResponse>
    'skills/list': CodexAppServerMethodSpec<NativeCodexAppServerParams<'skills/list'>, SkillsListResponse>
    'plugin/list': CodexAppServerMethodSpec<NativeCodexAppServerParams<'plugin/list'>, PluginListResponse>
    'plugin/read': CodexAppServerMethodSpec<NativeCodexAppServerParams<'plugin/read'>, PluginReadResponse>
    'plugin/install': CodexAppServerMethodSpec<NativeCodexAppServerParams<'plugin/install'>, PluginInstallResponse>
    'plugin/uninstall': CodexAppServerMethodSpec<NativeCodexAppServerParams<'plugin/uninstall'>, PluginUninstallResponse>
    'app/list': CodexAppServerMethodSpec<NativeCodexAppServerParams<'app/list'>, AppsListResponse>
    'mcpServerStatus/list': CodexAppServerMethodSpec<NativeCodexAppServerParams<'mcpServerStatus/list'>, ListMcpServerStatusResponse>
    'mcpServer/resource/read': CodexAppServerMethodSpec<NativeCodexAppServerParams<'mcpServer/resource/read'>, McpResourceReadResponse>
    'mcpServer/tool/call': CodexAppServerMethodSpec<NativeCodexAppServerParams<'mcpServer/tool/call'>, McpServerToolCallResponse>
    'memory/reset': CodexAppServerMethodSpec<NativeCodexAppServerParams<'memory/reset'>, MemoryResetResponse>
}

export type CodexAppServerMethod = keyof CodexAppServerMethodMap

export type CodexAppServerParams<TMethod extends CodexAppServerMethod> =
    CodexAppServerMethodMap[TMethod]['params']

export type CodexAppServerResult<TMethod extends CodexAppServerMethod> =
    CodexAppServerMethodMap[TMethod]['result']

export type CodexAppServerFeatureGroup =
    | 'session'
    | 'thread'
    | 'turn'
    | 'review'
    | 'models'
    | 'skills'
    | 'plugins'
    | 'apps'
    | 'mcp'
    | 'memory'

export type CodexAppServerCapability = {
    method: CodexAppServerMethod
    featureGroup: CodexAppServerFeatureGroup
    experimental: boolean
    minimumCodexCliVersion: string
    webVisible: boolean
    failureCopy: string
}

export const CODEX_APP_SERVER_CAPABILITIES = [
    { method: 'initialize', featureGroup: 'session', experimental: false, minimumCodexCliVersion: '0.122.0', webVisible: false, failureCopy: 'Codex app-server initialization failed.' },
    { method: 'thread/start', featureGroup: 'thread', experimental: false, minimumCodexCliVersion: '0.122.0', webVisible: false, failureCopy: 'Failed to start Codex thread.' },
    { method: 'thread/resume', featureGroup: 'thread', experimental: false, minimumCodexCliVersion: '0.122.0', webVisible: true, failureCopy: 'Failed to resume Codex thread.' },
    { method: 'thread/fork', featureGroup: 'thread', experimental: false, minimumCodexCliVersion: '0.122.0', webVisible: true, failureCopy: 'Failed to fork Codex thread.' },
    { method: 'thread/archive', featureGroup: 'thread', experimental: false, minimumCodexCliVersion: '0.122.0', webVisible: true, failureCopy: 'Failed to archive Codex thread.' },
    { method: 'thread/unarchive', featureGroup: 'thread', experimental: false, minimumCodexCliVersion: '0.122.0', webVisible: true, failureCopy: 'Failed to unarchive Codex thread.' },
    { method: 'thread/rollback', featureGroup: 'thread', experimental: false, minimumCodexCliVersion: '0.122.0', webVisible: true, failureCopy: 'Failed to rollback Codex thread.' },
    { method: 'thread/list', featureGroup: 'thread', experimental: false, minimumCodexCliVersion: '0.122.0', webVisible: true, failureCopy: 'Failed to list Codex threads.' },
    { method: 'thread/read', featureGroup: 'thread', experimental: false, minimumCodexCliVersion: '0.122.0', webVisible: true, failureCopy: 'Failed to read Codex thread.' },
    { method: 'thread/name/set', featureGroup: 'thread', experimental: false, minimumCodexCliVersion: '0.122.0', webVisible: true, failureCopy: 'Failed to rename Codex thread.' },
    { method: 'thread/metadata/update', featureGroup: 'thread', experimental: false, minimumCodexCliVersion: '0.122.0', webVisible: true, failureCopy: 'Failed to update Codex thread metadata.' },
    { method: 'thread/memoryMode/set', featureGroup: 'memory', experimental: false, minimumCodexCliVersion: '0.122.0', webVisible: true, failureCopy: 'Failed to set Codex memory mode.' },
    { method: 'thread/compact/start', featureGroup: 'thread', experimental: false, minimumCodexCliVersion: '0.122.0', webVisible: true, failureCopy: 'Failed to compact Codex thread.' },
    { method: 'thread/turns/list', featureGroup: 'thread', experimental: false, minimumCodexCliVersion: '0.122.0', webVisible: true, failureCopy: 'Failed to list Codex thread turns.' },
    { method: 'turn/start', featureGroup: 'turn', experimental: false, minimumCodexCliVersion: '0.122.0', webVisible: false, failureCopy: 'Failed to start Codex turn.' },
    { method: 'turn/steer', featureGroup: 'turn', experimental: false, minimumCodexCliVersion: '0.122.0', webVisible: true, failureCopy: 'Failed to steer Codex turn.' },
    { method: 'turn/interrupt', featureGroup: 'turn', experimental: false, minimumCodexCliVersion: '0.122.0', webVisible: true, failureCopy: 'Failed to interrupt Codex turn.' },
    { method: 'review/start', featureGroup: 'review', experimental: false, minimumCodexCliVersion: '0.122.0', webVisible: true, failureCopy: 'Failed to start Codex review.' },
    { method: 'model/list', featureGroup: 'models', experimental: false, minimumCodexCliVersion: '0.122.0', webVisible: true, failureCopy: 'Failed to list Codex models.' },
    { method: 'skills/list', featureGroup: 'skills', experimental: false, minimumCodexCliVersion: '0.122.0', webVisible: true, failureCopy: 'Failed to list Codex skills.' },
    { method: 'plugin/list', featureGroup: 'plugins', experimental: true, minimumCodexCliVersion: '0.122.0', webVisible: true, failureCopy: 'Failed to list Codex plugins.' },
    { method: 'plugin/read', featureGroup: 'plugins', experimental: true, minimumCodexCliVersion: '0.122.0', webVisible: true, failureCopy: 'Failed to read Codex plugin.' },
    { method: 'plugin/install', featureGroup: 'plugins', experimental: true, minimumCodexCliVersion: '0.122.0', webVisible: true, failureCopy: 'Failed to install Codex plugin.' },
    { method: 'plugin/uninstall', featureGroup: 'plugins', experimental: true, minimumCodexCliVersion: '0.122.0', webVisible: true, failureCopy: 'Failed to uninstall Codex plugin.' },
    { method: 'app/list', featureGroup: 'apps', experimental: true, minimumCodexCliVersion: '0.122.0', webVisible: true, failureCopy: 'Failed to list Codex apps.' },
    { method: 'mcpServerStatus/list', featureGroup: 'mcp', experimental: false, minimumCodexCliVersion: '0.122.0', webVisible: true, failureCopy: 'Failed to list MCP server status.' },
    { method: 'mcpServer/resource/read', featureGroup: 'mcp', experimental: false, minimumCodexCliVersion: '0.122.0', webVisible: true, failureCopy: 'Failed to read MCP resource.' },
    { method: 'mcpServer/tool/call', featureGroup: 'mcp', experimental: false, minimumCodexCliVersion: '0.122.0', webVisible: true, failureCopy: 'Failed to call MCP tool.' },
    { method: 'memory/reset', featureGroup: 'memory', experimental: false, minimumCodexCliVersion: '0.122.0', webVisible: true, failureCopy: 'Failed to reset Codex memory.' }
] as const satisfies readonly CodexAppServerCapability[]

export const CODEX_APP_SERVER_METHODS = CODEX_APP_SERVER_CAPABILITIES.map((capability) => capability.method)

export function getCodexAppServerCapability(method: string): CodexAppServerCapability | null {
    return CODEX_APP_SERVER_CAPABILITIES.find((capability) => capability.method === method) ?? null
}

export function isCodexAppServerMethod(method: string): method is CodexAppServerMethod {
    return getCodexAppServerCapability(method) !== null
}
