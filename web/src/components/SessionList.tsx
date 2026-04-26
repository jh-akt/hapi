import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { CodexSessionSummary, ProjectSummary, SessionSummary } from '@/types/api'
import type { ApiClient } from '@/api/client'
import { useLongPress } from '@/hooks/useLongPress'
import { usePlatform } from '@/hooks/usePlatform'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { SessionActionMenu } from '@/components/SessionActionMenu'
import { RenameSessionDialog } from '@/components/RenameSessionDialog'
import { RollbackThreadDialog } from '@/components/RollbackThreadDialog'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { CopyIcon, CheckIcon } from '@/components/icons'
import { getProjectPath, getSessionProjectPath } from '@/lib/project-path'
import { queryKeys } from '@/lib/query-keys'
import { useToast } from '@/lib/toast-context'
import { useTranslation } from '@/lib/use-translation'

type DisplaySessionSummary = SessionSummary | CodexSessionSummary

type SessionGroup = {
    key: string
    directory: string
    displayName: string
    machineId: string | null
    sessions: SessionSummary[]
    latestUpdatedAt: number
    hasActiveSession: boolean
    projectName: string | null
}

type MachineGroup = {
    machineId: string | null
    label: string
    projectGroups: SessionGroup[]
    totalSessions: number
    hasActiveSession: boolean
    latestUpdatedAt: number
}

function getGroupDisplayName(directory: string): string {
    if (directory === 'Other') return directory
    const parts = directory.split(/[\\/]+/).filter(Boolean)
    if (parts.length === 0) return directory
    if (parts.length === 1) return parts[0]
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
}

export const UNKNOWN_MACHINE_ID = '__unknown__'

function isCodexHistorySession(session: DisplaySessionSummary): session is CodexSessionSummary {
    return 'listSource' in session && session.listSource === 'codex-history'
}

function getActionSessionId(session: DisplaySessionSummary): string | null {
    if (isCodexHistorySession(session)) {
        return session.attachedSessionId
    }
    return session.id
}

function supportsCodexThreadLifecycleActions(session: DisplaySessionSummary): session is CodexSessionSummary {
    return isCodexHistorySession(session)
        && Boolean(session.attachedSessionId)
        && session.metadata?.flavor === 'codex'
        && session.metadata?.source !== 'native-attached'
        && session.codexSessionId.trim().length > 0
}

export function isSessionVisuallyDimmed(session: DisplaySessionSummary): boolean {
    return session.archived
}

export function deduplicateSessionsByAgentId(sessions: DisplaySessionSummary[], selectedSessionId?: string | null): DisplaySessionSummary[] {
    const byAgentId = new Map<string, DisplaySessionSummary[]>()
    const result: DisplaySessionSummary[] = []

    for (const session of sessions) {
        const agentId = session.metadata?.agentSessionId
        if (!agentId) {
            result.push(session)
            continue
        }
        const group = byAgentId.get(agentId)
        if (group) {
            group.push(session)
        } else {
            byAgentId.set(agentId, [session])
        }
    }

    for (const group of byAgentId.values()) {
        group.sort((a, b) => {
            // Active session always wins — it's the live connection
            if (a.active !== b.active) return a.active ? -1 : 1
            // Among inactive duplicates, keep the selected one visible
            if (a.id === selectedSessionId) return -1
            if (b.id === selectedSessionId) return 1
            return b.updatedAt - a.updatedAt
        })
        result.push(group[0])
    }

    return result
}

