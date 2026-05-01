import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isObject } from '@hapi/protocol'
import type { ApiClient } from '@/api/client'
import type { CodexAppServerResult, CodexThread, CodexTurn, Session } from '@/types/api'
import { Button } from '@/components/ui/button'
import { canReadCodexThreadFromAppServer } from '@/hooks/queries/useCodexThreadMessages'
import { queryKeys } from '@/lib/query-keys'
import { useToast } from '@/lib/toast-context'
import { useTranslation } from '@/lib/use-translation'

export type CodexWorkspacePanelTab = 'messages' | 'summary' | 'review' | 'manage'

type DetailRow = {
    label: string
    value: string
}

type PluginRow = {
    id: string
    name: string
    pluginName: string
    description: string | null
    installed: boolean
    enabled: boolean
    marketplaceName: string
    marketplacePath: string | null
    remoteMarketplaceName: string | null
}

type PanelRow = {
    id: string
    label: string
    title: string
    detail: string
    tone?: 'normal' | 'warning' | 'error'
}

type ReviewRow = PanelRow

const REVIEW_VISIBLE_TURNS = 50

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function asNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function statusLabel(value: unknown): string {
    if (!isObject(value)) {
        return asString(value) ?? 'unknown'
    }
    const type = asString(value.type)
    if (type === 'active' && Array.isArray(value.activeFlags) && value.activeFlags.length > 0) {
        return `active: ${value.activeFlags.join(', ')}`
    }
    return type ?? 'unknown'
}

function formatTimestamp(value: unknown): string | null {
    const timestamp = asNumber(value)
    if (!timestamp || timestamp <= 0) {
        return null
    }
    const millis = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp
    return new Date(millis).toLocaleString()
}

function shortText(value: unknown, max = 180): string {
    const text = asString(value) ?? stringify(value)
    const normalized = text.replace(/\s+/g, ' ').trim()
    if (normalized.length <= max) {
        return normalized
    }
    return `${normalized.slice(0, max - 1)}…`
}

function stringify(value: unknown): string {
    if (typeof value === 'string') {
        return value
    }
    try {
        return JSON.stringify(value)
    } catch {
        return String(value)
    }
}

function gitSummary(value: unknown): string | null {
    if (!isObject(value)) {
        return null
    }
    const branch = asString(value.branch) ?? asString(value.currentBranch)
    const commit = asString(value.commit) ?? asString(value.sha)
    if (branch && commit) {
        return `${branch} @ ${commit.slice(0, 8)}`
    }
    return branch ?? (commit ? commit.slice(0, 8) : null)
}

function threadRows(thread: CodexThread | null, session: Session): DetailRow[] {
    if (!thread) {
        return []
    }
    const rows: DetailRow[] = []
    const title = thread.name ?? thread.preview ?? session.metadata?.name ?? session.id
    rows.push({ label: 'codexPanel.summary.name', value: title })
    rows.push({ label: 'codexPanel.summary.status', value: statusLabel(thread.status) })
    rows.push({ label: 'codexPanel.summary.modelProvider', value: thread.modelProvider ?? session.model ?? 'unknown' })
    if (session.modelReasoningEffort ?? session.effort) {
        rows.push({ label: 'codexPanel.summary.effort', value: session.modelReasoningEffort ?? session.effort ?? '' })
    }
    rows.push({ label: 'codexPanel.summary.turns', value: String(thread.turns?.length ?? 0) })
    const cwd = thread.cwd ?? thread.path ?? session.metadata?.path
    if (cwd) {
        rows.push({ label: 'codexPanel.summary.cwd', value: cwd })
    }
    const updatedAt = formatTimestamp(thread.updatedAt)
    if (updatedAt) {
        rows.push({ label: 'codexPanel.summary.updatedAt', value: updatedAt })
    }
    if (thread.cliVersion) {
        rows.push({ label: 'codexPanel.summary.cliVersion', value: thread.cliVersion })
    }
    const git = gitSummary(thread.gitInfo)
    if (git) {
        rows.push({ label: 'codexPanel.summary.git', value: git })
    }
    return rows
}

