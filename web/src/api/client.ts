import type {
    CodexAppServerMethod,
    CodexAppServerParams,
    CodexAppServerResult,
    AttachmentMetadata,
    AuthResponse,
    CodexCollaborationMode,
    CodexSessionsResponse,
    CodexReviewStartParams,
    CodexReviewStartResponse,
    CodexThreadActionParams,
    CodexThreadArchiveResponse,
    CodexThreadForkParams,
    CodexThreadForkResponse,
    CodexThreadListParams,
    CodexThreadListResponse,
    CodexThreadReadParams,
    CodexThreadReadResponse,
    CodexThreadRollbackParams,
    CodexThreadRollbackResponse,
    CodexThreadTurnsListResponse,
    CodexThreadUnarchiveResponse,
    CodexOpenStrategy,
    CodexTurnSteerParams,
    CodexTurnSteerResponse,
    DeleteUploadResponse,
    ListDirectoryResponse,
    FileReadResponse,
    FileSearchResponse,
    GitCommandResponse,
    MachinePathsExistsResponse,
    MachinesResponse,
    MessagesResponse,
    ProjectsResponse,
    CreateProjectResponse,
    NativeSessionAttachResponse,
    NativeSessionsResponse,
    PermissionMode,
    PushSubscriptionPayload,
    PushUnsubscribePayload,
    PushVapidPublicKeyResponse,
    SlashCommandsResponse,
    SkillsResponse,
    SpawnResponse,
    UploadFileResponse,
    VisibilityPayload,
    SessionResponse,
    SessionsResponse
} from '@/types/api'

type ApiClientOptions = {
    baseUrl?: string
    getToken?: () => string | null
    onUnauthorized?: () => Promise<string | null>
}

type ErrorPayload = {
    error?: unknown
}

function parseErrorCode(bodyText: string): string | undefined {
    try {
        const parsed = JSON.parse(bodyText) as ErrorPayload
        return typeof parsed.error === 'string' ? parsed.error : undefined
    } catch {
        return undefined
    }
}

export class ApiError extends Error {
    status: number
    code?: string
    body?: string

    constructor(message: string, status: number, code?: string, body?: string) {
        super(message)
        this.name = 'ApiError'
        this.status = status
        this.code = code
        this.body = body
    }
}

export class ApiClient {
    private token: string
    private readonly baseUrl: string | null
    private readonly getToken: (() => string | null) | null
    private readonly onUnauthorized: (() => Promise<string | null>) | null

    constructor(token: string, options?: ApiClientOptions) {
        this.token = token
        this.baseUrl = options?.baseUrl ?? null
        this.getToken = options?.getToken ?? null
        this.onUnauthorized = options?.onUnauthorized ?? null
    }

    private buildUrl(path: string): string {
        if (!this.baseUrl) {
            return path
        }
        try {
            return new URL(path, this.baseUrl).toString()
        } catch {
            return path
        }
    }

    private async request<T>(
        path: string,
        init?: RequestInit,
        attempt: number = 0,
        overrideToken?: string | null
    ): Promise<T> {
        const headers = new Headers(init?.headers)
        const liveToken = this.getToken ? this.getToken() : null
        const authToken = overrideToken !== undefined
            ? (overrideToken ?? (liveToken ?? this.token))
            : (liveToken ?? this.token)
        if (authToken) {
            headers.set('authorization', `Bearer ${authToken}`)
        }
        if (init?.body !== undefined && !headers.has('content-type')) {
            headers.set('content-type', 'application/json')
        }

        const res = await fetch(this.buildUrl(path), {
            ...init,
            headers
        })

        if (res.status === 401) {
            if (attempt === 0 && this.onUnauthorized) {
                const refreshed = await this.onUnauthorized()
                if (refreshed) {
                    this.token = refreshed
                    return await this.request<T>(path, init, attempt + 1, refreshed)
                }
            }
            throw new Error('Session expired. Please sign in again.')
        }

        if (!res.ok) {
            const body = await res.text().catch(() => '')
            throw new Error(`HTTP ${res.status} ${res.statusText}: ${body}`)
        }

        return await res.json() as T
    }

    async authenticate(auth: { initData: string } | { accessToken: string }): Promise<AuthResponse> {
        const res = await fetch(this.buildUrl('/api/auth'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(auth)
        })

        if (!res.ok) {
            const body = await res.text().catch(() => '')
            const code = parseErrorCode(body)
            const detail = body ? `: ${body}` : ''
            throw new ApiError(`Auth failed: HTTP ${res.status} ${res.statusText}${detail}`, res.status, code, body || undefined)
        }

        return await res.json() as AuthResponse
    }

