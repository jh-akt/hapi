import { isSessionArchivedMetadata, toSessionSummary } from '@hapi/protocol'
import { Hono } from 'hono'
import { basename } from 'node:path'
import { z } from 'zod'
import { listNativeCodexSessionCatalog } from '../../native/codexSessionCatalog'
import type { Session, SyncEngine } from '../../sync/syncEngine'
import { normalizeFilesystemPath } from '../../utils/filesystemPath'
import type { WebAppEnv } from '../middleware/auth'
import { requireSyncEngine } from './guards'

const openCodexSessionSchema = z.object({
    cwd: z.string().trim().min(1),
    codexSessionId: z.string().trim().min(1),
    title: z.string().trim().min(1).max(255).optional(),
    openStrategy: z.enum([
        'navigate-attached',
        'open-app-server-thread',
        'open-native-resume'
    ]).optional()
})

type CodexOrigin = 'attached' | 'app-server-thread' | 'transcript-fallback'
type CodexOpenStrategy = 'navigate-attached' | 'open-app-server-thread' | 'open-native-resume'

function sortDisplaySessions(
    left: {
        active: boolean
        pendingRequestsCount: number
        updatedAt: number
    },
    right: {
        active: boolean
        pendingRequestsCount: number
        updatedAt: number
    }
): number {
    if (left.active !== right.active) {
        return left.active ? -1 : 1
    }
    if (left.active && left.pendingRequestsCount !== right.pendingRequestsCount) {
        return right.pendingRequestsCount - left.pendingRequestsCount
    }
    return right.updatedAt - left.updatedAt
}

function pickAttachedSession(sessions: Session[], codexSessionId: string): Session | null {
    return sessions
        .filter((session) => session.metadata?.codexSessionId === codexSessionId)
        .sort((left, right) => {
            const archivedLeft = isSessionArchivedMetadata(left.metadata)
            const archivedRight = isSessionArchivedMetadata(right.metadata)
            if (left.active !== right.active) {
                return left.active ? -1 : 1
            }
            if (archivedLeft !== archivedRight) {
                return archivedLeft ? 1 : -1
            }
            return right.updatedAt - left.updatedAt
        })[0] ?? null
}

function normalizeDisplayText(value: string | null | undefined): string | null {
    if (typeof value !== 'string') {
        return null
    }
    const normalized = value.replace(/\s+/g, ' ').trim()
    return normalized.length > 0 ? normalized : null
}

function truncateDisplayText(value: string | null, maxLength = 120): string | null {
    if (!value) {
        return null
    }
    if (value.length <= maxLength) {
        return value
    }
    return `${value.slice(0, maxLength - 1).trimEnd()}…`
}

function getDirectoryLabel(cwd: string): string {
    const trimmed = cwd.trim()
    if (!trimmed) {
        return 'Session'
    }
    const label = basename(trimmed)
    return label.length > 0 ? label : trimmed
}

function buildCodexSessionDisplayName(options: {
    cwd: string
    attachedName?: string | null
    summaryText?: string | null
}): string {
    const fallbackName = getDirectoryLabel(options.cwd)
    const attachedName = normalizeDisplayText(options.attachedName)
    const summaryText = truncateDisplayText(normalizeDisplayText(options.summaryText))

    if (attachedName && attachedName !== fallbackName) {
        return attachedName
    }
    if (summaryText) {
        return summaryText
    }
    if (attachedName) {
        return attachedName
    }
    return fallbackName
}

function normalizeTimestamp(value: number | null | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return 0
    }
    return value < 1_000_000_000_000 ? value * 1000 : value
}

type CodexSessionListEntry = {
    id: string
    attachedSessionId: string | null
    listSource: 'codex-history'
    codexSessionId: string
    codexOrigin: CodexOrigin
    openStrategy: CodexOpenStrategy
    active: boolean
    thinking: boolean
    activeAt: number
    updatedAt: number
    metadata: {
        name: string
        path: string
        machineId?: string
        summary?: { text: string }
        flavor: 'codex'
        source?: NonNullable<Session['metadata']>['source']
        native?: NonNullable<Session['metadata']>['native']
        worktree?: NonNullable<Session['metadata']>['worktree']
        agentSessionId: string
    }
    todoProgress: ReturnType<typeof toSessionSummary>['todoProgress']
    pendingRequestsCount: number
    model: string | null
    effort: string | null
    archived: boolean
}