function groupSessionsByDirectory(
    sessions: DisplaySessionSummary[],
    projects: ProjectSummary[]
): SessionGroup[] {
    const groups = new Map<string, {
        directory: string
        machineId: string | null
        sessions: DisplaySessionSummary[]
        projectName: string | null
        latestUpdatedAt: number
    }>()
    const groupedProjectPaths = new Set<string>()

    sessions.forEach(session => {
        const path = getSessionProjectPath(session) ?? 'Other'
        const machineId = session.metadata?.machineId ?? null
        const key = `${machineId ?? UNKNOWN_MACHINE_ID}::${path}`
        if (!groups.has(key)) {
            groups.set(key, {
                directory: path,
                machineId,
                sessions: [],
                projectName: null,
                latestUpdatedAt: 0
            })
        }
        const group = groups.get(key)!
        group.sessions.push(session)
        if (session.updatedAt > group.latestUpdatedAt) {
            group.latestUpdatedAt = session.updatedAt
        }
        if (path !== 'Other') {
            groupedProjectPaths.add(path)
        }
    })

    projects.forEach(project => {
        const path = getProjectPath(project)
        const matchingGroups = Array.from(groups.values()).filter((group) => group.directory === path)

        if (matchingGroups.length > 0) {
            for (const group of matchingGroups) {
                if (!group.projectName && project.name) {
                    group.projectName = project.name
                }
                if (project.updatedAt > group.latestUpdatedAt) {
                    group.latestUpdatedAt = project.updatedAt
                }
            }
            return
        }

        if (groupedProjectPaths.has(path)) {
            return
        }

        const key = `${UNKNOWN_MACHINE_ID}::${path}`
        groups.set(key, {
            directory: path,
            machineId: null,
            sessions: [],
            projectName: project.name,
            latestUpdatedAt: project.updatedAt
        })
    })

    return Array.from(groups.entries())
        .map(([key, group]) => {
            const sortedSessions = [...group.sessions].sort((a, b) => {
                const rankA = a.active ? (a.pendingRequestsCount > 0 ? 0 : 1) : 2
                const rankB = b.active ? (b.pendingRequestsCount > 0 ? 0 : 1) : 2
                if (rankA !== rankB) return rankA - rankB
                return b.updatedAt - a.updatedAt
            })
            const latestUpdatedAt = group.latestUpdatedAt
            const hasActiveSession = group.sessions.some(s => s.active)
            const displayName = group.projectName?.trim() || getGroupDisplayName(group.directory)

            return {
                key,
                directory: group.directory,
                displayName,
                machineId: group.machineId,
                sessions: sortedSessions,
                latestUpdatedAt,
                hasActiveSession,
                projectName: group.projectName
            }
        })
        .sort((a, b) => {
            if (a.hasActiveSession !== b.hasActiveSession) {
                return a.hasActiveSession ? -1 : 1
            }
            return b.latestUpdatedAt - a.latestUpdatedAt
        })
}

function groupByMachine(
    groups: SessionGroup[],
    resolveMachineLabel: (id: string | null) => string
): MachineGroup[] {
    const map = new Map<string, MachineGroup>()
    for (const g of groups) {
        const key = g.machineId ?? UNKNOWN_MACHINE_ID
        let mg = map.get(key)
        if (!mg) {
            mg = {
                machineId: g.machineId,
                label: resolveMachineLabel(g.machineId),
                projectGroups: [],
                totalSessions: 0,
                hasActiveSession: false,
                latestUpdatedAt: 0,
            }
            map.set(key, mg)
        }
        mg.projectGroups.push(g)
        mg.totalSessions += g.sessions.length
        if (g.hasActiveSession) mg.hasActiveSession = true
        if (g.latestUpdatedAt > mg.latestUpdatedAt) mg.latestUpdatedAt = g.latestUpdatedAt
    }
    return [...map.values()].sort((a, b) => {
        if (a.hasActiveSession !== b.hasActiveSession) return a.hasActiveSession ? -1 : 1
        return b.latestUpdatedAt - a.latestUpdatedAt
    })
}

function CopyPathButton({ path, className }: { path: string; className?: string }) {
    const [copied, setCopied] = useState(false)
    const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation()
        navigator.clipboard.writeText(path)
        setCopied(true)
        clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => setCopied(false), 1500)
    }

    useEffect(() => () => clearTimeout(timerRef.current), [])

    return (
        <button
            type="button"
            className={`shrink-0 p-0.5 rounded transition-colors ${copied ? 'text-[var(--app-badge-success-text)]' : 'text-[var(--app-hint)] hover:text-[var(--app-fg)]'} ${className ?? ''}`}
            title={copied ? 'Copied!' : `Copy: ${path}`}
            onClick={handleClick}
        >
            {copied
                ? <CheckIcon className="h-3.5 w-3.5" />
                : <CopyIcon className="h-3.5 w-3.5" />
            }
        </button>
    )
}

function PlusIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    )
}

function LoaderIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
            <line x1="12" y1="2" x2="12" y2="6" />
            <line x1="12" y1="18" x2="12" y2="22" />
            <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
            <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
            <line x1="2" y1="12" x2="6" y2="12" />
            <line x1="18" y1="12" x2="22" y2="12" />
            <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
            <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
        </svg>
    )
}

function BulbIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M9 18h6" />
            <path d="M10 22h4" />
            <path d="M12 2a7 7 0 0 0-4 12c.6.6 1 1.2 1 2h6c0-.8.4-1.4 1-2a7 7 0 0 0-4-12Z" />
        </svg>
    )
}

function ChevronIcon(props: { className?: string; collapsed?: boolean }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`${props.className ?? ''} transition-transform duration-200 ${props.collapsed ? '' : 'rotate-90'}`}
        >
            <polyline points="9 18 15 12 9 6" />
        </svg>
    )
}

function getSessionTitle(session: DisplaySessionSummary): string {
    if (session.metadata?.name) {
        return session.metadata.name
    }
    if (session.metadata?.summary?.text) {
        return session.metadata.summary.text
    }
    if (session.metadata?.path) {
        const parts = session.metadata.path.split('/').filter(Boolean)
        return parts.length > 0 ? parts[parts.length - 1] : session.id.slice(0, 8)
    }
    return session.id.slice(0, 8)
}

function getTodoProgress(session: DisplaySessionSummary): { completed: number; total: number } | null {
    if (!session.todoProgress) return null
    if (session.todoProgress.completed === session.todoProgress.total) return null
    return session.todoProgress
}

const FLAVOR_BADGES: Record<string, { label: string; colors: string }> = {
    claude: {
        label: 'Cl',
        colors: 'bg-[#d97706] text-white',
    },
    codex: {
        label: 'Cx',
        colors: 'bg-[#111827] text-white',
    },
    cursor: {
        label: 'Cu',
        colors: 'bg-[#0f766e] text-white',
    },
    gemini: {
        label: 'Gm',
        colors: 'bg-[#2563eb] text-white',
    },
    opencode: {
        label: 'Op',
        colors: 'bg-[#15803d] text-white',
    },
}

function FlavorIcon({ flavor, className }: { flavor?: string | null; className?: string }) {
    const badge = FLAVOR_BADGES[(flavor ?? 'claude').trim().toLowerCase()] ?? FLAVOR_BADGES.claude
    return (
        <span
            aria-hidden="true"
            className={`inline-flex items-center justify-center rounded-sm text-[8px] font-semibold leading-none ${badge.colors} ${className ?? 'h-4 w-4'}`}
        >
            {badge.label}
        </span>
    )
}

function MachineIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
    )
}

function formatRelativeTime(value: number, t: (key: string, params?: Record<string, string | number>) => string): string | null {
    const ms = value < 1_000_000_000_000 ? value * 1000 : value
    if (!Number.isFinite(ms)) return null
    const delta = Date.now() - ms
    if (delta < 60_000) return t('session.time.justNow')
    const minutes = Math.floor(delta / 60_000)
    if (minutes < 60) return t('session.time.minutesAgo', { n: minutes })
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return t('session.time.hoursAgo', { n: hours })
    const days = Math.floor(hours / 24)
    if (days < 7) return t('session.time.daysAgo', { n: days })
    return new Date(ms).toLocaleDateString()
}

