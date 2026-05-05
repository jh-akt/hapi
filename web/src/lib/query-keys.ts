export const queryKeys = {
    sessions: ['sessions'] as const,
    codexSessions: ['codex-sessions'] as const,
    codexThread: (sessionId: string, threadId: string) => ['codex-thread', sessionId, threadId] as const,
    codexThreadMessages: (sessionId: string, threadId: string) => ['codex-thread-messages', sessionId, threadId] as const,
    codexThreadTurns: (sessionId: string, threadId: string) => ['codex-thread-turns', sessionId, threadId] as const,
    codexReviewThread: (sessionId: string, threadId: string) => ['codex-review-thread', sessionId, threadId] as const,
    codexModels: (sessionId: string) => ['codex-models', sessionId] as const,
    machineCodexModels: (machineId: string) => ['machine-codex-models', machineId] as const,
    codexManagement: (sessionId: string, threadId: string, group: string) => [
        'codex-management',
        sessionId,
        threadId,
        group
    ] as const,
    projects: ['projects'] as const,
    session: (sessionId: string) => ['session', sessionId] as const,
    messages: (sessionId: string) => ['messages', sessionId] as const,
    machines: ['machines'] as const,
    gitStatus: (sessionId: string) => ['git-status', sessionId] as const,
    sessionFiles: (sessionId: string, query: string) => ['session-files', sessionId, query] as const,
    sessionDirectory: (sessionId: string, path: string) => ['session-directory', sessionId, path] as const,
    sessionFile: (sessionId: string, path: string) => ['session-file', sessionId, path] as const,
    gitFileDiff: (sessionId: string, path: string, staged?: boolean) => [
        'git-file-diff',
        sessionId,
        path,
        staged ? 'staged' : 'unstaged'
    ] as const,
    slashCommands: (sessionId: string) => ['slash-commands', sessionId] as const,
    skills: (sessionId: string) => ['skills', sessionId] as const,
}