    async bind(auth: { initData: string; accessToken: string }): Promise<AuthResponse> {
        const res = await fetch(this.buildUrl('/api/bind'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(auth)
        })

        if (!res.ok) {
            const body = await res.text().catch(() => '')
            const code = parseErrorCode(body)
            const detail = body ? `: ${body}` : ''
            throw new ApiError(`Bind failed: HTTP ${res.status} ${res.statusText}${detail}`, res.status, code, body || undefined)
        }

        return await res.json() as AuthResponse
    }

    async getSessions(): Promise<SessionsResponse> {
        return await this.request<SessionsResponse>('/api/sessions')
    }

    async getCodexSessions(): Promise<CodexSessionsResponse> {
        return await this.request<CodexSessionsResponse>('/api/codex-sessions')
    }

    async getProjects(): Promise<ProjectsResponse> {
        return await this.request<ProjectsResponse>('/api/projects')
    }

    async getPushVapidPublicKey(): Promise<PushVapidPublicKeyResponse> {
        return await this.request<PushVapidPublicKeyResponse>('/api/push/vapid-public-key')
    }

    async subscribePushNotifications(payload: PushSubscriptionPayload): Promise<void> {
        await this.request('/api/push/subscribe', {
            method: 'POST',
            body: JSON.stringify(payload)
        })
    }

    async unsubscribePushNotifications(payload: PushUnsubscribePayload): Promise<void> {
        await this.request('/api/push/subscribe', {
            method: 'DELETE',
            body: JSON.stringify(payload)
        })
    }

    async setVisibility(payload: VisibilityPayload): Promise<void> {
        await this.request('/api/visibility', {
            method: 'POST',
            body: JSON.stringify(payload)
        })
    }

    async getSession(sessionId: string): Promise<SessionResponse> {
        return await this.request<SessionResponse>(`/api/sessions/${encodeURIComponent(sessionId)}`)
    }

    async getMessages(sessionId: string, options: { beforeSeq?: number | null; limit?: number }): Promise<MessagesResponse> {
        const params = new URLSearchParams()
        if (options.beforeSeq !== undefined && options.beforeSeq !== null) {
            params.set('beforeSeq', `${options.beforeSeq}`)
        }
        if (options.limit !== undefined && options.limit !== null) {
            params.set('limit', `${options.limit}`)
        }

        const qs = params.toString()
        const url = `/api/sessions/${encodeURIComponent(sessionId)}/messages${qs ? `?${qs}` : ''}`
        return await this.request<MessagesResponse>(url)
    }