function SessionItem(props: {
    session: DisplaySessionSummary
    onSelect: (session: DisplaySessionSummary) => void
    showPath?: boolean
    api: ApiClient | null
    selected?: boolean
}) {
    const { t } = useTranslation()
    const { session: s, onSelect, showPath = true, api, selected = false } = props
    const { haptic } = usePlatform()
    const { addToast } = useToast()
    const [menuOpen, setMenuOpen] = useState(false)
    const [menuAnchorPoint, setMenuAnchorPoint] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
    const [renameOpen, setRenameOpen] = useState(false)
    const [archiveOpen, setArchiveOpen] = useState(false)
    const [unarchiveOpen, setUnarchiveOpen] = useState(false)
    const [rollbackOpen, setRollbackOpen] = useState(false)
    const [compactOpen, setCompactOpen] = useState(false)
    const [deleteOpen, setDeleteOpen] = useState(false)
    const actionSessionId = getActionSessionId(s)
    const hasSessionActions = Boolean(actionSessionId)
    const codexThreadLifecycleSupported = supportsCodexThreadLifecycleActions(s)

    const {
        archiveSession,
        unarchiveSession,
        forkSession,
        rollbackCodexThread,
        compactCodexThread,
        renameSession,
        deleteSession,
        isPending
    } = useSessionActions(
        api,
        actionSessionId,
        s.metadata?.flavor ?? null,
        undefined,
        codexThreadLifecycleSupported
            ? {
                codexThreadId: s.codexSessionId,
                sessionSource: s.metadata?.source ?? null,
                sessionActive: s.active,
                sessionPath: s.metadata?.path ?? null
            }
            : undefined
    )

    const handleFork = async () => {
        if (!actionSessionId) {
            return
        }
        try {
            const nextSessionId = await forkSession()
            haptic.notification('success')
            onSelect({
                ...s,
                id: nextSessionId
            })
        } catch (error) {
            haptic.notification('error')
            addToast({
                title: t('session.forkFailed.title'),
                body: error instanceof Error ? error.message : t('session.forkFailed.body'),
                sessionId: actionSessionId,
                url: `/sessions/${actionSessionId}`
            })
        }
    }

    const longPressHandlers = useLongPress({
        onLongPress: (point) => {
            if (!hasSessionActions) {
                return
            }
            haptic.impact('medium')
            setMenuAnchorPoint(point)
            setMenuOpen(true)
        },
        onClick: () => {
            if (!menuOpen) {
                onSelect(s)
            }
        },
        threshold: 500
    })

    const sessionName = getSessionTitle(s)
    const todoProgress = getTodoProgress(s)
    const isNativeSession = s.metadata?.source === 'native-attached'
    const visuallyDimmed = isSessionVisuallyDimmed(s)
    return (
        <>
            <button
                type="button"
                {...longPressHandlers}
                className={`session-list-item flex w-full flex-col gap-1 px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] select-none rounded-lg ${selected ? 'bg-[var(--app-secondary-bg)]' : ''}`}
                style={{ WebkitTouchCallout: 'none' }}
                aria-current={selected ? 'page' : undefined}
            >
                <div className={`flex items-center justify-between gap-3 ${visuallyDimmed ? 'opacity-50' : ''}`}>
                    <div className="flex items-center gap-2 min-w-0">
                        <FlavorIcon flavor={s.metadata?.flavor} className="h-4 w-4 shrink-0" />
                        <div className={`truncate text-sm font-medium ${visuallyDimmed ? 'text-[var(--app-hint)]' : 'text-[var(--app-fg)]'}`}>
                            {sessionName}
                        </div>
                        {isNativeSession ? (
                            <span className="shrink-0 rounded-full border border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--app-hint)]">
                                {t('nativeSession.badge')}
                            </span>
                        ) : null}
                        {s.archived ? (
                            <span className="shrink-0 rounded-full border border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--app-hint)]">
                                {t('session.badge.archived')}
                            </span>
                        ) : null}
                        {s.active && s.thinking ? (
                            <LoaderIcon className="h-3.5 w-3.5 shrink-0 text-[var(--app-hint)] animate-spin-slow" />
                        ) : null}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 text-xs">
                        {todoProgress ? (
                            <span className="flex items-center gap-1 text-[var(--app-hint)]">
                                <BulbIcon className="h-3 w-3" />
                                {todoProgress.completed}/{todoProgress.total}
                            </span>
                        ) : null}
                        {s.pendingRequestsCount > 0 ? (
                            <span className="text-[var(--app-badge-warning-text)]">
                                {t('session.item.pending')} {s.pendingRequestsCount}
                            </span>
                        ) : null}
                        <span className="text-[var(--app-hint)]">
                            {formatRelativeTime(s.updatedAt, t)}
                        </span>
                    </div>
                </div>
                {showPath ? (
                    <div className="truncate text-xs text-[var(--app-hint)]">
                        {s.metadata?.path ?? s.id}
                    </div>
                ) : null}
            </button>

            <SessionActionMenu
                isOpen={hasSessionActions && menuOpen}
                onClose={() => setMenuOpen(false)}
                sessionActive={s.active}
                onFork={hasSessionActions && s.metadata?.path ? handleFork : undefined}
                onRollback={codexThreadLifecycleSupported && !s.archived ? () => setRollbackOpen(true) : undefined}
                onCompact={codexThreadLifecycleSupported && !s.archived ? () => setCompactOpen(true) : undefined}
                onRename={() => setRenameOpen(true)}
                onArchive={hasSessionActions && !s.archived ? () => setArchiveOpen(true) : undefined}
                onUnarchive={codexThreadLifecycleSupported && s.archived ? () => setUnarchiveOpen(true) : undefined}
                onDelete={() => setDeleteOpen(true)}
                anchorPoint={menuAnchorPoint}
            />

            <RenameSessionDialog
                isOpen={renameOpen}
                onClose={() => setRenameOpen(false)}
                currentName={sessionName}
                onRename={renameSession}
                isPending={isPending}
            />

            <RollbackThreadDialog
                isOpen={rollbackOpen}
                onClose={() => setRollbackOpen(false)}
                api={api}
                sessionId={actionSessionId}
                threadId={codexThreadLifecycleSupported ? s.codexSessionId : null}
                onRollback={rollbackCodexThread}
                isPending={isPending}
            />

            <ConfirmDialog
                isOpen={compactOpen}
                onClose={() => setCompactOpen(false)}
                title={t('dialog.compactCodexThread.title')}
                description={t('dialog.compactCodexThread.description', { name: sessionName })}
                confirmLabel={t('dialog.compactCodexThread.confirm')}
                confirmingLabel={t('dialog.compactCodexThread.confirming')}
                onConfirm={compactCodexThread}
                isPending={isPending}
            />

            <ConfirmDialog
                isOpen={archiveOpen}
                onClose={() => setArchiveOpen(false)}
                title={t(codexThreadLifecycleSupported ? 'dialog.archiveCodexThread.title' : 'dialog.archive.title')}
                description={t(
                    codexThreadLifecycleSupported ? 'dialog.archiveCodexThread.description' : 'dialog.archive.description',
                    { name: sessionName }
                )}
                confirmLabel={t(codexThreadLifecycleSupported ? 'dialog.archiveCodexThread.confirm' : 'dialog.archive.confirm')}
                confirmingLabel={t(codexThreadLifecycleSupported ? 'dialog.archiveCodexThread.confirming' : 'dialog.archive.confirming')}
                onConfirm={archiveSession}
                isPending={isPending}
                destructive
            />

            <ConfirmDialog
                isOpen={unarchiveOpen}
                onClose={() => setUnarchiveOpen(false)}
                title={t('dialog.unarchive.title')}
                description={t('dialog.unarchive.description', { name: sessionName })}
                confirmLabel={t('dialog.unarchive.confirm')}
                confirmingLabel={t('dialog.unarchive.confirming')}
                onConfirm={unarchiveSession}
                isPending={isPending}
            />

            <ConfirmDialog
                isOpen={deleteOpen}
                onClose={() => setDeleteOpen(false)}
                title={t('dialog.delete.title')}
                description={t('dialog.delete.description', { name: sessionName })}
                confirmLabel={t('dialog.delete.confirm')}
                confirmingLabel={t('dialog.delete.confirming')}
                onConfirm={deleteSession}
                isPending={isPending}
                destructive
            />
        </>
    )
}

