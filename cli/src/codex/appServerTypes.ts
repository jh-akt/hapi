export type ApprovalPolicy = 'untrusted' | 'on-failure' | 'on-request' | 'never';
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

export interface InitializeCapabilities {
    experimentalApi: boolean;
}

export interface InitializeParams {
    clientInfo: {
        name: string;
        title?: string;
        version: string;
    };
    capabilities: InitializeCapabilities | null;
}

export interface InitializeResponse {
    userAgent?: string;
    [key: string]: unknown;
}

export interface ThreadStartParams {
    model?: string;
    modelProvider?: string;
    cwd?: string;
    approvalPolicy?: ApprovalPolicy;
    sandbox?: SandboxMode;
    config?: Record<string, unknown>;
    baseInstructions?: string;
    developerInstructions?: string;
    personality?: string;
    ephemeral?: boolean;
    experimentalRawEvents?: boolean;
}

export interface ThreadStartResponse {
    thread: AppServerThread;
    model: string;
    [key: string]: unknown;
}

export type ResponseItem = Record<string, unknown>;

export interface ThreadResumeParams {
    threadId: string;
    history?: ResponseItem[];
    path?: string;
    model?: string;
    modelProvider?: string;
    cwd?: string;
    approvalPolicy?: ApprovalPolicy;
    sandbox?: SandboxMode;
    config?: Record<string, unknown>;
    baseInstructions?: string;
    developerInstructions?: string;
    personality?: string;
}

export interface ThreadResumeResponse {
    thread: AppServerThread;
    model: string;
    [key: string]: unknown;
}

export interface TextElementRange {
    start: number;
    end: number;
}

export interface TextElement {
    byteRange?: TextElementRange;
    byte_range?: TextElementRange;
    placeholder?: string;
}

export type UserInput =
    | {
        type: 'text';
        text: string;
        textElements?: TextElement[];
        text_elements?: TextElement[];
    }
    | {
        type: 'image';
        url: string;
    }
    | {
        type: 'localImage';
        path: string;
    }
    | {
        type: 'skill';
        name: string;
        path: string;
    }
    | {
        type: 'mention';
        name: string;
        path: string;
    };

export type SandboxPolicy =
    | { type: 'dangerFullAccess' }
    | { type: 'readOnly' }
    | { type: 'externalSandbox'; networkAccess?: 'restricted' | 'enabled' }
    | {
        type: 'workspaceWrite';
        writableRoots?: string[];
        networkAccess?: boolean;
        excludeTmpdirEnvVar?: boolean;
        excludeSlashTmp?: boolean;
    };

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type ReasoningSummary = 'auto' | 'none' | 'brief' | 'detailed';

export type CollaborationMode = {
    mode: 'plan' | 'default';
    settings: {
        model: string;
        reasoning_effort?: ReasoningEffort | null;
        developer_instructions?: string | null;
    };
};

export interface TurnStartParams {
    threadId: string;
    input: UserInput[];
    cwd?: string;
    approvalPolicy?: ApprovalPolicy;
    sandboxPolicy?: SandboxPolicy;
    model?: string;
    effort?: ReasoningEffort;
    summary?: ReasoningSummary;
    personality?: string;
    outputSchema?: unknown;
    collaborationMode?: CollaborationMode;
}

export interface TurnStartResponse {
    turn: {
        id: string;
        status?: string;
    };
    [key: string]: unknown;
}

export interface TurnInterruptParams {
    threadId: string;
    turnId: string;
}

export interface TurnInterruptResponse {
    ok: boolean;
    [key: string]: unknown;
}

export type ThreadSortKey = 'created_at' | 'updated_at';
export type SortDirection = 'asc' | 'desc';
export type ThreadSourceKind =
    | 'cli'
    | 'vscode'
    | 'exec'
    | 'appServer'
    | 'subAgent'
    | 'subAgentReview'
    | 'subAgentCompact'
    | 'subAgentThreadSpawn'
    | 'subAgentOther'
    | 'unknown';

export type ThreadStatus =
    | { type: 'notLoaded' }
    | { type: 'idle' }
    | { type: 'systemError' }
    | { type: 'active'; activeFlags: string[] };

export interface AppServerTurn {
    id: string;
    items: unknown[];
    status: string | Record<string, unknown>;
    error: Record<string, unknown> | null;
    startedAt: number | null;
    completedAt: number | null;
    durationMs: number | null;
    [key: string]: unknown;
}

export interface AppServerThread {
    id: string;
    forkedFromId?: string | null;
    preview?: string;
    ephemeral?: boolean;
    modelProvider?: string;
    createdAt?: number;
    updatedAt?: number;
    status?: ThreadStatus;
    path?: string | null;
    cwd?: string;
    cliVersion?: string;
    source?: string | Record<string, unknown>;
    agentNickname?: string | null;
    agentRole?: string | null;
    gitInfo?: Record<string, unknown> | null;
    name?: string | null;
    turns?: AppServerTurn[];
    [key: string]: unknown;
}

