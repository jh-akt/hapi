import type {
    DecryptedMessage as ProtocolDecryptedMessage,
    NativeSessionMetadata,
    Session,
    SessionSummary,
    SessionSource,
    SyncEvent as ProtocolSyncEvent,
    WorktreeMetadata
} from '@hapi/protocol/types'

export type {
    AgentState,
    AttachmentMetadata,
    CodexCollaborationMode,
    NativeSessionMetadata,
    PermissionMode,
    Session,
    SessionSummary,
    SessionSummaryMetadata,
    SessionSource,
    TeamMember,
    TeamMessage,
    TeamState,
    TeamTask,
    TodoItem,
    WorktreeMetadata
} from '@hapi/protocol/types'

export type SessionMetadataSummary = {
    path: string
    host: string
    version?: string
    name?: string
    os?: string
    summary?: { text: string; updatedAt: number }
    machineId?: string
    tools?: string[]
    flavor?: string | null
    source?: SessionSource
    native?: NativeSessionMetadata
    worktree?: WorktreeMetadata
}

export type MessageStatus = 'queued' | 'sending' | 'sent' | 'failed'

export type DecryptedMessage = ProtocolDecryptedMessage & {
    status?: MessageStatus
    originalText?: string
}

export type RunnerState = {
    status?: string
    pid?: number
    httpPort?: number
    startedAt?: number
    shutdownRequestedAt?: number
    shutdownSource?: string
    lastSpawnError?: {
        message: string
        pid?: number
        exitCode?: number | null
        signal?: string | null
        at: number
    } | null
}

export type Machine = {
    id: string
    active: boolean
    metadata: {
        host: string
        platform: string
        happyCliVersion: string
        displayName?: string
    } | null
    runnerState?: RunnerState | null
}

export type AuthResponse = {
    token: string
    user: {
        id: number
        username?: string
        firstName?: string
        lastName?: string
    }
}

export type SessionsResponse = { sessions: SessionSummary[] }
export type CodexSessionSummary = SessionSummary & {
    attachedSessionId: string | null
    listSource: 'codex-history'
    codexSessionId: string
}
export type CodexSessionsResponse = { sessions: CodexSessionSummary[] }
export type SessionResponse = { session: Session }

export type CodexThreadStatus =
    | { type: 'notLoaded' }
    | { type: 'idle' }
    | { type: 'systemError' }
    | { type: 'active'; activeFlags: string[] }

export type CodexTurn = {
    id: string
    items?: unknown[]
    status?: string | Record<string, unknown>
    error?: Record<string, unknown> | null
    startedAt?: number | null
    completedAt?: number | null
    durationMs?: number | null
    [key: string]: unknown
}

export type CodexThread = {
    id: string
    forkedFromId?: string | null
    preview?: string
    ephemeral?: boolean
    modelProvider?: string
    createdAt?: number
    updatedAt?: number
    status?: CodexThreadStatus
    path?: string | null
    cwd?: string
    cliVersion?: string
    source?: string | Record<string, unknown>
    agentNickname?: string | null
    agentRole?: string | null
    gitInfo?: Record<string, unknown> | null
    name?: string | null
    turns?: CodexTurn[]
    [key: string]: unknown
}

export type CodexThreadSortKey = 'created_at' | 'updated_at'
export type CodexSortDirection = 'asc' | 'desc'
export type CodexThreadSourceKind =
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

export type CodexThreadListParams = {
    cursor?: string | null
    limit?: number | null
    sortKey?: CodexThreadSortKey | null
    sortDirection?: CodexSortDirection | null
    modelProviders?: string[] | null
    sourceKinds?: CodexThreadSourceKind[] | null
    archived?: boolean | null
    cwd?: string | string[] | null
    useStateDbOnly?: boolean
    searchTerm?: string | null
}

export type CodexThreadListResponse = {
    data: CodexThread[]
    nextCursor: string | null
    backwardsCursor: string | null
}

export type CodexThreadReadParams = {
    threadId?: string | null
    includeTurns?: boolean
}

export type CodexThreadReadResponse = {
    thread: CodexThread
}

