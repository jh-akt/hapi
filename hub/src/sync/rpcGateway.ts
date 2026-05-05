import type { CodexCollaborationMode, PermissionMode } from '@hapi/protocol/types'
import type {
    CodexAppServerMethod,
    CodexAppServerParams,
    CodexAppServerResult
} from '@hapi/protocol/codex-app-server'
import { isCodexAppServerMethod } from '@hapi/protocol/codex-app-server'
import type { Server } from 'socket.io'
import type { RpcRegistry } from '../socket/rpcRegistry'

export type RpcCommandResponse = {
    success: boolean
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
}

export type RpcReadFileResponse = {
    success: boolean
    content?: string
    error?: string
}

export type RpcUploadFileResponse = {
    success: boolean
    path?: string
    error?: string
}

export type RpcDeleteUploadResponse = {
    success: boolean
    error?: string
}

export type RpcDirectoryEntry = {
    name: string
    type: 'file' | 'directory' | 'other'
    size?: number
    modified?: number
}

export type RpcListDirectoryResponse = {
    success: boolean
    entries?: RpcDirectoryEntry[]
    error?: string
}

export type RpcPathExistsResponse = {
    exists: Record<string, boolean>
}

export type RpcCodexThreadStatus =
    | { type: 'notLoaded' }
    | { type: 'idle' }
    | { type: 'systemError' }
    | { type: 'active'; activeFlags: string[] }

export type RpcCodexTurn = {
    id: string
    items?: unknown[]
    status?: string | Record<string, unknown>
    error?: Record<string, unknown> | null
    startedAt?: number | null
    completedAt?: number | null
    durationMs?: number | null
    [key: string]: unknown
}

export type RpcCodexThread = {
    id: string
    forkedFromId?: string | null
    preview?: string
    ephemeral?: boolean
    modelProvider?: string
    createdAt?: number
    updatedAt?: number
    status?: RpcCodexThreadStatus
    path?: string | null
    cwd?: string
    cliVersion?: string
    source?: string | Record<string, unknown>
    agentNickname?: string | null
    agentRole?: string | null
    gitInfo?: Record<string, unknown> | null
    name?: string | null
    turns?: RpcCodexTurn[]
    [key: string]: unknown
}

export type RpcCodexThreadSortKey = 'created_at' | 'updated_at'
export type RpcCodexSortDirection = 'asc' | 'desc'
export type RpcCodexThreadSourceKind =
    | 'cli'
    | 'vscode'
    | 'exec'
    | 'appServer'
    | 'subAgent'
    | 'subAgentReview'
    | 'subAgentCompact'
    | 'subAgentThreadSpawn'
    | 'subAgentOther'
    | 'unknown'

export type RpcCodexThreadListParams = {
    cursor?: string | null
    limit?: number | null
    sortKey?: RpcCodexThreadSortKey | null
    sortDirection?: RpcCodexSortDirection | null
    modelProviders?: string[] | null
    sourceKinds?: RpcCodexThreadSourceKind[] | null
    archived?: boolean | null
    cwd?: string | string[] | null
    useStateDbOnly?: boolean
    searchTerm?: string | null
}

export type RpcCodexThreadListResponse = {
    data: RpcCodexThread[]
    nextCursor: string | null
    backwardsCursor: string | null
}

export type RpcCodexThreadReadParams = {
    threadId?: string | null
    includeTurns?: boolean
}

export type RpcCodexThreadReadResponse = {
    thread: RpcCodexThread
}

export type RpcCodexThreadForkParams = {
    threadId?: string | null
    path?: string | null
    model?: string | null
    modelProvider?: string | null
    cwd?: string | null
    approvalPolicy?: 'untrusted' | 'on-failure' | 'on-request' | 'never' | null
    sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access' | null
    config?: Record<string, unknown> | null
    baseInstructions?: string | null
    developerInstructions?: string | null
    ephemeral?: boolean
    excludeTurns?: boolean
    persistExtendedHistory?: boolean
}

export type RpcCodexThreadForkResponse = {
    thread: RpcCodexThread
    model: string
    modelProvider: string
    cwd: string
    instructionSources?: string[]
    reasoningEffort?: string | null
    [key: string]: unknown
}

export type RpcCodexThreadActionParams = {
    threadId?: string | null
}

export type RpcCodexThreadArchiveResponse = Record<string, never>

export type RpcCodexThreadUnarchiveResponse = {
    thread: RpcCodexThread
}