export interface ThreadForkParams {
    threadId: string;
    path?: string | null;
    model?: string | null;
    modelProvider?: string | null;
    cwd?: string | null;
    approvalPolicy?: ApprovalPolicy | null;
    sandbox?: SandboxMode | null;
    config?: Record<string, unknown> | null;
    baseInstructions?: string | null;
    developerInstructions?: string | null;
    ephemeral?: boolean;
    excludeTurns?: boolean;
    persistExtendedHistory?: boolean;
}

export interface ThreadForkResponse {
    thread: AppServerThread;
    model: string;
    modelProvider: string;
    cwd: string;
    instructionSources?: string[];
    approvalPolicy?: ApprovalPolicy;
    sandbox?: SandboxPolicy;
    reasoningEffort?: ReasoningEffort | null;
    [key: string]: unknown;
}

export interface ThreadArchiveParams {
    threadId: string;
}

export type ThreadArchiveResponse = Record<string, never>;

export interface ThreadUnarchiveParams {
    threadId: string;
}

export interface ThreadUnarchiveResponse {
    thread: AppServerThread;
}

export interface ThreadRollbackParams {
    threadId: string;
    numTurns: number;
}

export interface ThreadRollbackResponse {
    thread: AppServerThread;
}

export interface ThreadListParams {
    cursor?: string | null;
    limit?: number | null;
    sortKey?: ThreadSortKey | null;
    sortDirection?: SortDirection | null;
    modelProviders?: string[] | null;
    sourceKinds?: ThreadSourceKind[] | null;
    archived?: boolean | null;
    cwd?: string | string[] | null;
    useStateDbOnly?: boolean;
    searchTerm?: string | null;
}

export interface ThreadListResponse {
    data: AppServerThread[];
    nextCursor: string | null;
    backwardsCursor: string | null;
}

export interface ThreadReadParams {
    threadId: string;
    includeTurns: boolean;
}

export interface ThreadReadResponse {
    thread: AppServerThread;
}

export interface TurnSteerParams {
    threadId: string;
    input: UserInput[];
    expectedTurnId: string;
}

export interface TurnSteerResponse {
    turnId: string;
}

export type ReviewTarget =
    | { type: 'uncommittedChanges' }
    | { type: 'baseBranch'; branch: string }
    | { type: 'commit'; sha: string; title: string | null }
    | { type: 'custom'; instructions: string };

export type ReviewDelivery = 'inline' | 'detached';

export interface ReviewStartParams {
    threadId: string;
    target: ReviewTarget;
    delivery?: ReviewDelivery | null;
}

export interface ReviewStartResponse {
    turn: AppServerTurn;
    reviewThreadId: string;
}

export interface CodexAppServerMethodSpec<TParams, TResult> {
    params: TParams;
    result: TResult;
}

export interface CodexAppServerMethodMap {
    initialize: CodexAppServerMethodSpec<InitializeParams, InitializeResponse>;
    'thread/start': CodexAppServerMethodSpec<ThreadStartParams, ThreadStartResponse>;
    'thread/resume': CodexAppServerMethodSpec<ThreadResumeParams, ThreadResumeResponse>;
    'thread/fork': CodexAppServerMethodSpec<ThreadForkParams, ThreadForkResponse>;
    'thread/archive': CodexAppServerMethodSpec<ThreadArchiveParams, ThreadArchiveResponse>;
    'thread/unarchive': CodexAppServerMethodSpec<ThreadUnarchiveParams, ThreadUnarchiveResponse>;
    'thread/rollback': CodexAppServerMethodSpec<ThreadRollbackParams, ThreadRollbackResponse>;
    'thread/list': CodexAppServerMethodSpec<ThreadListParams, ThreadListResponse>;
    'thread/read': CodexAppServerMethodSpec<ThreadReadParams, ThreadReadResponse>;
    'turn/start': CodexAppServerMethodSpec<TurnStartParams, TurnStartResponse>;
    'turn/steer': CodexAppServerMethodSpec<TurnSteerParams, TurnSteerResponse>;
    'turn/interrupt': CodexAppServerMethodSpec<TurnInterruptParams, TurnInterruptResponse>;
    'review/start': CodexAppServerMethodSpec<ReviewStartParams, ReviewStartResponse>;
}

export type CodexAppServerMethod = keyof CodexAppServerMethodMap;

export type CodexAppServerParams<TMethod extends CodexAppServerMethod> =
    CodexAppServerMethodMap[TMethod]['params'];

export type CodexAppServerResult<TMethod extends CodexAppServerMethod> =
    CodexAppServerMethodMap[TMethod]['result'];
