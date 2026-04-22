import type { NativeSessionMetadata, Session, SessionSource, WorktreeMetadata } from './schemas'

export function isSessionArchivedMetadata(metadata: Pick<NonNullable<Session['metadata']>, 'archivedAt' | 'archivedBy' | 'archiveReason'> | null | undefined): boolean {
    return Boolean(metadata?.archivedAt ?? metadata?.archivedBy ?? metadata?.archiveReason)
}

export type SessionSummaryMetadata = {
    name?: string
    path: string
    machineId?: string
    summary?: { text: string }
    flavor?: string | null
    source?: SessionSource
    native?: NativeSessionMetadata
    worktree?: WorktreeMetadata
    agentSessionId?: string
    archivedAt?: number
    archivedBy?: string
    archiveReason?: string
}

export type SessionSummary = {
    id: string
    active: boolean
    thinking: boolean
    activeAt: number
    updatedAt: number
    metadata: SessionSummaryMetadata | null
    todoProgress: { completed: number; total: number } | null
    pendingRequestsCount: number
    model: string | null
    effort: string | null
    archived: boolean
}

export function toSessionSummary(session: Session): SessionSummary {
    const pendingRequestsCount = session.agentState?.requests ? Object.keys(session.agentState.requests).length : 0
    const archived = isSessionArchivedMetadata(session.metadata)

    const metadata: SessionSummaryMetadata | null = session.metadata ? {
        name: session.metadata.name,
        path: session.metadata.path,
        machineId: session.metadata.machineId ?? undefined,
        summary: session.metadata.summary ? { text: session.metadata.summary.text } : undefined,
        flavor: session.metadata.flavor ?? null,
        source: session.metadata.source ?? 'managed',
        native: session.metadata.native,
        worktree: session.metadata.worktree,
        archivedAt: session.metadata.archivedAt,
        archivedBy: session.metadata.archivedBy,
        archiveReason: session.metadata.archiveReason,
        agentSessionId: session.metadata.codexSessionId
            ?? session.metadata.claudeSessionId
            ?? session.metadata.geminiSessionId
            ?? session.metadata.opencodeSessionId
            ?? session.metadata.cursorSessionId
            ?? undefined
    } : null

    const todoProgress = session.todos?.length ? {
        completed: session.todos.filter(t => t.status === 'completed').length,
        total: session.todos.length
    } : null

    return {
        id: session.id,
        active: session.active,
        thinking: session.thinking,
        activeAt: session.activeAt,
        updatedAt: session.updatedAt,
        metadata,
        todoProgress,
        pendingRequestsCount,
        model: session.model,
        effort: session.effort,
        archived
    }
}
