import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { usePlatform } from '@/hooks/usePlatform'
import { normalizeProjectPath } from '@/lib/project-path'
import { queryKeys } from '@/lib/query-keys'
import { useTranslation } from '@/lib/use-translation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

function getDisplayName(path: string): string {
    const parts = path.split('/').filter(Boolean)
    if (parts.length === 0) {
        return path
    }
    return parts[parts.length - 1] ?? path
}

export function NativeSessionAttach(props: {
    api: ApiClient | null
    onSuccess: (sessionId: string) => void
    onProjectCreated?: (projectPath: string) => void
}) {
    const queryClient = useQueryClient()
    const { haptic } = usePlatform()
    const { t } = useTranslation()
    const [cwd, setCwd] = useState('')
    const [title, setTitle] = useState('')

    const query = useQuery({
        queryKey: queryKeys.nativeSessions,
        queryFn: async () => {
            if (!props.api) {
                throw new Error('API unavailable')
            }
            return await props.api.discoverNativeSessions()
        },
        enabled: Boolean(props.api),
        retry: false
    })

    const createMutation = useMutation({
        mutationFn: async (payload: {
            path: string
            name?: string
        }) => {
            if (!props.api) {
                throw new Error('API unavailable')
            }
            return await props.api.createProject(payload)
        },
        onSuccess: async ({ project, nativeSession }) => {
            haptic.notification('success')
            setCwd('')
            setTitle('')
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
                queryClient.invalidateQueries({ queryKey: queryKeys.codexSessions }),
                queryClient.invalidateQueries({ queryKey: queryKeys.nativeSessions })
            ])

            if (nativeSession?.sessionId) {
                props.onSuccess(nativeSession.sessionId)
                return
            }

            if (nativeSession) {
                await attachMutation.mutateAsync({
                    tmuxSession: nativeSession.tmuxSession,
                    tmuxPane: nativeSession.tmuxPane,
                    agent: nativeSession.command
                }).catch(() => undefined)
                return
            }

            props.onProjectCreated?.(project.path)
        },
        onError: () => {
            haptic.notification('error')
        }
    })

    const attachMutation = useMutation({
        // Keep the UI aligned with the backend allowlist.
        // Native Claude attach is intentionally disabled for now.
        mutationFn: async (payload: {
            tmuxSession: string
            tmuxPane: string
            agent: 'codex'
        }) => {
            if (!props.api) {
                throw new Error('API unavailable')
            }
            return await props.api.attachNativeSession(payload)
        },
        onSuccess: async ({ sessionId }) => {
            haptic.notification('success')
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.codexSessions }),
                queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
                queryClient.invalidateQueries({ queryKey: queryKeys.nativeSessions })
            ])
            props.onSuccess(sessionId)
        },
        onError: () => {
            haptic.notification('error')
        }
    })

    const sessions = query.data?.sessions ?? []
    const createError = createMutation.error instanceof Error ? createMutation.error.message : null
    const attachError = attachMutation.error instanceof Error ? attachMutation.error.message : null
    const actionError = createError ?? attachError
    const trimmedCwd = cwd.trim()
    const trimmedTitle = title.trim()

    return (
        <div className="px-3 py-4">
            <Card className="border border-[var(--app-border)]">
                <CardHeader className="gap-2">
                    <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                            <CardTitle>{t('nativeSession.title')}</CardTitle>
                            <CardDescription>{t('nativeSession.description')}</CardDescription>
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void query.refetch()}
                            disabled={query.isFetching}
                        >
                            {t('nativeSession.refresh')}
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-3">
                        <div className="space-y-3">
                            <div className="space-y-1">
                                <div className="text-sm font-medium text-[var(--app-fg)]">
                                    {t('nativeSession.createTitle')}
                                </div>
                                <div className="text-xs text-[var(--app-hint)]">
                                    {t('nativeSession.createDescription')}
                                </div>
                            </div>

                            <div className="space-y-1">
                                <label className="text-xs font-medium text-[var(--app-hint)]">
                                    {t('nativeSession.directoryLabel')}
                                </label>
                                <input
                                    type="text"
                                    value={cwd}
                                    onChange={(event) => setCwd(event.target.value)}
                                    placeholder={t('nativeSession.directoryPlaceholder')}
                                    className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)]"
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="text-xs font-medium text-[var(--app-hint)]">
                                    {t('nativeSession.titleLabel')}
                                </label>
                                <input
                                    type="text"
                                    value={title}
                                    onChange={(event) => setTitle(event.target.value)}
                                    placeholder={t('nativeSession.titlePlaceholder')}
                                    className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)]"
                                />
                            </div>

                            <div className="flex justify-end">
                                <Button
                                    type="button"
                                    size="sm"
                                    disabled={createMutation.isPending || trimmedCwd.length === 0}
                                    onClick={() => {
                                        void createMutation.mutateAsync({
                                            path: normalizeProjectPath(trimmedCwd),
                                            name: trimmedTitle || undefined
                                        })
                                    }}
                                >
                                    {createMutation.isPending ? t('nativeSession.creating') : t('nativeSession.create')}
                                </Button>
                            </div>
                        </div>
                    </div>

                    {actionError ? (
                        <div className="rounded-md border border-[var(--app-badge-error-border)] bg-[var(--app-badge-error-bg)] px-3 py-2 text-sm text-[var(--app-badge-error-text)]">
                            {actionError}
                        </div>
                    ) : null}

                    {query.error ? (
                        <div className="rounded-md border border-[var(--app-badge-error-border)] bg-[var(--app-badge-error-bg)] px-3 py-2 text-sm text-[var(--app-badge-error-text)]">
                            {query.error instanceof Error ? query.error.message : t('nativeSession.loadError')}
                        </div>
                    ) : null}

                    {query.isLoading ? (
                        <div className="text-sm text-[var(--app-hint)]">{t('nativeSession.loading')}</div>
                    ) : null}

                    {!query.isLoading && sessions.length === 0 ? (
                        <div className="rounded-md border border-dashed border-[var(--app-border)] px-3 py-4 text-sm text-[var(--app-hint)]">
                            {t('nativeSession.empty')}
                        </div>
                    ) : null}

                    {sessions.map((session) => {
                        const isPending = attachMutation.isPending
                            && attachMutation.variables?.tmuxPane === session.tmuxPane
                            && attachMutation.variables?.tmuxSession === session.tmuxSession

                        return (
                            <div
                                key={`${session.tmuxSession}:${session.tmuxPane}`}
                                className="rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-3"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 space-y-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <div className="truncate text-sm font-medium text-[var(--app-fg)]">
                                                {getDisplayName(session.cwd)}
                                            </div>
                                            <Badge>{session.command}</Badge>
                                            {session.sessionId ? (
                                                <Badge variant="success">{t('nativeSession.attached')}</Badge>
                                            ) : null}
                                        </div>
                                        <div className="text-xs text-[var(--app-hint)]">
                                            {session.tmuxSession}:{session.tmuxPane}
                                        </div>
                                        <div className="truncate text-xs text-[var(--app-hint)]">
                                            {session.cwd}
                                        </div>
                                    </div>

                                    {session.sessionId ? (
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            size="sm"
                                            onClick={() => props.onSuccess(session.sessionId!)}
                                        >
                                            {t('nativeSession.open')}
                                        </Button>
                                    ) : (
                                        <Button
                                            type="button"
                                            size="sm"
                                            disabled={isPending}
                                            onClick={() => {
                                                void attachMutation.mutateAsync({
                                                    tmuxSession: session.tmuxSession,
                                                    tmuxPane: session.tmuxPane,
                                                    agent: session.command
                                                })
                                            }}
                                        >
                                            {isPending ? t('nativeSession.attaching') : t('nativeSession.attach')}
                                        </Button>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </CardContent>
            </Card>
        </div>
    )
}