export function buildReviewRows(turns: CodexTurn[] | undefined): ReviewRow[] {
    const rows: ReviewRow[] = []
    for (const turn of turns ?? []) {
        const items = Array.isArray(turn.items) ? turn.items : []
        for (const [index, item] of items.entries()) {
            if (!isObject(item)) {
                continue
            }
            const id = asString(item.id) ?? `${turn.id}:${index}`
            const type = asString(item.type)
            if (type === 'enteredReviewMode' || type === 'exitedReviewMode') {
                rows.push({
                    id,
                    label: type === 'enteredReviewMode' ? 'Review' : 'Review done',
                    title: type === 'enteredReviewMode' ? 'Entered review mode' : 'Exited review mode',
                    detail: shortText(item.review)
                })
                continue
            }
            if (type === 'fileChange') {
                const changes = Array.isArray(item.changes) ? item.changes : []
                const paths = changes
                    .map((change) => isObject(change) ? asString(change.path) : null)
                    .filter((path): path is string => Boolean(path))
                rows.push({
                    id,
                    label: 'Files',
                    title: `${paths.length} file change${paths.length === 1 ? '' : 's'}`,
                    detail: paths.slice(0, 4).join(', ') || shortText(item.changes),
                    tone: item.status === 'failed' ? 'error' : 'normal'
                })
                continue
            }
        }
    }
    return rows.slice(-12).reverse()
}

function flattenPlugins(response: CodexAppServerResult<'plugin/list'> | undefined): PluginRow[] {
    return (response?.marketplaces ?? []).flatMap((marketplace) => {
        const remoteMarketplaceName = marketplace.path ? null : marketplace.name
        return marketplace.plugins.map((plugin) => ({
            id: plugin.id,
            name: plugin.interface?.displayName ?? plugin.name,
            pluginName: plugin.name,
            description: plugin.interface?.shortDescription ?? plugin.interface?.longDescription ?? null,
            installed: plugin.installed,
            enabled: plugin.enabled,
            marketplaceName: marketplace.name,
            marketplacePath: marketplace.path,
            remoteMarketplaceName
        }))
    })
}

function ErrorLine(props: { message: string }) {
    return (
        <div className="rounded-md border border-[var(--app-badge-error-border)] bg-[var(--app-badge-error-bg)] px-3 py-2 text-xs text-[var(--app-badge-error-text)]">
            {props.message}
        </div>
    )
}

function EmptyLine(props: { message: string }) {
    return <div className="py-4 text-sm text-[var(--app-hint)]">{props.message}</div>
}