    async getGitStatus(sessionId: string): Promise<GitCommandResponse> {
        return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-status`)
    }

    async getGitDiffNumstat(sessionId: string, staged: boolean): Promise<GitCommandResponse> {
        const params = new URLSearchParams()
        params.set('staged', staged ? 'true' : 'false')
        return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-diff-numstat?${params.toString()}`)
    }

    async getGitDiffFile(sessionId: string, path: string, staged?: boolean): Promise<GitCommandResponse> {
        const params = new URLSearchParams()
        params.set('path', path)
        if (staged !== undefined) {
            params.set('staged', staged ? 'true' : 'false')
        }
        return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-diff-file?${params.toString()}`)
    }

    async searchSessionFiles(sessionId: string, query: string, limit?: number): Promise<FileSearchResponse> {
        const params = new URLSearchParams()
        if (query) {
            params.set('query', query)
        }
        if (limit !== undefined) {
            params.set('limit', `${limit}`)
        }
        const qs = params.toString()
        return await this.request<FileSearchResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/files${qs ? `?${qs}` : ''}`)
    }

    async readSessionFile(sessionId: string, path: string): Promise<FileReadResponse> {
        const params = new URLSearchParams()
        params.set('path', path)
        return await this.request<FileReadResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/file?${params.toString()}`)
    }

    async listSessionDirectory(sessionId: string, path?: string): Promise<ListDirectoryResponse> {
        const params = new URLSearchParams()
        if (path) {
            params.set('path', path)
        }

        const qs = params.toString()
        return await this.request<ListDirectoryResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/directory${qs ? `?${qs}` : ''}`
        )
    }

    async uploadFile(sessionId: string, filename: string, content: string, mimeType: string): Promise<UploadFileResponse> {
        return await this.request<UploadFileResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/upload`, {
            method: 'POST',
            body: JSON.stringify({ filename, content, mimeType })
        })
    }

    async deleteUploadFile(sessionId: string, path: string): Promise<DeleteUploadResponse> {
        return await this.request<DeleteUploadResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/upload/delete`, {
            method: 'POST',
            body: JSON.stringify({ path })
        })
    }

    async resumeSession(sessionId: string): Promise<string> {
        const response = await this.request<{ sessionId: string }>(
            `/api/sessions/${encodeURIComponent(sessionId)}/resume`,
            { method: 'POST' }
        )
        return response.sessionId
    }

    async sendMessage(sessionId: string, text: string, localId?: string | null, attachments?: AttachmentMetadata[]): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
            method: 'POST',
            body: JSON.stringify({
                text,
                localId: localId ?? undefined,
                attachments: attachments ?? undefined
            })
        })
    }

    async abortSession(sessionId: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/abort`, {
            method: 'POST',
            body: JSON.stringify({})
        })
    }

    async archiveSession(sessionId: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/archive`, {
            method: 'POST',
            body: JSON.stringify({})
        })
    }

    async forkSession(sessionId: string, options?: { directory?: string }): Promise<string> {
        const response = await this.request<{ sessionId: string }>(
            `/api/sessions/${encodeURIComponent(sessionId)}/fork`,
            {
                method: 'POST',
                body: JSON.stringify(options ?? {})
            }
        )
        return response.sessionId
    }

    async listCodexThreads(sessionId: string, params?: CodexThreadListParams): Promise<CodexThreadListResponse> {
        return await this.request<CodexThreadListResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/codex/threads/list`,
            {
                method: 'POST',
                body: JSON.stringify(params ?? {})
            }
        )
    }

    async codexAppServer<TMethod extends CodexAppServerMethod>(
        sessionId: string,
        method: TMethod,
        params: CodexAppServerParams<TMethod>
    ): Promise<CodexAppServerResult<TMethod>> {
        return await this.request<CodexAppServerResult<TMethod>>(
            `/api/sessions/${encodeURIComponent(sessionId)}/codex/app-server`,
            {
                method: 'POST',
                body: JSON.stringify({ method, params })
            }
        )
    }

    async readCodexThread(sessionId: string, params: CodexThreadReadParams): Promise<CodexThreadReadResponse> {
        return await this.codexAppServer(
            sessionId,
            'thread/read',
            params as CodexAppServerParams<'thread/read'>
        ) as CodexThreadReadResponse
    }

    async forkCodexThread(sessionId: string, params: CodexThreadForkParams): Promise<CodexThreadForkResponse> {
        return await this.codexAppServer(
            sessionId,
            'thread/fork',
            params as CodexAppServerParams<'thread/fork'>
        ) as CodexThreadForkResponse
    }

    async archiveCodexThread(sessionId: string, params?: CodexThreadActionParams): Promise<CodexThreadArchiveResponse> {
        return await this.codexAppServer(
            sessionId,
            'thread/archive',
            (params ?? {}) as CodexAppServerParams<'thread/archive'>
        ) as CodexThreadArchiveResponse
    }

    async unarchiveCodexThread(sessionId: string, params?: CodexThreadActionParams): Promise<CodexThreadUnarchiveResponse> {
        return await this.codexAppServer(
            sessionId,
            'thread/unarchive',
            (params ?? {}) as CodexAppServerParams<'thread/unarchive'>
        ) as CodexThreadUnarchiveResponse
    }

    async rollbackCodexThread(sessionId: string, params: CodexThreadRollbackParams): Promise<CodexThreadRollbackResponse> {
        return await this.codexAppServer(
            sessionId,
            'thread/rollback',
            params as CodexAppServerParams<'thread/rollback'>
        ) as CodexThreadRollbackResponse
    }

    async renameCodexThread(
        sessionId: string,
        params: CodexAppServerParams<'thread/name/set'>
    ): Promise<CodexAppServerResult<'thread/name/set'>> {
        return await this.codexAppServer(sessionId, 'thread/name/set', params)
    }

    async compactCodexThread(
        sessionId: string,
        params: CodexAppServerParams<'thread/compact/start'>
    ): Promise<CodexAppServerResult<'thread/compact/start'>> {
        return await this.codexAppServer(sessionId, 'thread/compact/start', params)
    }

    async listCodexThreadTurns(
        sessionId: string,
        params: CodexAppServerParams<'thread/turns/list'>
    ): Promise<CodexThreadTurnsListResponse> {
        return await this.codexAppServer(sessionId, 'thread/turns/list', params) as CodexThreadTurnsListResponse
    }

    async steerCodexTurn(sessionId: string, params: CodexTurnSteerParams): Promise<CodexTurnSteerResponse> {
        return await this.codexAppServer(
            sessionId,
            'turn/steer',
            params as CodexAppServerParams<'turn/steer'>
        ) as CodexTurnSteerResponse
    }

    async startCodexReview(sessionId: string, params: CodexReviewStartParams): Promise<CodexReviewStartResponse> {
        return await this.codexAppServer(
            sessionId,
            'review/start',
            params as CodexAppServerParams<'review/start'>
        ) as CodexReviewStartResponse
    }

    async listCodexSkills(
        sessionId: string,
        params: CodexAppServerParams<'skills/list'>
    ): Promise<CodexAppServerResult<'skills/list'>> {
        return await this.codexAppServer(sessionId, 'skills/list', params)
    }

    async listCodexPlugins(
        sessionId: string,
        params: CodexAppServerParams<'plugin/list'>
    ): Promise<CodexAppServerResult<'plugin/list'>> {
        return await this.codexAppServer(sessionId, 'plugin/list', params)
    }

    async readCodexPlugin(
        sessionId: string,
        params: CodexAppServerParams<'plugin/read'>
    ): Promise<CodexAppServerResult<'plugin/read'>> {
        return await this.codexAppServer(sessionId, 'plugin/read', params)
    }

    async installCodexPlugin(
        sessionId: string,
        params: CodexAppServerParams<'plugin/install'>
    ): Promise<CodexAppServerResult<'plugin/install'>> {
        return await this.codexAppServer(sessionId, 'plugin/install', params)
    }

    async uninstallCodexPlugin(
        sessionId: string,
        params: CodexAppServerParams<'plugin/uninstall'>
    ): Promise<CodexAppServerResult<'plugin/uninstall'>> {
        return await this.codexAppServer(sessionId, 'plugin/uninstall', params)
    }

    async listCodexApps(
        sessionId: string,
        params: CodexAppServerParams<'app/list'>
    ): Promise<CodexAppServerResult<'app/list'>> {
        return await this.codexAppServer(sessionId, 'app/list', params)
    }

    async listCodexMcpServers(
        sessionId: string,
        params: CodexAppServerParams<'mcpServerStatus/list'>
    ): Promise<CodexAppServerResult<'mcpServerStatus/list'>> {
        return await this.codexAppServer(sessionId, 'mcpServerStatus/list', params)
    }

    async readCodexMcpResource(
        sessionId: string,
        params: CodexAppServerParams<'mcpServer/resource/read'>
    ): Promise<CodexAppServerResult<'mcpServer/resource/read'>> {
        return await this.codexAppServer(sessionId, 'mcpServer/resource/read', params)
    }

    async callCodexMcpTool(
        sessionId: string,
        params: CodexAppServerParams<'mcpServer/tool/call'>
    ): Promise<CodexAppServerResult<'mcpServer/tool/call'>> {
        return await this.codexAppServer(sessionId, 'mcpServer/tool/call', params)
    }

    async setCodexThreadMemoryMode(
        sessionId: string,
        params: CodexAppServerParams<'thread/memoryMode/set'>
    ): Promise<CodexAppServerResult<'thread/memoryMode/set'>> {
        return await this.codexAppServer(sessionId, 'thread/memoryMode/set', params)
    }

    async resetCodexMemory(sessionId: string): Promise<CodexAppServerResult<'memory/reset'>> {
        return await this.codexAppServer(
            sessionId,
            'memory/reset',
            undefined as CodexAppServerParams<'memory/reset'>
        )
    }

    async createProject(payload: {
        path: string
        name?: string
    }): Promise<CreateProjectResponse> {
        return await this.request<CreateProjectResponse>('/api/projects', {
            method: 'POST',
            body: JSON.stringify(payload)
        })
    }

    async openCodexSession(payload: {
        cwd: string
        codexSessionId: string
        title?: string
        openStrategy?: CodexOpenStrategy
    }): Promise<NativeSessionAttachResponse> {
        return await this.request<NativeSessionAttachResponse>('/api/codex-sessions/open', {
            method: 'POST',
            body: JSON.stringify(payload)
        })
    }

    async switchSession(sessionId: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/switch`, {
            method: 'POST',
            body: JSON.stringify({})
        })
    }

    async setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/permission-mode`, {
            method: 'POST',
            body: JSON.stringify({ mode })
        })
    }

    async setCollaborationMode(sessionId: string, mode: CodexCollaborationMode): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/collaboration-mode`, {
            method: 'POST',
            body: JSON.stringify({ mode })
        })
    }

    async setModel(sessionId: string, model: string | null): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/model`, {
            method: 'POST',
            body: JSON.stringify({ model })
        })
    }

    async setModelReasoningEffort(sessionId: string, modelReasoningEffort: string | null): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/model-reasoning-effort`, {
            method: 'POST',
            body: JSON.stringify({ modelReasoningEffort })
        })
    }

    async setEffort(sessionId: string, effort: string | null): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/effort`, {
            method: 'POST',
            body: JSON.stringify({ effort })
        })
    }

    async approvePermission(
        sessionId: string,
        requestId: string,
        modeOrOptions?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | {
            mode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'
            allowTools?: string[]
            decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
            answers?: Record<string, string[]> | Record<string, { answers: string[] }>
        }
    ): Promise<void> {
        const body = typeof modeOrOptions === 'string' || modeOrOptions === undefined
            ? { mode: modeOrOptions }
            : modeOrOptions
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(requestId)}/approve`, {
            method: 'POST',
            body: JSON.stringify(body)
        })
    }

    async denyPermission(
        sessionId: string,
        requestId: string,
        options?: {
            decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
        }
    ): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(requestId)}/deny`, {
            method: 'POST',
            body: JSON.stringify(options ?? {})
        })
    }

    async getMachines(): Promise<MachinesResponse> {
        return await this.request<MachinesResponse>('/api/machines')
    }

    async discoverNativeSessions(): Promise<NativeSessionsResponse> {
        return await this.request<NativeSessionsResponse>('/api/native-sessions/discover')
    }

    async attachNativeSession(payload: {
        tmuxSession: string
        tmuxPane: string
        agent?: 'codex'
        title?: string
    }): Promise<NativeSessionAttachResponse> {
        return await this.request<NativeSessionAttachResponse>('/api/native-sessions/attach', {
            method: 'POST',
            body: JSON.stringify(payload)
        })
    }

    async createNativeSession(payload: {
        cwd: string
        agent?: 'codex'
        title?: string
    }): Promise<NativeSessionAttachResponse> {
        return await this.request<NativeSessionAttachResponse>('/api/native-sessions/create', {
            method: 'POST',
            body: JSON.stringify(payload)
        })
    }

    async detachNativeSession(sessionId: string): Promise<void> {
        await this.request(`/api/native-sessions/${encodeURIComponent(sessionId)}/detach`, {
            method: 'POST',
            body: JSON.stringify({})
        })
    }

    async checkMachinePathsExists(
        machineId: string,
        paths: string[]
    ): Promise<MachinePathsExistsResponse> {
        return await this.request<MachinePathsExistsResponse>(
            `/api/machines/${encodeURIComponent(machineId)}/paths/exists`,
            {
                method: 'POST',
                body: JSON.stringify({ paths })
            }
        )
    }

    async spawnSession(
        machineId: string,
        directory: string,
        agent?: 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode',
        model?: string,
        modelReasoningEffort?: string,
        yolo?: boolean,
        sessionType?: 'simple' | 'worktree',
        worktreeName?: string,
        effort?: string
    ): Promise<SpawnResponse> {
        return await this.request<SpawnResponse>(`/api/machines/${encodeURIComponent(machineId)}/spawn`, {
            method: 'POST',
            body: JSON.stringify({ directory, agent, model, modelReasoningEffort, yolo, sessionType, worktreeName, effort })
        })
    }

    async getSlashCommands(sessionId: string): Promise<SlashCommandsResponse> {
        return await this.request<SlashCommandsResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/slash-commands`
        )
    }

    async getSkills(sessionId: string): Promise<SkillsResponse> {
        return await this.request<SkillsResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/skills`
        )
    }

    async renameSession(sessionId: string, name: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}`, {
            method: 'PATCH',
            body: JSON.stringify({ name })
        })
    }

    async deleteSession(sessionId: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}`, {
            method: 'DELETE'
        })
    }

    async fetchVoiceToken(options?: { customAgentId?: string; customApiKey?: string }): Promise<{
        allowed: boolean
        token?: string
        agentId?: string
        error?: string
    }> {
        return await this.request('/api/voice/token', {
            method: 'POST',
            body: JSON.stringify(options || {})
        })
    }
}