export type RpcCodexThreadRollbackParams = {
    threadId?: string | null
    numTurns: number
}

export type RpcCodexThreadRollbackResponse = {
    thread: RpcCodexThread
}

export type RpcCodexUserInput =
    | { type: 'text'; text: string; textElements?: Array<Record<string, unknown>>; text_elements?: Array<Record<string, unknown>> }
    | { type: 'image'; url: string }
    | { type: 'localImage'; path: string }
    | { type: 'skill'; name: string; path: string }
    | { type: 'mention'; name: string; path: string }

export type RpcCodexTurnSteerParams = {
    threadId?: string | null
    input: RpcCodexUserInput[]
    expectedTurnId?: string | null
}

export type RpcCodexTurnSteerResponse = {
    turnId: string
}

export type RpcCodexReviewTarget =
    | { type: 'uncommittedChanges' }
    | { type: 'baseBranch'; branch: string }
    | { type: 'commit'; sha: string; title: string | null }
    | { type: 'custom'; instructions: string }

export type RpcCodexReviewStartParams = {
    threadId?: string | null
    target: RpcCodexReviewTarget
    delivery?: 'inline' | 'detached' | null
}

export type RpcCodexReviewStartResponse = {
    turn: RpcCodexTurn
    reviewThreadId: string
}

const CODEX_APP_SERVER_RPC_METHOD = 'codex-app-server'

export class RpcGateway {
    constructor(
        private readonly io: Server,
        private readonly rpcRegistry: RpcRegistry
    ) {
    }

    async approvePermission(
        sessionId: string,
        requestId: string,
        mode?: PermissionMode,
        allowTools?: string[],
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort',
        answers?: Record<string, string[]> | Record<string, { answers: string[] }>
    ): Promise<void> {
        await this.sessionRpc(sessionId, 'permission', {
            id: requestId,
            approved: true,
            mode,
            allowTools,
            decision,
            answers
        })
    }

    async denyPermission(
        sessionId: string,
        requestId: string,
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
    ): Promise<void> {
        await this.sessionRpc(sessionId, 'permission', {
            id: requestId,
            approved: false,
            decision
        })
    }

    async abortSession(sessionId: string): Promise<void> {
        await this.sessionRpc(sessionId, 'abort', { reason: 'User aborted via Telegram Bot' })
    }

    async switchSession(sessionId: string, to: 'remote' | 'local'): Promise<void> {
        await this.sessionRpc(sessionId, 'switch', { to })
    }

    async requestSessionConfig(
        sessionId: string,
        config: {
            permissionMode?: PermissionMode
            model?: string | null
            modelReasoningEffort?: string | null
            effort?: string | null
            collaborationMode?: CodexCollaborationMode
        }
    ): Promise<unknown> {
        return await this.sessionRpc(sessionId, 'set-session-config', config)
    }

    async killSession(sessionId: string): Promise<void> {
        await this.sessionRpc(sessionId, 'killSession', {})
    }

    async spawnSession(
        machineId: string,
        directory: string,
        agent: 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode' = 'claude',
        model?: string,
        modelReasoningEffort?: string,
        yolo?: boolean,
        sessionType?: 'simple' | 'worktree',
        worktreeName?: string,
        resumeSessionId?: string,
        effort?: string,
        permissionMode?: PermissionMode
    ): Promise<{ type: 'success'; sessionId: string } | { type: 'error'; message: string }> {
        try {
            const result = await this.machineRpc(
                machineId,
                'spawn-happy-session',
                { type: 'spawn-in-directory', directory, agent, model, modelReasoningEffort, yolo, sessionType, worktreeName, resumeSessionId, effort, permissionMode }
            )
            if (result && typeof result === 'object') {
                const obj = result as Record<string, unknown>
                if (obj.type === 'success' && typeof obj.sessionId === 'string') {
                    return { type: 'success', sessionId: obj.sessionId }
                }
                if (obj.type === 'error' && typeof obj.errorMessage === 'string') {
                    return { type: 'error', message: obj.errorMessage }
                }
                if (obj.type === 'requestToApproveDirectoryCreation' && typeof obj.directory === 'string') {
                    return { type: 'error', message: `Directory creation requires approval: ${obj.directory}` }
                }
                if (typeof obj.error === 'string') {
                    return { type: 'error', message: obj.error }
                }
                if (obj.type !== 'success' && typeof obj.message === 'string') {
                    return { type: 'error', message: obj.message }
                }
            }
            const details = typeof result === 'string'
                ? result
                : (() => {
                    try {
                        return JSON.stringify(result)
                    } catch {
                        return String(result)
                    }
                })()
            return { type: 'error', message: `Unexpected spawn result: ${details}` }
        } catch (error) {
            return { type: 'error', message: error instanceof Error ? error.message : String(error) }
        }
    }