type CodexSessionCandidate = CodexSessionListEntry & {
    sourceRank: number
    appServerSourceSessionId?: string
}

type AppServerOpenTarget = {
    sourceSession: Session
    cwd: string
}

function isRemoteCodexAppServerSession(session: Session): boolean {
    return session.active
        && session.metadata?.flavor === 'codex'
        && session.metadata?.source !== 'native-attached'
        && session.agentState?.controlledByUser !== true
}

function isActiveThreadStatus(status: unknown): boolean {
    return Boolean(
        status
        && typeof status === 'object'
        && 'type' in status
        && status.type === 'active'
    )
}

function buildCodexSessionCandidate(options: {
    codexSessionId: string
    cwd: string
    attachedSession: Session | null
    preferredName?: string | null
    summaryText?: string | null
    updatedAt: number
    activeAt?: number
    active?: boolean
    archived?: boolean
    machineId?: string | null
    source?: NonNullable<Session['metadata']>['source']
    sourceRank: number
    origin: Exclude<CodexOrigin, 'attached'>
    appServerSourceSessionId?: string
}): CodexSessionCandidate {
    const attachedSummary = options.attachedSession ? toSessionSummary(options.attachedSession) : null
    const rawPath = options.cwd.trim() || attachedSummary?.metadata?.path || options.cwd
    const path = normalizeFilesystemPath(rawPath) || rawPath
    const summaryText = attachedSummary?.metadata?.summary?.text
        ?? normalizeDisplayText(options.summaryText)
    const updatedAt = Math.max(attachedSummary?.updatedAt ?? 0, normalizeTimestamp(options.updatedAt))
    const active = attachedSummary?.active ?? options.active ?? false
    const normalizedActiveAt = normalizeTimestamp(options.activeAt)
    const activeAt = attachedSummary?.activeAt ?? (normalizedActiveAt > 0 ? normalizedActiveAt : updatedAt)

    return {
        id: attachedSummary?.id ?? `codex:${options.codexSessionId}`,
        attachedSessionId: attachedSummary?.id ?? null,
        listSource: 'codex-history',
        codexSessionId: options.codexSessionId,
        codexOrigin: attachedSummary ? 'attached' : options.origin,
        openStrategy: attachedSummary
            ? 'navigate-attached'
            : options.origin === 'app-server-thread'
                ? 'open-app-server-thread'
                : 'open-native-resume',
        active,
        thinking: attachedSummary?.thinking ?? false,
        activeAt,
        updatedAt,
        metadata: {
            name: buildCodexSessionDisplayName({
                cwd: path,
                attachedName: attachedSummary?.metadata?.name ?? options.preferredName,
                summaryText
            }),
            path,
            machineId: attachedSummary?.metadata?.machineId ?? options.machineId ?? undefined,
            summary: summaryText ? { text: summaryText } : undefined,
            flavor: 'codex',
            source: attachedSummary?.metadata?.source ?? options.source,
            native: attachedSummary?.metadata?.native,
            worktree: attachedSummary?.metadata?.worktree,
            agentSessionId: options.codexSessionId
        },
        todoProgress: attachedSummary?.todoProgress ?? null,
        pendingRequestsCount: attachedSummary?.pendingRequestsCount ?? 0,
        model: attachedSummary?.model ?? null,
        effort: attachedSummary?.effort ?? null,
        archived: Boolean(attachedSummary?.archived || options.archived),
        sourceRank: options.sourceRank,
        appServerSourceSessionId: options.appServerSourceSessionId
    }
}

function shouldReplaceCodexSessionCandidate(
    current: CodexSessionCandidate,
    next: CodexSessionCandidate
): boolean {
    const displayOrder = sortDisplaySessions(next, current)
    if (displayOrder !== 0) {
        return displayOrder < 0
    }

    const nextAttached = Boolean(next.attachedSessionId)
    const currentAttached = Boolean(current.attachedSessionId)
    if (nextAttached !== currentAttached) {
        return nextAttached
    }

    if (next.sourceRank !== current.sourceRank) {
        return next.sourceRank > current.sourceRank
    }

    return next.updatedAt >= current.updatedAt
}

function mergeCodexSessionCandidate(
    entries: Map<string, CodexSessionCandidate>,
    candidate: CodexSessionCandidate
): void {
    const current = entries.get(candidate.codexSessionId)
    if (!current || shouldReplaceCodexSessionCandidate(current, candidate)) {
        entries.set(candidate.codexSessionId, candidate)
    }
}

