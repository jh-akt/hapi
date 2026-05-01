import { isSessionArchivedMetadata, toSessionSummary } from '@hapi/protocol'
import { Hono } from 'hono'
import { basename } from 'node:path'
import { z } from 'zod'
import type { Machine, Session, SyncEngine } from '../../sync/syncEngine'
import { normalizeFilesystemPath } from '../../utils/filesystemPath'
import type { WebAppEnv } from '../middleware/auth'
import { requireSyncEngine } from './guards'

const openCodexSessionSchema = z.object({
    cwd: z.string().trim().min(1),
    codexSessionId: z.string().trim().min(1),
    title: z.string().trim().min(1).max(255).optional(),
    openStrategy: z.enum([
        'navigate-attached',
        'open-app-server-thread'
    ]).optional()
})

type CodexOrigin = 'attached' | 'app-server-thread'
type CodexOpenStrategy = 'navigate-attached' | 'open-app-server-thread'

const nativeTmuxRetiredMessage = 'Native tmux resume has been retired. Open this Codex thread from an app-server-backed session.'

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
    appServerSourceMachineId?: string
}

type AppServerOpenTarget = {
    sourceSession?: Session
    machineId: string
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
    origin: 'app-server-thread'
    appServerSourceSessionId?: string
    appServerSourceMachineId?: string
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
            : 'open-app-server-thread',
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
        appServerSourceSessionId: options.appServerSourceSessionId,
        appServerSourceMachineId: options.appServerSourceMachineId
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
            origin: 'app-server-thread'
        }))
}

async function listAppServerCodexSessionCandidates(
    engine: SyncEngine,
    sessions: Session[],
    machines: Machine[]
): Promise<CodexSessionCandidate[]> {
    const remoteCodexSessions = sessions.filter(isRemoteCodexAppServerSession)
    const onlineMachines = machines.filter((machine) => machine.active)
    if (remoteCodexSessions.length === 0 && onlineMachines.length === 0) {
        return []
    }

    const entries = new Map<string, CodexSessionCandidate>()
    const requests = [
        { archived: false as const },
        { archived: true as const }
    ]

    await Promise.all(remoteCodexSessions.map(async (session) => {
        const attachedSession = session.metadata?.codexSessionId
            ? pickAttachedSession(sessions, session.metadata.codexSessionId)
            : session

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
                        cwd: thread.cwd ?? thread.path ?? session.metadata?.path ?? '',
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
                // Ignore unsupported / failed app-server listings; transcript/tmux fallback is retired.
            }
        }))
    }))

    await Promise.all(onlineMachines.map(async (machine) => {
        if (typeof engine.listCodexThreadsFromMachine !== 'function') {
            return
        }

        await Promise.all(requests.map(async ({ archived }) => {
            try {
                const result = await engine.listCodexThreadsFromMachine(machine.id, {
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
                    const rawCwd = thread.cwd ?? thread.path ?? machine.metadata?.homeDir ?? ''

                    mergeCodexSessionCandidate(entries, buildCodexSessionCandidate({
                        codexSessionId,
                        cwd: rawCwd,
                        attachedSession: threadAttachedSession,
                        preferredName: thread.name,
                        summaryText: thread.preview,
                        updatedAt: thread.updatedAt ?? thread.createdAt ?? machine.updatedAt,
                        activeAt: machine.activeAt,
                        active: isActiveThreadStatus(thread.status),
                        archived,
                        machineId: machine.id,
                        sourceRank: 1,
                        origin: 'app-server-thread',
                        appServerSourceMachineId: machine.id
                    }))
                }
            } catch {
                // Keep Codex history available from other online machines or sessions.
            }
        }))
    }))

    return Array.from(entries.values())
}