    async checkPathsExist(machineId: string, paths: string[]): Promise<Record<string, boolean>> {
        const result = await this.machineRpc(machineId, 'path-exists', { paths }) as RpcPathExistsResponse | unknown
        if (!result || typeof result !== 'object') {
            throw new Error('Unexpected path-exists result')
        }

        const existsValue = (result as RpcPathExistsResponse).exists
        if (!existsValue || typeof existsValue !== 'object') {
            throw new Error('Unexpected path-exists result')
        }

        const exists: Record<string, boolean> = {}
        for (const [key, value] of Object.entries(existsValue)) {
            exists[key] = value === true
        }
        return exists
    }

    async getGitStatus(sessionId: string, cwd?: string): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-status', { cwd }) as RpcCommandResponse
    }

    async getGitDiffNumstat(sessionId: string, options: { cwd?: string; staged?: boolean }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-diff-numstat', options) as RpcCommandResponse
    }

    async getGitDiffFile(sessionId: string, options: { cwd?: string; filePath: string; staged?: boolean }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-diff-file', options) as RpcCommandResponse
    }

    async readSessionFile(sessionId: string, path: string): Promise<RpcReadFileResponse> {
        return await this.sessionRpc(sessionId, 'readFile', { path }) as RpcReadFileResponse
    }

    async listDirectory(sessionId: string, path: string): Promise<RpcListDirectoryResponse> {
        return await this.sessionRpc(sessionId, 'listDirectory', { path }) as RpcListDirectoryResponse
    }

    async uploadFile(sessionId: string, filename: string, content: string, mimeType: string): Promise<RpcUploadFileResponse> {
        return await this.sessionRpc(sessionId, 'uploadFile', { sessionId, filename, content, mimeType }) as RpcUploadFileResponse
    }

    async deleteUploadFile(sessionId: string, path: string): Promise<RpcDeleteUploadResponse> {
        return await this.sessionRpc(sessionId, 'deleteUpload', { sessionId, path }) as RpcDeleteUploadResponse
    }

    async runRipgrep(sessionId: string, args: string[], cwd?: string): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'ripgrep', { args, cwd }) as RpcCommandResponse
    }

    async listSlashCommands(sessionId: string, agent: string): Promise<{
        success: boolean
        commands?: Array<{ name: string; description?: string; source: 'builtin' | 'user' | 'plugin' | 'project' }>
        error?: string
    }> {
        return await this.sessionRpc(sessionId, 'listSlashCommands', { agent }) as {
            success: boolean
            commands?: Array<{ name: string; description?: string; source: 'builtin' | 'user' | 'plugin' | 'project' }>
            error?: string
        }
    }

    async listSkills(sessionId: string): Promise<{
        success: boolean
        skills?: Array<{ name: string; description?: string }>
        error?: string
    }> {
        return await this.sessionRpc(sessionId, 'listSkills', {}) as {
            success: boolean
            skills?: Array<{ name: string; description?: string }>
            error?: string
        }
    }

    async listCodexThreads(sessionId: string, params: RpcCodexThreadListParams = {}): Promise<RpcCodexThreadListResponse> {
        return await this.codexAppServerRpc(sessionId, 'thread/list', params) as RpcCodexThreadListResponse
    }

    async listCodexThreadsFromMachine(machineId: string, params: RpcCodexThreadListParams = {}): Promise<RpcCodexThreadListResponse> {
        return await this.machineCodexAppServerRpc(machineId, 'thread/list', params) as RpcCodexThreadListResponse
    }

    async readCodexThreadFromMachine(machineId: string, params: RpcCodexThreadReadParams): Promise<RpcCodexThreadReadResponse> {
        return await this.machineCodexAppServerRpc(machineId, 'thread/read', params) as RpcCodexThreadReadResponse
    }

    async codexAppServerFromMachine<TMethod extends CodexAppServerMethod>(
        machineId: string,
        method: TMethod,
        params: CodexAppServerParams<TMethod>
    ): Promise<CodexAppServerResult<TMethod>> {
        if (!isCodexAppServerMethod(method)) {
            throw new Error(`Unsupported Codex app-server RPC method: ${method}`)
        }
        return await this.machineCodexAppServerRpc(machineId, method, params) as CodexAppServerResult<TMethod>
    }

    async readCodexThread(sessionId: string, params: RpcCodexThreadReadParams): Promise<RpcCodexThreadReadResponse> {
        return await this.codexAppServerRpc(sessionId, 'thread/read', params) as RpcCodexThreadReadResponse
    }

    async forkCodexThread(sessionId: string, params: RpcCodexThreadForkParams): Promise<RpcCodexThreadForkResponse> {
        return await this.codexAppServerRpc(sessionId, 'thread/fork', params) as RpcCodexThreadForkResponse
    }

    async archiveCodexThread(sessionId: string, params: RpcCodexThreadActionParams): Promise<RpcCodexThreadArchiveResponse> {
        return await this.codexAppServerRpc(sessionId, 'thread/archive', params) as RpcCodexThreadArchiveResponse
    }

    async unarchiveCodexThread(sessionId: string, params: RpcCodexThreadActionParams): Promise<RpcCodexThreadUnarchiveResponse> {
        return await this.codexAppServerRpc(sessionId, 'thread/unarchive', params) as RpcCodexThreadUnarchiveResponse
    }

    async rollbackCodexThread(sessionId: string, params: RpcCodexThreadRollbackParams): Promise<RpcCodexThreadRollbackResponse> {
        return await this.codexAppServerRpc(sessionId, 'thread/rollback', params) as RpcCodexThreadRollbackResponse
    }

    async steerCodexTurn(sessionId: string, params: RpcCodexTurnSteerParams): Promise<RpcCodexTurnSteerResponse> {
        return await this.codexAppServerRpc(sessionId, 'turn/steer', params) as RpcCodexTurnSteerResponse
    }

    async startCodexReview(sessionId: string, params: RpcCodexReviewStartParams): Promise<RpcCodexReviewStartResponse> {
        return await this.codexAppServerRpc(sessionId, 'review/start', params) as RpcCodexReviewStartResponse
    }

    async codexAppServer<TMethod extends CodexAppServerMethod>(
        sessionId: string,
        method: TMethod,
        params: CodexAppServerParams<TMethod>
    ): Promise<CodexAppServerResult<TMethod>> {
        if (!isCodexAppServerMethod(method)) {
            throw new Error(`Unsupported Codex app-server RPC method: ${method}`)
        }
        return await this.codexAppServerRpc(sessionId, method, params) as CodexAppServerResult<TMethod>
    }

    async machineCodexAppServer<TMethod extends CodexAppServerMethod>(
        machineId: string,
        method: TMethod,
        params: CodexAppServerParams<TMethod>
    ): Promise<CodexAppServerResult<TMethod>> {
        if (!isCodexAppServerMethod(method)) {
            throw new Error(`Unsupported Codex app-server RPC method: ${method}`)
        }
        return await this.machineCodexAppServerRpc(machineId, method, params) as CodexAppServerResult<TMethod>
    }

    private async sessionRpc(sessionId: string, method: string, params: unknown): Promise<unknown> {
        return await this.rpcCall(`${sessionId}:${method}`, params)
    }

    private async codexAppServerRpc(
        sessionId: string,
        method: CodexAppServerMethod,
        params: unknown
    ): Promise<unknown> {
        return await this.sessionRpc(sessionId, CODEX_APP_SERVER_RPC_METHOD, { method, params })
    }

    private async machineCodexAppServerRpc(
        machineId: string,
        method: CodexAppServerMethod,
        params: unknown
    ): Promise<unknown> {
        return await this.machineRpc(machineId, CODEX_APP_SERVER_RPC_METHOD, { method, params })
    }

    private async machineRpc(machineId: string, method: string, params: unknown): Promise<unknown> {
        return await this.rpcCall(`${machineId}:${method}`, params)
    }

    private async rpcCall(method: string, params: unknown): Promise<unknown> {
        const socketId = this.rpcRegistry.getSocketIdForMethod(method)
        if (!socketId) {
            throw new Error(`RPC handler not registered: ${method}`)
        }

        const socket = this.io.of('/cli').sockets.get(socketId)
        if (!socket) {
            throw new Error(`RPC socket disconnected: ${method}`)
        }

        const response = await socket.timeout(30_000).emitWithAck('rpc-request', {
            method,
            params: JSON.stringify(params)
        }) as unknown

        if (typeof response !== 'string') {
            return response
        }

        try {
            return JSON.parse(response) as unknown
        } catch {
            return response
        }
    }
}