function listAttachedCodexSessionCandidates(sessions: Session[]): CodexSessionCandidate[] {
    return sessions
        .filter((session): session is Session & {
            metadata: NonNullable<Session['metadata']> & { codexSessionId: string }
        } => (
            session.metadata?.flavor === 'codex'
            && typeof session.metadata.codexSessionId === 'string'
            && session.metadata.codexSessionId.trim().length > 0
        ))
        .map((session) => buildCodexSessionCandidate({
            codexSessionId: session.metadata.codexSessionId,
            cwd: session.metadata.path,
            attachedSession: session,
            preferredName: session.metadata.name,
            summaryText: session.metadata.summary?.text,
            updatedAt: session.updatedAt,
            activeAt: session.activeAt,
            active: session.active,
            archived: isSessionArchivedMetadata(session.metadata),
            machineId: session.metadata.machineId,
            source: session.metadata.source,
            sourceRank: 0,
            origin: 'transcript-fallback'
        }))
}

async function listAppServerCodexSessionCandidates(
    engine: SyncEngine,
    sessions: Session[]
): Promise<CodexSessionCandidate[]> {
    if (typeof engine.listCodexThreads !== 'function') {
        return []
    }

    const remoteCodexSessions = sessions.filter(isRemoteCodexAppServerSession)
    if (remoteCodexSessions.length === 0) {
        return []
    }

    const entries = new Map<string, CodexSessionCandidate>()

    await Promise.all(remoteCodexSessions.map(async (session) => {
        const attachedSession = session.metadata?.codexSessionId
            ? pickAttachedSession(sessions, session.metadata.codexSessionId)
            : session

        const requests = [
            { archived: false as const },
            { archived: true as const }
        ]

        await Promise.all(requests.map(async ({ archived }) => {
            try {
                const result = await engine.listCodexThreads(session.id, {
                    archived,
                    sortKey: 'updated_at',
                    sortDirection: 'desc',
                    limit: 200
                })

                for (const thread of result.data) {
                    const codexSessionId = thread.id?.trim()
                    if (!codexSessionId) {
                        continue
                    }

                    const threadAttachedSession = pickAttachedSession(sessions, codexSessionId)
                        ?? (attachedSession?.metadata?.codexSessionId === codexSessionId ? attachedSession : null)

                    mergeCodexSessionCandidate(entries, buildCodexSessionCandidate({
                        codexSessionId,
                        cwd: thread.path ?? thread.cwd ?? session.metadata?.path ?? '',
                        attachedSession: threadAttachedSession,
                        preferredName: thread.name,
                        summaryText: thread.preview,
                        updatedAt: thread.updatedAt ?? thread.createdAt ?? session.updatedAt,
                        activeAt: session.activeAt,
                        active: isActiveThreadStatus(thread.status),
                        archived,
                        machineId: session.metadata?.machineId,
                        source: session.metadata?.source,
                        sourceRank: 2,
                        origin: 'app-server-thread',
                        appServerSourceSessionId: session.id
                    }))
                }
            } catch {
                // Ignore unsupported / failed app-server listings and keep transcript fallback alive.
            }
        }))
    }))

    return Array.from(entries.values())
}

async function findAppServerOpenTarget(options: {
    engine: SyncEngine
    sessions: Session[]
    codexSessionId: string
    cwd: string
}): Promise<AppServerOpenTarget | null> {
    if (typeof options.engine.listCodexThreads !== 'function') {
        return null
    }

    const requestedPath = normalizeFilesystemPath(options.cwd) ?? options.cwd
    const remoteCodexSessions = options.sessions.filter(isRemoteCodexAppServerSession)
    for (const session of remoteCodexSessions) {
        for (const archived of [false, true] as const) {
            try {
                const result = await options.engine.listCodexThreads(session.id, {
                    archived,
                    sortKey: 'updated_at',
                    sortDirection: 'desc',
                    limit: 200
                })
                const thread = result.data.find((entry) => entry.id?.trim() === options.codexSessionId)
                if (!thread) {
                    continue
                }

                const rawCwd = thread.path ?? thread.cwd ?? session.metadata?.path ?? requestedPath
                const cwd = normalizeFilesystemPath(rawCwd) ?? rawCwd
                return {
                    sourceSession: session,
                    cwd
                }
            } catch {
                // Keep checking other active app-server sessions.
            }
        }
    }

    return null
}