async function findAppServerOpenTarget(options: {
    engine: SyncEngine
    sessions: Session[]
    machines: Machine[]
    codexSessionId: string
    cwd: string
}): Promise<AppServerOpenTarget | null> {
    const requestedPath = normalizeFilesystemPath(options.cwd) ?? options.cwd
    const remoteCodexSessions = options.sessions.filter(isRemoteCodexAppServerSession)
    for (const session of remoteCodexSessions) {
        if (typeof options.engine.listCodexThreads !== 'function') {
            continue
        }
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

                const rawCwd = thread.cwd ?? thread.path ?? session.metadata?.path ?? requestedPath
                const cwd = normalizeFilesystemPath(rawCwd) ?? rawCwd
                const machineId = session.metadata?.machineId
                if (!machineId) {
                    continue
                }
                return {
                    sourceSession: session,
                    machineId,
                    cwd
                }
            } catch {
                // Keep checking other active app-server sessions.
            }
        }
    }

    const onlineMachines = options.machines.filter((machine) => machine.active)
    for (const machine of onlineMachines) {
        if (typeof options.engine.listCodexThreadsFromMachine !== 'function') {
            continue
        }
        for (const archived of [false, true] as const) {
            try {
                const result = await options.engine.listCodexThreadsFromMachine(machine.id, {
                    archived,
                    sortKey: 'updated_at',
                    sortDirection: 'desc',
                    limit: 200
                })
                const thread = result.data.find((entry) => entry.id?.trim() === options.codexSessionId)
                if (!thread) {
                    continue
                }

                const rawCwd = thread.cwd ?? thread.path ?? machine.metadata?.homeDir ?? requestedPath
                const cwd = normalizeFilesystemPath(rawCwd) ?? rawCwd
                return {
                    machineId: machine.id,
                    cwd
                }
            } catch {
                // Keep checking other active app-server machines.
            }
        }
    }

    return null
}

async function openAppServerCodexThread(options: {
    engine: SyncEngine
    sessions: Session[]
    machines: Machine[]
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
        machines: options.machines,
        codexSessionId: options.codexSessionId,
        cwd: options.cwd
    })
    if (!target) {
        return { error: 'Codex app-server thread is not available from an online runner', status: 409 }
    }

    if (typeof options.engine.spawnSession !== 'function') {
        return { error: 'Remote Codex spawn is unavailable', status: 503 }
    }

    const spawnResult = await options.engine.spawnSession(
        target.machineId,
        target.cwd,
        'codex',
        target.sourceSession?.model ?? undefined,
        target.sourceSession?.modelReasoningEffort ?? undefined,
        undefined,
        undefined,
        undefined,
        options.codexSessionId,
        target.sourceSession?.effort ?? undefined,
        target.sourceSession?.permissionMode ?? undefined
    )

    if (spawnResult.type === 'error') {
        return { error: spawnResult.message, status: 409 }
    }

    if (typeof options.engine.setSessionCodexSessionId === 'function') {
        options.engine.setSessionCodexSessionId(spawnResult.sessionId, options.codexSessionId)
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
        const machines = engine.getMachinesByNamespace(namespace)
        const entries = new Map<string, CodexSessionCandidate>()

        for (const candidate of listAttachedCodexSessionCandidates(sessions)) {
            mergeCodexSessionCandidate(entries, candidate)
        }

        for (const candidate of await listAppServerCodexSessionCandidates(engine, sessions, machines)) {
            mergeCodexSessionCandidate(entries, candidate)
        }

        return c.json({
            sessions: Array.from(entries.values())
                .sort(sortDisplaySessions)
                .map(({
                    sourceRank: _sourceRank,
                    appServerSourceSessionId: _appServerSourceSessionId,
                    appServerSourceMachineId: _appServerSourceMachineId,
                    ...entry
                }) => entry)
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
            const machines = engine.getMachinesByNamespace(namespace)
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
                machines,
                codexSessionId: parsed.data.codexSessionId,
                cwd: parsed.data.cwd
            })
            const shouldOpenViaAppServer = parsed.data.openStrategy === 'open-app-server-thread'
                || (!parsed.data.openStrategy && appServerTarget)

            if (shouldOpenViaAppServer) {
                const result = await openAppServerCodexThread({
                    engine,
                    sessions,
                    machines,
                    codexSessionId: parsed.data.codexSessionId,
                    cwd: appServerTarget?.cwd ?? parsed.data.cwd
                })
                if ('error' in result) {
                    return c.json({ error: result.error }, result.status)
                }
                return c.json({ sessionId: result.sessionId })
            }

            return c.json({ error: nativeTmuxRetiredMessage }, 409)
        } catch (error) {
            return c.json({
                error: error instanceof Error ? error.message : 'Failed to open codex session'
            }, 500)
        }
    })

    return app
}