export function SessionList(props: {
    sessions: DisplaySessionSummary[]
    projects?: ProjectSummary[]
    onSelect: (session: DisplaySessionSummary) => void
    onNewSession: () => void
    onRefresh: () => void
    isLoading: boolean
    renderHeader?: boolean
    api: ApiClient | null
    machineLabelsById?: Record<string, string>
    selectedSessionId?: string | null
    emptyLabel?: string
    focusedProjectPath?: string | null
}) {
    const { t } = useTranslation()
    const { renderHeader = true, api, selectedSessionId, machineLabelsById = {} } = props
    const queryClient = useQueryClient()
    const { haptic } = usePlatform()
    const { addToast } = useToast()
    const groups = useMemo(
        () => groupSessionsByDirectory(
            deduplicateSessionsByAgentId(props.sessions, selectedSessionId),
            props.projects ?? []
        ),
        [props.projects, props.sessions, selectedSessionId]
    )
    const [collapseOverrides, setCollapseOverrides] = useState<Map<string, boolean>>(
        () => new Map()
    )
    const isGroupCollapsed = (group: SessionGroup): boolean => {
        const override = collapseOverrides.get(group.key)
        if (override !== undefined) return override
        const hasSelectedSession = selectedSessionId
            ? group.sessions.some(session => session.id === selectedSessionId || getActionSessionId(session) === selectedSessionId)
            : false
        const isFocusedProject = props.focusedProjectPath
            ? group.directory === props.focusedProjectPath
            : false
        return !group.hasActiveSession && !hasSelectedSession && !isFocusedProject
    }

    const toggleGroup = (groupKey: string, isCollapsed: boolean) => {
        setCollapseOverrides(prev => {
            const next = new Map(prev)
            next.set(groupKey, !isCollapsed)
            return next
        })
    }

    const resolveMachineLabel = (machineId: string | null): string => {
        if (machineId && machineLabelsById[machineId]) {
            return machineLabelsById[machineId]
        }
        if (machineId) {
            return machineId.slice(0, 8)
        }
        return t('machine.unknown')
    }

    const machineGroups = useMemo(
        () => groupByMachine(groups, resolveMachineLabel),
        [groups, machineLabelsById] // eslint-disable-line react-hooks/exhaustive-deps
    )

    const createInDirectoryMutation = useMutation({
        mutationFn: async (input: { sessionId: string; directory: string }) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.forkSession(input.sessionId, { directory: input.directory })
        },
        onSuccess: async (sessionId, input) => {
            haptic.notification('success')
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
                queryClient.invalidateQueries({ queryKey: queryKeys.codexSessions })
            ])
            const sourceSession = props.sessions.find((session) => getActionSessionId(session) === input.sessionId)
            if (sourceSession) {
                props.onSelect({
                    ...sourceSession,
                    id: sessionId
                })
                return
            }
            props.onSelect({
                id: sessionId,
                active: false,
                thinking: false,
                activeAt: Date.now(),
                updatedAt: Date.now(),
                metadata: {
                    path: input.directory,
                    flavor: 'codex'
                },
                todoProgress: null,
                pendingRequestsCount: 0,
                model: null,
                effort: null,
                archived: false
            })
        },
        onError: (error, input) => {
            haptic.notification('error')
            addToast({
                title: t('session.createInDirectoryFailed.title'),
                body: error instanceof Error ? error.message : t('session.createInDirectoryFailed.body'),
                sessionId: input.sessionId,
                url: `/sessions/${input.sessionId}`
            })
        }
    })

    const isMachineCollapsed = (mg: MachineGroup): boolean => {
        const key = `machine::${mg.machineId ?? UNKNOWN_MACHINE_ID}`
        const override = collapseOverrides.get(key)
        if (override !== undefined) return override
        const hasSelected = selectedSessionId
            ? mg.projectGroups.some(pg => pg.sessions.some(s => s.id === selectedSessionId || getActionSessionId(s) === selectedSessionId))
            : false
        const hasFocusedProject = props.focusedProjectPath
            ? mg.projectGroups.some((pg) => pg.directory === props.focusedProjectPath)
            : false
        return !mg.hasActiveSession && !hasSelected && !hasFocusedProject
    }

    const toggleMachine = (mg: MachineGroup) => {
        const key = `machine::${mg.machineId ?? UNKNOWN_MACHINE_ID}`
        const current = isMachineCollapsed(mg)
        setCollapseOverrides(prev => {
            const next = new Map(prev)
            next.set(key, !current)
            return next
        })
    }

    // Auto-expand group (and machine) containing selected session
    useEffect(() => {
        if (!selectedSessionId) return
        setCollapseOverrides(prev => {
            const group = groups.find(g =>
                g.sessions.some(s => s.id === selectedSessionId || getActionSessionId(s) === selectedSessionId)
            )
            if (!group) return prev
            const next = new Map(prev)
            let changed = false
            // Expand project group if collapsed
            if (prev.has(group.key) && prev.get(group.key)) {
                next.delete(group.key)
                changed = true
            }
            // Expand machine group if collapsed
            const machineKey = `machine::${group.machineId ?? UNKNOWN_MACHINE_ID}`
            if (prev.has(machineKey) && prev.get(machineKey)) {
                next.delete(machineKey)
                changed = true
            }
            return changed ? next : prev
        })
    }, [selectedSessionId, groups])

    useEffect(() => {
        if (!props.focusedProjectPath) return
        setCollapseOverrides(prev => {
            const group = groups.find((item) => item.directory === props.focusedProjectPath)
            if (!group) return prev
            const next = new Map(prev)
            let changed = false
            if (prev.has(group.key) && prev.get(group.key)) {
                next.delete(group.key)
                changed = true
            }
            const machineKey = `machine::${group.machineId ?? UNKNOWN_MACHINE_ID}`
            if (prev.has(machineKey) && prev.get(machineKey)) {
                next.delete(machineKey)
                changed = true
            }
            return changed ? next : prev
        })
    }, [groups, props.focusedProjectPath])

    // Clean up stale collapse overrides
    useEffect(() => {
        setCollapseOverrides(prev => {
            if (prev.size === 0) return prev
            const next = new Map(prev)
            const knownKeys = new Set<string>()
            for (const g of groups) {
                knownKeys.add(g.key)
                knownKeys.add(`machine::${g.machineId ?? UNKNOWN_MACHINE_ID}`)
            }
            let changed = false
            for (const key of next.keys()) {
                if (!knownKeys.has(key)) {
                    next.delete(key)
                    changed = true
                }
            }
            return changed ? next : prev
        })
    }, [groups])

    return (
        <div className="mx-auto w-full max-w-content flex flex-col">
            {renderHeader ? (
                <div className="flex items-center justify-between px-3 py-1">
                    <div className="text-xs text-[var(--app-hint)]">
                        {t('sessions.count', { n: props.sessions.length, m: groups.length })}
                    </div>
                    <button
                        type="button"
                        onClick={props.onNewSession}
                        className="session-list-new-button p-1.5 rounded-full text-[var(--app-link)] transition-colors"
                        title={t('sessions.new')}
                    >
                        <PlusIcon className="h-5 w-5" />
                    </button>
                </div>
            ) : null}

            {machineGroups.length === 0 ? (
                <div className="px-3 py-6 text-sm text-[var(--app-hint)]">
                    {props.emptyLabel ?? t('sessions.empty.active')}
                </div>
            ) : (
                <div className="flex flex-col gap-3 px-2 pt-1 pb-2">
                    {machineGroups.map((mg) => {
                    const machineCollapsed = isMachineCollapsed(mg)
                    return (
                        <div key={mg.machineId ?? UNKNOWN_MACHINE_ID}>
                            {/* Level 1: Machine */}
                            <button
                                type="button"
                                onClick={() => toggleMachine(mg)}
                                className="flex w-full items-center gap-2 px-1 py-1.5 text-left rounded-lg transition-colors hover:bg-[var(--app-subtle-bg)] select-none"
                            >
                                <ChevronIcon className="h-4 w-4 text-[var(--app-hint)] shrink-0" collapsed={machineCollapsed} />
                                <MachineIcon className="h-4 w-4 text-[var(--app-hint)] shrink-0" />
                                <span className="text-sm font-semibold truncate flex-1">{mg.label}</span>
                                <span className="text-[11px] tabular-nums text-[var(--app-hint)] shrink-0">({mg.totalSessions})</span>
                            </button>

                            {/* Level 2: Projects */}
                            <div className="collapsible-panel" data-open={!machineCollapsed || undefined}>
                                <div className="collapsible-inner">
                                <div className="flex flex-col ml-3.5 pl-1 mt-0.5">
                                    {mg.projectGroups.map((group) => {
                                        const isCollapsed = isGroupCollapsed(group)
                                        return (
                                            <div key={group.key}>
                                                <div
                                                    className="group/project sticky top-0 z-10 flex items-center gap-2 px-1 py-1.5 text-left rounded-lg transition-colors hover:bg-[var(--app-subtle-bg)] cursor-pointer min-w-0 w-full select-none"
                                                    onClick={() => toggleGroup(group.key, isCollapsed)}
                                                    title={group.directory}
                                                >
                                                    <ChevronIcon className="h-3.5 w-3.5 text-[var(--app-hint)] shrink-0" collapsed={isCollapsed} />
                                                    <span className="font-medium text-sm truncate flex-1">
                                                        {group.displayName}
                                                    </span>
                                                    {group.sessions.find((session) => getActionSessionId(session)) ? (
                                                        <button
                                                            type="button"
                                                            className="opacity-70 md:opacity-0 md:group-hover/project:opacity-100 transition-opacity duration-150 shrink-0 p-0.5 rounded text-[var(--app-hint)] hover:text-[var(--app-fg)]"
                                                            title={t('session.action.newInDirectory')}
                                                            onClick={(event) => {
                                                                event.stopPropagation()
                                                                const forkSource = group.sessions.find((session) => getActionSessionId(session))
                                                                if (!forkSource) {
                                                                    return
                                                                }
                                                                void createInDirectoryMutation.mutateAsync({
                                                                    sessionId: getActionSessionId(forkSource)!,
                                                                    directory: group.directory
                                                                })
                                                            }}
                                                        >
                                                            {createInDirectoryMutation.isPending
                                                                && createInDirectoryMutation.variables?.sessionId === getActionSessionId(group.sessions.find((session) => getActionSessionId(session))!)
                                                                && createInDirectoryMutation.variables?.directory === group.directory
                                                                ? <LoaderIcon className="h-3.5 w-3.5 animate-spin-slow" />
                                                                : <PlusIcon className="h-3.5 w-3.5" />
                                                            }
                                                        </button>
                                                    ) : null}
                                                    <CopyPathButton path={group.directory} className="opacity-0 group-hover/project:opacity-100 transition-opacity duration-150" />
                                                    <span className="text-[11px] tabular-nums text-[var(--app-hint)] shrink-0">
                                                        ({group.sessions.length})
                                                    </span>
                                                </div>

                                                {/* Level 3: Sessions */}
                                                <div className="collapsible-panel" data-open={!isCollapsed || undefined}>
                                                    <div className="collapsible-inner">
                                                    <div className="flex flex-col gap-0.5 ml-3 pl-1 pr-1 py-1">
                                                        {group.sessions.length === 0 ? (
                                                            <div className="px-2 py-2 text-xs text-[var(--app-hint)]">
                                                                {t('project.empty')}
                                                            </div>
                                                        ) : (
                                                            group.sessions.map((s) => (
                                                                <SessionItem
                                                                    key={s.id}
                                                                    session={s}
                                                                    onSelect={props.onSelect}
                                                                    showPath={false}
                                                                    api={api}
                                                                    selected={s.id === selectedSessionId || getActionSessionId(s) === selectedSessionId}
                                                                />
                                                            ))
                                                        )}
                                                    </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                                </div>
                            </div>
                        </div>
                    )
                    })}
                </div>
            )}
        </div>
    )
}