async function openAppServerCodexThread(options: {
    engine: SyncEngine
    sessions: Session[]
    codexSessionId: string
    cwd: string
}): Promise<{ sessionId: string } | { error: string; status: 400 | 409 | 503 }> {
    const attached = pickAttachedSession(options.sessions, options.codexSessionId)
    if (attached) {
        return { sessionId: attached.id }
    }

    const target = await findAppServerOpenTarget({
        engine: options.engine,
        sessions: options.sessions,
        codexSessionId: options.codexSessionId,
        cwd: options.cwd
    })
    if (!target) {
        return { error: 'Codex app-server thread is not available from an online remote session', status: 409 }
    }

    const machineId = target.sourceSession.metadata?.machineId
    if (!machineId) {
        return { error: 'Codex app-server source machine is unavailable', status: 503 }
    }

    if (typeof options.engine.spawnSession !== 'function') {
        return { error: 'Remote Codex spawn is unavailable', status: 503 }
    }

    const spawnResult = await options.engine.spawnSession(
        machineId,
        target.cwd,
        'codex',
        target.sourceSession.model ?? undefined,
        target.sourceSession.modelReasoningEffort ?? undefined,
        undefined,
        undefined,
        undefined,
        options.codexSessionId,
        target.sourceSession.effort ?? undefined,
        target.sourceSession.permissionMode ?? undefined
    )

    if (spawnResult.type === 'error') {
        return { error: spawnResult.message, status: 409 }
    }

    return { sessionId: spawnResult.sessionId }
}

export function createCodexSessionsRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/codex-sessions', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const namespace = c.get('namespace')
        const sessions = engine.getSessionsByNamespace(namespace)
        const entries = new Map<string, CodexSessionCandidate>()

        for (const candidate of listAttachedCodexSessionCandidates(sessions)) {
            mergeCodexSessionCandidate(entries, candidate)
        }

        for (const candidate of await listAppServerCodexSessionCandidates(engine, sessions)) {
            mergeCodexSessionCandidate(entries, candidate)
        }

        for (const entry of listNativeCodexSessionCatalog()) {
            mergeCodexSessionCandidate(entries, buildCodexSessionCandidate({
                codexSessionId: entry.codexSessionId,
                cwd: entry.cwd,
                attachedSession: pickAttachedSession(sessions, entry.codexSessionId),
                summaryText: entry.recentUserMessages[entry.recentUserMessages.length - 1],
                updatedAt: entry.updatedAt,
                activeAt: entry.timestamp ?? entry.updatedAt,
                sourceRank: 1,
                origin: 'transcript-fallback'
            }))
        }

        return c.json({
            sessions: Array.from(entries.values())
                .sort(sortDisplaySessions)
                .map(({ sourceRank: _sourceRank, appServerSourceSessionId: _appServerSourceSessionId, ...entry }) => entry)
        })
    })

    app.post('/codex-sessions/open', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const body = await c.req.json().catch(() => null)
        const parsed = openCodexSessionSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        try {
            const namespace = c.get('namespace')
            const sessions = engine.getSessionsByNamespace(namespace)
            const attached = pickAttachedSession(sessions, parsed.data.codexSessionId)
            if (parsed.data.openStrategy === 'navigate-attached') {
                if (!attached) {
                    return c.json({ error: 'Attached Codex session not found' }, 409)
                }
                return c.json({ sessionId: attached.id })
            }

            const appServerTarget = await findAppServerOpenTarget({
                engine,
                sessions,
                codexSessionId: parsed.data.codexSessionId,
                cwd: parsed.data.cwd
            })
            const shouldOpenViaAppServer = parsed.data.openStrategy === 'open-app-server-thread'
                || (!parsed.data.openStrategy && appServerTarget)

            if (shouldOpenViaAppServer) {
                const result = await openAppServerCodexThread({
                    engine,
                    sessions,
                    codexSessionId: parsed.data.codexSessionId,
                    cwd: appServerTarget?.cwd ?? parsed.data.cwd
                })
                if ('error' in result) {
                    return c.json({ error: result.error }, result.status)
                }
                return c.json({ sessionId: result.sessionId })
            }

            const session = await engine.openCodexSession(c.get('namespace'), parsed.data)
            return c.json({ sessionId: session.id })
        } catch (error) {
            return c.json({
                error: error instanceof Error ? error.message : 'Failed to open codex session'
            }, 500)
        }
    })

    return app
}