function PanelRows(props: { rows: PanelRow[] }) {
    return (
        <div className="space-y-2">
            {props.rows.map((row) => (
                <div key={row.id} className="border-b border-[var(--app-divider)] py-2 last:border-b-0">
                    <div className="flex items-center gap-2">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                            row.tone === 'error'
                                ? 'bg-[var(--app-badge-error-bg)] text-[var(--app-badge-error-text)]'
                                : 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)]'
                        }`}>
                            {row.label}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--app-fg)]">
                            {row.title}
                        </span>
                    </div>
                    <div className="mt-1 line-clamp-3 text-xs text-[var(--app-hint)]">
                        {row.detail}
                    </div>
                </div>
            ))}
        </div>
    )
}

export function CodexWorkspacePanel(props: {
    api: ApiClient
    session: Session
    activeTab: CodexWorkspacePanelTab
    onTabChange: (tab: CodexWorkspacePanelTab) => void
    reviewThreadId?: string | null
    onReviewThreadIdChange?: (threadId: string | null) => void
}) {
    const { t } = useTranslation()
    const { addToast } = useToast()
    const queryClient = useQueryClient()
    const tab = props.activeTab

    const canUseAppServerThread = canReadCodexThreadFromAppServer(props.session)
    const threadId = canUseAppServerThread && typeof props.session.metadata?.codexSessionId === 'string'
        ? props.session.metadata.codexSessionId.trim()
        : null
    const cwd = canUseAppServerThread ? props.session.metadata?.path ?? null : null

    const threadQuery = useQuery({
        queryKey: threadId ? queryKeys.codexThread(props.session.id, threadId) : ['codex-thread', 'workspace-panel-disabled'],
        queryFn: async () => await props.api.readCodexThread(props.session.id, {
            threadId: threadId ?? '',
            includeTurns: false
        }),
        enabled: tab === 'summary' && Boolean(threadId),
        staleTime: 3_000
    })

    const turnsQuery = useQuery({
        queryKey: threadId ? queryKeys.codexThreadTurns(props.session.id, threadId) : ['codex-thread-turns', 'workspace-panel-disabled'],
        queryFn: async () => await props.api.listCodexThreadTurns(props.session.id, {
            threadId: threadId ?? '',
            limit: 50,
            sortDirection: 'desc'
        }),
        enabled: tab === 'summary' && Boolean(threadId),
        staleTime: 10_000
    })

    const effectiveReviewThreadId = props.reviewThreadId?.trim() || null
    const reviewQuery = useQuery({
        queryKey: effectiveReviewThreadId
            ? queryKeys.codexReviewThread(props.session.id, effectiveReviewThreadId)
            : ['codex-review-thread', 'disabled'],
        queryFn: async () => {
            if (!effectiveReviewThreadId) {
                throw new Error('Missing review thread id')
            }
            return await props.api.listCodexThreadTurns(props.session.id, {
                threadId: effectiveReviewThreadId,
                limit: REVIEW_VISIBLE_TURNS,
                sortDirection: 'desc'
            })
        },
        enabled: tab === 'review' && Boolean(effectiveReviewThreadId),
        staleTime: 5_000
    })

    const skillsQuery = useQuery({
        queryKey: threadId ? queryKeys.codexManagement(props.session.id, threadId, 'skills') : ['codex-management', 'skills-disabled'],
        queryFn: async () => await props.api.listCodexSkills(props.session.id, {
            cwds: cwd ? [cwd] : undefined,
            forceReload: false
        }),
        enabled: tab === 'manage' && Boolean(threadId),
        staleTime: 20_000
    })

    const pluginsQuery = useQuery({
        queryKey: threadId ? queryKeys.codexManagement(props.session.id, threadId, 'plugins') : ['codex-management', 'plugins-disabled'],
        queryFn: async () => await props.api.listCodexPlugins(props.session.id, {
            cwds: cwd ? [cwd] : undefined
        }),
        enabled: tab === 'manage' && Boolean(threadId),
        staleTime: 20_000
    })

    const appsQuery = useQuery({
        queryKey: threadId ? queryKeys.codexManagement(props.session.id, threadId, 'apps') : ['codex-management', 'apps-disabled'],
        queryFn: async () => await props.api.listCodexApps(props.session.id, {
            threadId: threadId ?? '',
            limit: 40
        }),
        enabled: tab === 'manage' && Boolean(threadId),
        staleTime: 20_000
    })

    const mcpQuery = useQuery({
        queryKey: threadId ? queryKeys.codexManagement(props.session.id, threadId, 'mcp') : ['codex-management', 'mcp-disabled'],
        queryFn: async () => await props.api.listCodexMcpServers(props.session.id, {
            limit: 40,
            detail: 'toolsAndAuthOnly'
        }),
        enabled: tab === 'manage' && Boolean(threadId),
        staleTime: 20_000
    })

    const invalidateManagement = async () => {
        if (!threadId) {
            return
        }
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: queryKeys.codexManagement(props.session.id, threadId, 'plugins') }),
            queryClient.invalidateQueries({ queryKey: queryKeys.codexManagement(props.session.id, threadId, 'apps') }),
            queryClient.invalidateQueries({ queryKey: queryKeys.codexManagement(props.session.id, threadId, 'skills') }),
            queryClient.invalidateQueries({ queryKey: queryKeys.codexManagement(props.session.id, threadId, 'mcp') })
        ])
    }

    const pluginMutation = useMutation({
        mutationFn: async (plugin: PluginRow) => {
            if (plugin.installed) {
                return await props.api.uninstallCodexPlugin(props.session.id, { pluginId: plugin.id })
            }
            return await props.api.installCodexPlugin(props.session.id, {
                pluginName: plugin.pluginName,
                marketplacePath: plugin.marketplacePath,
                remoteMarketplaceName: plugin.remoteMarketplaceName
            })
        },
        onSuccess: async (_result, plugin) => {
            await invalidateManagement()
            addToast({
                title: plugin.installed ? t('codexPanel.manage.pluginUninstalled') : t('codexPanel.manage.pluginInstalled'),
                body: plugin.name,
                sessionId: props.session.id,
                url: `/sessions/${props.session.id}`
            })
        },
        onError: (error) => {
            addToast({
                title: t('codexPanel.manage.pluginFailed'),
                body: error instanceof Error ? error.message : t('dialog.error.default'),
                sessionId: props.session.id,
                url: `/sessions/${props.session.id}`
            })
        }
    })

    const memoryMutation = useMutation({
        mutationFn: async (mode: 'enabled' | 'disabled') => await props.api.setCodexThreadMemoryMode(props.session.id, {
            threadId: threadId ?? '',
            mode
        }),
        onSuccess: async (_result, mode) => {
            if (!threadId) {
                return
            }
            await queryClient.invalidateQueries({ queryKey: queryKeys.codexThread(props.session.id, threadId) })
            addToast({
                title: t('codexPanel.manage.memoryUpdated'),
                body: t(mode === 'enabled' ? 'codexPanel.manage.memoryEnabled' : 'codexPanel.manage.memoryDisabled'),
                sessionId: props.session.id,
                url: `/sessions/${props.session.id}`
            })
        },
        onError: (error) => {
            addToast({
                title: t('codexPanel.manage.memoryFailed'),
                body: error instanceof Error ? error.message : t('dialog.error.default'),
                sessionId: props.session.id,
                url: `/sessions/${props.session.id}`
            })
        }
    })

    const resetMemoryMutation = useMutation({
        mutationFn: async () => await props.api.resetCodexMemory(props.session.id),
        onSuccess: async () => {
            if (threadId) {
                await queryClient.invalidateQueries({ queryKey: queryKeys.codexThread(props.session.id, threadId) })
            }
            addToast({
                title: t('codexPanel.manage.memoryResetDone'),
                body: t('codexPanel.manage.memoryResetDoneBody'),
                sessionId: props.session.id,
                url: `/sessions/${props.session.id}`
            })
        },
        onError: (error) => {
            addToast({
                title: t('codexPanel.manage.memoryFailed'),
                body: error instanceof Error ? error.message : t('dialog.error.default'),
                sessionId: props.session.id,
                url: `/sessions/${props.session.id}`
            })
        }
    })

    const thread = threadQuery.data?.thread ?? null
    const summaryRows = useMemo(() => threadRows(thread, props.session), [thread, props.session])
    const visibleTurns = useMemo(
        () => turnsQuery.data?.data ? [...turnsQuery.data.data].reverse() : thread?.turns ?? [],
        [thread?.turns, turnsQuery.data?.data]
    )
    const reviewTurns = useMemo(
        () => reviewQuery.data?.data ? [...reviewQuery.data.data].reverse() : [],
        [reviewQuery.data?.data]
    )
    const reviewRows = useMemo(
        () => buildReviewRows(reviewTurns),
        [reviewTurns]
    )
    const plugins = useMemo(() => flattenPlugins(pluginsQuery.data), [pluginsQuery.data])
    const skills = (skillsQuery.data?.data ?? []).flatMap((entry) => entry.skills.map((skill) => ({
        name: skill.interface?.displayName ?? skill.name,
        description: skill.interface?.shortDescription ?? skill.shortDescription ?? skill.description,
        enabled: skill.enabled,
        cwd: entry.cwd
    })))
    const apps = appsQuery.data?.data ?? []
    const mcpServers = mcpQuery.data?.data ?? []

    if (!canUseAppServerThread || !threadId) {
        return null
    }

    const tabClass = (value: CodexWorkspacePanelTab) => [
        'h-8 rounded-md px-3 text-xs font-semibold transition-colors',
        tab === value
            ? 'bg-[var(--app-button)] text-[var(--app-button-text)]'
            : 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)] hover:text-[var(--app-fg)]'
    ].join(' ')

    return (
        <section className="border-b border-[var(--app-border)] bg-[var(--app-bg)]">
            <div className="mx-auto w-full max-w-content px-3 py-3">
                <div className="mb-3 flex items-center gap-2 overflow-x-auto">
                    <button type="button" className={tabClass('messages')} onClick={() => props.onTabChange('messages')}>
                        {t('codexPanel.tab.messages')}
                    </button>
                    <button type="button" className={tabClass('summary')} onClick={() => props.onTabChange('summary')}>
                        {t('codexPanel.tab.summary')}
                    </button>
                    <button type="button" className={tabClass('review')} onClick={() => props.onTabChange('review')}>
                        {t('codexPanel.tab.review')}
                    </button>
                    <button type="button" className={tabClass('manage')} onClick={() => props.onTabChange('manage')}>
                        {t('codexPanel.tab.manage')}
                    </button>
                </div>

                {tab === 'summary' ? (
                    <div className="space-y-3">
                        {threadQuery.error ? (
                            <ErrorLine message={threadQuery.error instanceof Error ? threadQuery.error.message : t('codexPanel.summary.loadFailed')} />
                        ) : null}
                        <div className="grid gap-2 sm:grid-cols-2">
                            {summaryRows.map((row) => (
                                <div key={row.label} className="min-w-0 border-b border-[var(--app-divider)] py-1.5">
                                    <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--app-hint)]">
                                        {t(row.label)}
                                    </div>
                                    <div className="truncate text-sm text-[var(--app-fg)]" title={row.value}>
                                        {row.value}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs text-[var(--app-hint)]">
                            <span>{t('codexPanel.summary.turnList')}: {visibleTurns.length}</span>
                            {turnsQuery.isFetching ? <span>{t('loading')}</span> : null}
                            {turnsQuery.error ? <span>{t('codexPanel.summary.turnsFailed')}</span> : null}
                        </div>
                    </div>
                ) : null}

                {tab === 'review' ? (
                    <div className="space-y-3">
                        {effectiveReviewThreadId ? (
                            <div className="flex items-center gap-2 text-xs text-[var(--app-hint)]">
                                <span className="min-w-0 flex-1 truncate">
                                    {t('codexPanel.review.thread')}: {effectiveReviewThreadId}
                                </span>
                                <button
                                    type="button"
                                    className="shrink-0 rounded px-2 py-1 text-[var(--app-link)] hover:bg-[var(--app-subtle-bg)]"
                                    onClick={() => props.onReviewThreadIdChange?.(null)}
                                >
                                    {t('codexPanel.review.clear')}
                                </button>
                            </div>
                        ) : (
                            <EmptyLine message={t('codexPanel.review.empty')} />
                        )}
                        {reviewQuery.error ? (
                            <ErrorLine message={reviewQuery.error instanceof Error ? reviewQuery.error.message : t('codexPanel.review.loadFailed')} />
                        ) : null}
                        {reviewQuery.isLoading ? (
                            <EmptyLine message={t('loading')} />
                        ) : reviewRows.length > 0 ? (
                            <PanelRows rows={reviewRows} />
                        ) : effectiveReviewThreadId ? (
                            <EmptyLine message={t('codexPanel.review.noRows')} />
                        ) : null}
                    </div>
                ) : null}

                {tab === 'manage' ? (
                    <div className="grid gap-4 lg:grid-cols-2">
                        <div className="space-y-2">
                            <div className="text-sm font-semibold">{t('codexPanel.manage.skills')}</div>
                            {skillsQuery.error ? (
                                <ErrorLine message={skillsQuery.error instanceof Error ? skillsQuery.error.message : t('codexPanel.manage.loadFailed')} />
                            ) : skills.length > 0 ? (
                                <div className="space-y-2">
                                    {skills.slice(0, 8).map((skill) => (
                                        <div key={`${skill.cwd}:${skill.name}`} className="min-w-0 border-b border-[var(--app-divider)] pb-2">
                                            <div className="flex items-center gap-2">
                                                <span className="truncate text-sm font-medium">{skill.name}</span>
                                                <span className="shrink-0 text-xs text-[var(--app-hint)]">
                                                    {skill.enabled ? t('codexPanel.manage.enabled') : t('codexPanel.manage.disabled')}
                                                </span>
                                            </div>
                                            <div className="line-clamp-2 text-xs text-[var(--app-hint)]">{skill.description}</div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <EmptyLine message={skillsQuery.isLoading ? t('loading') : t('codexPanel.manage.empty')} />
                            )}
                        </div>

                        <div className="space-y-2">
                            <div className="text-sm font-semibold">{t('codexPanel.manage.plugins')}</div>
                            {pluginsQuery.error ? (
                                <ErrorLine message={pluginsQuery.error instanceof Error ? pluginsQuery.error.message : t('codexPanel.manage.loadFailed')} />
                            ) : plugins.length > 0 ? (
                                <div className="space-y-2">
                                    {plugins.slice(0, 8).map((plugin) => (
                                        <div key={plugin.id} className="flex min-w-0 items-start gap-2 border-b border-[var(--app-divider)] pb-2">
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-sm font-medium">{plugin.name}</div>
                                                <div className="line-clamp-2 text-xs text-[var(--app-hint)]">
                                                    {plugin.description ?? plugin.marketplaceName}
                                                </div>
                                            </div>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant={plugin.installed ? 'outline' : 'secondary'}
                                                disabled={pluginMutation.isPending}
                                                onClick={() => pluginMutation.mutate(plugin)}
                                            >
                                                {plugin.installed ? t('codexPanel.manage.uninstall') : t('codexPanel.manage.install')}
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <EmptyLine message={pluginsQuery.isLoading ? t('loading') : t('codexPanel.manage.empty')} />
                            )}
                        </div>

                        <div className="space-y-2">
                            <div className="text-sm font-semibold">{t('codexPanel.manage.apps')}</div>
                            {appsQuery.error ? (
                                <ErrorLine message={appsQuery.error instanceof Error ? appsQuery.error.message : t('codexPanel.manage.loadFailed')} />
                            ) : apps.length > 0 ? (
                                <div className="space-y-2">
                                    {apps.slice(0, 8).map((app) => (
                                        <div key={app.id} className="min-w-0 border-b border-[var(--app-divider)] pb-2">
                                            <div className="flex items-center gap-2">
                                                <span className="truncate text-sm font-medium">{app.name}</span>
                                                <span className="shrink-0 text-xs text-[var(--app-hint)]">
                                                    {app.isEnabled && app.isAccessible ? t('codexPanel.manage.enabled') : t('codexPanel.manage.disabled')}
                                                </span>
                                            </div>
                                            <div className="line-clamp-2 text-xs text-[var(--app-hint)]">
                                                {app.description ?? app.pluginDisplayNames.join(', ')}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <EmptyLine message={appsQuery.isLoading ? t('loading') : t('codexPanel.manage.empty')} />
                            )}
                        </div>

                        <div className="space-y-2">
                            <div className="text-sm font-semibold">{t('codexPanel.manage.mcp')}</div>
                            {mcpQuery.error ? (
                                <ErrorLine message={mcpQuery.error instanceof Error ? mcpQuery.error.message : t('codexPanel.manage.loadFailed')} />
                            ) : mcpServers.length > 0 ? (
                                <div className="space-y-2">
                                    {mcpServers.slice(0, 8).map((server) => (
                                        <div key={server.name} className="min-w-0 border-b border-[var(--app-divider)] pb-2">
                                            <div className="flex items-center gap-2">
                                                <span className="truncate text-sm font-medium">{server.name}</span>
                                                <span className="shrink-0 text-xs text-[var(--app-hint)]">{server.authStatus}</span>
                                            </div>
                                            <div className="text-xs text-[var(--app-hint)]">
                                                {Object.keys(server.tools ?? {}).length} {t('codexPanel.manage.tools')} · {server.resources?.length ?? 0} {t('codexPanel.manage.resources')}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <EmptyLine message={mcpQuery.isLoading ? t('loading') : t('codexPanel.manage.empty')} />
                            )}
                        </div>

                        <div className="space-y-2 lg:col-span-2">
                            <div className="text-sm font-semibold">{t('codexPanel.manage.memory')}</div>
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    disabled={memoryMutation.isPending}
                                    onClick={() => memoryMutation.mutate('enabled')}
                                >
                                    {t('codexPanel.manage.memoryEnable')}
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    disabled={memoryMutation.isPending}
                                    onClick={() => memoryMutation.mutate('disabled')}
                                >
                                    {t('codexPanel.manage.memoryDisable')}
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={resetMemoryMutation.isPending}
                                    onClick={() => {
                                        if (window.confirm(t('codexPanel.manage.memoryResetConfirm'))) {
                                            resetMemoryMutation.mutate()
                                        }
                                    }}
                                >
                                    {t('codexPanel.manage.memoryReset')}
                                </Button>
                            </div>
                        </div>
                    </div>
                ) : null}
            </div>
        </section>
    )
}