export type CodexThreadForkParams = {
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

export type CodexThreadForkResponse = {
    thread: CodexThread
    model: string
    modelProvider: string
    cwd: string
    instructionSources?: string[]
    reasoningEffort?: string | null
    [key: string]: unknown
}

export type CodexThreadActionParams = {
    threadId?: string | null
}

export type CodexThreadArchiveResponse = Record<string, never>

export type CodexThreadUnarchiveResponse = {
    thread: CodexThread
}

export type CodexThreadRollbackParams = {
    threadId?: string | null
    numTurns: number
}

export type CodexThreadRollbackResponse = {
    thread: CodexThread
}

export type CodexUserInput =
    | { type: 'text'; text: string; textElements?: Array<Record<string, unknown>>; text_elements?: Array<Record<string, unknown>> }
    | { type: 'image'; url: string }
    | { type: 'localImage'; path: string }
    | { type: 'skill'; name: string; path: string }
    | { type: 'mention'; name: string; path: string }

export type CodexTurnSteerParams = {
    threadId?: string | null
    input: CodexUserInput[]
    expectedTurnId?: string | null
}

export type CodexTurnSteerResponse = {
    turnId: string
}

export type CodexReviewTarget =
    | { type: 'uncommittedChanges' }
    | { type: 'baseBranch'; branch: string }
    | { type: 'commit'; sha: string; title: string | null }
    | { type: 'custom'; instructions: string }

export type CodexReviewStartParams = {
    threadId?: string | null
    target: CodexReviewTarget
    delivery?: 'inline' | 'detached' | null
}

export type CodexReviewStartResponse = {
    turn: CodexTurn
    reviewThreadId: string
}

export type ProjectSummary = {
    id: string
    namespace: string
    path: string
    name: string | null
    createdAt: number
    updatedAt: number
}
export type ProjectsResponse = { projects: ProjectSummary[] }
export type CreateProjectResponse = {
    project: ProjectSummary
    nativeSession: NativeSessionCandidate | null
}
export type MessagesResponse = {
    messages: DecryptedMessage[]
    page: {
        limit: number
        beforeSeq: number | null
        nextBeforeSeq: number | null
        hasMore: boolean
    }
}

export type MachinesResponse = { machines: Machine[] }
export type MachinePathsExistsResponse = { exists: Record<string, boolean> }
export type NativeSessionCandidate = {
    tmuxSession: string
    tmuxPane: string
    cwd: string
    command: 'codex'
    sessionId?: string
}
export type NativeSessionsResponse = { sessions: NativeSessionCandidate[] }
export type NativeSessionAttachResponse = { sessionId: string }

export type SpawnResponse =
    | { type: 'success'; sessionId: string }
    | { type: 'error'; message: string }

export type GitCommandResponse = {
    success: boolean
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
}

export type FileSearchItem = {
    fileName: string
    filePath: string
    fullPath: string
    fileType: 'file' | 'folder'
}

export type FileSearchResponse = {
    success: boolean
    files?: FileSearchItem[]
    error?: string
}

export type DirectoryEntry = {
    name: string
    type: 'file' | 'directory' | 'other'
    size?: number
    modified?: number
}

export type ListDirectoryResponse = {
    success: boolean
    entries?: DirectoryEntry[]
    error?: string
}

export type FileReadResponse = {
    success: boolean
    content?: string
    error?: string
}

export type UploadFileResponse = {
    success: boolean
    path?: string
    error?: string
}

export type DeleteUploadResponse = {
    success: boolean
    error?: string
}

export type GitFileStatus = {
    fileName: string
    filePath: string
    fullPath: string
    status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'
    isStaged: boolean
    linesAdded: number
    linesRemoved: number
    oldPath?: string
}

export type GitStatusFiles = {
    stagedFiles: GitFileStatus[]
    unstagedFiles: GitFileStatus[]
    branch: string | null
    totalStaged: number
    totalUnstaged: number
}

export type SlashCommand = {
    name: string
    description?: string
    source: 'builtin' | 'user' | 'plugin' | 'project'
    content?: string  // Expanded content for Codex user prompts
    pluginName?: string
}

export type SlashCommandsResponse = {
    success: boolean
    commands?: SlashCommand[]
    error?: string
}

export type SkillSummary = {
    name: string
    description?: string
}

export type SkillsResponse = {
    success: boolean
    skills?: SkillSummary[]
    error?: string
}

export type PushSubscriptionKeys = {
    p256dh: string
    auth: string
}

export type PushSubscriptionPayload = {
    endpoint: string
    keys: PushSubscriptionKeys
}

export type PushUnsubscribePayload = {
    endpoint: string
}

export type PushVapidPublicKeyResponse = {
    publicKey: string
}

export type VisibilityPayload = {
    subscriptionId: string
    visibility: 'visible' | 'hidden'
}

export type SyncEvent = ProtocolSyncEvent
